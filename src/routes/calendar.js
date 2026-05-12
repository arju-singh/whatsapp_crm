const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const { from, to } = req.query;
  const filters = [];
  const params = {};
  if (from) { filters.push('starts_at >= @from'); params.from = Number(from); }
  if (to) { filters.push('starts_at <= @to'); params.to = Number(to); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT e.*,
      d.name AS deal_name,
      v.name AS contact_name
    FROM calendar_events e
    LEFT JOIN deals d ON d.id = e.deal_id
    LEFT JOIN vendors v ON v.id = e.contact_id
    ${where}
    ORDER BY starts_at ASC
  `).all(params);
  res.json(rows);
});

router.post('/', (req, res) => {
  const { title, starts_at, ends_at, color, deal_id, contact_id, notes } = req.body;
  if (!title || !starts_at || !ends_at) return res.status(400).json({ error: 'title_starts_ends_required' });
  const r = db.prepare(`
    INSERT INTO calendar_events (title, starts_at, ends_at, color, deal_id, contact_id, notes)
    VALUES (?, ?, ?, COALESCE(?, '#7A7670'), ?, ?, ?)
  `).run(title, starts_at, ends_at, color, deal_id || null, contact_id || null, notes || null);
  res.json({ id: r.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const allowed = ['title', 'starts_at', 'ends_at', 'color', 'deal_id', 'contact_id', 'notes'];
  const sets = [];
  const params = { id: req.params.id };
  for (const k of allowed) if (req.body[k] !== undefined) { sets.push(`${k} = @${k}`); params[k] = req.body[k]; }
  if (!sets.length) return res.json({ ok: true });
  db.prepare(`UPDATE calendar_events SET ${sets.join(', ')} WHERE id = @id`).run(params);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM calendar_events WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
