const express = require('express');
const db = require('../db');
const wa = require('../whatsapp');
const transports = require('../transports');
const { body, S } = require('../validate');
const { orgFilter, ownedByOrg, ownedIds } = require('../tenancy');
const { requirePerm } = require('../permissions');

const router = express.Router();

router.post('/test', requirePerm('messages.send'), body({
  to_phone: S.string({ maxLength: 32 }),
  body: S.text(),
  template_id: S.int({ min: 1 }),
}), (req, res) => {
  const { to_phone, body, template_id } = req.body;
  const phone = String(to_phone || process.env.TEST_NUMBER || '').replace(/\D/g, '');
  if (!phone) return res.status(400).json({ error: 'to_phone or TEST_NUMBER env required' });
  let messageBody = body;
  if (!messageBody && template_id) {
    const t = db.prepare(`SELECT body FROM templates WHERE id = @id AND ${orgFilter()}`).get({ id: template_id, orgId: req.orgId });
    if (!t) return res.status(404).json({ error: 'template_not_found' });
    messageBody = t.body;
  }
  if (!messageBody) return res.status(400).json({ error: 'body_or_template_required' });
  // Use a stub vendor row so the existing pipeline (sendOne) handles it. Upsert by phone.
  let v = db.prepare(`SELECT id FROM vendors WHERE phone = @phone AND ${orgFilter()}`).get({ phone, orgId: req.orgId });
  if (!v) {
    const r = db.prepare(`INSERT INTO vendors (organization_id, name, phone, status) VALUES (?, ?, ?, 'test')`).run(req.orgId, 'Test recipient', phone);
    v = { id: r.lastInsertRowid };
  }
  const msg = db.prepare(`
    INSERT INTO messages (organization_id, vendor_id, direction, body, status) VALUES (?, ?, 'out', ?, 'queued')
  `).run(req.orgId, v.id, messageBody);
  transports.sendMessage('whatsapp', msg.lastInsertRowid);
  res.json({ id: msg.lastInsertRowid, queued: true, to_phone: phone });
});

router.post('/preview', body({
  vendor_id: S.int({ min: 1 }),
  body: S.text(),
  template_id: S.int({ min: 1 }),
}), (req, res) => {
  const { vendor_id, body, template_id } = req.body;
  let messageBody = body;
  if (!messageBody && template_id) {
    const t = db.prepare(`SELECT body FROM templates WHERE id = @id AND ${orgFilter()}`).get({ id: template_id, orgId: req.orgId });
    if (!t) return res.status(404).json({ error: 'template_not_found' });
    messageBody = t.body;
  }
  if (!messageBody) return res.status(400).json({ error: 'body_or_template_required' });
  const v = vendor_id ? db.prepare(`SELECT name, company, email FROM vendors WHERE id = @id AND ${orgFilter()}`).get({ id: vendor_id, orgId: req.orgId }) : null;
  const wa = require('../whatsapp');
  const rendered = wa.renderTemplate(messageBody, {
    name: (v && v.name) || 'Sample Name',
    company: (v && v.company) || 'Acme Inc',
    email: (v && v.email) || 'sample@example.com',
  });
  res.json({ rendered });
});

router.post('/send', requirePerm('messages.send'), body({
  vendor_id: S.int({ min: 1 }),
  body: S.text(),
  template_id: S.int({ min: 1 }),
  scheduled_at: S.int({ min: 0 }),
}), (req, res) => {
  const { vendor_id, body, template_id } = req.body;
  if (!vendor_id || (!body && !template_id)) {
    return res.status(400).json({ error: 'vendor_id and (body or template_id) required' });
  }
  // The target contact must belong to the caller's org — otherwise this would
  // dispatch a WhatsApp message to another tenant's contact (cross-tenant send).
  if (!ownedByOrg('vendors', vendor_id, req.orgId)) {
    return res.status(404).json({ error: 'vendor_not_found' });
  }
  let messageBody = body;
  if (!messageBody && template_id) {
    const t = db.prepare(`SELECT body FROM templates WHERE id = @id AND ${orgFilter()}`).get({ id: template_id, orgId: req.orgId });
    if (!t) return res.status(404).json({ error: 'template_not_found' });
    messageBody = t.body;
  }
  const scheduleMs = Number(req.body.scheduled_at) || 0;
  const future = scheduleMs > Date.now() + 30_000;
  const r = db.prepare(`
    INSERT INTO messages (organization_id, vendor_id, direction, body, status, scheduled_at, next_attempt_at)
    VALUES (?, ?, 'out', ?, ?, ?, ?)
  `).run(req.orgId, vendor_id, messageBody, future ? 'scheduled' : 'queued', future ? scheduleMs : null, future ? scheduleMs : null);
  if (!future) transports.sendMessage('whatsapp', r.lastInsertRowid);
  res.json({ id: r.lastInsertRowid, queued: !future, scheduled_at: future ? scheduleMs : null });
});

