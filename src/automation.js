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

// Every handler receives the fire ctx (which carries `orgId`) plus `action`.
// All writes are stamped/scoped with that org, and reads (templates) are scoped
// too, so an automation can only ever act within its own tenant.
const HANDLERS = {
  send_template({ vendor, action, orgId }) {
    if (!vendor || orgId == null) return;
    const t = db.prepare('SELECT body FROM templates WHERE id = ? AND organization_id = ? AND deleted_at IS NULL').get(action.template_id, orgId);
    if (!t) return { error: 'template_not_found' };
    const r = db.prepare(`
      INSERT INTO messages (organization_id, vendor_id, direction, body, status) VALUES (?, ?, 'out', ?, 'queued')
    `).run(orgId, vendor.id, t.body);
    transports.sendMessage('whatsapp', r.lastInsertRowid);
    return { message_id: r.lastInsertRowid };
  },
  send_message({ vendor, action, orgId }) {
    if (!vendor || orgId == null) return;
    const r = db.prepare(`
      INSERT INTO messages (organization_id, vendor_id, direction, body, status) VALUES (?, ?, 'out', ?, 'queued')
    `).run(orgId, vendor.id, action.body || '(empty)');
    transports.sendMessage('whatsapp', r.lastInsertRowid);
    return { message_id: r.lastInsertRowid };
  },
  create_task({ vendor, deal, action, orgId }) {
    if (orgId == null) return;
    const due = action.due_in_h ? Date.now() + Number(action.due_in_h) * 3600 * 1000 : null;
    const r = db.prepare(`
      INSERT INTO tasks (organization_id, vendor_id, deal_id, title, due_at, priority, type, owner)
      VALUES (?, ?, ?, ?, ?, COALESCE(?, 'med'), COALESCE(?, 'task'), 'You')
    `).run(orgId, vendor && vendor.id, deal && deal.id, action.title || 'Auto task', due, action.priority, action.type);
    return { task_id: r.lastInsertRowid };
  },
  set_status({ vendor, action, orgId }) {
    if (!vendor || orgId == null) return;
    db.prepare('UPDATE vendors SET status = ?, updated_at = ? WHERE id = ? AND organization_id = ?').run(action.status, Date.now(), vendor.id, orgId);
    return { ok: true };
  },
  add_tag({ vendor, action, orgId }) {
    if (!vendor || orgId == null) return;
    const tags = (vendor.tags || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!tags.includes(action.tag)) tags.push(action.tag);
    db.prepare('UPDATE vendors SET tags = ?, updated_at = ? WHERE id = ? AND organization_id = ?').run(tags.join(','), Date.now(), vendor.id, orgId);
    return { tags: tags.join(',') };
  },
  ai_draft_reply({ vendor, orgId }) {
    if (!vendor || orgId == null) return;
    return getAi().draftReply(vendor.id, orgId).catch((e) => ({ error: e.message }));
  },
  notify({ action, orgId }) {
    if (orgId == null) return;
    db.prepare('INSERT INTO notifications (organization_id, kind, text, link) VALUES (?, ?, ?, ?)')
      .run(orgId, action.kind || 'info', action.text || 'Automation event', action.link || null);
    return { ok: true };
  },
  slack_notify({ action }) {
    // Placeholder. Wire to a real Slack webhook later.
    console.log('[automation] slack_notify (stub):', action.text);
    return { ok: true };
  },
};

function listAutomations(trigger, orgId) {
  if (orgId == null) return [];
  return db.prepare(`SELECT * FROM automations WHERE status = 'on' AND trigger = ? AND organization_id = ? AND deleted_at IS NULL`).all(trigger, orgId);
}

