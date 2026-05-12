const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(db.prepare(`SELECT * FROM team_members ORDER BY is_self DESC, name ASC`).all());
});

router.get('/me', (req, res) => {
  const me = db.prepare('SELECT * FROM team_members WHERE is_self = 1 LIMIT 1').get();
  res.json(me || null);
});

router.post('/', (req, res) => {
  const { name, role, email, avatar, color, quota, attained, is_self } = req.body;
  if (!name) return res.status(400).json({ error: 'name_required' });
  const initials = (avatar || name).split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const r = db.prepare(`
    INSERT INTO team_members (name, role, email, avatar, color, quota, attained, is_self)
    VALUES (?, ?, ?, ?, COALESCE(?, '#7A7670'), COALESCE(?, 0), COALESCE(?, 0), COALESCE(?, 0))
  `).run(name, role || null, email || null, initials, color, quota, attained, is_self ? 1 : 0);
  res.json({ id: r.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const allowed = ['name', 'role', 'email', 'avatar', 'color', 'quota', 'attained', 'is_self'];
  const sets = [];
  const params = { id: req.params.id };
  for (const k of allowed) if (req.body[k] !== undefined) {
    sets.push(`${k} = @${k}`);
    params[k] = k === 'is_self' ? (req.body[k] ? 1 : 0) : req.body[k];
  }
  if (!sets.length) return res.json({ ok: true });
  db.prepare(`UPDATE team_members SET ${sets.join(', ')} WHERE id = @id`).run(params);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM team_members WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