router.post('/bulk', requirePerm('messages.send'), body({
  vendor_ids: S.array({ of: S.int({ min: 1 }), maxItems: 100000 }),
  template_id: S.int({ min: 1 }),
  body: S.text(),
  campaign_name: S.string({ maxLength: 200 }),
  scheduled_at: S.int({ min: 0 }),
}), (req, res) => {
  const { vendor_ids, template_id, body, campaign_name, scheduled_at } = req.body;
  if (!Array.isArray(vendor_ids) || !vendor_ids.length) {
    return res.status(400).json({ error: 'vendor_ids[] required' });
  }
  // Strip any vendor_ids that aren't this org's contacts before building the
  // campaign, so a bulk send can never fan out to another tenant's numbers.
  const owned = ownedIds('vendors', vendor_ids, req.orgId);
  const targetIds = vendor_ids.filter((id) => owned.has(Number(id)));
  const skippedForeign = vendor_ids.length - targetIds.length;
  if (!targetIds.length) return res.status(400).json({ error: 'no_valid_vendor_ids' });
  let messageBody = body;
  let tid = template_id || null;
  if (!messageBody && tid) {
    const t = db.prepare(`SELECT body FROM templates WHERE id = @id AND ${orgFilter()}`).get({ id: tid, orgId: req.orgId });
    if (!t) return res.status(404).json({ error: 'template_not_found' });
    messageBody = t.body;
  }
  if (!messageBody) return res.status(400).json({ error: 'body_or_template_required' });

  const scheduleMs = Number(scheduled_at) || 0;
  const future = scheduleMs > Date.now() + 30_000;

  const camp = db.prepare(`
    INSERT INTO campaigns (organization_id, name, template_id, status, total_targets, started_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    req.orgId,
    campaign_name || `Campaign ${new Date().toISOString()}`,
    tid,
    future ? 'scheduled' : 'running',
    targetIds.length,
    future ? scheduleMs : Date.now(),
  );
  const campaignId = camp.lastInsertRowid;

  const insertMsg = db.prepare(`
    INSERT INTO messages (organization_id, vendor_id, campaign_id, direction, body, status, scheduled_at, next_attempt_at)
    VALUES (?, ?, ?, 'out', ?, ?, ?, ?)
  `);
  const tx = db.transaction((ids) => {
    const out = [];
    for (const vid of ids) {
      const r = insertMsg.run(
        req.orgId, vid, campaignId, messageBody,
        future ? 'scheduled' : 'queued',
        future ? scheduleMs : null,
        future ? scheduleMs : null,
      );
      out.push(r.lastInsertRowid);
    }
    return out;
  });
  const ids = tx(targetIds);
  if (!future) for (const id of ids) transports.sendMessage('whatsapp', id);
  res.json({ campaign_id: campaignId, queued: !future ? ids.length : 0, scheduled: future ? ids.length : 0, skipped_foreign: skippedForeign, scheduled_at: future ? scheduleMs : null });
});

router.get('/', (req, res) => {
  const { vendor_id, campaign_id, status, limit = 200 } = req.query;
  const filters = [orgFilter('m')];
  const params = { orgId: req.orgId };
  if (vendor_id) { filters.push('m.vendor_id = @vendor_id'); params.vendor_id = vendor_id; }
  if (campaign_id) { filters.push('m.campaign_id = @campaign_id'); params.campaign_id = campaign_id; }
  if (status) { filters.push('m.status = @status'); params.status = status; }
  const where = `WHERE ${filters.join(' AND ')}`;
  const rows = db.prepare(`
    SELECT m.*, v.name AS vendor_name, v.phone AS vendor_phone
    FROM messages m JOIN vendors v ON v.id = m.vendor_id AND v.organization_id = @orgId
    ${where} ORDER BY m.created_at DESC LIMIT @limit
  `).all({ ...params, limit: Number(limit) });
  res.json(rows);
});

router.get('/stats/by-template', (req, res) => {
  const rows = db.prepare(`
    SELECT
      t.id AS template_id, t.name AS template_name,
      SUM(CASE WHEN m.direction='out' THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN m.direction='out' AND m.status IN ('sent','delivered','read') THEN 1 ELSE 0 END) AS delivered_or_better,
      SUM(CASE WHEN m.direction='out' AND m.status IN ('delivered','read') THEN 1 ELSE 0 END) AS delivered,
      SUM(CASE WHEN m.direction='out' AND m.status='read' THEN 1 ELSE 0 END) AS read_count,
      (SELECT COUNT(*) FROM messages m2 WHERE m2.direction='in' AND m2.organization_id = @orgId AND m2.vendor_id IN (
        SELECT DISTINCT m3.vendor_id FROM messages m3 JOIN campaigns c2 ON c2.id = m3.campaign_id
        WHERE c2.template_id = t.id AND m3.organization_id = @orgId AND c2.organization_id = @orgId
      )) AS replies
    FROM templates t
    LEFT JOIN campaigns c ON c.template_id = t.id
    LEFT JOIN messages m ON m.campaign_id = c.id
    WHERE ${orgFilter('t')}
    GROUP BY t.id, t.name
    ORDER BY sent DESC NULLS LAST
  `).all({ orgId: req.orgId });
  res.json(rows);
});

router.get('/stats/summary', (req, res) => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const totals = db.prepare(`
    SELECT
      SUM(CASE WHEN direction='out' THEN 1 ELSE 0 END) AS sent_total,
      SUM(CASE WHEN direction='out' AND status IN ('sent','delivered','read') THEN 1 ELSE 0 END) AS delivered,
      SUM(CASE WHEN direction='out' AND status='read' THEN 1 ELSE 0 END) AS read_count,
      SUM(CASE WHEN direction='out' AND status='failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN direction='in' THEN 1 ELSE 0 END) AS replies,
      SUM(CASE WHEN direction='out' AND created_at >= @today THEN 1 ELSE 0 END) AS sent_today
    FROM messages WHERE ${orgFilter()}
  `).get({ today: today.getTime(), orgId: req.orgId });
  res.json(totals);
});

// Cancel a still-pending message. Only allowed for queued/scheduled rows;
// once a message has been claimed by the worker (sending/sent/delivered/read), refuse.
router.delete('/:id', (req, res) => {
  const m = db.prepare(`SELECT id, status FROM messages WHERE id = @id AND ${orgFilter()}`).get({ id: req.params.id, orgId: req.orgId });
  if (!m) return res.status(404).json({ error: 'not_found' });
  if (m.status !== 'queued' && m.status !== 'scheduled') {
    return res.status(409).json({ error: 'cannot_cancel', detail: `message is ${m.status}` });
  }
  db.prepare(`UPDATE messages SET status='cancelled', error='cancelled by user' WHERE id = @id AND ${orgFilter()}`).run({ id: req.params.id, orgId: req.orgId });
  res.json({ ok: true });
});

// Bulk cancel: only messages still queued/scheduled can be cancelled; others
// (already sending/sent/...) are skipped and reported back.
router.post('/delete-bulk', body({ ids: S.array({ of: S.int({ min: 1 }), maxItems: 10000 }) }), (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids_array_required' });
  const sel = db.prepare(`SELECT status FROM messages WHERE id = @id AND ${orgFilter()}`);
  const upd = db.prepare(`UPDATE messages SET status='cancelled', error='cancelled by user' WHERE id = @id AND ${orgFilter()}`);
  let deleted = 0, skipped = 0;
  const tx = db.transaction((rows) => {
    for (const id of rows) {
      const m = sel.get({ id, orgId: req.orgId });
      if (m && (m.status === 'queued' || m.status === 'scheduled')) { upd.run({ id, orgId: req.orgId }); deleted++; }
      else skipped++;
    }
  });
  tx(ids);
  res.json({ deleted, skipped });
});

module.exports = router;