function activeOrgIds() {
  return db.prepare('SELECT id FROM organizations WHERE deleted_at IS NULL').all().map((r) => r.id);
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

// Fire a trigger for ONE org. ctx must carry `orgId`; only that org's automations
// run, and every action executes in that org's context. No orgId → nothing fires
// (fail closed) so an unscoped caller can never run every tenant's automations.
function fire(trigger, ctx = {}) {
  const orgId = ctx.orgId;
  if (orgId == null) return { trigger, fired: 0, skipped: 'no_org' };
  const automations = listAutomations(trigger, orgId);
  for (const a of automations) {
    runActions(a.actions_json, ctx);
    db.prepare('UPDATE automations SET runs = runs + 1, last_run_at = ? WHERE id = ? AND organization_id = ?').run(Date.now(), a.id, orgId);
  }
  return { trigger, fired: automations.length };
}

// One-off run for a specific automation (used by Test-run button). ctx.orgId is
// required and must match the automation's org.
function runById(id, ctx = {}) {
  const orgId = ctx.orgId;
  if (orgId == null) return { error: 'no_org' };
  const a = db.prepare('SELECT * FROM automations WHERE id = ? AND organization_id = ? AND deleted_at IS NULL').get(id, orgId);
  if (!a) return { error: 'not_found' };
  const results = runActions(a.actions_json, ctx);
  db.prepare('UPDATE automations SET runs = runs + 1, last_run_at = ? WHERE id = ? AND organization_id = ?').run(Date.now(), a.id, orgId);
  return { id, results };
}

// Scheduler tick — scan for vendors with no reply in 24h+ and fire `no_reply_24h`.
// Runs per-org so each tenant's automations only see their own contacts and the
// notification is stamped with the right org.
function tickNoReply() {
  const cutoff = Date.now() - 24 * 3600 * 1000;
  let fired = 0;
  const scan = db.prepare(`
    SELECT v.* FROM vendors v
    WHERE v.organization_id = ? AND v.deleted_at IS NULL
      AND v.last_contacted_at IS NOT NULL
      AND v.last_contacted_at < ?
      AND (v.last_replied_at IS NULL OR v.last_replied_at < v.last_contacted_at)
      AND v.status NOT IN ('won', 'lost', 'opted_out')
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.organization_id = v.organization_id AND n.kind = 'auto_no_reply_24h'
          AND n.text LIKE '%vendor:' || v.id || ':%' AND n.created_at > ?
      )
  `);
  const ins = db.prepare('INSERT INTO notifications (organization_id, kind, text, link, unread) VALUES (?, ?, ?, ?, 1)');
  for (const orgId of activeOrgIds()) {
    const cands = scan.all(orgId, cutoff, cutoff);
    for (const v of cands) {
      fire('no_reply_24h', { vendor: v, orgId });
      ins.run(orgId, 'auto_no_reply_24h', `[vendor:${v.id}:tick] No reply from ${v.name} in 24h+`, '/inbox');
      fired++;
    }
  }
  return { fired };
}

// Daily morning briefing — one notification per org with that org's pipeline.
function tickDailyMorning() {
  const startOfDay = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
  const endOfDay = (() => { const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime(); })();
  const openStmt = db.prepare(`
    SELECT COUNT(*) AS c, COALESCE(SUM(d.amount), 0) AS amt
    FROM deals d JOIN stages s ON s.id = d.stage_id AND s.organization_id = d.organization_id
    WHERE s.is_won = 0 AND s.is_lost = 0 AND d.organization_id = ? AND d.deleted_at IS NULL
  `);
  const tasksStmt = db.prepare(`
    SELECT COUNT(*) AS c FROM tasks WHERE completed = 0 AND due_at IS NOT NULL
      AND organization_id = ? AND deleted_at IS NULL AND due_at BETWEEN ? AND ?
  `);
  const ins = db.prepare('INSERT INTO notifications (organization_id, kind, text, link, unread) VALUES (?, ?, ?, ?, 1)');
  for (const orgId of activeOrgIds()) {
    const open = openStmt.get(orgId);
    const tasksToday = tasksStmt.get(orgId, startOfDay, endOfDay).c;
    ins.run(orgId, 'ai', `Morning briefing: ${open.c} open deals worth $${open.amt.toLocaleString()}, ${tasksToday} tasks due today`, '/dashboard');
    fire('daily_morning', { stats: { open, tasksToday }, orgId });
  }
  return { ok: true };
}

module.exports = { fire, runById, tickNoReply, tickDailyMorning, HANDLERS };
