// =============================================================
// Automation engine — runs trigger handlers on events and executes
// action chains stored on the `automations` rows. The actions_json
// column holds a JSON array; each item is { a: <action>, ...params }.
//
// Triggers (fired from elsewhere in the codebase):
//   - contact_created          (vendors.js POST/import)
//   - message_received         (whatsapp.js inbound handler)
//   - deal_stage_changed       (deals.js PUT /stage)
//   - lead_score_changed       (manual / from AI)
//   - no_reply_24h             (scheduler — scans nightly)
//   - daily_morning            (scheduler — 8am tick)
//
// Action types:
//   - send_template     {template_id}             → enqueue WA send to vendor
//   - send_message      {body}                    → enqueue WA send (free-form)
//   - create_task       {title, priority, due_in_h}
//   - set_status        {status}                  → vendor.status
//   - add_tag           {tag}
//   - ai_draft_reply    {}                        → ask AI to draft a reply
//   - notify            {kind, text}              → push notifications row
//   - slack_notify      {text}                    → no-op stub for now
// =============================================================
const db = require('./db');

let aiMod = null;
const transports = require('./transports'); // unified send; lazily loads channels itself

function getAi() { if (!aiMod) aiMod = require('./ai-agent'); return aiMod; }

const HANDLERS = {
  send_template({ vendor, action }) {
    if (!vendor) return;
    const t = db.prepare('SELECT body FROM templates WHERE id = ?').get(action.template_id);
    if (!t) return { error: 'template_not_found' };
    const r = db.prepare(`
      INSERT INTO messages (vendor_id, direction, body, status) VALUES (?, 'out', ?, 'queued')
    `).run(vendor.id, t.body);
    transports.sendMessage('whatsapp', r.lastInsertRowid);
    return { message_id: r.lastInsertRowid };
  },
  send_message({ vendor, action }) {
    if (!vendor) return;
    const r = db.prepare(`
      INSERT INTO messages (vendor_id, direction, body, status) VALUES (?, 'out', ?, 'queued')
    `).run(vendor.id, action.body || '(empty)');
    transports.sendMessage('whatsapp', r.lastInsertRowid);
    return { message_id: r.lastInsertRowid };
  },
  create_task({ vendor, deal, action }) {
    const due = action.due_in_h ? Date.now() + Number(action.due_in_h) * 3600 * 1000 : null;
    const r = db.prepare(`
      INSERT INTO tasks (vendor_id, deal_id, title, due_at, priority, type, owner)
      VALUES (?, ?, ?, ?, COALESCE(?, 'med'), COALESCE(?, 'task'), 'You')
    `).run(vendor && vendor.id, deal && deal.id, action.title || 'Auto task', due, action.priority, action.type);
    return { task_id: r.lastInsertRowid };
  },
  set_status({ vendor, action }) {
    if (!vendor) return;
    db.prepare('UPDATE vendors SET status = ?, updated_at = ? WHERE id = ?').run(action.status, Date.now(), vendor.id);
    return { ok: true };
  },
  add_tag({ vendor, action }) {
    if (!vendor) return;
    const tags = (vendor.tags || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!tags.includes(action.tag)) tags.push(action.tag);
    db.prepare('UPDATE vendors SET tags = ?, updated_at = ? WHERE id = ?').run(tags.join(','), Date.now(), vendor.id);
    return { tags: tags.join(',') };
  },
  ai_draft_reply({ vendor }) {
    if (!vendor) return;
    return getAi().draftReply(vendor.id).catch((e) => ({ error: e.message }));
  },
  notify({ action }) {
    db.prepare('INSERT INTO notifications (kind, text, link) VALUES (?, ?, ?)')
      .run(action.kind || 'info', action.text || 'Automation event', action.link || null);
    return { ok: true };
  },
  slack_notify({ action }) {
    // Placeholder. Wire to a real Slack webhook later.
    console.log('[automation] slack_notify (stub):', action.text);
    return { ok: true };
  },
};

function listAutomations(trigger) {
  return db.prepare(`SELECT * FROM automations WHERE status = 'on' AND trigger = ?`).all(trigger);
}

function runActions(actionsJson, ctx) {
  let actions;
  try { actions = JSON.parse(actionsJson || '[]'); } catch (_) { return []; }
  const results = [];
  for (const action of actions) {
    const fn = HANDLERS[action.a || action.type];
    if (!fn) { results.push({ action, error: 'unknown_action' }); continue; }
    try {
      results.push({ action, result: fn({ ...ctx, action }) });
    } catch (e) {
      results.push({ action, error: e.message });
    }
  }
  return results;
}

function fire(trigger, ctx = {}) {
  const automations = listAutomations(trigger);
  for (const a of automations) {
    runActions(a.actions_json, ctx);
    db.prepare('UPDATE automations SET runs = runs + 1, last_run_at = ? WHERE id = ?').run(Date.now(), a.id);
  }
  return { trigger, fired: automations.length };
}

// One-off run for a specific automation (used by Test-run button)
function runById(id, ctx = {}) {
  const a = db.prepare('SELECT * FROM automations WHERE id = ?').get(id);
  if (!a) return { error: 'not_found' };
  const results = runActions(a.actions_json, ctx);
  db.prepare('UPDATE automations SET runs = runs + 1, last_run_at = ? WHERE id = ?').run(Date.now(), a.id);
  return { id, results };
}

// Scheduler tick — scan for vendors with no reply in 24h+ and fire `no_reply_24h`
function tickNoReply() {
  const cutoff = Date.now() - 24 * 3600 * 1000;
  const cands = db.prepare(`
    SELECT v.* FROM vendors v
    WHERE v.last_contacted_at IS NOT NULL
      AND v.last_contacted_at < ?
      AND (v.last_replied_at IS NULL OR v.last_replied_at < v.last_contacted_at)
      AND v.status NOT IN ('won', 'lost', 'opted_out')
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.kind = 'auto_no_reply_24h' AND n.text LIKE '%vendor:' || v.id || ':%' AND n.created_at > ?
      )
  `).all(cutoff, cutoff);
  for (const v of cands) {
    fire('no_reply_24h', { vendor: v });
    db.prepare('INSERT INTO notifications (kind, text, link, unread) VALUES (?, ?, ?, 1)')
      .run('auto_no_reply_24h', `[vendor:${v.id}:tick] No reply from ${v.name} in 24h+`, '/inbox');
  }
  return { fired: cands.length };
}

// Daily morning briefing — emits a notification with today's pipeline summary
function tickDailyMorning() {
  const open = db.prepare(`
    SELECT COUNT(*) AS c, COALESCE(SUM(d.amount), 0) AS amt
    FROM deals d JOIN stages s ON s.id = d.stage_id
    WHERE s.is_won = 0 AND s.is_lost = 0
  `).get();
  const tasksToday = db.prepare(`
    SELECT COUNT(*) AS c FROM tasks WHERE completed = 0 AND due_at IS NOT NULL
      AND due_at BETWEEN ? AND ?
  `).get((() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })(),
       (() => { const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime(); })()).c;
  db.prepare('INSERT INTO notifications (kind, text, link, unread) VALUES (?, ?, ?, 1)')
    .run('ai', `Morning briefing: ${open.c} open deals worth $${open.amt.toLocaleString()}, ${tasksToday} tasks due today`, '/dashboard');
  fire('daily_morning', { stats: { open, tasksToday } });
  return { ok: true };
}

module.exports = { fire, runById, tickNoReply, tickDailyMorning, HANDLERS };
