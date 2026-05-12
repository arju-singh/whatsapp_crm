const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM stages ORDER BY position ASC, id ASC').all());
});

router.post('/', (req, res) => {
  const { name, color, probability, position, is_won, is_lost } = req.body;
  if (!name) return res.status(400).json({ error: 'name_required' });
  const r = db.prepare(`
    INSERT INTO stages (name, color, probability, position, is_won, is_lost)
    VALUES (?, ?, COALESCE(?, 0), COALESCE(?, 99), COALESCE(?, 0), COALESCE(?, 0))
  `).run(name, color || '#A8A29E', probability, position, is_won, is_lost);
  res.json({ id: r.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const allowed = ['name', 'color', 'probability', 'position', 'is_won', 'is_lost'];
  const sets = [];
  const params = { id: req.params.id };
  for (const k of allowed) if (req.body[k] !== undefined) { sets.push(`${k} = @${k}`); params[k] = req.body[k]; }
  if (!sets.length) return res.json({ ok: true });
  db.prepare(`UPDATE stages SET ${sets.join(', ')} WHERE id = @id`).run(params);
  res.json({ ok: true });
});

router.put('/reorder', (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order_array_required' });
  const upd = db.prepare('UPDATE stages SET position = ? WHERE id = ?');
  const tx = db.transaction(() => { order.forEach((id, idx) => upd.run(idx + 1, id)); });
  tx();
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM stages WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
