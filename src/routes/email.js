const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const email = require('../email');
const transports = require('../transports');
const suppressions = require('./suppressions');
const settings = require('../settings');
const { body, S } = require('../validate');
const { orgFilter } = require('../tenancy');
const { requirePerm } = require('../permissions');

const router = express.Router();

// ----- Templates -----
router.get('/templates', (req, res) => {
  const rows = db.prepare(`SELECT * FROM email_templates WHERE ${orgFilter()} ORDER BY id DESC`).all({ orgId: req.orgId });
  res.json(rows);
});

router.post('/templates', body({
  name: S.string({ maxLength: 200 }),
  subject: S.string({ maxLength: 300 }),
  body_html: S.text({ maxLength: 10000 }),
  body_text: S.text({ maxLength: 10000 }),
  category: S.string({ maxLength: 200 }),
}), (req, res) => {
  const { name, subject, body_html, body_text, category } = req.body;
  if (!name || !subject || !body_html) return res.status(400).json({ error: 'name, subject, body_html required' });
  const r = db.prepare(`
    INSERT INTO email_templates (organization_id, name, subject, body_html, body_text, category) VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.orgId, name, subject, body_html, body_text || null, category || null);
  res.json({ id: r.lastInsertRowid });
});

router.put('/templates/:id', body({
  name: S.string({ maxLength: 200 }),
  subject: S.string({ maxLength: 300 }),
  body_html: S.text({ maxLength: 10000 }),
  body_text: S.text({ maxLength: 10000 }),
  category: S.string({ maxLength: 200 }),
}), (req, res) => {
  const { name, subject, body_html, body_text, category } = req.body;
  db.prepare(`
    UPDATE email_templates SET name=@name, subject=@subject, body_html=@body_html, body_text=@body_text, category=@category WHERE id=@id AND ${orgFilter()}
  `).run({ name, subject, body_html, body_text: body_text || null, category: category || null, id: req.params.id, orgId: req.orgId });
  res.json({ ok: true });
});

router.delete('/templates/:id', (req, res) => {
  db.prepare(`UPDATE email_templates SET deleted_at = @now WHERE id = @id AND ${orgFilter()}`)
    .run({ id: req.params.id, orgId: req.orgId, now: Date.now() });
  res.json({ ok: true });
});

// ----- Send -----
router.post('/send', requirePerm('email.send'), body({
  vendor_id: S.int({ min: 1 }),
  to_email: S.email({ maxLength: 254 }),
  template_id: S.int({ min: 1 }),
  subject: S.string({ maxLength: 300 }),
  body_html: S.text({ maxLength: 10000 }),
  body_text: S.text({ maxLength: 10000 }),
}), (req, res) => {
  const { vendor_id, to_email, template_id, subject, body_html, body_text } = req.body;
  let toAddr = to_email;
  let v = null;
  if (vendor_id) {
    v = db.prepare(`SELECT id, name, email FROM vendors WHERE id = @id AND ${orgFilter()}`).get({ id: vendor_id, orgId: req.orgId });
    if (!v) return res.status(404).json({ error: 'vendor_not_found' });
    toAddr = toAddr || v.email;
  }
  if (!toAddr) return res.status(400).json({ error: 'to_email_or_vendor_with_email_required' });
  if (suppressions.isSuppressed(req.orgId, { email: toAddr })) {
    return res.status(409).json({ error: 'suppressed' });
  }

  let subj = subject, html = body_html, text = body_text, tid = template_id || null;
  if (template_id) {
    const t = db.prepare(`SELECT * FROM email_templates WHERE id = @id AND ${orgFilter()}`).get({ id: template_id, orgId: req.orgId });
    if (!t) return res.status(404).json({ error: 'template_not_found' });
    subj = subj || t.subject;
    html = html || t.body_html;
    text = text || t.body_text;
  }
  if (!subj || !html) return res.status(400).json({ error: 'subject_and_body_html_required' });

  const r = db.prepare(`
    INSERT INTO emails (organization_id, vendor_id, template_id, direction, to_email, subject, body_html, body_text, status)
    VALUES (?, ?, ?, 'out', ?, ?, ?, ?, 'queued')
  `).run(req.orgId, vendor_id || null, tid, toAddr, subj, html, text || null);
  transports.sendMessage('email', r.lastInsertRowid);
  res.json({ id: r.lastInsertRowid, queued: true });
});

router.post('/bulk', requirePerm('email.send'), body({
  vendor_ids: S.array({ of: S.int({ min: 1 }), maxItems: 10000 }),
  template_id: S.int({ min: 1 }),
  subject: S.string({ maxLength: 300 }),
  body_html: S.text({ maxLength: 10000 }),
  body_text: S.text({ maxLength: 10000 }),
  campaign_name: S.string({ maxLength: 200 }),
}), (req, res) => {
  const { vendor_ids, template_id, subject, body_html, body_text, campaign_name } = req.body;
  if (!Array.isArray(vendor_ids) || !vendor_ids.length) {
    return res.status(400).json({ error: 'vendor_ids[] required' });
  }
  let subj = subject, html = body_html, text = body_text, tid = template_id || null;
  if (template_id) {
    const t = db.prepare(`SELECT * FROM email_templates WHERE id = @id AND ${orgFilter()}`).get({ id: template_id, orgId: req.orgId });
    if (!t) return res.status(404).json({ error: 'template_not_found' });
    subj = subj || t.subject;
    html = html || t.body_html;
    text = text || t.body_text;
  }
  if (!subj || !html) return res.status(400).json({ error: 'subject_and_body_html_required' });

  const camp = db.prepare(`
    INSERT INTO campaigns (organization_id, name, template_id, status, total_targets, started_at, channel)
    VALUES (?, ?, ?, 'running', ?, ?, 'email')
  `).run(req.orgId, campaign_name || `Email ${new Date().toISOString()}`, tid, vendor_ids.length, Date.now());
  const campaignId = camp.lastInsertRowid;

  const insert = db.prepare(`
    INSERT INTO emails (organization_id, vendor_id, campaign_id, template_id, direction, to_email, subject, body_html, body_text, status)
    VALUES (?, ?, ?, ?, 'out', ?, ?, ?, ?, 'queued')
  `);
  let queued = 0, skippedNoEmail = 0, skippedSuppressed = 0;
  const tx = db.transaction((ids) => {
    for (const vid of ids) {
      const v = db.prepare(`SELECT id, email FROM vendors WHERE id = @id AND ${orgFilter()}`).get({ id: vid, orgId: req.orgId });
      if (!v || !v.email) { skippedNoEmail++; continue; }
      if (suppressions.isSuppressed(req.orgId, { email: v.email })) { skippedSuppressed++; continue; }
      const r = insert.run(req.orgId, v.id, campaignId, tid, v.email, subj, html, text || null);
      transports.sendMessage('email', r.lastInsertRowid);
      queued++;
    }
  });
  tx(vendor_ids);
  res.json({ campaign_id: campaignId, queued, skipped_no_email: skippedNoEmail, skipped_suppressed: skippedSuppressed });
});

// ----- List/inspect -----
router.get('/', (req, res) => {
  const { vendor_id, status, limit = 200 } = req.query;
  const filters = [orgFilter('e')];
  const params = { orgId: req.orgId };
  if (vendor_id) { filters.push('e.vendor_id = @vendor_id'); params.vendor_id = vendor_id; }
  if (status) { filters.push('e.status = @status'); params.status = status; }
  const where = `WHERE ${filters.join(' AND ')}`;
  const rows = db.prepare(`
    SELECT e.*, v.name AS vendor_name FROM emails e
    LEFT JOIN vendors v ON v.id = e.vendor_id AND v.organization_id = @orgId AND v.deleted_at IS NULL
    ${where} ORDER BY e.created_at DESC LIMIT @limit
  `).all({ ...params, limit: Number(limit) });
  res.json(rows);
});

router.get('/status', (req, res) => {
  res.json({ configured: email.isConfigured() });
});

// ----- Webhooks (bounce/complaint/open events from email providers) -----

function applyWebhookEvent({ event, to_email, message_id, reason }) {
  const ev = String(event || '').toLowerCase();
  const isBounce = /bounce|hard[-_ ]?bounce|undeliver/i.test(ev);
  const isComplaint = /complain|spam[-_ ]?report|abuse/i.test(ev);
  const isOpen = /open/i.test(ev);
  const isClick = /click/i.test(ev);
  const isDelivery = /deliver/i.test(ev) && !isBounce;

  // Match the email row by message_id first, then by to_email (latest)
  let row = null;
  if (message_id) {
    row = db.prepare('SELECT * FROM emails WHERE message_id = ? ORDER BY id DESC LIMIT 1').get(message_id);
  }
  if (!row && to_email) {
    row = db.prepare(`
      SELECT * FROM emails WHERE LOWER(to_email) = LOWER(?) ORDER BY id DESC LIMIT 1
    `).get(to_email);
  }

  const now = Date.now();
  if (isOpen && row) {
    db.prepare(`UPDATE emails SET opened_at = COALESCE(opened_at, ?), open_count = open_count + 1 WHERE id = ?`).run(now, row.id);
  }
  if (isClick && row) {
    db.prepare(`UPDATE emails SET opened_at = COALESCE(opened_at, ?) WHERE id = ?`).run(now, row.id);
  }
  if (isDelivery && row) {
    db.prepare(`UPDATE emails SET status = CASE WHEN status IN ('sent','queued','sending','scheduled') THEN 'delivered' ELSE status END WHERE id = ?`).run(row.id);
  }
  if (isBounce) {
    if (row) db.prepare(`UPDATE emails SET status='bounced', error=? WHERE id=?`).run(reason || 'bounced', row.id);
    // Attribute the suppression to the org that actually sent this email (from the
    // matched row). No row → no org → addSuppression no-ops, so a webhook can never
    // create a suppression in the wrong (or default) tenant.
    suppressions.addSuppression({ orgId: row?.organization_id, email: to_email || row?.to_email, reason: 'bounce', source: 'webhook' });
    db.prepare(`INSERT INTO audit_log (event, vendor_id, email_id, detail) VALUES ('email_bounce', ?, ?, ?)`)
      .run(row?.vendor_id || null, row?.id || null, (reason || '').slice(0, 200));
  }
  if (isComplaint) {
    if (row) db.prepare(`UPDATE emails SET status='complained', error=? WHERE id=?`).run(reason || 'complaint', row.id);
    suppressions.addSuppression({ orgId: row?.organization_id, email: to_email || row?.to_email, reason: 'complaint', source: 'webhook' });
    db.prepare(`INSERT INTO audit_log (event, vendor_id, email_id, detail) VALUES ('email_complaint', ?, ?, ?)`)
      .run(row?.vendor_id || null, row?.id || null, (reason || '').slice(0, 200));
  }
}

// ---- signature verification helpers ----

function timingSafeEq(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function verifyResend(req) {
  // Resend uses Svix: signed = `${id}.${timestamp}.${rawBody}`, HMAC-SHA256, base64.
  // Header `svix-signature` is space-separated `v1,<sig>` pairs (multiple sigs during rotation).
  const secretRaw = settings.get('resend_webhook_secret') || '';
  if (!secretRaw) return { ok: true, skipped: true };
  const id = req.get('svix-id') || req.get('webhook-id');
  const ts = req.get('svix-timestamp') || req.get('webhook-timestamp');
  const sigHeader = req.get('svix-signature') || req.get('webhook-signature') || '';
  if (!id || !ts || !sigHeader || !req.rawBody) return { ok: false, reason: 'missing_headers_or_body' };
  // Reject replays older than 5 minutes
  const age = Math.abs(Math.floor(Date.now() / 1000) - parseInt(ts, 10));
  if (Number.isFinite(age) && age > 300) return { ok: false, reason: 'timestamp_skew' };
  // Strip whsec_ prefix and base64-decode
  const secret = secretRaw.startsWith('whsec_') ? secretRaw.slice('whsec_'.length) : secretRaw;
  let secretBuf;
  try { secretBuf = Buffer.from(secret, 'base64'); }
  catch (_) { return { ok: false, reason: 'bad_secret' }; }
  const signedPayload = `${id}.${ts}.${req.rawBody.toString('utf8')}`;
  const expected = crypto.createHmac('sha256', secretBuf).update(signedPayload).digest('base64');
  for (const part of sigHeader.split(/\s+/)) {
    const [, sig] = part.split(',');
    if (sig && timingSafeEq(expected, sig)) return { ok: true };
  }
  return { ok: false, reason: 'signature_mismatch' };
}

function verifyMailgun(req) {
  const key = settings.get('mailgun_signing_key') || '';
  if (!key) return { ok: true, skipped: true };
  const sig = (req.body && req.body.signature) || {};
  const { timestamp, token, signature } = sig;
  if (!timestamp || !token || !signature) return { ok: false, reason: 'missing_signature_object' };
  const age = Math.abs(Math.floor(Date.now() / 1000) - parseInt(timestamp, 10));
  if (Number.isFinite(age) && age > 300) return { ok: false, reason: 'timestamp_skew' };
  const expected = crypto.createHmac('sha256', key).update(timestamp + token).digest('hex');
  return timingSafeEq(expected, signature) ? { ok: true } : { ok: false, reason: 'signature_mismatch' };
}

// Providers with no HMAC signature scheme (generic/sendgrid/postmark) rely on a
// shared secret instead: the caller must present it via ?token= or the
// x-webhook-token header. Skipped (open) only when no secret is configured.
function verifySharedToken(req) {
  const secret = settings.get('email_webhook_secret') || process.env.EMAIL_WEBHOOK_SECRET || '';
  if (!secret) return { ok: true, skipped: true };
  const provided = String(req.get('x-webhook-token') || req.query.token || '');
  if (provided && timingSafeEq(provided, secret)) return { ok: true };
  return { ok: false, reason: 'bad_token' };
}

function rejectIfRequired(res, verdict, provider) {
  // Signature/token enforcement is on when explicitly enabled, and on by default
  // in production so no webhook route falls back to its permissive dev path.
  const required = settings.get('webhook_signature_required') === '1'
    || process.env.NODE_ENV === 'production';
  if (verdict.skipped) {
    if (!required) return false;
    res.status(401).json({ error: 'webhook_secret_not_configured', provider });
    return true;
  }
  if (verdict.ok) return false;
  console.warn(`[webhook] ${provider} signature failed: ${verdict.reason}`);
  res.status(401).json({ error: 'invalid_signature', reason: verdict.reason, provider });
  return true;
}

// Generic — accepts { event, email, message_id, reason }
router.post('/webhook/generic', (req, res) => {
  if (rejectIfRequired(res, verifySharedToken(req), 'generic')) return;
  const events = Array.isArray(req.body) ? req.body : [req.body];
  for (const e of events) {
    applyWebhookEvent({
      event: e.event || e.type,
      to_email: e.email || e.to || e.recipient,
      message_id: e.message_id || e.messageId || e.smtp_id,
      reason: e.reason || e.detail,
    });
  }
  res.json({ ok: true, processed: events.length });
});

// SendGrid event webhook — array of events
router.post('/webhook/sendgrid', (req, res) => {
  if (rejectIfRequired(res, verifySharedToken(req), 'sendgrid')) return;
  const events = Array.isArray(req.body) ? req.body : [];
  for (const e of events) {
    applyWebhookEvent({
      event: e.event,
      to_email: e.email,
      message_id: e['smtp-id'] || e.sg_message_id,
      reason: e.reason || e.response,
    });
  }
  res.json({ ok: true, processed: events.length });
});

// Resend webhook — { type, data: { email_id, to, ... } }
router.post('/webhook/resend', (req, res) => {
  const verdict = verifyResend(req);
  if (rejectIfRequired(res, verdict, 'resend')) return;
  const e = req.body || {};
  applyWebhookEvent({
    event: e.type || '',
    to_email: Array.isArray(e.data?.to) ? e.data.to[0] : (e.data?.to || ''),
    message_id: e.data?.email_id,
    reason: e.data?.reason || e.data?.error,
  });
  res.json({ ok: true, verified: !verdict.skipped });
});

// Postmark — { RecordType, Email, MessageID, Description }
router.post('/webhook/postmark', (req, res) => {
  if (rejectIfRequired(res, verifySharedToken(req), 'postmark')) return;
  const e = req.body || {};
  applyWebhookEvent({
    event: e.RecordType || e.Type,
    to_email: e.Email || e.Recipient,
    message_id: e.MessageID,
    reason: e.Description || e.Details,
  });
  res.json({ ok: true });
});

// Mailgun — { 'event-data': { event, recipient, message: { headers: { 'message-id' } } } }
router.post('/webhook/mailgun', (req, res) => {
  const verdict = verifyMailgun(req);
  if (rejectIfRequired(res, verdict, 'mailgun')) return;
  const e = (req.body && req.body['event-data']) || req.body || {};
  applyWebhookEvent({
    event: e.event,
    to_email: e.recipient,
    message_id: e.message?.headers?.['message-id'],
    reason: e.reason || e['delivery-status']?.description,
  });
  res.json({ ok: true, verified: !verdict.skipped });
});

// 1×1 transparent gif for open tracking
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
router.get('/track/:token.gif', (req, res) => {
  // Record an open ONLY when the signed token verifies. Prevents anyone from
  // enumerating sequential ids to tamper with other tenants' open counts — the
  // token is an HMAC of the email id, so it can't be forged or guessed. An old
  // or bogus token simply returns the pixel without recording (safe degradation).
  const id = email.verifyEmailTrackToken(req.params.token);
  if (id) {
    const now = Date.now();
    db.prepare(`
      UPDATE emails
      SET opened_at = COALESCE(opened_at, ?), open_count = open_count + 1
      WHERE id = ?
    `).run(now, id);
  }
  res.set('Content-Type', 'image/gif');
  res.set('Cache-Control', 'no-store');
  res.send(PIXEL);
});

module.exports = router;
