const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT c.*, t.name AS template_name,
      (SELECT COUNT(*) FROM messages m WHERE m.campaign_id = c.id AND m.status IN ('sent','delivered','read')) AS delivered_count,
      (SELECT COUNT(*) FROM messages m WHERE m.campaign_id = c.id AND m.status = 'read') AS read_count,
      (SELECT COUNT(*) FROM messages m JOIN vendors v ON v.id = m.vendor_id
        WHERE m.campaign_id = c.id AND v.last_replied_at IS NOT NULL AND v.last_replied_at > c.started_at) AS reply_count
    FROM campaigns c LEFT JOIN templates t ON t.id = c.template_id
    ORDER BY c.created_at DESC
  `).all();
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'not_found' });
  const messages = db.prepare(`
    SELECT m.*, v.name AS vendor_name, v.phone AS vendor_phone
    FROM messages m JOIN vendors v ON v.id = m.vendor_id
    WHERE m.campaign_id = ? ORDER BY m.created_at DESC
  `).all(req.params.id);
  res.json({ campaign: c, messages });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM campaigns WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
