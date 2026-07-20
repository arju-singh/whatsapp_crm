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

// --- Per-org uniqueness migration (D1) ------------------------------------
//
// `vendors.phone` shipped as a GLOBAL `UNIQUE` column, which is a cross-tenant
// defect: one org's import (ON CONFLICT(phone)) could overwrite another org's
// contact, and two orgs can't both hold the same number. The correct constraint
// is `UNIQUE(organization_id, phone)`. SQLite can't drop a column-level UNIQUE
// in place, so we rebuild the table once (standard 12-step procedure), copying
// all data and preserving row ids so foreign keys stay valid.
//
// Safe: runs only if the legacy global unique is still present; verifies the row
// count matches before dropping the old table; foreign_keys toggled off only for
// the rebuild so no cascade fires on the transient DROP.
function hasGlobalPhoneUnique() {
  if (!tableExists('vendors')) return false;
  const idxList = db.prepare('PRAGMA index_list(vendors)').all();
  for (const idx of idxList) {
    if (idx.unique && idx.origin === 'u') {
      const info = db.prepare(`PRAGMA index_info("${idx.name}")`).all();
      if (info.length === 1 && info[0].name === 'phone') return true;
    }
  }
  return false;
}

function migrateVendorPhoneUnique() {
  if (!hasGlobalPhoneUnique()) return;
  console.log('[tenancy] migrating vendors.phone to UNIQUE(organization_id, phone)…');

  const cols = db.prepare('PRAGMA table_info(vendors)').all();
  const colNames = cols.map((c) => c.name);
  const defs = cols.map((c) => {
    if (c.pk && /INT/i.test(c.type || '')) return `${c.name} INTEGER PRIMARY KEY AUTOINCREMENT`;
    let d = `${c.name} ${c.type || 'TEXT'}`;
    if (c.notnull) d += ' NOT NULL';
    // Wrap every default in parens: literals stay valid and expression defaults
    // (e.g. strftime(...)) are only legal in CREATE TABLE when parenthesized.
    if (c.dflt_value != null) d += ` DEFAULT (${c.dflt_value})`;
    return d;
  });
  // Column-level UNIQUE on phone is intentionally NOT re-emitted; the table-level
  // composite constraint below replaces it.
  const createSql = `CREATE TABLE vendors_new (\n  ${defs.join(',\n  ')},\n  UNIQUE(organization_id, phone)\n)`;
  const colList = colNames.map((n) => `"${n}"`).join(', ');

  const before = db.prepare('SELECT COUNT(*) c FROM vendors').get().c;

  // foreign_keys cannot be toggled inside a transaction; this runs at boot,
  // single-threaded, so the brief window is safe.
  db.pragma('foreign_keys = OFF');
  try {
    const tx = db.transaction(() => {
      db.exec(createSql);
      db.exec(`INSERT INTO vendors_new (${colList}) SELECT ${colList} FROM vendors`);
      const after = db.prepare('SELECT COUNT(*) c FROM vendors_new').get().c;
      if (after !== before) throw new Error(`row count mismatch (${before} -> ${after}); aborting`);
      db.exec('DROP TABLE vendors');
      db.exec('ALTER TABLE vendors_new RENAME TO vendors');
      // Recreate the indexes that lived on the old table.
      db.exec('CREATE INDEX IF NOT EXISTS idx_vendors_status ON vendors(status)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_vendors_company ON vendors(company_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_vendors_org ON vendors(organization_id)');
    });
    tx();
    const fkErrors = db.prepare('PRAGMA foreign_key_check').all();
    if (fkErrors.length) console.warn('[tenancy] post-migration FK check flagged rows:', fkErrors.length);
    console.log(`[tenancy] vendors rebuilt with UNIQUE(organization_id, phone); ${before} rows preserved`);
  } finally {
    db.pragma('foreign_keys = ON');
  }
}
migrateVendorPhoneUnique();

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

// --- Provisioning ---------------------------------------------------------

// Create a fresh, isolated organization for a user plus an 'owner' membership,
// in one transaction. This is THE fix for the cross-tenant default-org bug:
// every account gets its OWN workspace and never lands in the shared default
// org (id=1) that holds another tenant's data. Idempotent — if the user already
// has any membership, returns that org's id and creates nothing.
//
// Call this at signup / OAuth account creation (the primary path) and lazily
// from tenantContext as a safety net for any legacy or edge-case account that
// somehow has no membership.
function provisionOrgForUser(userId, orgName, role = 'owner') {
  return db.transaction(() => {
    const existing = db.prepare(
      'SELECT organization_id FROM memberships WHERE user_id = ? ORDER BY organization_id LIMIT 1',
    ).get(userId);
    if (existing) return existing.organization_id;
    const info = db.prepare(
      `INSERT INTO organizations (name, industry) VALUES (?, 'general')`,
    ).run(orgName && String(orgName).trim() ? String(orgName).trim() : 'My Workspace');
    const orgId = info.lastInsertRowid;
    db.prepare(
      `INSERT OR IGNORE INTO memberships (organization_id, user_id, role) VALUES (?, ?, ?)`,
    ).run(orgId, userId, role);
    return orgId;
  })();
}

