// =============================================================
// Leads — scraped prospects (Google Maps / Justdial). They live in a
// separate `leads` table until you promote one to a vendor.
// =============================================================
const express = require('express');
const db = require('../db');
const scrapers = require('../scrapers');
const { body, S } = require('../validate');
const { orgFilter } = require('../tenancy');

const router = express.Router();

router.get('/', (req, res) => {
  const { source, q, imported } = req.query;
  const filters = [orgFilter()];
  const params = { orgId: req.orgId };
  if (source) { filters.push('source = @source'); params.source = source; }
  if (imported === '0' || imported === '1') { filters.push('imported = @imported'); params.imported = Number(imported); }
  if (q) { filters.push('(name LIKE @q OR phone LIKE @q OR city LIKE @q OR address LIKE @q)'); params.q = `%${q}%`; }
  const where = `WHERE ${filters.join(' AND ')}`;
  res.json(db.prepare(`SELECT * FROM leads ${where} ORDER BY created_at DESC LIMIT 500`).all(params));
});

router.get('/sources', (req, res) => {
  res.json(scrapers.availableSources());
});

router.post('/scrape', body({
  source: S.string({ maxLength: 60 }),
  query: S.string({ maxLength: 200 }),
  city: S.string({ maxLength: 200 }),
  max: S.int({ min: 1, max: 500, default: 30 }),
}), async (req, res) => {
  const { source = 'google_maps', query, city, max = 30 } = req.body || {};
  if (!query) return res.status(400).json({ error: 'query_required' });
  try {
    const result = await scrapers.runScrape({ source, query, city, max: Number(max) });
    if (!result.results || !result.results.length) {
      return res.json({ inserted: 0, skipped: 0, results: [], error: result.error || 'no_results' });
    }
    // Dedupe against existing leads + vendors
    const existingLeads = new Set(db.prepare(`SELECT phone FROM leads WHERE phone IS NOT NULL AND ${orgFilter()}`).all({ orgId: req.orgId }).map((r) => r.phone));
    const existingVendors = new Set(db.prepare(`SELECT phone FROM vendors WHERE phone IS NOT NULL AND ${orgFilter()}`).all({ orgId: req.orgId }).map((r) => r.phone));

    const insert = db.prepare(`
      INSERT INTO leads (organization_id, name, phone, address, city, category, source, source_url, rating, hours)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    let inserted = 0, skipped = 0;
    const tx = db.transaction((rows) => {
      for (const r of rows) {
        const phone = (r.phone || '').replace(/\D/g, '');
        if (phone && (existingLeads.has(phone) || existingVendors.has(phone))) { skipped++; continue; }
        insert.run(req.orgId, r.name, phone || null, r.address || null, r.city || null, r.category || null, r.source, r.source_url || null, r.rating || null, r.hours || null);
        if (phone) existingLeads.add(phone);
        inserted++;
      }
    });
    tx(result.results);
    res.json({ inserted, skipped, total: result.results.length, source });
  } catch (e) {
    console.error('[scrape] error', e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/promote', body({}), (req, res) => {
  const lead = db.prepare(`SELECT * FROM leads WHERE id = @id AND ${orgFilter()}`).get({ id: req.params.id, orgId: req.orgId });
  if (!lead) return res.status(404).json({ error: 'not_found' });
  if (!lead.phone || lead.phone.length < 10) return res.status(400).json({ error: 'invalid_phone' });

  const existing = db.prepare(`SELECT id FROM vendors WHERE phone = @phone AND ${orgFilter()}`).get({ phone: lead.phone, orgId: req.orgId });
  if (existing) {
    db.prepare(`UPDATE leads SET imported = 1, vendor_id = @vid WHERE id = @id AND ${orgFilter()}`).run({ vid: existing.id, id: lead.id, orgId: req.orgId });
    return res.json({ ok: true, vendor_id: existing.id, was_new: false });
  }
  const r = db.prepare(`
    INSERT INTO vendors (organization_id, name, phone, company, address, city, category, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'lead')
  `).run(req.orgId, lead.name, lead.phone, lead.name, lead.address || null, lead.city || null, lead.category || null);
  db.prepare(`UPDATE leads SET imported = 1, vendor_id = @vid WHERE id = @id AND ${orgFilter()}`).run({ vid: r.lastInsertRowid, id: lead.id, orgId: req.orgId });
  res.json({ ok: true, vendor_id: r.lastInsertRowid, was_new: true });
});

router.post('/promote-bulk', body({ ids: S.array({ of: S.int({ min: 1 }), maxItems: 10000 }) }), (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids_array_required' });
  let promoted = 0, skipped = 0;
  for (const id of ids) {
    const lead = db.prepare(`SELECT * FROM leads WHERE id = @id AND ${orgFilter()}`).get({ id, orgId: req.orgId });
    if (!lead || !lead.phone || lead.phone.length < 10) { skipped++; continue; }
    const existing = db.prepare(`SELECT id FROM vendors WHERE phone = @phone AND ${orgFilter()}`).get({ phone: lead.phone, orgId: req.orgId });
    if (existing) {
      db.prepare(`UPDATE leads SET imported = 1, vendor_id = @vid WHERE id = @id AND ${orgFilter()}`).run({ vid: existing.id, id: lead.id, orgId: req.orgId });
      skipped++; continue;
    }
    const r = db.prepare(`
      INSERT INTO vendors (organization_id, name, phone, company, address, city, category, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'lead')
    `).run(req.orgId, lead.name, lead.phone, lead.name, lead.address || null, lead.city || null, lead.category || null);
    db.prepare(`UPDATE leads SET imported = 1, vendor_id = @vid WHERE id = @id AND ${orgFilter()}`).run({ vid: r.lastInsertRowid, id: lead.id, orgId: req.orgId });
    promoted++;
  }
  res.json({ promoted, skipped });
});

router.post('/delete-bulk', body({ ids: S.array({ of: S.int({ min: 1 }), maxItems: 10000 }) }), (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids_array_required' });
  const del = db.prepare(`UPDATE leads SET deleted_at = @now WHERE id = @id AND ${orgFilter()}`);
  const tx = db.transaction((rows) => { for (const id of rows) del.run({ id, orgId: req.orgId, now: Date.now() }); });
  tx(ids);
  res.json({ deleted: ids.length });
});

router.delete('/:id', (req, res) => {
  db.prepare(`UPDATE leads SET deleted_at = @now WHERE id = @id AND ${orgFilter()}`)
    .run({ id: req.params.id, orgId: req.orgId, now: Date.now() });
  res.json({ ok: true });
});

module.exports = router;
