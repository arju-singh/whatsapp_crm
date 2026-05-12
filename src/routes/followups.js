const express = require('express');
const db = require('../db');

const router = express.Router();

// Rules CRUD
router.get('/rules', (req, res) => {
  res.json(db.prepare(`
    SELECT r.*,
      CASE WHEN r.channel = 'email' THEN et.name ELSE t.name END AS template_name
    FROM followup_rules r
    LEFT JOIN templates t ON t.id = r.template_id AND COALESCE(r.channel,'whatsapp') = 'whatsapp'
    LEFT JOIN email_templates et ON et.id = r.template_id AND r.channel = 'email'
    ORDER BY r.created_at DESC
  `).all());
});

router.post('/rules', (req, res) => {
  const { name, trigger, delay_hours, template_id, max_attempts, stop_on_reply, active, channel } = req.body;
  if (!name || !trigger || !delay_hours || !template_id) {
    return res.status(400).json({ error: 'name, trigger, delay_hours, template_id required' });
  }
  if (!['no_reply', 'after_send'].includes(trigger)) {
    return res.status(400).json({ error: 'trigger must be no_reply or after_send' });
  }
  const ch = channel === 'email' ? 'email' : 'whatsapp';
  const r = db.prepare(`
    INSERT INTO followup_rules (name, trigger, delay_hours, template_id, max_attempts, stop_on_reply, active, channel)
    VALUES (?, ?, ?, ?, COALESCE(?, 3), COALESCE(?, 1), COALESCE(?, 1), ?)
  `).run(name, trigger, delay_hours, template_id, max_attempts, stop_on_reply, active, ch);
  res.json({ id: r.lastInsertRowid });
});

router.put('/rules/:id', (req, res) => {
  const allowed = ['name', 'trigger', 'delay_hours', 'template_id', 'max_attempts', 'stop_on_reply', 'active', 'channel'];
  const sets = [];
  const params = { id: req.params.id };
  for (const k of allowed) if (req.body[k] !== undefined) { sets.push(`${k} = @${k}`); params[k] = req.body[k]; }
  if (!sets.length) return res.json({ ok: true });
  db.prepare(`UPDATE followup_rules SET ${sets.join(', ')} WHERE id = @id`).run(params);
  res.json({ ok: true });
});

router.delete('/rules/:id', (req, res) => {
  db.prepare('DELETE FROM followup_rules WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Pending follow-ups list
router.get('/pending', (req, res) => {
  const rows = db.prepare(`
    SELECT f.*, v.name AS vendor_name, v.phone AS vendor_phone, r.name AS rule_name
    FROM followups f
    JOIN vendors v ON v.id = f.vendor_id
    JOIN followup_rules r ON r.id = f.rule_id
    WHERE f.status = 'pending'
    ORDER BY f.scheduled_at ASC LIMIT 500
  `).all();
  res.json(rows);
});

router.post('/cancel/:id', (req, res) => {
  db.prepare("UPDATE followups SET status = 'cancelled' WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

router.get('/stats/summary', (req, res) => {
  const totals = db.prepare(`
    SELECT
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) AS cancelled,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed
    FROM followups
  `).get();
  res.json(totals);
});

module.exports = router;
