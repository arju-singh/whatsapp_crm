const express = require('express');
const db = require('../db');
const { body, S } = require('../validate');
const { orgFilter, fkError } = require('../tenancy');

const router = express.Router();

router.get('/', (req, res) => {
  const { vendor_id, scope = 'open', limit = 200 } = req.query;
  const filters = [orgFilter('t')];
  const params = { orgId: req.orgId, limit: Number(limit) };
  if (vendor_id) { filters.push('t.vendor_id = @vendor_id'); params.vendor_id = vendor_id; }
  if (scope === 'open') filters.push('t.completed = 0');
  else if (scope === 'done') filters.push('t.completed = 1');
  else if (scope === 'overdue') filters.push('t.completed = 0 AND t.due_at IS NOT NULL AND t.due_at < strftime("%s","now") * 1000');
  else if (scope === 'today') {
    const start = new Date(); start.setHours(0,0,0,0);
    const end = new Date(); end.setHours(23,59,59,999);
    filters.push('t.completed = 0 AND t.due_at BETWEEN @start AND @end');
    params.start = start.getTime(); params.end = end.getTime();
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT t.*, v.name AS vendor_name, v.phone AS vendor_phone
    FROM tasks t LEFT JOIN vendors v ON v.id = t.vendor_id AND v.organization_id = @orgId AND v.deleted_at IS NULL
    ${where} ORDER BY t.completed ASC, t.due_at ASC NULLS LAST, t.created_at DESC LIMIT @limit
  `).all(params);
  res.json(rows);
});

router.post('/', body({
  vendor_id: S.int({ min: 0 }),
  title: S.string({ required: true, maxLength: 200 }),
  description: S.text(),
  due_at: S.int({ min: 0 }),
  priority: S.string({ maxLength: 60 }),
  type: S.string({ maxLength: 60 }),
  owner: S.string({ maxLength: 200 }),
  deal_id: S.int({ min: 0 }),
}), (req, res) => {
  const { vendor_id, title, description, due_at, priority, type, owner, deal_id } = req.body;
  if (!title) return res.status(400).json({ error: 'title_required' });
  const fkErr = fkError(req.orgId, 'vendors', vendor_id, 'vendor_id')
    || fkError(req.orgId, 'deals', deal_id, 'deal_id');
  if (fkErr) return res.status(400).json({ error: fkErr });
  const r = db.prepare(`
    INSERT INTO tasks (organization_id, vendor_id, title, description, due_at, priority, type, owner, deal_id)
    VALUES (?, ?, ?, ?, ?, COALESCE(?, 'normal'), COALESCE(?, 'task'), ?, ?)
  `).run(req.orgId, vendor_id || null, title, description || null, due_at || null, priority, type || null, owner || null, deal_id || null);
  res.json({ id: r.lastInsertRowid });
});

router.put('/:id', body({
  title: S.string({ maxLength: 200 }),
  description: S.text(),
  due_at: S.int({ min: 0 }),
  priority: S.string({ maxLength: 60 }),
  vendor_id: S.int({ min: 0 }),
  type: S.string({ maxLength: 60 }),
  owner: S.string({ maxLength: 200 }),
  deal_id: S.int({ min: 0 }),
  completed: S.flag(),
}), (req, res) => {
  const fkErr = fkError(req.orgId, 'vendors', req.body.vendor_id, 'vendor_id')
    || fkError(req.orgId, 'deals', req.body.deal_id, 'deal_id');
  if (fkErr) return res.status(400).json({ error: fkErr });
  const allowed = ['title', 'description', 'due_at', 'priority', 'vendor_id', 'type', 'owner', 'deal_id'];
  const sets = [];
  const params = { id: req.params.id, orgId: req.orgId };
  for (const k of allowed) if (req.body[k] !== undefined) { sets.push(`${k} = @${k}`); params[k] = req.body[k]; }
  if (req.body.completed !== undefined) {
    sets.push('completed = @completed');
    sets.push('completed_at = @completed_at');
    params.completed = req.body.completed ? 1 : 0;
    params.completed_at = req.body.completed ? Date.now() : null;
  }
  if (!sets.length) return res.json({ ok: true });
  db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = @id AND ${orgFilter()}`).run(params);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare(`UPDATE tasks SET deleted_at = @now WHERE id = @id AND ${orgFilter()}`)
    .run({ id: req.params.id, orgId: req.orgId, now: Date.now() });
  res.json({ ok: true });
});

router.get('/stats/summary', (req, res) => {
  const now = Date.now();
  const start = new Date(); start.setHours(0,0,0,0);
  const end = new Date(); end.setHours(23,59,59,999);
  const totals = db.prepare(`
    SELECT
      SUM(CASE WHEN completed = 0 THEN 1 ELSE 0 END) AS open,
      SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN completed = 0 AND due_at IS NOT NULL AND due_at < @now THEN 1 ELSE 0 END) AS overdue,
      SUM(CASE WHEN completed = 0 AND due_at BETWEEN @start AND @end THEN 1 ELSE 0 END) AS due_today
    FROM tasks WHERE ${orgFilter()}
  `).get({ now, start: start.getTime(), end: end.getTime(), orgId: req.orgId });
  res.json(totals);
});

router.post('/delete-bulk', body({ ids: S.array({ of: S.int({ min: 1 }), maxItems: 10000 }) }), (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids_array_required' });
  const del = db.prepare(`UPDATE tasks SET deleted_at = @now WHERE id = @id AND ${orgFilter()}`);
  const tx = db.transaction((rows) => { for (const id of rows) del.run({ id, orgId: req.orgId, now: Date.now() }); });
  tx(ids);
  res.json({ deleted: ids.length });
});

router.post('/complete-bulk', body({ ids: S.array({ of: S.int({ min: 1 }), maxItems: 10000 }) }), (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids_array_required' });
  const now = Date.now();
  const upd = db.prepare(`UPDATE tasks SET completed = 1, completed_at = @now WHERE id = @id AND ${orgFilter()}`);
  const tx = db.transaction((rows) => { for (const id of rows) upd.run({ now, id, orgId: req.orgId }); });
  tx(ids);
  res.json({ updated: ids.length });
});

module.exports = router;