// --- Request context ------------------------------------------------------

// Resolve the active organization for the request. Mount AFTER the auth
// middleware (which sets req.user). A user's first/only membership is the active
// org; an X-Org-Id header lets a multi-org user switch, but only to an org they
// actually belong to (defends against cross-tenant access).
//
// SECURITY: a user with no membership is NEVER dropped into the shared default
// org (that was the S1 cross-tenant leak). Instead we self-heal by provisioning
// them their own isolated workspace, so req.orgId always points at an org the
// caller legitimately owns.
function tenantContext(req, res, next) {
  if (!req.user) return next();

  let memberships = db.prepare(
    'SELECT organization_id, role FROM memberships WHERE user_id = ? ORDER BY organization_id',
  ).all(req.user.id);

  if (!memberships.length) {
    // No membership — provision a private org rather than defaulting to org 1.
    try {
      provisionOrgForUser(req.user.id, req.user.name, 'owner');
      memberships = db.prepare(
        'SELECT organization_id, role FROM memberships WHERE user_id = ? ORDER BY organization_id',
      ).all(req.user.id);
    } catch (e) {
      console.error('[tenancy] failed to provision org for user', req.user.id, e.message);
    }
  }

  let active = memberships[0] || null;
  const requested = req.headers['x-org-id'];
  if (requested != null) {
    const want = Number(requested);
    const match = memberships.find((m) => m.organization_id === want);
    if (match) active = match;
  }

  // No shared-default fallback: if we still can't resolve an org, req.orgId is
  // null so org-scoped queries (organization_id = @orgId) match nothing rather
  // than leaking org 1's data.
  req.orgId = active ? active.organization_id : null;
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

// Does a live row in `table` (a tenant table) belong to `orgId`? Use this to
// reject client-supplied foreign keys (company_id, contact_id, stage_id,
// vendor_id, template_id, …) that point at ANOTHER tenant's row before writing
// them. Returns true only for a present, non-soft-deleted row in that org.
const _TENANT_TABLE_SET = new Set(TENANT_TABLES);
/**
 * Does a live (non-soft-deleted) row in a tenant table belong to `orgId`?
 * @param {string} table one of TENANT_TABLES
 * @param {number|null|undefined} id row id
 * @param {number|null|undefined} orgId caller's org
 * @returns {boolean}
 */
function ownedByOrg(table, id, orgId) {
  if (id == null || orgId == null) return false;
  if (!_TENANT_TABLE_SET.has(table)) throw new Error(`ownedByOrg: unknown tenant table "${table}"`);
  return !!db.prepare(
    `SELECT 1 FROM ${table} WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
  ).get(id, orgId);
}

/**
 * Guard for a client-supplied foreign key in a write body.
 * @param {number} orgId caller's org
 * @param {string} table tenant table the FK points into
 * @param {number|null|undefined} id the supplied FK value
 * @param {string} field field name, used to build the error code
 * @returns {string|null} `invalid_<field>` when the FK points at another org's
 *   row, or null when the reference is absent (null/0) or valid for this org.
 */
function fkError(orgId, table, id, field) {
  if (id == null || id === 0) return null;
  return ownedByOrg(table, id, orgId) ? null : `invalid_${field}`;
}

// Given a list of ids for a tenant table, return the Set of those that actually
// belong to `orgId` (live rows). Chunked so a huge bulk request (e.g. a campaign
// over thousands of vendor_ids) can be filtered to the caller's own rows in a
// few queries instead of one-per-id. Used to strip cross-tenant ids from bulk
// operations before they touch other orgs' data.
function ownedIds(table, ids, orgId) {
  if (!_TENANT_TABLE_SET.has(table)) throw new Error(`ownedIds: unknown tenant table "${table}"`);
  const out = new Set();
  if (orgId == null || !Array.isArray(ids) || !ids.length) return out;
  const uniq = [...new Set(ids.map(Number).filter(Number.isInteger))];
  const CHUNK = 800;
  for (let i = 0; i < uniq.length; i += CHUNK) {
    const chunk = uniq.slice(i, i + CHUNK);
    const ph = chunk.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT id FROM ${table} WHERE organization_id = ? AND deleted_at IS NULL AND id IN (${ph})`,
    ).all(orgId, ...chunk);
    for (const r of rows) out.add(r.id);
  }
  return out;
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
  provisionOrgForUser,
  ownedByOrg,
  fkError,
  ownedIds,
  orgFilter,
  live,
};
