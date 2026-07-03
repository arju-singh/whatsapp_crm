// ---------------------------------------------------------------------------
// Industry module: Real Estate.
//
// This is the reference for a *fully self-contained, route-owning* module — the
// shape estateflow's features (properties, attendance, social, call-bridge) get
// folded into next. It proves the whole contract end-to-end:
//   - owns its schema via migrate() (the `properties` table)
//   - mounts its own routes at /api/m/realestate, gated by requireModule
//   - contributes permissions + nav
//   - every query is org-scoped and soft-delete aware
//
// An org only sees any of this if it enables the 'realestate' module.
// ---------------------------------------------------------------------------

module.exports = {
  key: 'realestate',
  name: 'Real Estate',
  description: 'Property inventory, listings, and one-click sharing to contacts.',
  core: false,
  industry: true,
  dependsOn: ['contacts'],
  permissions: ['properties.read', 'properties.write', 'properties.delete'],
  nav: [
    { label: 'Properties', icon: 'building', path: '/properties', perm: 'properties.read' },
  ],

  migrate(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS properties (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id INTEGER NOT NULL DEFAULT 1,
        title TEXT NOT NULL,
        type TEXT,                  -- apartment | villa | plot | commercial ...
        status TEXT DEFAULT 'available',
        price INTEGER,
        currency TEXT DEFAULT 'INR',
        city TEXT,
        address TEXT,
        beds INTEGER,
        baths INTEGER,
        area_sqft INTEGER,
        description TEXT,
        cover_image TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        deleted_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_properties_org ON properties(organization_id);
      CREATE INDEX IF NOT EXISTS idx_properties_status ON properties(organization_id, status);
    `);
  },

  routes(router, { db, requirePerm, orgFilter }) {
    // List (org-scoped, live only)
    router.get('/properties', requirePerm('properties.read'), (req, res) => {
      const filters = [orgFilter()];
      const params = { orgId: req.orgId };
      if (req.query.status) { filters.push('status = @status'); params.status = req.query.status; }
      if (req.query.city) { filters.push('city = @city'); params.city = req.query.city; }
      const rows = db.prepare(
        `SELECT * FROM properties WHERE ${filters.join(' AND ')} ORDER BY updated_at DESC`,
      ).all(params);
      res.json({ rows, total: rows.length });
    });

    // Single
    router.get('/properties/:id', requirePerm('properties.read'), (req, res) => {
      const row = db.prepare(
        `SELECT * FROM properties WHERE id = @id AND ${orgFilter()}`,
      ).get({ id: Number(req.params.id), orgId: req.orgId });
      if (!row) return res.status(404).json({ error: 'not_found' });
      res.json(row);
    });

    // Create (org stamped from the request context, never from the client)
    router.post('/properties', requirePerm('properties.write'), (req, res) => {
      const b = req.body || {};
      if (!b.title) return res.status(400).json({ error: 'title_required' });
      const r = db.prepare(`
        INSERT INTO properties
          (organization_id, title, type, status, price, currency, city, address, beds, baths, area_sqft, description, cover_image)
        VALUES
          (@orgId, @title, @type, @status, @price, @currency, @city, @address, @beds, @baths, @area_sqft, @description, @cover_image)
      `).run({
        orgId: req.orgId,
        title: b.title,
        type: b.type || null,
        status: b.status || 'available',
        price: b.price != null ? Number(b.price) : null,
        currency: b.currency || 'INR',
        city: b.city || null,
        address: b.address || null,
        beds: b.beds != null ? Number(b.beds) : null,
        baths: b.baths != null ? Number(b.baths) : null,
        area_sqft: b.area_sqft != null ? Number(b.area_sqft) : null,
        description: b.description || null,
        cover_image: b.cover_image || null,
      });
      const row = db.prepare('SELECT * FROM properties WHERE id = ?').get(r.lastInsertRowid);
      res.status(201).json(row);
    });

    // Update (org-scoped)
    router.patch('/properties/:id', requirePerm('properties.write'), (req, res) => {
      const allowed = ['title', 'type', 'status', 'price', 'currency', 'city',
        'address', 'beds', 'baths', 'area_sqft', 'description', 'cover_image'];
      const sets = [];
      const params = { id: Number(req.params.id), orgId: req.orgId, now: Date.now() };
      for (const k of allowed) {
        if (k in (req.body || {})) { sets.push(`${k} = @${k}`); params[k] = req.body[k]; }
      }
      if (!sets.length) return res.status(400).json({ error: 'no_fields' });
      sets.push('updated_at = @now');
      const r = db.prepare(
        `UPDATE properties SET ${sets.join(', ')} WHERE id = @id AND ${orgFilter()}`,
      ).run(params);
      if (!r.changes) return res.status(404).json({ error: 'not_found' });
      res.json(db.prepare('SELECT * FROM properties WHERE id = ?').get(params.id));
    });

    // Soft delete (org-scoped) — never a hard DELETE.
    router.delete('/properties/:id', requirePerm('properties.delete'), (req, res) => {
      const r = db.prepare(
        `UPDATE properties SET deleted_at = @now WHERE id = @id AND ${orgFilter()}`,
      ).run({ id: Number(req.params.id), orgId: req.orgId, now: Date.now() });
      if (!r.changes) return res.status(404).json({ error: 'not_found' });
      res.json({ ok: true });
    });
  },
};
