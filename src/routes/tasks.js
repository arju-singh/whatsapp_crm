const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const { vendor_id, scope = 'open', limit = 200 } = req.query;
  const filters = [];
  const params = { limit: Number(limit) };
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
    FROM tasks t LEFT JOIN vendors v ON v.id = t.vendor_id
    ${where} ORDER BY t.completed ASC, t.due_at ASC NULLS LAST, t.created_at DESC LIMIT @limit
  `).all(params);
  res.json(rows);
});

router.post('/', (req, res) => {
  const { vendor_id, title, description, due_at, priority, type, owner, deal_id } = req.body;
  if (!title) return res.status(400).json({ error: 'title_required' });
  const r = db.prepare(`
    INSERT INTO tasks (vendor_id, title, description, due_at, priority, type, owner, deal_id)
    VALUES (?, ?, ?, ?, COALESCE(?, 'normal'), COALESCE(?, 'task'), ?, ?)
  `).run(vendor_id || null, title, description || null, due_at || null, priority, type || null, owner || null, deal_id || null);
  res.json({ id: r.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const allowed = ['title', 'description', 'due_at', 'priority', 'vendor_id', 'type', 'owner', 'deal_id'];
  const sets = [];
  const params = { id: req.params.id };
  for (const k of allowed) if (req.body[k] !== undefined) { sets.push(`${k} = @${k}`); params[k] = req.body[k]; }
  if (req.body.completed !== undefined) {
    sets.push('completed = @completed');
    sets.push('completed_at = @completed_at');
    params.completed = req.body.completed ? 1 : 0;
    params.completed_at = req.body.completed ? Date.now() : null;
  }
  if (!sets.length) return res.json({ ok: true });
  db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = @id`).run(params);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
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
      SUM(CASE WHEN completed = 0 AND due_at IS NOT NULL AND due_at < ? THEN 1 ELSE 0 END) AS overdue,
      SUM(CASE WHEN completed = 0 AND due_at BETWEEN ? AND ? THEN 1 ELSE 0 END) AS due_today
    FROM tasks
  `).get(now, start.getTime(), end.getTime());
  res.json(totals);
});

module.exports = router;
