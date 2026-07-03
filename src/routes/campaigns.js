const express = require('express');
const db = require('../db');
const { body, S } = require('../validate');
const { orgFilter } = require('../tenancy');

const router = express.Router();

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT c.*, t.name AS template_name,
      (SELECT COUNT(*) FROM messages m WHERE m.campaign_id = c.id AND m.status IN ('sent','delivered','read')) AS delivered_count,
      (SELECT COUNT(*) FROM messages m WHERE m.campaign_id = c.id AND m.status = 'read') AS read_count,
      (SELECT COUNT(*) FROM messages m JOIN vendors v ON v.id = m.vendor_id
        WHERE m.campaign_id = c.id AND v.last_replied_at IS NOT NULL AND v.last_replied_at > c.started_at) AS reply_count
    FROM campaigns c LEFT JOIN templates t ON t.id = c.template_id
    WHERE ${orgFilter('c')}
    ORDER BY c.created_at DESC
  `).all({ orgId: req.orgId });
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const c = db.prepare(`SELECT * FROM campaigns WHERE id = @id AND ${orgFilter()}`).get({ id: req.params.id, orgId: req.orgId });
  if (!c) return res.status(404).json({ error: 'not_found' });
  const messages = db.prepare(`
    SELECT m.*, v.name AS vendor_name, v.phone AS vendor_phone
    FROM messages m JOIN vendors v ON v.id = m.vendor_id
    WHERE m.campaign_id = @id AND ${orgFilter('m')} ORDER BY m.created_at DESC
  `).all({ id: req.params.id, orgId: req.orgId });
  res.json({ campaign: c, messages });
});

router.delete('/:id', (req, res) => {
  db.prepare(`UPDATE campaigns SET deleted_at = @now WHERE id = @id AND ${orgFilter()}`).run({ id: req.params.id, orgId: req.orgId, now: Date.now() });
  res.json({ ok: true });
});

router.post('/delete-bulk', body({ ids: S.array({ of: S.int({ min: 1 }), maxItems: 10000 }) }), (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids_array_required' });
  const del = db.prepare(`UPDATE campaigns SET deleted_at = @now WHERE id = @id AND ${orgFilter()}`);
  const tx = db.transaction((rows) => { for (const id of rows) del.run({ id, orgId: req.orgId, now: Date.now() }); });
  tx(ids);
  res.json({ deleted: ids.length });
});

module.exports = router;
