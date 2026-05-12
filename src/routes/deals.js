const express = require('express');
const db = require('../db');

const router = express.Router();

const dealSelect = `
  d.*,
  c.name AS company_name, c.logo AS company_logo, c.color AS company_color,
  s.name AS stage_name, s.color AS stage_color, s.probability AS stage_probability,
  s.is_won AS stage_is_won, s.is_lost AS stage_is_lost,
  v.name AS contact_name, v.avatar AS contact_avatar, v.title AS contact_title
`;

router.get('/', (req, res) => {
  const { owner, stage_id, company_id, q, forecast } = req.query;
  const filters = [];
  const params = {};
  if (owner) { filters.push('d.owner = @owner'); params.owner = owner; }
  if (stage_id) { filters.push('d.stage_id = @stage_id'); params.stage_id = stage_id; }
  if (company_id) { filters.push('d.company_id = @company_id'); params.company_id = company_id; }
  if (forecast) { filters.push('d.forecast = @forecast'); params.forecast = forecast; }
  if (q) { filters.push('(d.name LIKE @q OR c.name LIKE @q)'); params.q = `%${q}%`; }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT ${dealSelect}
    FROM deals d
    LEFT JOIN companies c ON c.id = d.company_id
    LEFT JOIN stages s ON s.id = d.stage_id
    LEFT JOIN vendors v ON v.id = d.contact_id
    ${where}
    ORDER BY d.created_at DESC
  `).all(params);
  res.json(rows);
});

router.get('/stats/summary', (req, res) => {
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN s.is_won = 0 AND s.is_lost = 0 THEN d.amount ELSE 0 END) AS open_value,
      SUM(CASE WHEN s.is_won = 1 THEN d.amount ELSE 0 END) AS won_value,
      SUM(CASE WHEN s.is_lost = 1 THEN d.amount ELSE 0 END) AS lost_value,
      SUM(CASE WHEN s.is_won = 0 AND s.is_lost = 0 THEN 1 ELSE 0 END) AS open_count,
      SUM(CASE WHEN s.is_won = 1 THEN 1 ELSE 0 END) AS won_count,
      SUM(CASE WHEN d.forecast = 'commit' AND s.is_won = 0 AND s.is_lost = 0 THEN d.amount ELSE 0 END) AS commit_value,
      SUM(CASE WHEN d.forecast = 'best-case' AND s.is_won = 0 AND s.is_lost = 0 THEN d.amount ELSE 0 END) AS best_case_value
    FROM deals d
    LEFT JOIN stages s ON s.id = d.stage_id
  `).get();
  // Pipeline trend: last 8 weeks of total open value over time
  const sources = db.prepare(`
    SELECT COALESCE(d.source, 'Unknown') AS src, COUNT(*) AS cnt, SUM(d.amount) AS amt
    FROM deals d GROUP BY src ORDER BY amt DESC
  `).all();
  res.json({ totals, sources });
});

router.get('/:id', (req, res) => {
  const d = db.prepare(`
    SELECT ${dealSelect}
    FROM deals d
    LEFT JOIN companies c ON c.id = d.company_id
    LEFT JOIN stages s ON s.id = d.stage_id
    LEFT JOIN vendors v ON v.id = d.contact_id
    WHERE d.id = ?
  `).get(req.params.id);
  if (!d) return res.status(404).json({ error: 'not_found' });
  const tasks = db.prepare('SELECT * FROM tasks WHERE deal_id = ? ORDER BY due_at ASC').all(req.params.id);
  const events = db.prepare('SELECT * FROM calendar_events WHERE deal_id = ? ORDER BY starts_at DESC').all(req.params.id);
  res.json({ deal: d, tasks, events });
});

router.post('/', (req, res) => {
  const { name, company_id, contact_id, stage_id, amount, owner, close_date, source, priority, forecast, score, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'name_required' });
  let resolvedStage = stage_id;
  if (!resolvedStage) {
    const first = db.prepare('SELECT id FROM stages ORDER BY position ASC LIMIT 1').get();
    resolvedStage = first ? first.id : null;
  }
  const r = db.prepare(`
    INSERT INTO deals (name, company_id, contact_id, stage_id, amount, owner, close_date, source, priority, forecast, score, notes)
    VALUES (?, ?, ?, ?, COALESCE(?, 0), ?, ?, ?, COALESCE(?, 'med'), COALESCE(?, 'pipeline'), COALESCE(?, 50), ?)
  `).run(name, company_id || null, contact_id || null, resolvedStage, amount, owner || null, close_date || null, source || null, priority, forecast, score, notes || null);
  res.json({ id: r.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const allowed = ['name', 'company_id', 'contact_id', 'stage_id', 'amount', 'owner', 'close_date', 'source', 'priority', 'forecast', 'score', 'notes'];
  const sets = [];
  const params = { id: req.params.id, updated_at: Date.now() };
  for (const k of allowed) if (req.body[k] !== undefined) { sets.push(`${k} = @${k}`); params[k] = req.body[k]; }
  if (!sets.length) return res.json({ ok: true });
  sets.push('updated_at = @updated_at');
  db.prepare(`UPDATE deals SET ${sets.join(', ')} WHERE id = @id`).run(params);
  res.json({ ok: true });
});

router.put('/:id/stage', (req, res) => {
  const { stage_id } = req.body;
  if (!stage_id) return res.status(400).json({ error: 'stage_id_required' });
  const stage = db.prepare('SELECT is_won, is_lost FROM stages WHERE id = ?').get(stage_id);
  const r = db.prepare('UPDATE deals SET stage_id = ?, updated_at = ? WHERE id = ?').run(stage_id, Date.now(), req.params.id);
  if (stage && stage.is_won) {
    db.prepare("UPDATE deals SET forecast = 'closed', score = 100 WHERE id = ?").run(req.params.id);
  } else if (stage && stage.is_lost) {
    db.prepare("UPDATE deals SET forecast = 'closed', score = 0 WHERE id = ?").run(req.params.id);
  }
  try {
    const deal = db.prepare('SELECT d.*, v.* FROM deals d LEFT JOIN vendors v ON v.id = d.contact_id WHERE d.id = ?').get(req.params.id);
    require('../automation').fire('deal_stage_changed', { deal, vendor: deal && deal.contact_id ? deal : null, stage });
  } catch (_) {}
  res.json({ ok: true, changes: r.changes });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM deals WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
