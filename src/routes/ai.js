const express = require('express');
const db = require('../db');
const { body, S } = require('../validate');
const { orgFilter } = require('../tenancy');
const rateLimit = require('../ratelimit');

const router = express.Router();

// Dedicated limiter for endpoints that spend real money on the Anthropic API.
// Per-user so one account can't run up the bill; tighter than the global API cap.
const aiLimiter = rateLimit({ bucket: 'ai', max: 30, windowMs: 5 * 60 * 1000, keyBy: 'user' });

// Pattern-matched assistant. No external LLM call — answers come from live data.
router.post('/ask', body({ query: S.string({ maxLength: 2000 }) }), (req, res) => {
  const q = String(req.body && req.body.query || '').toLowerCase();
  if (!q) return res.status(400).json({ error: 'query_required' });
  const reply = answer(q);
  res.json({ reply });
});

// AI draft endpoints (Claude API; needs anthropic_api_key in settings)
router.post('/draft-reply', aiLimiter, body({ vendor_id: S.int({ min: 1 }) }), async (req, res) => {
  const { vendor_id } = req.body || {};
  if (!vendor_id) return res.status(400).json({ error: 'vendor_id_required' });
  try {
    const r = await require('../ai-agent').draftReply(vendor_id);
    res.json(r);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/drafts', (req, res) => {
  const { status, vendor_id } = req.query;
  res.json(require('../ai-agent').listDrafts({ status: status || 'pending', vendor_id }));
});

router.post('/drafts/:id/approve', body({}), (req, res) => {
  try { res.json(require('../ai-agent').approveDraft(req.params.id)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/drafts/:id/dismiss', body({}), (req, res) => {
  res.json(require('../ai-agent').dismissDraft(req.params.id));
});

router.put('/drafts/:id', body({ body: S.text({ maxLength: 10000 }) }), (req, res) => {
  const { body } = req.body || {};
  if (!body) return res.status(400).json({ error: 'body_required' });
  res.json(require('../ai-agent').editDraft(req.params.id, body));
});

router.get('/health', (req, res) => {
  const settings = require('../settings');
  const agent = require('../ai-agent');
  const model = agent.getModel();
  res.json({
    api_key_set: agent.aiConfigured(), // true when the configured provider (Anthropic or Gemini) has a key
    provider: agent.providerFor(model),
    model,
    auto_draft_inbound: settings.get('ai_auto_draft_inbound') === '1',
  });
});

router.get('/insights', (req, res) => {
  res.json({ insights: buildInsights() });
});

router.get('/dashboard-summary', (req, res) => {
  const stats = db.prepare(`
    SELECT
      SUM(CASE WHEN s.is_won = 0 AND s.is_lost = 0 THEN d.amount ELSE 0 END) AS pipeline_value,
      SUM(CASE WHEN s.is_won = 1 AND d.close_date >= date('now', 'start of month') THEN d.amount ELSE 0 END) AS booked_mtd,
      COUNT(CASE WHEN s.is_won = 0 AND s.is_lost = 0 THEN 1 END) AS open_deals,
      COUNT(CASE WHEN s.is_won = 1 THEN 1 END) AS won_deals,
      COUNT(CASE WHEN s.is_lost = 1 THEN 1 END) AS lost_deals
    FROM deals d LEFT JOIN stages s ON s.id = d.stage_id
    WHERE ${orgFilter('d')}
  `).get({ orgId: req.orgId });
  const winRate = (stats.won_deals + stats.lost_deals) > 0
    ? Math.round((stats.won_deals / (stats.won_deals + stats.lost_deals)) * 100)
    : 0;
  const me = db.prepare(`SELECT * FROM team_members WHERE is_self = 1 AND ${orgFilter()}`).get({ orgId: req.orgId }) || { quota: 1, attained: 0 };
  const quotaPct = me.quota > 0 ? Math.round((me.attained / me.quota) * 100) : 0;
  const tasksOpen = db.prepare(`SELECT COUNT(*) AS c FROM tasks WHERE completed = 0 AND priority = 'high' AND ${orgFilter()}`).get({ orgId: req.orgId }).c;
  res.json({
    pipeline_value: stats.pipeline_value || 0,
    booked_mtd: stats.booked_mtd || 0,
    win_rate: winRate,
    quota_attainment: quotaPct,
    high_priority_open_tasks: tasksOpen,
    me: me.name || 'You',
  });
});

function buildInsights() {
  const insights = [];
  const hot = db.prepare(`
    SELECT d.id, d.name, d.score, d.amount, c.name AS company
    FROM deals d
    LEFT JOIN companies c ON c.id = d.company_id
    LEFT JOIN stages s ON s.id = d.stage_id
    WHERE d.score >= 85 AND s.is_won = 0 AND s.is_lost = 0
    ORDER BY d.score DESC LIMIT 1
  `).get();
  if (hot) insights.push({
    title: `${hot.company} is heating up`,
    body: `${hot.name} has a win-score of ${hot.score}. Suggest pushing close earlier this period.`,
    deal_id: hot.id, kind: 'up',
  });
  const stale = db.prepare(`
    SELECT d.id, d.name, c.name AS company, d.updated_at
    FROM deals d
    LEFT JOIN companies c ON c.id = d.company_id
    LEFT JOIN stages s ON s.id = d.stage_id
    WHERE s.is_won = 0 AND s.is_lost = 0 AND d.updated_at < ?
    ORDER BY d.updated_at ASC LIMIT 1
  `).get(Date.now() - 14 * 86400000);
  if (stale) insights.push({
    title: `${stale.company} churn risk`,
    body: `${stale.name} hasn't moved in 14+ days. Recommend a check-in this week.`,
    deal_id: stale.id, kind: 'risk',
  });
  const expansion = db.prepare(`
    SELECT d.id, d.name, c.name AS company
    FROM deals d
    LEFT JOIN companies c ON c.id = d.company_id
    WHERE d.source = 'Expansion'
    ORDER BY d.created_at DESC LIMIT 1
  `).get();
  if (expansion) insights.push({
    title: `${expansion.company} expansion signal`,
    body: `${expansion.name} is an active expansion opportunity. Worth aligning with the champion.`,
    deal_id: expansion.id, kind: 'up',
  });
  return insights;
}

function answer(q) {
  if (q.includes('pipeline') || q.includes('summary')) {
    const open = db.prepare(`
      SELECT d.*, c.name AS company FROM deals d
      LEFT JOIN companies c ON c.id = d.company_id
      LEFT JOIN stages s ON s.id = d.stage_id
      WHERE s.is_won = 0 AND s.is_lost = 0
      ORDER BY d.score DESC LIMIT 3
    `).all();
    const total = open.reduce((s, d) => s + d.amount, 0);
    const top = open.slice(0, 3).map((d) => `${d.company} (${fmt(d.amount)}, ${d.score}%)`).join(', ');
    return `📊 You have ${open.length} top-scoring deals on the radar. Top 3: ${top}. Total open value across these: ${fmt(total)}.`;
  }
  if (q.includes('risk') || q.includes('churn')) {
    const stale = db.prepare(`
      SELECT d.name, c.name AS company FROM deals d
      LEFT JOIN companies c ON c.id = d.company_id
      LEFT JOIN stages s ON s.id = d.stage_id
      WHERE s.is_won = 0 AND s.is_lost = 0 AND d.updated_at < ?
      ORDER BY d.updated_at ASC LIMIT 3
    `).all(Date.now() - 14 * 86400000);
    if (!stale.length) return 'Nothing concerning in the pipeline right now — every open deal has activity in the last 14 days.';
    return '⚠️ Watch list: ' + stale.map((d) => `${d.company} (${d.name})`).join(', ') + '. Recommend a check-in.';
  }
  if (q.includes('draft') || q.includes('follow')) {
    return 'Here\'s a draft:\n\n"Hi — thanks for the quick review. Happy to align on next steps. Want to lock in a 20-min call this week?"\n\nTell me who it\'s to and I\'ll personalize.';
  }
  if (q.includes('touch') || q.includes('haven') || q.includes('cold')) {
    const cold = db.prepare(`
      SELECT name, last_contacted_at FROM vendors
      WHERE last_contacted_at IS NOT NULL AND last_contacted_at < ?
      ORDER BY last_contacted_at ASC LIMIT 5
    `).all(Date.now() - 14 * 86400000);
    if (!cold.length) return 'You\'re fully caught up — no contacts have gone quiet for more than 14 days.';
    return 'Contacts gone quiet (>14d): ' + cold.map((c) => c.name).join(', ');
  }
  return 'I can summarize your pipeline, surface risks, draft follow-ups, or list cold contacts. Try asking one of those.';
}

function fmt(n) {
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'k';
  return '$' + n;
}

module.exports = router;
