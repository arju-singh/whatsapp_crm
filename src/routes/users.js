const express = require('express');
const db = require('../db');
const { hashPassword, requireRole, ROLES } = require('../auth');

const router = express.Router();

function normalizePhone(p) {
  let d = String(p || '').replace(/\D/g, '').replace(/^0+/, '');
  if (d.length === 10) d = '91' + d;
  return d;
}

router.get('/', requireRole('admin'), (req, res) => {
  const rows = db.prepare(`
    SELECT id, name, phone, role, active, created_at, last_login_at
    FROM users ORDER BY created_at DESC
  `).all();
  res.json({ rows });
});

router.post('/', requireRole('super_admin'), (req, res) => {
  const { name, phone, password, role } = req.body || {};
  if (!name || !phone || !password) return res.status(400).json({ error: 'name_phone_password_required' });
  if (String(password).length < 6) return res.status(400).json({ error: 'password_too_short' });
  if (role && !ROLES.includes(role)) return res.status(400).json({ error: 'invalid_role' });
  const normalized = normalizePhone(phone);
  if (normalized.length < 11) return res.status(400).json({ error: 'invalid_phone' });
  try {
    const r = db.prepare(`INSERT INTO users (name, phone, password_hash, role) VALUES (?, ?, ?, ?)`)
      .run(name, normalized, hashPassword(password), role || 'user');
    res.json({ id: r.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/:id', requireRole('super_admin'), (req, res) => {
  const id = Number(req.params.id);
  const { name, role, active, password } = req.body || {};
  const sets = [];
  const params = { id, updated_at: Date.now() };
  if (name !== undefined) { sets.push('name = @name'); params.name = name; }
  if (role !== undefined) {
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'invalid_role' });
    sets.push('role = @role'); params.role = role;
  }
  if (active !== undefined) { sets.push('active = @active'); params.active = active ? 1 : 0; }
  if (password !== undefined) {
    if (String(password).length < 6) return res.status(400).json({ error: 'password_too_short' });
    sets.push('password_hash = @ph'); params.ph = hashPassword(password);
  }
  if (!sets.length) return res.json({ ok: true });
  sets.push('updated_at = @updated_at');
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = @id`).run(params);
  res.json({ ok: true });
});

router.delete('/:id', requireRole('super_admin'), (req, res) => {
  const id = Number(req.params.id);
  if (req.user && req.user.id === id) return res.status(400).json({ error: 'cannot_delete_self' });
  db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
  res.json({ ok: true });
});

module.exports = router;
