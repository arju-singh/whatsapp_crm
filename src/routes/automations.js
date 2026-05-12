const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const rows = db.prepare(`SELECT * FROM automations ORDER BY status DESC, last_run_at DESC`).all();
  res.json(rows.map((r) => ({ ...r, actions: parseActions(r.actions_json) })));
});

router.post('/', (req, res) => {
  const { name, trigger, actions, status } = req.body;
  if (!name || !trigger) return res.status(400).json({ error: 'name_and_trigger_required' });
  const r = db.prepare(`
    INSERT INTO automations (name, trigger, actions_json, status)
    VALUES (?, ?, ?, COALESCE(?, 'on'))
  `).run(name, trigger, actions ? JSON.stringify(actions) : '[]', status);
  res.json({ id: r.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const allowed = ['name', 'trigger', 'status'];
  const sets = [];
  const params = { id: req.params.id };
  for (const k of allowed) if (req.body[k] !== undefined) { sets.push(`${k} = @${k}`); params[k] = req.body[k]; }
  if (req.body.actions !== undefined) {
    sets.push('actions_json = @actions_json');
    params.actions_json = JSON.stringify(req.body.actions);
  }
  if (!sets.length) return res.json({ ok: true });
  db.prepare(`UPDATE automations SET ${sets.join(', ')} WHERE id = @id`).run(params);
  res.json({ ok: true });
});

router.put('/:id/toggle', (req, res) => {
  const a = db.prepare('SELECT status FROM automations WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'not_found' });
  const next = a.status === 'on' ? 'off' : 'on';
  db.prepare('UPDATE automations SET status = ? WHERE id = ?').run(next, req.params.id);
  res.json({ ok: true, status: next });
});

router.post('/:id/run', (req, res) => {
  const a = db.prepare('SELECT * FROM automations WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'not_found' });
  // Allow off automations to be tested manually; just don't fire on event
  const ctx = {};
  if (req.body && req.body.vendor_id) {
    ctx.vendor = db.prepare('SELECT * FROM vendors WHERE id = ?').get(req.body.vendor_id);
  }
  if (req.body && req.body.deal_id) {
    ctx.deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.body.deal_id);
  }
  const result = require('../automation').runById(req.params.id, ctx);
  res.json({ ok: true, ...result });
});

// List of available action types + triggers (for the editor UI)
router.get('/meta', (req, res) => {
  res.json({
    triggers: [
      { id: 'contact_created', label: 'New contact added' },
      { id: 'message_received', label: 'Inbound WhatsApp received' },
      { id: 'deal_stage_changed', label: 'Deal moved to a new stage' },
      { id: 'no_reply_24h', label: 'No reply for 24 hours' },
      { id: 'daily_morning', label: 'Daily 8 AM briefing' },
    ],
    actions: [
      { id: 'send_template', label: 'Send WhatsApp template', params: ['template_id'] },
      { id: 'send_message', label: 'Send WhatsApp message', params: ['body'] },
      { id: 'create_task', label: 'Create a task', params: ['title', 'priority', 'due_in_h'] },
      { id: 'set_status', label: 'Update vendor status', params: ['status'] },
      { id: 'add_tag', label: 'Add tag to contact', params: ['tag'] },
      { id: 'ai_draft_reply', label: 'AI draft a reply', params: [] },
      { id: 'notify', label: 'Notify me in the app', params: ['kind', 'text'] },
      { id: 'slack_notify', label: 'Slack notify (stub)', params: ['text'] },
    ],
  });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM automations WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

function parseActions(json) {
  if (!json) return [];
  try { return JSON.parse(json); } catch (_) { return []; }
}

module.exports = router;
