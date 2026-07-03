// ---------------------------------------------------------------------------
// Permission model (Phase 0).
//
// Authorization is permission-based, not role-hardcoded. A permission is a
// `resource.action` string (e.g. 'contacts.write'). Roles are just named bundles
// of permissions, so new roles can be composed without touching route code.
//
// Backward compatibility: the existing roles ('user', 'admin', 'super_admin')
// keep working unchanged. super_admin/admin resolve to the wildcard '*', so
// every endpoint the seeded admin can hit today still works. requirePerm() is
// additive — routes adopt it incrementally; requireRole() in auth.js is untouched.
//
// Modules contribute their own permissions at registration time via
// registerPermissions(), so the catalog grows as features are installed.
// ---------------------------------------------------------------------------

// Core permissions that exist regardless of which modules are enabled. Feature
// modules add to this set through registerPermissions().
const CORE_PERMISSIONS = new Set([
  'contacts.read', 'contacts.write', 'contacts.delete',
  'messages.read', 'messages.send',
  'tasks.read', 'tasks.write',
  'activities.read',
  'notifications.read',
  // Platform administration
  'team.read', 'team.manage',
  // Record-level access overrides (metadata engine): see / edit any record
  // regardless of ownership or visibility; share a record with another user.
  'records.view_all', 'records.edit_all', 'records.share',
  'users.read', 'users.manage', // view accounts / create-edit-delete accounts
  'support.manage',             // feedback & bug inbox
  'settings.manage',            // workspace settings, import/export
  'whatsapp.admin',             // destructive WhatsApp session ops (reconnect/wipe/import)
  'billing.manage',
  'modules.manage',     // enable/disable feature modules for the org
  'org.manage',         // rename org, delete org, etc.
]);

// Owner-only permissions: the wildcard '*' does NOT grant these. They model the
// one real gap between an admin and the account owner — only an explicit grant
// (or the exact resource wildcard, e.g. 'users.*') confers them. This preserves
// the legacy rule that admins run the workspace but cannot manage login accounts.
const SENSITIVE = new Set(['users.manage']);

// Role → permission bundles. '*' is a full wildcard; 'resource.*' grants every
// action on a resource. Membership roles map here; if a role is unknown we fall
// back to the legacy user role for safety (least privilege among legacy roles).
const ROLE_PERMISSIONS = {
  // Legacy roles (must keep current behavior). super_admin also gets the
  // sensitive 'users.*' (account management); admin is full wildcard EXCEPT the
  // sensitive set — exactly the old admin-vs-super_admin distinction.
  super_admin: ['*', 'users.*'],
  admin: ['*'],
  user: ['contacts.read', 'contacts.write', 'messages.read', 'messages.send',
    'tasks.read', 'tasks.write', 'activities.read', 'notifications.read'],

  // New membership roles
  owner: ['*', 'users.*'],
  // Manager sees & edits every record (records.view_all/edit_all) and can share.
  manager: ['contacts.*', 'messages.*', 'tasks.*', 'activities.read',
    'notifications.read', 'team.read', 'deals.*', 'reports.read',
    'objects.read', 'records.read', 'records.write', 'records.delete',
    'records.view_all', 'records.edit_all', 'records.share'],
  // Sales can work records but only sees its OWN (no view_all) — ownership matters.
  sales: ['contacts.read', 'contacts.write', 'messages.read', 'messages.send',
    'tasks.read', 'tasks.write', 'activities.read', 'notifications.read',
    'deals.read', 'deals.write',
    'objects.read', 'records.read', 'records.write', 'records.share'],
  support: ['contacts.read', 'messages.read', 'messages.send', 'tasks.read',
    'tasks.write', 'activities.read', 'notifications.read', 'tickets.*',
    'objects.read', 'records.read'],
  member: ['contacts.read', 'messages.read', 'tasks.read', 'activities.read',
    'notifications.read', 'objects.read', 'records.read'],
  viewer: ['contacts.read', 'messages.read', 'tasks.read', 'activities.read',
    'reports.read', 'notifications.read', 'objects.read', 'records.read'],
};

function registerPermissions(list) {
  for (const p of list || []) CORE_PERMISSIONS.add(p);
}

function allPermissions() {
  return Array.from(CORE_PERMISSIONS).sort();
}

// Does a granted permission pattern satisfy the requested permission?
//   exact         matches itself (grants even sensitive perms)
//   '*'           matches anything EXCEPT owner-only (SENSITIVE) perms
//   'contacts.*'  matches 'contacts.read', 'contacts.write', … (incl. sensitive
//                 perms within that resource, e.g. 'users.*' grants 'users.manage')
function patternMatches(granted, want) {
  if (granted === want) return true;
  if (granted === '*') return !SENSITIVE.has(want);
  if (granted.endsWith('.*')) {
    const prefix = granted.slice(0, -1); // 'contacts.'
    return want.startsWith(prefix);
  }
  return false;
}

function permissionsForRole(role) {
  return ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.user;
}

// Expand a role into the concrete permission strings it grants, resolving
// wildcards against the known catalog (used for /api/platform/me so the
// frontend can reason about exact capabilities).
function resolvePermissions(role) {
  const patterns = permissionsForRole(role);
  if (patterns.includes('*')) return allPermissions();
  const out = new Set();
  for (const want of allPermissions()) {
    if (patterns.some((g) => patternMatches(g, want))) out.add(want);
  }
  // Include any granted patterns that aren't (yet) in the catalog verbatim.
  for (const g of patterns) if (!g.endsWith('.*') && g !== '*') out.add(g);
  return Array.from(out).sort();
}

function hasPermission(role, want) {
  return permissionsForRole(role).some((g) => patternMatches(g, want));
}

// Express middleware. Uses the membership role (req.orgRole, set by
// tenantContext) and falls back to the user's global role.
function requirePerm(want) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' });
    const role = req.orgRole || req.user.role;
    if (!hasPermission(role, want)) {
      return res.status(403).json({ error: 'forbidden', need: want });
    }
    next();
  };
}

module.exports = {
  registerPermissions,
  allPermissions,
  permissionsForRole,
  resolvePermissions,
  hasPermission,
  requirePerm,
  ROLE_PERMISSIONS,
};
