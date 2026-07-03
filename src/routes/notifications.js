const express = require('express');
const db = require('../db');
const { body, S } = require('../validate');
const { orgFilter } = require('../tenancy');

const router = express.Router();

router.get('/', (req, res) => {
  const rows = db.prepare(`SELECT * FROM notifications WHERE ${orgFilter()} ORDER BY created_at DESC LIMIT 100`).all({ orgId: req.orgId });
  const unread = db.prepare(`SELECT COUNT(*) AS c FROM notifications WHERE unread = 1 AND ${orgFilter()}`).get({ orgId: req.orgId }).c;
  res.json({ rows, unread });
});

router.post('/', body({
  kind: S.string({ maxLength: 60 }),
  text: S.text(),
  link: S.string({ maxLength: 2000 }),
}), (req, res) => {
  const { kind, text, link } = req.body;
  if (!text) return res.status(400).json({ error: 'text_required' });
  const r = db.prepare(`INSERT INTO notifications (organization_id, kind, text, link) VALUES (?, ?, ?, ?)`)
    .run(req.orgId, kind || 'info', text, link || null);
  res.json({ id: r.lastInsertRowid });
});

router.put('/:id/read', (req, res) => {
  db.prepare(`UPDATE notifications SET unread = 0 WHERE id = @id AND ${orgFilter()}`).run({ id: req.params.id, orgId: req.orgId });
  res.json({ ok: true });
});

router.put('/read-all', (req, res) => {
  db.prepare(`UPDATE notifications SET unread = 0 WHERE unread = 1 AND ${orgFilter()}`).run({ orgId: req.orgId });
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare(`UPDATE notifications SET deleted_at = @now WHERE id = @id AND ${orgFilter()}`)
    .run({ id: req.params.id, orgId: req.orgId, now: Date.now() });
  res.json({ ok: true });
});

module.exports = router;
