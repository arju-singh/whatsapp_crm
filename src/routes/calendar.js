const express = require('express');
const db = require('../db');
const { body, S } = require('../validate');
const { orgFilter, fkError } = require('../tenancy');

const router = express.Router();

router.get('/', (req, res) => {
  const { from, to } = req.query;
  const filters = [orgFilter('e')];
  const params = { orgId: req.orgId };
  if (from) { filters.push('starts_at >= @from'); params.from = Number(from); }
  if (to) { filters.push('starts_at <= @to'); params.to = Number(to); }
  const where = `WHERE ${filters.join(' AND ')}`;
  const rows = db.prepare(`
    SELECT e.*,
      d.name AS deal_name,
      v.name AS contact_name
    FROM calendar_events e
    LEFT JOIN deals d ON d.id = e.deal_id AND d.organization_id = @orgId AND d.deleted_at IS NULL
    LEFT JOIN vendors v ON v.id = e.contact_id AND v.organization_id = @orgId AND v.deleted_at IS NULL
    ${where}
    ORDER BY starts_at ASC
  `).all(params);
  res.json(rows);
});

router.post('/', body({
  title: S.string({ maxLength: 200 }),
  starts_at: S.int({ min: 0 }),
  ends_at: S.int({ min: 0 }),
  color: S.string({ maxLength: 60 }),
  deal_id: S.int({ min: 0 }),
  contact_id: S.int({ min: 0 }),
  notes: S.text(),
}), (req, res) => {
  const { title, starts_at, ends_at, color, deal_id, contact_id, notes } = req.body;
  if (!title || !starts_at || !ends_at) return res.status(400).json({ error: 'title_starts_ends_required' });
  const fkErr = fkError(req.orgId, 'deals', deal_id, 'deal_id')
    || fkError(req.orgId, 'vendors', contact_id, 'contact_id');
  if (fkErr) return res.status(400).json({ error: fkErr });
  const r = db.prepare(`
    INSERT INTO calendar_events (organization_id, title, starts_at, ends_at, color, deal_id, contact_id, notes)
    VALUES (?, ?, ?, ?, COALESCE(?, '#7A7670'), ?, ?, ?)
  `).run(req.orgId, title, starts_at, ends_at, color, deal_id || null, contact_id || null, notes || null);
  res.json({ id: r.lastInsertRowid });
});

router.put('/:id', body({
  title: S.string({ maxLength: 200 }),
  starts_at: S.int({ min: 0 }),
  ends_at: S.int({ min: 0 }),
  color: S.string({ maxLength: 60 }),
  deal_id: S.int({ min: 0 }),
  contact_id: S.int({ min: 0 }),
  notes: S.text(),
}), (req, res) => {
  const fkErr = fkError(req.orgId, 'deals', req.body.deal_id, 'deal_id')
    || fkError(req.orgId, 'vendors', req.body.contact_id, 'contact_id');
  if (fkErr) return res.status(400).json({ error: fkErr });
  const allowed = ['title', 'starts_at', 'ends_at', 'color', 'deal_id', 'contact_id', 'notes'];
  const sets = [];
  const params = { id: req.params.id, orgId: req.orgId };
  for (const k of allowed) if (req.body[k] !== undefined) { sets.push(`${k} = @${k}`); params[k] = req.body[k]; }
  if (!sets.length) return res.json({ ok: true });
  db.prepare(`UPDATE calendar_events SET ${sets.join(', ')} WHERE id = @id AND ${orgFilter()}`).run(params);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare(`UPDATE calendar_events SET deleted_at = @now WHERE id = @id AND ${orgFilter()}`)
    .run({ id: req.params.id, orgId: req.orgId, now: Date.now() });
  res.json({ ok: true });
});

module.exports = router;
