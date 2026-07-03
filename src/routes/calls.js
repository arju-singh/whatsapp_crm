const express = require('express');
const db = require('../db');
const telephony = require('../telephony');
const { body, S } = require('../validate');
const { orgFilter } = require('../tenancy');
const { requirePerm } = require('../permissions');

const router = express.Router();

const callBodySchema = {
  vendor_id: S.int({ min: 1 }),
  direction: S.string({ maxLength: 60 }),
  disposition: S.string({ maxLength: 60 }),
  outcome: S.string({ maxLength: 60 }),
  duration_sec: S.int({ min: 0 }),
  notes: S.text(),
  caller: S.string({ maxLength: 200 }),
};

router.get('/', (req, res) => {
  const { vendor_id, limit = 200 } = req.query;
  const filters = [orgFilter('c')];
  const params = { orgId: req.orgId, limit: Number(limit) };
  if (vendor_id) { filters.push('c.vendor_id = @vendor_id'); params.vendor_id = vendor_id; }
  const where = `WHERE ${filters.join(' AND ')}`;
  const rows = db.prepare(`
    SELECT c.*, v.name AS vendor_name, v.phone AS vendor_phone
    FROM calls c JOIN vendors v ON v.id = c.vendor_id
    ${where} ORDER BY c.created_at DESC LIMIT @limit
  `).all(params);
  res.json(rows);
});

router.post('/', body(callBodySchema), (req, res) => {
  const { vendor_id, direction, disposition, outcome, duration_sec, notes, caller } = req.body;
  if (!vendor_id) return res.status(400).json({ error: 'vendor_id_required' });
  const r = db.prepare(`
    INSERT INTO calls (organization_id, vendor_id, direction, disposition, outcome, duration_sec, notes, caller)
    VALUES (?, ?, COALESCE(?, 'out'), ?, ?, ?, ?, ?)
  `).run(req.orgId, vendor_id, direction || null, disposition || null, outcome || null, duration_sec || null, notes || null, caller || null);

  const now = Date.now();
  db.prepare(`
    UPDATE vendors SET last_contacted_at = @now, updated_at = @now,
      status = CASE
        WHEN @outcome = 'won' THEN 'won'
        WHEN @outcome = 'lost' THEN 'lost'
        WHEN status = 'new' THEN 'contacted'
        ELSE status END
    WHERE id = @id AND ${orgFilter()}
  `).run({ now, outcome: outcome || '', id: vendor_id, orgId: req.orgId });
  res.json({ id: r.lastInsertRowid });
});

