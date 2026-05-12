// =============================================================
// Leads — scraped prospects (Google Maps / Justdial). They live in a
// separate `leads` table until you promote one to a vendor.
// =============================================================
const express = require('express');
const db = require('../db');
const scrapers = require('../scrapers');

const router = express.Router();

router.get('/', (req, res) => {
  const { source, q, imported } = req.query;
  const filters = [];
  const params = {};
  if (source) { filters.push('source = @source'); params.source = source; }
  if (imported === '0' || imported === '1') { filters.push('imported = @imported'); params.imported = Number(imported); }
  if (q) { filters.push('(name LIKE @q OR phone LIKE @q OR city LIKE @q OR address LIKE @q)'); params.q = `%${q}%`; }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  res.json(db.prepare(`SELECT * FROM leads ${where} ORDER BY created_at DESC LIMIT 500`).all(params));
});

router.post('/scrape', async (req, res) => {
  const { source = 'google_maps', query, city, max = 30 } = req.body || {};
  if (!query) return res.status(400).json({ error: 'query_required' });
  const fullQuery = city ? `${query} in ${city}` : query;
  try {
    let result;
    if (source === 'justdial') {
      if (!city) return res.status(400).json({ error: 'city_required_for_justdial' });
      result = await scrapers.scrapeJustdial({ query, city, max: Number(max) });
    } else {
      result = await scrapers.scrapeGoogleMaps({ query: fullQuery, max: Number(max) });
    }
    if (!result.results || !result.results.length) {
      return res.json({ inserted: 0, skipped: 0, results: [], error: result.error || 'no_results' });
    }
    // Dedupe against existing leads + vendors
    const existingLeads = new Set(db.prepare('SELECT phone FROM leads WHERE phone IS NOT NULL').all().map((r) => r.phone));
    const existingVendors = new Set(db.prepare('SELECT phone FROM vendors WHERE phone IS NOT NULL').all().map((r) => r.phone));

    const insert = db.prepare(`
      INSERT INTO leads (name, phone, address, city, category, source, source_url, rating, hours)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    let inserted = 0, skipped = 0;
    const tx = db.transaction((rows) => {
      for (const r of rows) {
        const phone = (r.phone || '').replace(/\D/g, '');
        if (phone && (existingLeads.has(phone) || existingVendors.has(phone))) { skipped++; continue; }
        insert.run(r.name, phone || null, r.address || null, r.city || null, r.category || null, r.source, r.source_url || null, r.rating || null, r.hours || null);
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

router.post('/:id/promote', (req, res) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'not_found' });
  if (!lead.phone || lead.phone.length < 10) return res.status(400).json({ error: 'invalid_phone' });

  const existing = db.prepare('SELECT id FROM vendors WHERE phone = ?').get(lead.phone);
  if (existing) {
    db.prepare('UPDATE leads SET imported = 1, vendor_id = ? WHERE id = ?').run(existing.id, lead.id);
    return res.json({ ok: true, vendor_id: existing.id, was_new: false });
  }
  const r = db.prepare(`
    INSERT INTO vendors (name, phone, company, address, city, category, status)
    VALUES (?, ?, ?, ?, ?, ?, 'lead')
  `).run(lead.name, lead.phone, lead.name, lead.address || null, lead.city || null, lead.category || null);
  db.prepare('UPDATE leads SET imported = 1, vendor_id = ? WHERE id = ?').run(r.lastInsertRowid, lead.id);
  res.json({ ok: true, vendor_id: r.lastInsertRowid, was_new: true });
});

router.post('/promote-bulk', (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids_array_required' });
  let promoted = 0, skipped = 0;
  for (const id of ids) {
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
    if (!lead || !lead.phone || lead.phone.length < 10) { skipped++; continue; }
    const existing = db.prepare('SELECT id FROM vendors WHERE phone = ?').get(lead.phone);
    if (existing) {
      db.prepare('UPDATE leads SET imported = 1, vendor_id = ? WHERE id = ?').run(existing.id, lead.id);
      skipped++; continue;
    }
    const r = db.prepare(`
      INSERT INTO vendors (name, phone, company, address, city, category, status)
      VALUES (?, ?, ?, ?, ?, ?, 'lead')
    `).run(lead.name, lead.phone, lead.name, lead.address || null, lead.city || null, lead.category || null);
    db.prepare('UPDATE leads SET imported = 1, vendor_id = ? WHERE id = ?').run(r.lastInsertRowid, lead.id);
    promoted++;
  }
  res.json({ promoted, skipped });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
