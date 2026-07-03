const express = require('express');
const db = require('../db');
const { orgFilter } = require('../tenancy');

const router = express.Router();

router.get('/funnel', (req, res) => {
  const stages = db.prepare(`SELECT id, name, position FROM stages WHERE is_lost = 0 AND ${orgFilter()} ORDER BY position ASC`).all({ orgId: req.orgId });
  const counts = stages.map((s) => ({
    stage: s.name,
    count: db.prepare(`SELECT COUNT(*) AS c FROM deals WHERE stage_id = @sid AND ${orgFilter()}`).get({ sid: s.id, orgId: req.orgId }).c,
  }));
  const contactCount = db.prepare(`SELECT COUNT(*) AS c FROM vendors WHERE ${orgFilter()}`).get({ orgId: req.orgId }).c;
  const repliedCount = db.prepare(`SELECT COUNT(*) AS c FROM vendors WHERE status = 'replied' AND ${orgFilter()}`).get({ orgId: req.orgId }).c;
  return res.json([
    { stage: 'Leads', count: contactCount },
    { stage: 'Contacted', count: db.prepare(`SELECT COUNT(*) AS c FROM vendors WHERE status IN ('contacted','replied','won','lost') AND ${orgFilter()}`).get({ orgId: req.orgId }).c },
    { stage: 'Replied', count: repliedCount },
    ...counts,
  ]);
});

router.get('/revenue', (req, res) => {
  // Bucket won deals by close month for last 7 months
  const months = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key: d.toISOString().slice(0, 7),
      label: d.toLocaleString('en', { month: 'short' }),
    });
  }
  const won = db.prepare(`
    SELECT substr(d.close_date, 1, 7) AS m, SUM(d.amount) AS amt
    FROM deals d JOIN stages s ON s.id = d.stage_id
    WHERE s.is_won = 1 AND ${orgFilter('d')} GROUP BY m
  `).all({ orgId: req.orgId });
  const wonMap = Object.fromEntries(won.map((r) => [r.m, r.amt]));
  res.json(months.map((m) => ({ m: m.label, booked: wonMap[m.key] || 0, target: 0 })));
});

router.get('/sources', (req, res) => {
  const rows = db.prepare(`
    SELECT COALESCE(source, 'Unknown') AS src, COUNT(*) AS cnt
    FROM deals WHERE ${orgFilter()} GROUP BY src ORDER BY cnt DESC
  `).all({ orgId: req.orgId });
  const total = rows.reduce((s, r) => s + r.cnt, 0) || 1;
  const palette = ['#E07A5F', '#3D5A80', '#588157', '#D4A373', '#6B4E71', '#A47148'];
  res.json(rows.map((r, i) => ({
    src: r.src, value: Math.round((r.cnt / total) * 100), color: palette[i % palette.length],
  })));
});

router.get('/pipeline-trend', (req, res) => {
  // Approximation: simulate cumulative pipeline weekly using deal created_at
  const start = new Date(); start.setDate(start.getDate() - 56);
  const points = [];
  for (let i = 0; i < 8; i++) {
    const cutoff = start.getTime() + i * 7 * 86400000;
    const v = db.prepare(`
      SELECT SUM(d.amount) AS amt FROM deals d
      JOIN stages s ON s.id = d.stage_id
      WHERE d.created_at <= @cutoff AND s.is_won = 0 AND s.is_lost = 0 AND ${orgFilter('d')}
    `).get({ cutoff, orgId: req.orgId }).amt || 0;
    points.push({ week: 'W' + (i + 14), value: v });
  }
  res.json(points);
});

router.get('/heatmap', (req, res) => {
  // Rows = day of week (0=Mon..6=Sun), Cols = hour (0-23). Score = inbound message rate.
  const rows = Array.from({ length: 7 }, () => Array(24).fill(0));
  const msgs = db.prepare(`SELECT created_at FROM messages WHERE direction = 'in' AND created_at IS NOT NULL AND ${orgFilter()}`).all({ orgId: req.orgId });
  msgs.forEach((m) => {
    const d = new Date(m.created_at);
    const day = (d.getDay() + 6) % 7; // shift Mon=0
    rows[day][d.getHours()] += 1;
  });
  let max = 0;
  for (const r of rows) for (const v of r) if (v > max) max = v;
  if (max) {
    for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) rows[d][h] = +(rows[d][h] / max).toFixed(2);
  }
  res.json(rows);
});

router.get('/leaderboard', (req, res) => {
  const team = db.prepare(`
    SELECT t.*,
      (SELECT COALESCE(SUM(d.amount), 0) FROM deals d
        JOIN stages s ON s.id = d.stage_id
        WHERE d.owner = t.name AND s.is_won = 0 AND s.is_lost = 0 AND ${orgFilter('d')}) AS open_pipe,
      (SELECT COUNT(*) FROM messages m
        JOIN vendors v ON v.id = m.vendor_id
        WHERE v.owner = t.name AND ${orgFilter('m')}) AS activities
    FROM team_members t
    WHERE t.quota > 0 AND ${orgFilter('t')}
    ORDER BY t.attained DESC
  `).all({ orgId: req.orgId });
  res.json(team);
});

router.get('/kpis', (req, res) => {
  const won = db.prepare(`
    SELECT d.*, julianday(date(d.close_date)) - julianday(date(d.created_at / 1000, 'unixepoch')) AS days
    FROM deals d JOIN stages s ON s.id = d.stage_id
    WHERE s.is_won = 1 AND ${orgFilter('d')}
  `).all({ orgId: req.orgId });
  const avgDeal = won.length ? Math.round(won.reduce((s, d) => s + d.amount, 0) / won.length) : 0;
  const avgCycle = won.length ? Math.round(won.reduce((s, d) => s + (d.days || 0), 0) / won.length) : 0;
  const totalClosed = db.prepare(`SELECT COUNT(*) AS c FROM deals d JOIN stages s ON s.id = d.stage_id WHERE (s.is_won = 1 OR s.is_lost = 1) AND ${orgFilter('d')}`).get({ orgId: req.orgId }).c;
  const winRate = totalClosed ? Math.round((won.length / totalClosed) * 100) : 0;
  const totalActivities = db.prepare(`SELECT COUNT(*) AS c FROM messages WHERE ${orgFilter()}`).get({ orgId: req.orgId }).c
    + db.prepare(`SELECT COUNT(*) AS c FROM calls WHERE ${orgFilter()}`).get({ orgId: req.orgId }).c;
  const totalDeals = db.prepare(`SELECT COUNT(*) AS c FROM deals WHERE ${orgFilter()}`).get({ orgId: req.orgId }).c;
  res.json({
    avg_deal_size: avgDeal,
    sales_cycle_days: avgCycle,
    win_rate: winRate,
    activities_per_deal: totalDeals ? +(totalActivities / totalDeals).toFixed(1) : 0,
  });
});

module.exports = router;
