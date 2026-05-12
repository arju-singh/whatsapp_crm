const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const { vendor_id, limit = 200 } = req.query;
  const where = vendor_id ? 'WHERE c.vendor_id = @vendor_id' : '';
  const rows = db.prepare(`
    SELECT c.*, v.name AS vendor_name, v.phone AS vendor_phone
    FROM calls c JOIN vendors v ON v.id = c.vendor_id
    ${where} ORDER BY c.created_at DESC LIMIT @limit
  `).all({ vendor_id, limit: Number(limit) });
  res.json(rows);
});

router.post('/', (req, res) => {
  const { vendor_id, direction, disposition, outcome, duration_sec, notes, caller } = req.body;
  if (!vendor_id) return res.status(400).json({ error: 'vendor_id_required' });
  const r = db.prepare(`
    INSERT INTO calls (vendor_id, direction, disposition, outcome, duration_sec, notes, caller)
    VALUES (?, COALESCE(?, 'out'), ?, ?, ?, ?, ?)
  `).run(vendor_id, direction || null, disposition || null, outcome || null, duration_sec || null, notes || null, caller || null);

  const now = Date.now();
  db.prepare(`
    UPDATE vendors SET last_contacted_at = ?, updated_at = ?,
      status = CASE
        WHEN ? = 'won' THEN 'won'
        WHEN ? = 'lost' THEN 'lost'
        WHEN status = 'new' THEN 'contacted'
        ELSE status END
    WHERE id = ?
  `).run(now, now, outcome || '', outcome || '', vendor_id);
  res.json({ id: r.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const allowed = ['direction', 'disposition', 'outcome', 'duration_sec', 'notes', 'caller'];
  const sets = [];
  const params = { id: req.params.id };
  for (const k of allowed) if (req.body[k] !== undefined) { sets.push(`${k} = @${k}`); params[k] = req.body[k]; }
  if (!sets.length) return res.json({ ok: true });
  db.prepare(`UPDATE calls SET ${sets.join(', ')} WHERE id = @id`).run(params);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM calls WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.get('/stats/summary', (req, res) => {
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN disposition = 'connected' THEN 1 ELSE 0 END) AS connected,
      SUM(CASE WHEN disposition = 'voicemail' THEN 1 ELSE 0 END) AS voicemail,
      SUM(CASE WHEN disposition = 'no_answer' THEN 1 ELSE 0 END) AS no_answer,
      SUM(CASE WHEN disposition = 'callback_request' THEN 1 ELSE 0 END) AS callbacks,
      SUM(CASE WHEN disposition = 'busy' THEN 1 ELSE 0 END) AS busy,
      SUM(CASE WHEN disposition = 'wrong_number' THEN 1 ELSE 0 END) AS wrong_number,
      SUM(CASE WHEN outcome = 'interested' THEN 1 ELSE 0 END) AS interested,
      SUM(CASE WHEN outcome = 'won' THEN 1 ELSE 0 END) AS won
    FROM calls
  `).get();
  res.json(totals);
});

module.exports = router;
