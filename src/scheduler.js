const cron = require('node-cron');
const db = require('./db');
const transports = require('./transports'); // unified send across WhatsApp/email

const HOUR_MS = 60 * 60 * 1000;

// 1) Schedule follow-ups for newly-sent outbound messages (WA or email).
function scheduleFollowups() {
  const rules = db.prepare('SELECT * FROM followup_rules WHERE active = 1 AND deleted_at IS NULL').all();
  if (!rules.length) return;

  const since = Date.now() - 24 * HOUR_MS;
  const recentWa = db.prepare(`
    SELECT id, vendor_id, organization_id, sent_at FROM messages
    WHERE direction = 'out' AND status IN ('sent','delivered','read')
      AND sent_at IS NOT NULL AND sent_at >= ?
  `).all(since);
  const recentEmail = db.prepare(`
    SELECT id, vendor_id, organization_id, sent_at FROM emails
    WHERE direction = 'out' AND status IN ('sent','delivered','opened')
      AND sent_at IS NOT NULL AND sent_at >= ?
  `).all(since);

  const insert = db.prepare(`
    INSERT INTO followups (organization_id, rule_id, vendor_id, parent_message_id, attempt, status, scheduled_at)
    VALUES (?, ?, ?, ?, 1, 'pending', ?)
  `);
  const exists = db.prepare(`
    SELECT 1 FROM followups WHERE rule_id = ? AND vendor_id = ? AND parent_message_id = ? AND organization_id = ?
  `);

  for (const rule of rules) {
    // Trigger source: a rule schedules from the SAME channel's prior send (WA rule
    // looks at WA sends, email rule looks at email sends) — and ONLY within the
    // rule's own org, so a rule never schedules against another tenant's messages.
    const source = rule.channel === 'email' ? recentEmail : recentWa;
    for (const m of source) {
      if (m.organization_id !== rule.organization_id) continue;
      if (exists.get(rule.id, m.vendor_id, m.id, rule.organization_id)) continue;
      const scheduledAt = m.sent_at + rule.delay_hours * HOUR_MS;
      insert.run(rule.organization_id, rule.id, m.vendor_id, m.id, scheduledAt);
    }
  }
}

// 2) Fire due follow-ups
function fireDueFollowups() {
  const now = Date.now();
  const due = db.prepare(`
    SELECT f.*, r.template_id, r.trigger, r.stop_on_reply, r.max_attempts, r.delay_hours,
           COALESCE(r.channel, 'whatsapp') AS channel,
           v.last_replied_at
    FROM followups f
    JOIN followup_rules r ON r.id = f.rule_id AND r.organization_id = f.organization_id
    JOIN vendors v ON v.id = f.vendor_id AND v.organization_id = f.organization_id
    WHERE f.status = 'pending' AND f.scheduled_at <= ? AND r.active = 1 AND f.deleted_at IS NULL
    ORDER BY f.scheduled_at ASC
    LIMIT 100
  `).all(now);

  for (const f of due) {
    const channel = f.channel || 'whatsapp';
    const orgId = f.organization_id;

    // If trigger is no_reply and vendor replied after parent — cancel
    if (f.trigger === 'no_reply' && f.last_replied_at && f.parent_message_id) {
      const tableForParent = channel === 'email' ? 'emails' : 'messages';
      const parent = db.prepare(`SELECT sent_at FROM ${tableForParent} WHERE id = ? AND organization_id = ?`).get(f.parent_message_id, orgId);
      if (parent && f.last_replied_at >= parent.sent_at) {
        db.prepare("UPDATE followups SET status = 'cancelled', fired_at = ? WHERE id = ?").run(now, f.id);
        continue;
      }
    }

    if (channel === 'email') {
      const t = db.prepare('SELECT * FROM email_templates WHERE id = ? AND organization_id = ? AND deleted_at IS NULL').get(f.template_id, orgId);
      const vendor = db.prepare('SELECT id, email FROM vendors WHERE id = ? AND organization_id = ?').get(f.vendor_id, orgId);
      if (!t || !vendor || !vendor.email) {
        db.prepare("UPDATE followups SET status = 'failed', fired_at = ? WHERE id = ?").run(now, f.id);
        continue;
      }
      const ins = db.prepare(`
        INSERT INTO emails (organization_id, vendor_id, template_id, direction, to_email, subject, body_html, body_text, status)
        VALUES (?, ?, ?, 'out', ?, ?, ?, ?, 'queued')
      `).run(orgId, vendor.id, t.id, vendor.email, t.subject, t.body_html, t.body_text || null);
      db.prepare("UPDATE followups SET status = 'sent', fired_at = ? WHERE id = ?").run(now, f.id);
      try { transports.sendMessage('email', ins.lastInsertRowid); } catch (e) { console.error('[sched] email enqueue', e.message); }
    } else {
      const t = db.prepare('SELECT body FROM templates WHERE id = ? AND organization_id = ? AND deleted_at IS NULL').get(f.template_id, orgId);
      if (!t) {
        db.prepare("UPDATE followups SET status = 'failed', fired_at = ? WHERE id = ?").run(now, f.id);
        continue;
      }
      const msg = db.prepare(`
        INSERT INTO messages (organization_id, vendor_id, followup_id, direction, body, status)
        VALUES (?, ?, ?, 'out', ?, 'queued')
      `).run(orgId, f.vendor_id, f.id, t.body);
      db.prepare("UPDATE followups SET status = 'sent', fired_at = ? WHERE id = ?").run(now, f.id);
      transports.sendMessage('whatsapp', msg.lastInsertRowid);
    }

    if (f.attempt < f.max_attempts) {
      const next = now + f.delay_hours * HOUR_MS;
      db.prepare(`
        INSERT INTO followups (organization_id, rule_id, vendor_id, parent_message_id, attempt, status, scheduled_at)
        VALUES (?, ?, ?, ?, ?, 'pending', ?)
      `).run(orgId, f.rule_id, f.vendor_id, f.parent_message_id, f.attempt + 1, next);
    }
  }
}

