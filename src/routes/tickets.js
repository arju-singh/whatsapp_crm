const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const { status, priority, assignee } = req.query;
  const filters = [];
  const params = {};
  if (status) { filters.push('t.status = @status'); params.status = status; }
  if (priority) { filters.push('t.priority = @priority'); params.priority = priority; }
  if (assignee) { filters.push('t.assignee = @assignee'); params.assignee = assignee; }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
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
    FROM tickets
  `).get();
  res.json(totals);
});

router.post('/', (req, res) => {
  const { subject, body, company_id, requester_id, priority, sla, assignee } = req.body;
  if (!subject) return res.status(400).json({ error: 'subject_required' });
  const r = db.prepare(`
    INSERT INTO tickets (subject, body, company_id, requester_id, priority, sla, assignee)
    VALUES (?, ?, ?, ?, COALESCE(?, 'med'), ?, ?)
  `).run(subject, body || null, company_id || null, requester_id || null, priority, sla || null, assignee || null);
  res.json({ id: r.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const allowed = ['subject', 'body', 'company_id', 'requester_id', 'priority', 'status', 'sla', 'assignee'];
  const sets = [];
  const params = { id: req.params.id, updated_at: Date.now() };
  for (const k of allowed) if (req.body[k] !== undefined) { sets.push(`${k} = @${k}`); params[k] = req.body[k]; }
  if (!sets.length) return res.json({ ok: true });
  sets.push('updated_at = @updated_at');
  db.prepare(`UPDATE tickets SET ${sets.join(', ')} WHERE id = @id`).run(params);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM tickets WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
