const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const rows = db.prepare(`SELECT * FROM notifications ORDER BY created_at DESC LIMIT 100`).all();
  const unread = db.prepare(`SELECT COUNT(*) AS c FROM notifications WHERE unread = 1`).get().c;
  res.json({ rows, unread });
});

router.post('/', (req, res) => {
  const { kind, text, link } = req.body;
  if (!text) return res.status(400).json({ error: 'text_required' });
  const r = db.prepare(`INSERT INTO notifications (kind, text, link) VALUES (?, ?, ?)`)
    .run(kind || 'info', text, link || null);
  res.json({ id: r.lastInsertRowid });
});

router.put('/:id/read', (req, res) => {
  db.prepare(`UPDATE notifications SET unread = 0 WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

router.put('/read-all', (req, res) => {
  db.prepare(`UPDATE notifications SET unread = 0 WHERE unread = 1`).run();
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM notifications WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
