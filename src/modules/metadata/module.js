// ---------------------------------------------------------------------------
// Metadata module — the "universal" core: tenants define their own objects and
// fields at runtime, and the Record Service stores/validates/queries instances
// with no DDL and no deploy. This is the SQLite-stack realization of the
// architecture doc's §6 metadata engine (OBJECT_DEFINITION / FIELD_DEFINITION /
// RELATIONSHIP_DEFINITION / RECORD). The metadata model is Postgres-portable —
// only the storage/RLS layer changes when this graduates to Postgres.
//
// Routes (mounted at /api/m/metadata, gated by the module being enabled):
//   GET    /objects                          list custom objects
//   POST   /objects                          create object              [objects.manage]
//   GET    /objects/:api                      object + its fields
//   PATCH  /objects/:api                      rename/icon               [objects.manage]
//   DELETE /objects/:api                      soft-delete object        [objects.manage]
//   POST   /objects/:api/fields               add field                 [objects.manage]
//   PATCH  /fields/:id                        update field              [objects.manage]
//   DELETE /fields/:id                        soft-delete field         [objects.manage]
//   GET    /objects/:api/records              list/filter records       [records.read]
//   POST   /objects/:api/records              create record             [records.write]
//   GET    /objects/:api/records/:id          read record               [records.read]
//   PATCH  /objects/:api/records/:id          update record             [records.write]
//   DELETE /objects/:api/records/:id          soft-delete record        [records.delete]
// ---------------------------------------------------------------------------

const rs = require('./record-service');
const access = require('./access');

