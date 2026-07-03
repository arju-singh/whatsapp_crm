const express = require('express');
const db = require('../db');
const { body, S } = require('../validate');
const { requirePerm } = require('../permissions');
const { orgFilter } = require('../tenancy');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(db.prepare(`SELECT * FROM team_members WHERE ${orgFilter()} ORDER BY is_self DESC, name ASC`).all({ orgId: req.orgId }));
});

router.get('/me', (req, res) => {
  const me = db.prepare(`SELECT * FROM team_members WHERE is_self = 1 AND ${orgFilter()} LIMIT 1`).get({ orgId: req.orgId });
  res.json(me || null);
});

router.post('/', requirePerm('team.manage'), body({
  name: S.string({ maxLength: 200 }),
  role: S.string({ maxLength: 200 }),
  email: S.email({ maxLength: 254 }),
  avatar: S.string({ maxLength: 200 }),
  color: S.string({ maxLength: 60 }),
  quota: S.int({ min: 0 }),
  attained: S.int({ min: 0 }),
  is_self: S.flag(),
}), (req, res) => {
  const { name, role, email, avatar, color, quota, attained, is_self } = req.body;
  if (!name) return res.status(400).json({ error: 'name_required' });
  const initials = (avatar || name).split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const r = db.prepare(`
    INSERT INTO team_members (organization_id, name, role, email, avatar, color, quota, attained, is_self)
    VALUES (?, ?, ?, ?, ?, COALESCE(?, '#7A7670'), COALESCE(?, 0), COALESCE(?, 0), COALESCE(?, 0))
  `).run(req.orgId, name, role || null, email || null, initials, color, quota, attained, is_self ? 1 : 0);
  res.json({ id: r.lastInsertRowid });
});

router.put('/:id', requirePerm('team.manage'), body({
  name: S.string({ maxLength: 200 }),
  role: S.string({ maxLength: 200 }),
  email: S.email({ maxLength: 254 }),
  avatar: S.string({ maxLength: 200 }),
  color: S.string({ maxLength: 60 }),
  quota: S.int({ min: 0 }),
  attained: S.int({ min: 0 }),
  is_self: S.flag(),
}), (req, res) => {
  const allowed = ['name', 'role', 'email', 'avatar', 'color', 'quota', 'attained', 'is_self'];
  const sets = [];
  const params = { id: req.params.id, orgId: req.orgId };
  for (const k of allowed) if (req.body[k] !== undefined) {
    sets.push(`${k} = @${k}`);
    params[k] = k === 'is_self' ? (req.body[k] ? 1 : 0) : req.body[k];
  }
  if (!sets.length) return res.json({ ok: true });
  db.prepare(`UPDATE team_members SET ${sets.join(', ')} WHERE id = @id AND ${orgFilter()}`).run(params);
  res.json({ ok: true });
});

router.delete('/:id', requirePerm('team.manage'), (req, res) => {
  db.prepare(`UPDATE team_members SET deleted_at = @now WHERE id = @id AND ${orgFilter()}`)
    .run({ id: req.params.id, orgId: req.orgId, now: Date.now() });
  res.json({ ok: true });
});

module.exports = router;
