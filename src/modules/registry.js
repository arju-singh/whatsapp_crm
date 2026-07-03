// ---------------------------------------------------------------------------
// Module registry — the platform's extension point (Phase 0 keystone).
//
// Every feature is a self-contained module that lives in src/modules/<key>/ and
// exports a manifest from module.js. A manifest declares everything the platform
// needs to wire the feature in:
//
//   module.exports = {
//     key: 'realestate',            // unique id, also the URL/db namespace
//     name: 'Real Estate',
//     description: '...',
//     core: false,                  // core modules are always on for every org
//     industry: true,               // surfaced as an industry pack in the UI
//     dependsOn: ['messaging'],     // other module keys this one needs
//     permissions: ['properties.read', 'properties.write'],
//     nav: [{ label, icon, path, perm }],
//     migrate(db) { ... },          // idempotent schema setup, run on boot
//     routes(router, deps) { ... }, // mounted at /api/m/<key>, gated by the module
//   };
//
// Adding a feature = dropping a folder. The core platform never changes.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const express = require('express');
const { registerPermissions, resolvePermissions, hasPermission, requirePerm } = require('../permissions');
const { DEFAULT_ORG_ID, orgFilter, live } = require('../tenancy');

let _modules = null; // ordered array of manifests
let _byKey = null;   // key -> manifest

function loadManifests() {
  if (_modules) return _modules;
  const dir = __dirname;
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(dir, entry.name, 'module.js');
    if (!fs.existsSync(manifestPath)) continue;
    const m = require(manifestPath);
    if (!m || !m.key) {
      console.warn(`[modules] ${entry.name}/module.js has no key — skipped`);
      continue;
    }
    found.push(m);
  }
  // Core modules first so their permissions/migrations land before features.
  found.sort((a, b) => (b.core ? 1 : 0) - (a.core ? 1 : 0));
  _modules = found;
  _byKey = Object.fromEntries(found.map((m) => [m.key, m]));
  return _modules;
}

// One-time platform initialization: run migrations, register permissions,
// validate dependencies, and switch every module on for the existing default
// org (so the current single workspace keeps all its features).
function init(db) {
  const modules = loadManifests();

  for (const m of modules) {
    if (typeof m.migrate === 'function') {
      try { m.migrate(db); } catch (e) {
        console.error(`[modules] ${m.key} migrate failed:`, e.message);
      }
    }
    if (Array.isArray(m.permissions)) registerPermissions(m.permissions);
  }

  // Dependency sanity check (warn-only; doesn't block boot).
  for (const m of modules) {
    for (const dep of m.dependsOn || []) {
      if (!_byKey[dep]) console.warn(`[modules] ${m.key} depends on unknown module "${dep}"`);
    }
  }

  // Enable all known modules for the default org if not already configured.
  const ins = db.prepare(
    `INSERT OR IGNORE INTO organization_modules (organization_id, module_key, enabled) VALUES (?, ?, 1)`,
  );
  const tx = db.transaction(() => {
    for (const m of modules) ins.run(DEFAULT_ORG_ID, m.key);
  });
  tx();

  console.log(`[modules] registered ${modules.length}: ${modules.map((m) => m.key).join(', ')}`);
  return modules;
}

function getModules() {
  return loadManifests();
}

// Is a module enabled for an org? Core modules are unconditionally on.
function isEnabled(db, orgId, key) {
  const m = _byKey && _byKey[key];
  if (m && m.core) return true;
  const row = db.prepare(
    'SELECT enabled FROM organization_modules WHERE organization_id = ? AND module_key = ?',
  ).get(orgId, key);
  return !!(row && row.enabled);
}

// Route guard: 403 if the request's org hasn't enabled this module. This hides
// the entire API surface of a disabled module, not just its menu.
function requireModule(db, key) {
  return (req, res, next) => {
    if (isEnabled(db, req.orgId || DEFAULT_ORG_ID, key)) return next();
    return res.status(403).json({ error: 'module_disabled', module: key });
  };
}

// Mount every module that owns routes under /api/m/<key>, guarded by the module
// gate. Deps are injected so modules don't reach back into core internals.
function mountModules(app, db) {
  const deps = { db, requirePerm, requireModule: (key) => requireModule(db, key), orgFilter, live };
  for (const m of getModules()) {
    if (typeof m.routes !== 'function') continue;
    const router = express.Router();
    m.routes(router, deps);
    const mountPath = m.mount || `/api/m/${m.key}`;
    app.use(mountPath, requireModule(db, m.key), router);
    console.log(`[modules] mounted ${m.key} at ${mountPath}`);
  }
}

// Build the per-request platform view: which modules are on, what the user can
// do, and the nav the frontend should render (filtered by enablement + perms).
function platformState(db, req) {
  const orgId = req.orgId || DEFAULT_ORG_ID;
  const role = req.orgRole || (req.user && req.user.role) || 'member';
  const org = db.prepare(
    'SELECT id, name, slug, industry, plan FROM organizations WHERE id = ?',
  ).get(orgId);

  const modules = getModules().map((m) => ({
    key: m.key,
    name: m.name,
    description: m.description || '',
    core: !!m.core,
    industry: !!m.industry,
    enabled: isEnabled(db, orgId, m.key),
  }));

  const nav = [];
  for (const m of getModules()) {
    if (!isEnabled(db, orgId, m.key)) continue;
    for (const item of m.nav || []) {
      if (item.perm && !hasPermission(role, item.perm)) continue;
      nav.push({ module: m.key, ...item });
    }
  }

  return {
    org,
    role,
    permissions: resolvePermissions(role),
    modules,
    nav,
  };
}

// /api/platform router: the frontend's source of truth for tenancy + modules.
function platformRouter(db) {
  const router = express.Router();

  router.get('/me', (req, res) => {
    res.json(platformState(db, req));
  });

  router.get('/modules', (req, res) => {
    res.json({ modules: platformState(db, req).modules });
  });

  const setEnabled = (enabled) => (req, res) => {
    const key = req.params.key;
    const m = _byKey && _byKey[key];
    if (!m) return res.status(404).json({ error: 'unknown_module', module: key });
    if (m.core) return res.status(400).json({ error: 'core_module_always_on', module: key });
    db.prepare(`
      INSERT INTO organization_modules (organization_id, module_key, enabled, updated_at)
      VALUES (@orgId, @key, @enabled, @now)
      ON CONFLICT(organization_id, module_key)
      DO UPDATE SET enabled = @enabled, updated_at = @now
    `).run({ orgId: req.orgId, key, enabled: enabled ? 1 : 0, now: Date.now() });
    res.json({ ok: true, module: key, enabled });
  };

  router.post('/modules/:key/enable', requirePerm('modules.manage'), setEnabled(true));
  router.post('/modules/:key/disable', requirePerm('modules.manage'), setEnabled(false));

  return router;
}

module.exports = {
  init,
  getModules,
  isEnabled,
  requireModule,
  mountModules,
  platformState,
  platformRouter,
};
