const express = require('express');
const db = require('../db');
const { body, S } = require('../validate');
const { orgFilter, ownedByOrg } = require('../tenancy');

const router = express.Router();

// A rule's template_id points at `templates` (WhatsApp) or `email_templates`
// (email) depending on channel. Validate it belongs to the caller's org so a
// rule can't be bound to another tenant's template.
function templateFkError(orgId, templateId, channel) {
  if (templateId == null) return null;
  const table = channel === 'email' ? 'email_templates' : 'templates';
  return ownedByOrg(table, templateId, orgId) ? null : 'invalid_template_id';
}

const ruleBodySchema = {
  name: S.string({ maxLength: 200 }),
  trigger: S.string({ maxLength: 60 }),
  delay_hours: S.int({ min: 0 }),
  template_id: S.int({ min: 1 }),
  max_attempts: S.int({ min: 1 }),
  stop_on_reply: S.flag(),
  active: S.flag(),
  channel: S.string({ maxLength: 60 }),
};

// Rules CRUD
router.get('/rules', (req, res) => {
  res.json(db.prepare(`
    SELECT r.*,
      CASE WHEN r.channel = 'email' THEN et.name ELSE t.name END AS template_name
    FROM followup_rules r
    LEFT JOIN templates t ON t.id = r.template_id AND COALESCE(r.channel,'whatsapp') = 'whatsapp'
    LEFT JOIN email_templates et ON et.id = r.template_id AND r.channel = 'email'
    WHERE ${orgFilter('r')}
    ORDER BY r.created_at DESC
  `).all({ orgId: req.orgId }));
});

router.post('/rules', body(ruleBodySchema), (req, res) => {
  const { name, trigger, delay_hours, template_id, max_attempts, stop_on_reply, active, channel } = req.body;
  if (!name || !trigger || !delay_hours || !template_id) {
    return res.status(400).json({ error: 'name, trigger, delay_hours, template_id required' });
  }
  if (!['no_reply', 'after_send'].includes(trigger)) {
    return res.status(400).json({ error: 'trigger must be no_reply or after_send' });
  }
  const ch = channel === 'email' ? 'email' : 'whatsapp';
  const fkErr = templateFkError(req.orgId, template_id, ch);
  if (fkErr) return res.status(400).json({ error: fkErr });
  const r = db.prepare(`
    INSERT INTO followup_rules (organization_id, name, trigger, delay_hours, template_id, max_attempts, stop_on_reply, active, channel)
    VALUES (?, ?, ?, ?, ?, COALESCE(?, 3), COALESCE(?, 1), COALESCE(?, 1), ?)
  `).run(req.orgId, name, trigger, delay_hours, template_id, max_attempts, stop_on_reply, active, ch);
  res.json({ id: r.lastInsertRowid });
});

router.put('/rules/:id', body(ruleBodySchema), (req, res) => {
  // If template_id is being changed, validate it against the rule's channel
  // (the new channel if supplied, otherwise the existing one).
  if (req.body.template_id !== undefined) {
    let ch = req.body.channel;
    if (ch === undefined) {
      const existing = db.prepare(`SELECT channel FROM followup_rules WHERE id = @id AND ${orgFilter()}`)
        .get({ id: req.params.id, orgId: req.orgId });
      if (!existing) return res.status(404).json({ error: 'not_found' });
      ch = existing.channel;
    }
    const fkErr = templateFkError(req.orgId, req.body.template_id, ch === 'email' ? 'email' : 'whatsapp');
    if (fkErr) return res.status(400).json({ error: fkErr });
  }
  const allowed = ['name', 'trigger', 'delay_hours', 'template_id', 'max_attempts', 'stop_on_reply', 'active', 'channel'];
  const sets = [];
  const params = { id: req.params.id, orgId: req.orgId };
  for (const k of allowed) if (req.body[k] !== undefined) { sets.push(`${k} = @${k}`); params[k] = req.body[k]; }
  if (!sets.length) return res.json({ ok: true });
  db.prepare(`UPDATE followup_rules SET ${sets.join(', ')} WHERE id = @id AND ${orgFilter()}`).run(params);
  res.json({ ok: true });
});

router.delete('/rules/:id', (req, res) => {
  db.prepare(`UPDATE followup_rules SET deleted_at = @now WHERE id = @id AND ${orgFilter()}`).run({ id: req.params.id, orgId: req.orgId, now: Date.now() });
  res.json({ ok: true });
});

// Pending follow-ups list
router.get('/pending', (req, res) => {
  const rows = db.prepare(`
    SELECT f.*, v.name AS vendor_name, v.phone AS vendor_phone, r.name AS rule_name
    FROM followups f
    JOIN vendors v ON v.id = f.vendor_id
    JOIN followup_rules r ON r.id = f.rule_id
    WHERE f.status = 'pending' AND ${orgFilter('f')}
    ORDER BY f.scheduled_at ASC LIMIT 500
  `).all({ orgId: req.orgId });
  res.json(rows);
});

router.post('/cancel/:id', body({}), (req, res) => {
  db.prepare(`UPDATE followups SET status = 'cancelled' WHERE id = @id AND ${orgFilter()}`).run({ id: req.params.id, orgId: req.orgId });
  res.json({ ok: true });
});

router.get('/stats/summary', (req, res) => {
  const totals = db.prepare(`
    SELECT
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) AS cancelled,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed
    FROM followups WHERE ${orgFilter()}
  `).get({ orgId: req.orgId });
  res.json(totals);
});

module.exports = router;
