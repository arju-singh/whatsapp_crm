// ---------------------------------------------------------------------------
// Multi-tenancy foundation (Phase 0).
//
// The platform is multi-tenant from the ground up: every piece of business data
// belongs to an `organization`. Even a single user gets an organization ("My
// Workspace") so the exact same code paths work for a freelancer, an SMB, and a
// SaaS hosting thousands of orgs — no special-casing.
//
// This module is intentionally additive and non-breaking. On require it:
//   1. Creates organizations / memberships / organization_modules tables.
//   2. Adds organization_id (DEFAULT 1) + deleted_at to every tenant table.
//      The DEFAULT 1 is the migration bridge: legacy INSERTs that don't yet pass
//      an org still land in the backfilled default org, so the running app keeps
//      working while routes are migrated to set org explicitly.
//   3. Backfills a default org (id=1) and a membership for every existing user.
//
// Query scoping is opt-in per route via the helpers at the bottom (orgFilter /
// live). Routes are migrated to use them one at a time — see vendors.js for the
// reference pattern.
// ---------------------------------------------------------------------------

const db = require('./db');

const DEFAULT_ORG_ID = 1;

// Tables that hold per-organization business data. Each gets organization_id +
// deleted_at. Deliberately excludes: users (org link is via memberships),
// sessions (auth infra), settings (migrating to per-org separately),
// analytics_events / audit_log / feedback (platform-level telemetry).
const TENANT_TABLES = [
  'vendors', 'templates', 'campaigns', 'messages', 'followup_rules', 'followups',
  'calls', 'tasks', 'suppressions', 'email_templates', 'emails', 'companies',
  'stages', 'deals', 'tickets', 'automations', 'team_members', 'notifications',
  'calendar_events', 'ai_drafts', 'leads',
];

function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

function tableExists(name) {
  return !!db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
  ).get(name);
}

// --- Schema ---------------------------------------------------------------

db.exec(`
CREATE TABLE IF NOT EXISTS organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  industry TEXT DEFAULT 'general',        -- 'general' | 'realestate' | 'agency' | ...
  plan TEXT DEFAULT 'free',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  subscription_status TEXT,
  current_period_end INTEGER,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  deleted_at INTEGER
);

-- A user can belong to many organizations; role is scoped to the membership,
-- not the user. This is what lets one login own a personal workspace and also
-- be a 'sales' member of a client's org later, with no code change.
CREATE TABLE IF NOT EXISTS memberships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  UNIQUE (organization_id, user_id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);

-- Which feature modules each org has switched on. Core modules are always on
-- regardless of rows here; this table only gates optional modules.
CREATE TABLE IF NOT EXISTS organization_modules (
  organization_id INTEGER NOT NULL,
  module_key TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  settings_json TEXT,
  updated_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  PRIMARY KEY (organization_id, module_key),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);
`);

// Add organization_id + deleted_at to every tenant table that exists.
for (const t of TENANT_TABLES) {
  if (!tableExists(t)) continue;
  ensureColumn(t, 'organization_id', `INTEGER DEFAULT ${DEFAULT_ORG_ID}`);
  ensureColumn(t, 'deleted_at', 'INTEGER');
  db.exec(`CREATE INDEX IF NOT EXISTS idx_${t}_org ON ${t}(organization_id);`);
}

// --- Backfill -------------------------------------------------------------

(function backfill() {
  const orgCount = db.prepare('SELECT COUNT(*) AS c FROM organizations').get().c;
  if (orgCount === 0) {
    // Force the default org to id=1 so it matches the DEFAULT 1 columns above.
    db.prepare(
      `INSERT INTO organizations (id, name, slug, industry) VALUES (?, ?, ?, ?)`,
    ).run(DEFAULT_ORG_ID, 'My Workspace', 'default', 'general');
    console.log('[tenancy] created default organization (id=1, "My Workspace")');
  }

  // Every existing user becomes a member of the default org. super_admin maps to
  // 'owner' (full control); everyone else keeps an equivalent membership role.
  const users = db.prepare('SELECT id, role FROM users').all();
  const insMember = db.prepare(
    `INSERT OR IGNORE INTO memberships (organization_id, user_id, role) VALUES (?, ?, ?)`,
  );
  let added = 0;
  for (const u of users) {
    const role = u.role === 'super_admin' ? 'owner' : (u.role || 'member');
    const r = insMember.run(DEFAULT_ORG_ID, u.id, role);
    if (r.changes) added++;
  }
  if (added) console.log(`[tenancy] backfilled ${added} membership(s) into default org`);
})();

// --- Request context ------------------------------------------------------

// Resolve the active organization for the request. Mount AFTER the auth
// middleware (which sets req.user). For now a user's first/only membership is
// the active org; an X-Org-Id header lets a multi-org user switch, but only to
// an org they actually belong to (defends against cross-tenant access).
function tenantContext(req, res, next) {
  if (!req.user) return next();

  const memberships = db.prepare(
    'SELECT organization_id, role FROM memberships WHERE user_id = ? ORDER BY organization_id',
  ).all(req.user.id);

  let active = memberships[0] || null;
  const requested = req.headers['x-org-id'];
  if (requested != null) {
    const want = Number(requested);
    const match = memberships.find((m) => m.organization_id === want);
    if (match) active = match;
  }

  req.orgId = active ? active.organization_id : DEFAULT_ORG_ID;
  req.orgRole = active ? active.role : (req.user.role || 'member');
  req.memberships = memberships;
  next();
}

// --- Query scoping helpers ------------------------------------------------
//
// Usage in a route (named params):
//   const where = `WHERE ${orgFilter()}`;
//   db.prepare(`SELECT * FROM vendors ${where}`).all({ orgId: req.orgId });
//
// When combining with other conditions, append to the filters array:
//   filters.push(orgFilter());            // 'organization_id = @orgId AND deleted_at IS NULL'
//   db.prepare(... WHERE filters.join(' AND ')).all({ ...params, orgId: req.orgId });
//
// `alias` qualifies the columns when the query joins multiple tables.

function orgFilter(alias) {
  const p = alias ? `${alias}.` : '';
  return `${p}organization_id = @orgId AND ${p}deleted_at IS NULL`;
}

// Just the soft-delete guard, for tables/joins where the org is already pinned.
function live(alias) {
  const p = alias ? `${alias}.` : '';
  return `${p}deleted_at IS NULL`;
}

module.exports = {
  DEFAULT_ORG_ID,
  TENANT_TABLES,
  tenantContext,
  orgFilter,
  live,
};