module.exports = {
  key: 'metadata',
  name: 'Data Studio',
  description: 'Define your own objects and fields — custom data for any industry.',
  core: false,
  permissions: ['objects.read', 'objects.manage', 'records.read', 'records.write', 'records.delete'],
  nav: [
    { label: 'Data Studio', icon: 'flow', path: '/data-studio', perm: 'objects.read' },
  ],

  migrate(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS object_definitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id INTEGER NOT NULL DEFAULT 1,
        api_name TEXT NOT NULL,
        label TEXT NOT NULL,
        label_plural TEXT,
        icon TEXT,
        is_standard INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        deleted_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_objdef_org ON object_definitions(organization_id);

      CREATE TABLE IF NOT EXISTS field_definitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id INTEGER NOT NULL DEFAULT 1,
        object_id INTEGER NOT NULL,
        api_name TEXT NOT NULL,
        label TEXT NOT NULL,
        data_type TEXT NOT NULL,
        required INTEGER DEFAULT 0,
        is_unique INTEGER DEFAULT 0,
        validation TEXT,
        options TEXT,
        position INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        deleted_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_fielddef_object ON field_definitions(organization_id, object_id);

      CREATE TABLE IF NOT EXISTS relationship_definitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id INTEGER NOT NULL DEFAULT 1,
        source_object_id INTEGER NOT NULL,
        target_object_id INTEGER NOT NULL,
        api_name TEXT NOT NULL,
        label TEXT,
        type TEXT DEFAULT 'lookup',
        cardinality TEXT DEFAULT 'many-to-one',
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        deleted_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS meta_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id INTEGER NOT NULL DEFAULT 1,
        object_id INTEGER NOT NULL,
        owner_id INTEGER,
        stage_id INTEGER,
        data TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        deleted_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_metarec_object ON meta_records(organization_id, object_id, deleted_at);

      -- Explicit per-record sharing (record-level access, layer 2).
      CREATE TABLE IF NOT EXISTS record_shares (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id INTEGER NOT NULL DEFAULT 1,
        record_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        access TEXT NOT NULL DEFAULT 'read',   -- read | write
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        deleted_at INTEGER,
        UNIQUE (record_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_record_shares ON record_shares(record_id, user_id);
    `);
    // Access-control columns (added to existing tables on upgrade).
    const addCol = (table, col, ddl) => {
      const have = db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name);
      if (!have.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
    };
    addCol('object_definitions', 'record_visibility', "TEXT DEFAULT 'public'"); // default for new records
    addCol('meta_records', 'visibility', 'TEXT');           // per-record override; null → object default
    addCol('field_definitions', 'read_perm', 'TEXT');       // field-level read gate (layer 3)
    addCol('field_definitions', 'write_perm', 'TEXT');      // field-level write gate
  },

  routes(router, { db, requirePerm }) {
    // --- helpers (org-scoped lookups) ---
    const objByApi = (orgId, api) => db.prepare(
      `SELECT * FROM object_definitions WHERE organization_id = ? AND api_name = ? AND deleted_at IS NULL`,
    ).get(orgId, api);
    const fieldsFor = (orgId, objectId) => db.prepare(
      `SELECT * FROM field_definitions WHERE organization_id = ? AND object_id = ? AND deleted_at IS NULL ORDER BY position, id`,
    ).all(orgId, objectId);
    // Access context for the request: who, what role, which org.
    const ctxOf = (req) => ({ me: req.user ? req.user.id : null, role: req.orgRole || (req.user && req.user.role) || 'member', orgId: req.orgId });

    // --- Object definitions ---
    router.get('/objects', requirePerm('objects.read'), (req, res) => {
      const rows = db.prepare(
        `SELECT o.*, (SELECT COUNT(*) FROM meta_records r WHERE r.object_id = o.id AND r.deleted_at IS NULL) AS record_count
         FROM object_definitions o WHERE o.organization_id = ? AND o.deleted_at IS NULL ORDER BY o.label`,
      ).all(req.orgId);
      res.json({ objects: rows });
    });

    router.post('/objects', requirePerm('objects.manage'), (req, res) => {
      const { api_name, label, label_plural, icon, record_visibility } = req.body || {};
      if (!rs.isValidApiName(api_name)) return res.status(400).json({ error: 'invalid_api_name', detail: 'lowercase letters/digits/underscore, must start with a letter' });
      if (!label) return res.status(400).json({ error: 'label_required' });
      if (objByApi(req.orgId, api_name)) return res.status(409).json({ error: 'api_name_taken' });
      const vis = record_visibility === 'private' ? 'private' : 'public';
      const r = db.prepare(
        `INSERT INTO object_definitions (organization_id, api_name, label, label_plural, icon, record_visibility) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(req.orgId, api_name, label, label_plural || label + 's', icon || null, vis);
      res.status(201).json(db.prepare('SELECT * FROM object_definitions WHERE id = ?').get(r.lastInsertRowid));
    });

    router.get('/objects/:api', requirePerm('objects.read'), (req, res) => {
      const obj = objByApi(req.orgId, req.params.api);
      if (!obj) return res.status(404).json({ error: 'object_not_found' });
      res.json({ object: obj, fields: fieldsFor(req.orgId, obj.id) });
    });

    router.patch('/objects/:api', requirePerm('objects.manage'), (req, res) => {
      const obj = objByApi(req.orgId, req.params.api);
      if (!obj) return res.status(404).json({ error: 'object_not_found' });
      const sets = []; const p = { id: obj.id, orgId: req.orgId, now: Date.now() };
      for (const k of ['label', 'label_plural', 'icon', 'record_visibility']) if (k in (req.body || {})) { sets.push(`${k} = @${k}`); p[k] = req.body[k]; }
      if (!sets.length) return res.json(obj);
      sets.push('updated_at = @now');
      db.prepare(`UPDATE object_definitions SET ${sets.join(', ')} WHERE id = @id AND organization_id = @orgId`).run(p);
      res.json(db.prepare('SELECT * FROM object_definitions WHERE id = ?').get(obj.id));
    });

    router.delete('/objects/:api', requirePerm('objects.manage'), (req, res) => {
      const obj = objByApi(req.orgId, req.params.api);
      if (!obj) return res.status(404).json({ error: 'object_not_found' });
      const now = Date.now();
      const tx = db.transaction(() => {
        db.prepare('UPDATE object_definitions SET deleted_at = ? WHERE id = ?').run(now, obj.id);
        db.prepare('UPDATE field_definitions SET deleted_at = ? WHERE object_id = ? AND deleted_at IS NULL').run(now, obj.id);
        db.prepare('UPDATE meta_records SET deleted_at = ? WHERE object_id = ? AND deleted_at IS NULL').run(now, obj.id);
      });
      tx();
      res.json({ ok: true });
    });

    // --- Field definitions ---
    router.post('/objects/:api/fields', requirePerm('objects.manage'), (req, res) => {
      const obj = objByApi(req.orgId, req.params.api);
      if (!obj) return res.status(404).json({ error: 'object_not_found' });
      const { api_name, label, data_type, required, is_unique, validation, options, position, read_perm, write_perm } = req.body || {};
      if (!rs.isValidApiName(api_name)) return res.status(400).json({ error: 'invalid_api_name' });
      if (!label) return res.status(400).json({ error: 'label_required' });
      if (!rs.DATA_TYPES.has(data_type)) return res.status(400).json({ error: 'invalid_data_type', allowed: [...rs.DATA_TYPES] });
      const exists = fieldsFor(req.orgId, obj.id).some((f) => f.api_name === api_name);
      if (exists) return res.status(409).json({ error: 'field_api_name_taken' });
      const r = db.prepare(`
        INSERT INTO field_definitions (organization_id, object_id, api_name, label, data_type, required, is_unique, validation, options, position, read_perm, write_perm)
        VALUES (@orgId, @objectId, @api_name, @label, @data_type, @required, @is_unique, @validation, @options, @position, @read_perm, @write_perm)
      `).run({
        orgId: req.orgId, objectId: obj.id, api_name, label, data_type,
        required: required ? 1 : 0, is_unique: is_unique ? 1 : 0,
        validation: validation ? JSON.stringify(validation) : null,
        options: options ? JSON.stringify(options) : null,
        position: position != null ? Number(position) : 0,
        read_perm: read_perm || null, write_perm: write_perm || null,
      });
      // A lookup field implies a relationship — record it for the object graph.
      if (data_type === 'lookup' && options && options.target_object_id) {
        db.prepare(`INSERT INTO relationship_definitions (organization_id, source_object_id, target_object_id, api_name, label, type) VALUES (?, ?, ?, ?, ?, 'lookup')`)
          .run(req.orgId, obj.id, Number(options.target_object_id), api_name, label);
      }
      res.status(201).json(db.prepare('SELECT * FROM field_definitions WHERE id = ?').get(r.lastInsertRowid));
    });

    router.patch('/fields/:id', requirePerm('objects.manage'), (req, res) => {
      const f = db.prepare('SELECT * FROM field_definitions WHERE id = ? AND organization_id = ? AND deleted_at IS NULL').get(req.params.id, req.orgId);
      if (!f) return res.status(404).json({ error: 'field_not_found' });
      const sets = []; const p = { id: f.id, now: Date.now() };
      for (const k of ['label', 'required', 'is_unique', 'position', 'read_perm', 'write_perm']) if (k in (req.body || {})) { sets.push(`${k} = @${k}`); p[k] = (k === 'required' || k === 'is_unique') ? (req.body[k] ? 1 : 0) : (req.body[k] || (k === 'position' ? 0 : null)); }
      if ('validation' in (req.body || {})) { sets.push('validation = @validation'); p.validation = req.body.validation ? JSON.stringify(req.body.validation) : null; }
      if ('options' in (req.body || {})) { sets.push('options = @options'); p.options = req.body.options ? JSON.stringify(req.body.options) : null; }
      if (!sets.length) return res.json(f);
      sets.push('updated_at = @now');
      db.prepare(`UPDATE field_definitions SET ${sets.join(', ')} WHERE id = @id`).run(p);
      res.json(db.prepare('SELECT * FROM field_definitions WHERE id = ?').get(f.id));
    });

    router.delete('/fields/:id', requirePerm('objects.manage'), (req, res) => {
      const r = db.prepare('UPDATE field_definitions SET deleted_at = ? WHERE id = ? AND organization_id = ? AND deleted_at IS NULL')
        .run(Date.now(), req.params.id, req.orgId);
      if (!r.changes) return res.status(404).json({ error: 'field_not_found' });
      res.json({ ok: true });
    });

    // --- Records (dynamic instances) ---
    router.get('/objects/:api/records', requirePerm('records.read'), (req, res) => {
      const obj = objByApi(req.orgId, req.params.api);
      if (!obj) return res.status(404).json({ error: 'object_not_found' });
      const ctx = ctxOf(req);
      const fields = fieldsFor(req.orgId, obj.id);
      const filter = rs.parseJson(req.query.filter, []);
      const compiled = rs.compileFilter(fields, filter);
      const where = ['organization_id = @orgId', 'object_id = @objectId', 'deleted_at IS NULL'];
      // Layer 2 (record-level): restrict to rows this user may see. Qualify with
      // the table name — record_shares also has an `id`, so an unqualified `id`
      // in the EXISTS subquery would bind to the wrong table.
      where.push(access.readPredicate('meta_records'));
      const params = {
        orgId: req.orgId, objectId: obj.id, ...compiled.params,
        me: ctx.me, objDefault: obj.record_visibility || 'public', viewAll: access.canViewAll(ctx.role) ? 1 : 0,
      };
      if (compiled.sql) where.push(`(${compiled.sql})`);
      const limit = Math.min(Number(req.query.limit) || 1000, 5000);
      const rows = db.prepare(
        `SELECT * FROM meta_records WHERE ${where.join(' AND ')} ORDER BY updated_at DESC LIMIT ${limit}`,
      ).all(params);
      // Layer 3 (field-level): mask fields the user cannot read.
      res.json({ object: obj.api_name, rows: rows.map((r) => access.maskRecord(rs.presentRecord(r), fields, ctx.role)), total: rows.length });
    });

    router.post('/objects/:api/records', requirePerm('records.write'), (req, res) => {
      const obj = objByApi(req.orgId, req.params.api);
      if (!obj) return res.status(404).json({ error: 'object_not_found' });
      const ctx = ctxOf(req);
      const fields = fieldsFor(req.orgId, obj.id);
      // Layer 3: reject writes to fields the user isn't allowed to set.
      const forbidden = access.forbiddenWrites(fields, ctx.role, req.body || {});
      if (forbidden.length) return res.status(403).json({ error: 'field_forbidden', fields: forbidden });
      const { ok, errors, data } = rs.validateRecord(fields, req.body || {}, { db, orgId: req.orgId });
      if (!ok) return res.status(422).json({ error: 'validation_failed', fields: errors });
      const uniq = rs.checkUnique(db, req.orgId, obj.id, fields, data);
      if (Object.keys(uniq).length) return res.status(409).json({ error: 'validation_failed', fields: uniq });
      const vis = req.body && req.body.visibility === 'private' ? 'private'
        : req.body && req.body.visibility === 'public' ? 'public' : null; // null → object default
      const r = db.prepare(
        `INSERT INTO meta_records (organization_id, object_id, owner_id, visibility, data) VALUES (?, ?, ?, ?, ?)`,
      ).run(req.orgId, obj.id, ctx.me, vis, JSON.stringify(data));
      res.status(201).json(access.maskRecord(rs.presentRecord(db.prepare('SELECT * FROM meta_records WHERE id = ?').get(r.lastInsertRowid)), fields, ctx.role));
    });

    const getRec = (orgId, objectId, id) => db.prepare(
      `SELECT * FROM meta_records WHERE id = ? AND object_id = ? AND organization_id = ? AND deleted_at IS NULL`,
    ).get(id, objectId, orgId);

    router.get('/objects/:api/records/:id', requirePerm('records.read'), (req, res) => {
      const obj = objByApi(req.orgId, req.params.api);
      if (!obj) return res.status(404).json({ error: 'object_not_found' });
      const ctx = ctxOf(req);
      const row = getRec(req.orgId, obj.id, req.params.id);
      if (!row) return res.status(404).json({ error: 'record_not_found' });
      // Layer 2: hide records the user may not see (404, not 403 — don't leak existence).
      if (!access.canReadRecord(db, ctx, row, obj.record_visibility)) return res.status(404).json({ error: 'record_not_found' });
      const fields = fieldsFor(req.orgId, obj.id);
      res.json(access.maskRecord(rs.presentRecord(row), fields, ctx.role));
    });

    router.patch('/objects/:api/records/:id', requirePerm('records.write'), (req, res) => {
      const obj = objByApi(req.orgId, req.params.api);
      if (!obj) return res.status(404).json({ error: 'object_not_found' });
      const ctx = ctxOf(req);
      const row = getRec(req.orgId, obj.id, req.params.id);
      if (!row) return res.status(404).json({ error: 'record_not_found' });
      if (!access.canReadRecord(db, ctx, row, obj.record_visibility)) return res.status(404).json({ error: 'record_not_found' });
      if (!access.canWriteRecord(db, ctx, row)) return res.status(403).json({ error: 'record_forbidden' });
      const fields = fieldsFor(req.orgId, obj.id);
      const forbidden = access.forbiddenWrites(fields, ctx.role, req.body || {});
      if (forbidden.length) return res.status(403).json({ error: 'field_forbidden', fields: forbidden });
      const { ok, errors, data } = rs.validateRecord(fields, req.body || {}, { partial: true, db, orgId: req.orgId });
      if (!ok) return res.status(422).json({ error: 'validation_failed', fields: errors });
      const merged = { ...rs.parseJson(row.data, {}), ...data };
      const uniq = rs.checkUnique(db, req.orgId, obj.id, fields, data, row.id);
      if (Object.keys(uniq).length) return res.status(409).json({ error: 'validation_failed', fields: uniq });
      // visibility change allowed by writers
      const setVis = (req.body && (req.body.visibility === 'private' || req.body.visibility === 'public')) ? req.body.visibility : row.visibility;
      db.prepare('UPDATE meta_records SET data = ?, visibility = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(merged), setVis, Date.now(), row.id);
      res.json(access.maskRecord(rs.presentRecord(db.prepare('SELECT * FROM meta_records WHERE id = ?').get(row.id)), fields, ctx.role));
    });

    router.delete('/objects/:api/records/:id', requirePerm('records.delete'), (req, res) => {
      const obj = objByApi(req.orgId, req.params.api);
      if (!obj) return res.status(404).json({ error: 'object_not_found' });
      const ctx = ctxOf(req);
      const row = getRec(req.orgId, obj.id, req.params.id);
      if (!row) return res.status(404).json({ error: 'record_not_found' });
      if (!access.canWriteRecord(db, ctx, row)) return res.status(403).json({ error: 'record_forbidden' });
      db.prepare('UPDATE meta_records SET deleted_at = ? WHERE id = ?').run(Date.now(), row.id);
      res.json({ ok: true });
    });

    // --- Record sharing (layer 2) ---
    router.get('/objects/:api/records/:id/shares', requirePerm('records.read'), (req, res) => {
      const obj = objByApi(req.orgId, req.params.api);
      if (!obj) return res.status(404).json({ error: 'object_not_found' });
      const row = getRec(req.orgId, obj.id, req.params.id);
      if (!row) return res.status(404).json({ error: 'record_not_found' });
      const shares = db.prepare('SELECT user_id, access FROM record_shares WHERE record_id = ? AND organization_id = ? AND deleted_at IS NULL').all(row.id, req.orgId);
      res.json({ shares });
    });

    router.post('/objects/:api/records/:id/share', requirePerm('records.share'), (req, res) => {
      const obj = objByApi(req.orgId, req.params.api);
      if (!obj) return res.status(404).json({ error: 'object_not_found' });
      const ctx = ctxOf(req);
      const row = getRec(req.orgId, obj.id, req.params.id);
      if (!row) return res.status(404).json({ error: 'record_not_found' });
      // Only someone who can write the record may share it.
      if (!access.canWriteRecord(db, ctx, row)) return res.status(403).json({ error: 'record_forbidden' });
      const userId = Number(req.body && req.body.user_id);
      const accLevel = req.body && req.body.access === 'write' ? 'write' : 'read';
      if (!Number.isInteger(userId)) return res.status(400).json({ error: 'user_id_required' });
      // The share target must be a member of this org — never share a record with
      // a user who belongs only to another tenant.
      const isMember = db.prepare('SELECT 1 FROM memberships WHERE user_id = ? AND organization_id = ?').get(userId, req.orgId);
      if (!isMember) return res.status(400).json({ error: 'user_not_in_org' });
      db.prepare(`
        INSERT INTO record_shares (organization_id, record_id, user_id, access) VALUES (@orgId, @rid, @uid, @acc)
        ON CONFLICT(record_id, user_id) DO UPDATE SET access = @acc, deleted_at = NULL
      `).run({ orgId: req.orgId, rid: row.id, uid: userId, acc: accLevel });
      res.json({ ok: true, user_id: userId, access: accLevel });
    });

    router.delete('/objects/:api/records/:id/share/:userId', requirePerm('records.share'), (req, res) => {
      const obj = objByApi(req.orgId, req.params.api);
      if (!obj) return res.status(404).json({ error: 'object_not_found' });
      const ctx = ctxOf(req);
      const row = getRec(req.orgId, obj.id, req.params.id);
      if (!row) return res.status(404).json({ error: 'record_not_found' });
      if (!access.canWriteRecord(db, ctx, row)) return res.status(403).json({ error: 'record_forbidden' });
      db.prepare('UPDATE record_shares SET deleted_at = ? WHERE record_id = ? AND user_id = ? AND organization_id = ?')
        .run(Date.now(), row.id, Number(req.params.userId), req.orgId);
      res.json({ ok: true });
    });
  },
};
