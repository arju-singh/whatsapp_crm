const express = require('express');
const db = require('../db');
const { body, S } = require('../validate');
const { orgFilter } = require('../tenancy');

const router = express.Router();

router.get('/', (req, res) => {
  const { q, tier } = req.query;
  const filters = [orgFilter('c')];
  const params = { orgId: req.orgId };
  if (q) { filters.push('(c.name LIKE @q OR c.domain LIKE @q OR c.industry LIKE @q OR c.city LIKE @q)'); params.q = `%${q}%`; }
  if (tier) { filters.push('c.tier = @tier'); params.tier = tier; }
  const where = `WHERE ${filters.join(' AND ')}`;
  const rows = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM vendors v WHERE v.company_id = c.id AND ${orgFilter('v')}) AS contacts_count,
      (SELECT COALESCE(SUM(d.amount), 0) FROM deals d
        JOIN stages s ON s.id = d.stage_id
        WHERE d.company_id = c.id AND s.is_won = 0 AND s.is_lost = 0 AND ${orgFilter('d')}) AS open_pipe
    FROM companies c
    ${where}
    ORDER BY c.mrr DESC
  `).all(params);
  res.json(rows);
});

router.get('/stats/summary', (req, res) => {
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(mrr) AS total_mrr,
      SUM(CASE WHEN tier = 'Enterprise' THEN 1 ELSE 0 END) AS enterprise,
      SUM(CASE WHEN tier = 'Growth' THEN 1 ELSE 0 END) AS growth,
      SUM(CASE WHEN tier = 'Starter' THEN 1 ELSE 0 END) AS starter
    FROM companies WHERE ${orgFilter()}
  `).get({ orgId: req.orgId });
  res.json(totals);
});

router.get('/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM companies WHERE id = @id AND ${orgFilter()}`)
    .get({ id: req.params.id, orgId: req.orgId });
  if (!row) return res.status(404).json({ error: 'not_found' });
  const contacts = db.prepare(`SELECT * FROM vendors WHERE company_id = @id AND ${orgFilter()} ORDER BY score DESC`)
    .all({ id: req.params.id, orgId: req.orgId });
  const deals = db.prepare(`
    SELECT d.*, s.name AS stage_name, s.color AS stage_color
    FROM deals d LEFT JOIN stages s ON s.id = d.stage_id
    WHERE d.company_id = @id AND ${orgFilter('d')} ORDER BY d.created_at DESC
  `).all({ id: req.params.id, orgId: req.orgId });
  const tickets = db.prepare(`SELECT * FROM tickets WHERE company_id = @id AND ${orgFilter()} ORDER BY created_at DESC`)
    .all({ id: req.params.id, orgId: req.orgId });
  res.json({ company: row, contacts, deals, tickets });
});

router.post('/', body({
  name: S.string({ required: true, maxLength: 200 }),
  domain: S.string({ maxLength: 200 }),
  industry: S.string({ maxLength: 200 }),
  size: S.string({ maxLength: 60 }),
  city: S.string({ maxLength: 200 }),
  tier: S.string({ maxLength: 60 }),
  mrr: S.int({ min: 0 }),
  since: S.string({ maxLength: 60 }),
  logo: S.string({ maxLength: 200 }),
  color: S.string({ maxLength: 60 }),
  notes: S.text(),
}), (req, res) => {
  const { name, domain, industry, size, city, tier, mrr, since, logo, color, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'name_required' });
  const initials = (logo || name).split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const r = db.prepare(`
    INSERT INTO companies (organization_id, name, domain, industry, size, city, tier, mrr, since, logo, color, notes)
    VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, 'Starter'), COALESCE(?, 0), ?, ?, COALESCE(?, '#7A7670'), ?)
  `).run(req.orgId, name, domain || null, industry || null, size || null, city || null, tier, mrr, since || null, initials, color, notes || null);
  res.json({ id: r.lastInsertRowid });
});

router.put('/:id', body({
  name: S.string({ maxLength: 200 }),
  domain: S.string({ maxLength: 200 }),
  industry: S.string({ maxLength: 200 }),
  size: S.string({ maxLength: 60 }),
  city: S.string({ maxLength: 200 }),
  tier: S.string({ maxLength: 60 }),
  mrr: S.int({ min: 0 }),
  since: S.string({ maxLength: 60 }),
  logo: S.string({ maxLength: 200 }),
  color: S.string({ maxLength: 60 }),
  notes: S.text(),
}), (req, res) => {
  const allowed = ['name', 'domain', 'industry', 'size', 'city', 'tier', 'mrr', 'since', 'logo', 'color', 'notes'];
  const sets = [];
  const params = { id: req.params.id, orgId: req.orgId, updated_at: Date.now() };
  for (const k of allowed) if (req.body[k] !== undefined) { sets.push(`${k} = @${k}`); params[k] = req.body[k]; }
  if (!sets.length) return res.json({ ok: true });
  sets.push('updated_at = @updated_at');
  db.prepare(`UPDATE companies SET ${sets.join(', ')} WHERE id = @id AND ${orgFilter()}`).run(params);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare(`UPDATE companies SET deleted_at = @now WHERE id = @id AND ${orgFilter()}`)
    .run({ id: req.params.id, orgId: req.orgId, now: Date.now() });
  res.json({ ok: true });
});

router.post('/delete-bulk', body({ ids: S.array({ of: S.int({ min: 1 }), maxItems: 10000 }) }), (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids_array_required' });
  const del = db.prepare(`UPDATE companies SET deleted_at = @now WHERE id = @id AND ${orgFilter()}`);
  const tx = db.transaction((rows) => { for (const id of rows) del.run({ id, orgId: req.orgId, now: Date.now() }); });
  tx(ids);
  res.json({ deleted: ids.length });
});

module.exports = router;