function requeueScheduledMessages() {
  const now = Date.now();
  const due = db.prepare(`
    SELECT id FROM messages
    WHERE status = 'scheduled' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
    ORDER BY scheduled_at ASC LIMIT 200
  `).all(now);
  for (const r of due) {
    const c = db.prepare(`
      UPDATE messages SET status = 'queued' WHERE id = ? AND status = 'scheduled'
    `).run(r.id);
    if (c.changes) transports.sendMessage('whatsapp', r.id);
  }
}

// Retry transiently-failed outbound messages once their backoff (next_attempt_at,
// set by sendOne) has elapsed. Terminal failures leave next_attempt_at NULL and
// are never picked up here. Fixes the "failed messages are never retried" gap.
function requeueFailedMessages() {
  const now = Date.now();
  const due = db.prepare(`
    SELECT id FROM messages
    WHERE status = 'failed' AND next_attempt_at IS NOT NULL AND next_attempt_at <= ?
    ORDER BY next_attempt_at ASC LIMIT 200
  `).all(now);
  for (const r of due) {
    const c = db.prepare(`
      UPDATE messages SET status = 'queued', next_attempt_at = NULL WHERE id = ? AND status = 'failed'
    `).run(r.id);
    if (c.changes) transports.sendMessage('whatsapp', r.id);
  }
}

function start() {
  cron.schedule('*/5 * * * *', () => {
    try { scheduleFollowups(); } catch (e) { console.error('[sched] schedule error', e); }
  });
  cron.schedule('* * * * *', () => {
    try { fireDueFollowups(); } catch (e) { console.error('[sched] fire error', e); }
    try { requeueScheduledMessages(); } catch (e) { console.error('[sched] requeue error', e); }
    try { requeueFailedMessages(); } catch (e) { console.error('[sched] retry error', e); }
    try { require('./email').processQueue(); } catch (e) { console.error('[sched] email queue error', e); }
  });
  // Hourly: check for vendors who have gone quiet for 24h+ and fire automations
  cron.schedule('15 * * * *', () => {
    try { require('./automation').tickNoReply(); } catch (e) { console.error('[sched] no_reply tick error', e); }
  });
  // Daily 8 AM: morning briefing automation
  cron.schedule('0 8 * * *', () => {
    try { require('./automation').tickDailyMorning(); } catch (e) { console.error('[sched] daily_morning tick error', e); }
  });
  setTimeout(() => { scheduleFollowups(); fireDueFollowups(); requeueScheduledMessages(); requeueFailedMessages(); }, 10_000);
  console.log('[sched] scheduler started');
}

module.exports = { start, scheduleFollowups, fireDueFollowups, requeueScheduledMessages, requeueFailedMessages };
