const express = require('express');
const db = require('../db');
const { body, S } = require('../validate');
const { orgFilter } = require('../tenancy');

const router = express.Router();

router.get('/', (req, res) => {
  const { status, priority, assignee } = req.query;
  const filters = [orgFilter('t')];
  const params = { orgId: req.orgId };
  if (status) { filters.push('t.status = @status'); params.status = status; }
  if (priority) { filters.push('t.priority = @priority'); params.priority = priority; }
  if (assignee) { filters.push('t.assignee = @assignee'); params.assignee = assignee; }
  const where = `WHERE ${filters.join(' AND ')}`;
  const rows = db.prepare(`
    SELECT t.*,
      c.name AS company_name, c.logo AS company_logo, c.color AS company_color,
      v.name AS requester_name
    FROM tickets t
    LEFT JOIN companies c ON c.id = t.company_id
    LEFT JOIN vendors v ON v.id = t.requester_id
    ${where}
    ORDER BY
      CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'med' THEN 2 ELSE 3 END,
      t.created_at DESC
  `).all(params);
  res.json(rows);
});

router.get('/stats/summary', (req, res) => {
  const totals = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'solved' THEN 1 ELSE 0 END) AS solved,
      SUM(CASE WHEN priority = 'urgent' AND status = 'open' THEN 1 ELSE 0 END) AS urgent_open
    FROM tickets WHERE ${orgFilter()}
  `).get({ orgId: req.orgId });
  res.json(totals);
});

router.post('/', body({
  subject: S.string({ maxLength: 300 }),
  body: S.text(),
  company_id: S.int({ min: 0 }),
  requester_id: S.int({ min: 0 }),
  priority: S.string({ maxLength: 60 }),
  sla: S.string({ maxLength: 60 }),
  assignee: S.string({ maxLength: 200 }),
}), (req, res) => {
  const { subject, body, company_id, requester_id, priority, sla, assignee } = req.body;
  if (!subject) return res.status(400).json({ error: 'subject_required' });
  const r = db.prepare(`
    INSERT INTO tickets (organization_id, subject, body, company_id, requester_id, priority, sla, assignee)
    VALUES (?, ?, ?, ?, ?, COALESCE(?, 'med'), ?, ?)
  `).run(req.orgId, subject, body || null, company_id || null, requester_id || null, priority, sla || null, assignee || null);
  res.json({ id: r.lastInsertRowid });
});

router.put('/:id', body({
  subject: S.string({ maxLength: 300 }),
  body: S.text(),
  company_id: S.int({ min: 0 }),
  requester_id: S.int({ min: 0 }),
  priority: S.string({ maxLength: 60 }),
  status: S.string({ maxLength: 60 }),
  sla: S.string({ maxLength: 60 }),
  assignee: S.string({ maxLength: 200 }),
}), (req, res) => {
  const allowed = ['subject', 'body', 'company_id', 'requester_id', 'priority', 'status', 'sla', 'assignee'];
  const sets = [];
  const params = { id: req.params.id, orgId: req.orgId, updated_at: Date.now() };
  for (const k of allowed) if (req.body[k] !== undefined) { sets.push(`${k} = @${k}`); params[k] = req.body[k]; }
  if (!sets.length) return res.json({ ok: true });
  sets.push('updated_at = @updated_at');
  db.prepare(`UPDATE tickets SET ${sets.join(', ')} WHERE id = @id AND ${orgFilter()}`).run(params);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare(`UPDATE tickets SET deleted_at = @now WHERE id = @id AND ${orgFilter()}`)
    .run({ id: req.params.id, orgId: req.orgId, now: Date.now() });
  res.json({ ok: true });
});

router.post('/delete-bulk', body({ ids: S.array({ of: S.int({ min: 1 }), maxItems: 10000 }) }), (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids_array_required' });
  const del = db.prepare(`UPDATE tickets SET deleted_at = @now WHERE id = @id AND ${orgFilter()}`);
  const tx = db.transaction((rows) => { for (const id of rows) del.run({ id, orgId: req.orgId, now: Date.now() }); });
  tx(ids);
  res.json({ deleted: ids.length });
});

router.post('/status-bulk', body({
  ids: S.array({ of: S.int({ min: 1 }), maxItems: 10000 }),
  status: S.string({ maxLength: 60 }),
}), (req, res) => {
  const { ids, status } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids_array_required' });
  const st = status || 'solved';
  const upd = db.prepare(`UPDATE tickets SET status = @status, updated_at = @now WHERE id = @id AND ${orgFilter()}`);
  const now = Date.now();
  const tx = db.transaction((rows) => { for (const id of rows) upd.run({ status: st, now, id, orgId: req.orgId }); });
  tx(ids);
  res.json({ updated: ids.length, status: st });
});

module.exports = router;