// Twilio call-status webhook. Public (whitelisted in PUBLIC_PATHS) — Twilio posts
// form-encoded with no session, so we parse urlencoded here and verify the
// X-Twilio-Signature before touching the DB. Matches the call row by CallSid
// (globally unique, set when we placed the call) — no org context needed. Always
// replies 200 with empty TwiML so Twilio doesn't retry on our processing.
router.post('/twilio/status', express.urlencoded({ extended: false }), (req, res) => {
  const replyOk = () => res.type('text/xml').send('<Response></Response>');
  const params = req.body || {};
  const url = process.env.TWILIO_STATUS_CALLBACK
    || `${process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`}${req.originalUrl}`;
  if (!telephony.validateTwilioSignature(req.get('X-Twilio-Signature'), url, params)) {
    return res.status(403).type('text/xml').send('<Response></Response>');
  }
  const sid = params.CallSid;
  if (!sid) return replyOk();
  const sets = ['status = @status'];
  const p = { sid, status: telephony.mapTwilioStatus(params.CallStatus) };
  if (params.CallDuration != null && params.CallDuration !== '') {
    sets.push('duration_sec = @duration'); p.duration = Number(params.CallDuration);
  }
  if (params.RecordingUrl) { sets.push('recording_url = @recording'); p.recording = params.RecordingUrl; }
  db.prepare(`UPDATE calls SET ${sets.join(', ')} WHERE provider_call_id = @sid`).run(p);
  replyOk();
});

// Available telephony providers + which one this org dials through.
router.get('/providers', (req, res) => {
  res.json({ active: telephony.activeProviderKey(), providers: telephony.providers() });
});

// Place an outbound call to a contact through the active provider. Persists the
// `calls` row first (org-stamped), then hands it to the telephony layer — the
// same persist-then-deliver shape as messaging. With no carrier configured this
// runs the dry-run 'log' provider and records an initiated call.
router.post('/dial', requirePerm('calls.make'), body({
  vendor_id: S.int({ min: 1 }),
  from: S.string({ maxLength: 32 }),
  agent: S.string({ maxLength: 200 }),
}), async (req, res) => {
  const { vendor_id, from, agent } = req.body;
  if (!vendor_id) return res.status(400).json({ error: 'vendor_id_required' });
  const vendor = db.prepare(`SELECT id, name, phone FROM vendors WHERE id = @id AND ${orgFilter()}`)
    .get({ id: vendor_id, orgId: req.orgId });
  if (!vendor) return res.status(404).json({ error: 'vendor_not_found' });

  const providerKey = telephony.activeProviderKey();
  const r = db.prepare(`
    INSERT INTO calls (organization_id, vendor_id, direction, disposition, status, provider, caller)
    VALUES (?, ?, 'out', 'initiated', 'initiated', ?, ?)
  `).run(req.orgId, vendor.id, providerKey, agent || req.user.name || null);
  const callId = r.lastInsertRowid;

  try {
    const result = await telephony.placeCall({
      callId, to: vendor.phone, from: from || null, agent: agent || req.user.name, orgId: req.orgId,
    });
    db.prepare('UPDATE calls SET status = ?, provider_call_id = ? WHERE id = ?')
      .run(result.status || 'initiated', result.providerCallId || null, callId);
    db.prepare(`UPDATE vendors SET last_contacted_at = @now, updated_at = @now,
        status = CASE WHEN status = 'new' THEN 'contacted' ELSE status END
      WHERE id = @id AND ${orgFilter()}`).run({ now: Date.now(), id: vendor.id, orgId: req.orgId });
    res.json({ id: callId, provider: providerKey, status: result.status || 'initiated', dry_run: !!result.dryRun, to: vendor.phone });
  } catch (e) {
    db.prepare('UPDATE calls SET status = ? WHERE id = ?').run('failed', callId);
    res.status(502).json({ error: 'dial_failed', detail: e.message, provider: providerKey, id: callId });
  }
});

router.put('/:id', body({
  direction: S.string({ maxLength: 60 }),
  disposition: S.string({ maxLength: 60 }),
  outcome: S.string({ maxLength: 60 }),
  duration_sec: S.int({ min: 0 }),
  notes: S.text(),
  caller: S.string({ maxLength: 200 }),
}), (req, res) => {
  const allowed = ['direction', 'disposition', 'outcome', 'duration_sec', 'notes', 'caller'];
  const sets = [];
  const params = { id: req.params.id, orgId: req.orgId };
  for (const k of allowed) if (req.body[k] !== undefined) { sets.push(`${k} = @${k}`); params[k] = req.body[k]; }
  if (!sets.length) return res.json({ ok: true });
  db.prepare(`UPDATE calls SET ${sets.join(', ')} WHERE id = @id AND ${orgFilter()}`).run(params);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare(`UPDATE calls SET deleted_at = @now WHERE id = @id AND ${orgFilter()}`)
    .run({ id: req.params.id, orgId: req.orgId, now: Date.now() });
  res.json({ ok: true });
});

router.get('/stats/summary', (req, res) => {
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN disposition = 'connected' THEN 1 ELSE 0 END) AS connected,
      SUM(CASE WHEN disposition = 'voicemail' THEN 1 ELSE 0 END) AS voicemail,
      SUM(CASE WHEN disposition = 'no_answer' THEN 1 ELSE 0 END) AS no_answer,
      SUM(CASE WHEN disposition = 'callback_request' THEN 1 ELSE 0 END) AS callbacks,
      SUM(CASE WHEN disposition = 'busy' THEN 1 ELSE 0 END) AS busy,
      SUM(CASE WHEN disposition = 'wrong_number' THEN 1 ELSE 0 END) AS wrong_number,
      SUM(CASE WHEN outcome = 'interested' THEN 1 ELSE 0 END) AS interested,
      SUM(CASE WHEN outcome = 'won' THEN 1 ELSE 0 END) AS won
    FROM calls WHERE ${orgFilter()}
  `).get({ orgId: req.orgId });
  res.json(totals);
});

router.post('/delete-bulk', body({ ids: S.array({ of: S.int({ min: 1 }), maxItems: 10000 }) }), (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids_array_required' });
  const del = db.prepare(`UPDATE calls SET deleted_at = @now WHERE id = @id AND ${orgFilter()}`);
  const tx = db.transaction((rows) => { for (const id of rows) del.run({ id, orgId: req.orgId, now: Date.now() }); });
  tx(ids);
  res.json({ deleted: ids.length });
});

module.exports = router;
