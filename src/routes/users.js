const express = require('express');
const db = require('../db');
const { hashPassword, ROLES } = require('../auth');
const { requirePerm } = require('../permissions');
const { body, S } = require('../validate');

const router = express.Router();

// Historically hard-coded '91'; delegate to the shared util, preserving that.
const normalizePhone = (p) => require('../phone').normalizePhone(p, '91');

// Account management is scoped to the caller's active organization. `users` is
// a global table, so WITHOUT this scoping a users.manage holder in one org could
// list/edit/delete accounts belonging only to other orgs (cross-tenant account
// takeover / privilege escalation). Membership in req.orgId is the boundary.
function isMemberOfOrg(userId, orgId) {
  if (!orgId) return false;
  return !!db.prepare(
    'SELECT 1 FROM memberships WHERE user_id = ? AND organization_id = ?',
  ).get(userId, orgId);
}

// Map the (legacy, global) users.role to a membership role scoped to this org.
function membershipRoleFor(globalRole) {
  return (globalRole === 'admin' || globalRole === 'super_admin') ? 'owner' : 'member';
}

router.get('/', requirePerm('users.read'), (req, res) => {
  // Only accounts that are members of the caller's active org.
  const rows = db.prepare(`
    SELECT u.id, u.name, u.phone, u.role, u.active, u.created_at, u.last_login_at, m.role AS org_role
    FROM users u
    JOIN memberships m ON m.user_id = u.id AND m.organization_id = @orgId
    ORDER BY u.created_at DESC
  `).all({ orgId: req.orgId });
  res.json({ rows });
});

router.post('/', requirePerm('users.manage'), body({
  name: S.string({ required: true, maxLength: 200 }),
  phone: S.string({ required: true, maxLength: 32 }),
  password: S.string({ required: true, minLength: 6, maxLength: 200 }),
  role: S.string({ maxLength: 60 }),
}), (req, res) => {
  if (!req.orgId) return res.status(400).json({ error: 'no_active_organization' });
  const { name, phone, password, role } = req.body || {};
  if (!name || !phone || !password) return res.status(400).json({ error: 'name_phone_password_required' });
  if (String(password).length < 6) return res.status(400).json({ error: 'password_too_short' });
  if (role && !ROLES.includes(role)) return res.status(400).json({ error: 'invalid_role' });
  const normalized = normalizePhone(phone);
  if (normalized.length < 11) return res.status(400).json({ error: 'invalid_phone' });
  try {
    // Create the account AND bind it to the caller's org via a membership, so a
    // newly created team member lands in THIS workspace — never a stray global
    // account that would later self-provision its own isolated org.
    const newId = db.transaction(() => {
      const r = db.prepare(`INSERT INTO users (name, phone, password_hash, role) VALUES (?, ?, ?, ?)`)
        .run(name, normalized, hashPassword(password), role || 'user');
      db.prepare(`INSERT OR IGNORE INTO memberships (organization_id, user_id, role) VALUES (?, ?, ?)`)
        .run(req.orgId, r.lastInsertRowid, membershipRoleFor(role || 'user'));
      return r.lastInsertRowid;
    })();
    res.json({ id: newId });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/:id', requirePerm('users.manage'), body({
  name: S.string({ maxLength: 200 }),
  role: S.string({ maxLength: 60 }),
  active: S.flag(),
  password: S.string({ minLength: 6, maxLength: 200 }),
}), (req, res) => {
  const id = Number(req.params.id);
  // Only manage accounts that belong to the caller's active org.
  if (!isMemberOfOrg(id, req.orgId)) return res.status(404).json({ error: 'not_found' });
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

router.delete('/:id', requirePerm('users.manage'), (req, res) => {
  const id = Number(req.params.id);
  if (req.user && req.user.id === id) return res.status(400).json({ error: 'cannot_delete_self' });
  // Only remove accounts that belong to the caller's org. Removing = dropping the
  // org membership; the account itself is deleted only once it no longer belongs
  // to ANY org, so we never delete a user another tenant still relies on.
  if (!isMemberOfOrg(id, req.orgId)) return res.status(404).json({ error: 'not_found' });
  db.transaction(() => {
    db.prepare(`DELETE FROM memberships WHERE user_id = ? AND organization_id = ?`).run(id, req.orgId);
    const remaining = db.prepare(`SELECT COUNT(*) c FROM memberships WHERE user_id = ?`).get(id).c;
    if (remaining === 0) {
      db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(id);
      db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
    }
  })();
  res.json({ ok: true });
});

module.exports = router;
