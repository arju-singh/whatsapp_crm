const express = require('express');
const db = require('../db');
const { body, S } = require('../validate');
const { orgFilter, fkError } = require('../tenancy');

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
  const filters = [orgFilter('d')];
  const params = { orgId: req.orgId };
  if (owner) { filters.push('d.owner = @owner'); params.owner = owner; }
  if (stage_id) { filters.push('d.stage_id = @stage_id'); params.stage_id = stage_id; }
  if (company_id) { filters.push('d.company_id = @company_id'); params.company_id = company_id; }
  if (forecast) { filters.push('d.forecast = @forecast'); params.forecast = forecast; }
  if (q) { filters.push('(d.name LIKE @q OR c.name LIKE @q)'); params.q = `%${q}%`; }
  const where = `WHERE ${filters.join(' AND ')}`;
  const rows = db.prepare(`
    SELECT ${dealSelect}
    FROM deals d
    LEFT JOIN companies c ON c.id = d.company_id AND c.organization_id = @orgId AND c.deleted_at IS NULL
    LEFT JOIN stages s ON s.id = d.stage_id AND s.organization_id = @orgId AND s.deleted_at IS NULL
    LEFT JOIN vendors v ON v.id = d.contact_id AND v.organization_id = @orgId AND v.deleted_at IS NULL
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
    WHERE ${orgFilter('d')}
  `).get({ orgId: req.orgId });
  // Pipeline trend: last 8 weeks of total open value over time
  const sources = db.prepare(`
    SELECT COALESCE(d.source, 'Unknown') AS src, COUNT(*) AS cnt, SUM(d.amount) AS amt
    FROM deals d WHERE ${orgFilter('d')} GROUP BY src ORDER BY amt DESC
  `).all({ orgId: req.orgId });
  res.json({ totals, sources });
});

router.get('/:id', (req, res) => {
  const d = db.prepare(`
    SELECT ${dealSelect}
    FROM deals d
    LEFT JOIN companies c ON c.id = d.company_id AND c.organization_id = @orgId AND c.deleted_at IS NULL
    LEFT JOIN stages s ON s.id = d.stage_id AND s.organization_id = @orgId AND s.deleted_at IS NULL
    LEFT JOIN vendors v ON v.id = d.contact_id AND v.organization_id = @orgId AND v.deleted_at IS NULL
    WHERE d.id = @id AND ${orgFilter('d')}
  `).get({ id: req.params.id, orgId: req.orgId });
  if (!d) return res.status(404).json({ error: 'not_found' });
  const tasks = db.prepare(`SELECT * FROM tasks WHERE deal_id = @id AND ${orgFilter()} ORDER BY due_at ASC`)
    .all({ id: req.params.id, orgId: req.orgId });
  const events = db.prepare(`SELECT * FROM calendar_events WHERE deal_id = @id AND ${orgFilter()} ORDER BY starts_at DESC`)
    .all({ id: req.params.id, orgId: req.orgId });
  res.json({ deal: d, tasks, events });
});

router.post('/', body({
  name: S.string({ maxLength: 200 }),
  company_id: S.int({ min: 0 }),
  contact_id: S.int({ min: 0 }),
  stage_id: S.int({ min: 0 }),
  amount: S.number({ min: 0 }),
  owner: S.string({ maxLength: 200 }),
  close_date: S.string({ maxLength: 60 }),
  source: S.string({ maxLength: 200 }),
  priority: S.string({ maxLength: 60 }),
  forecast: S.string({ maxLength: 60 }),
  score: S.int({ min: 0, max: 100 }),
  notes: S.text(),
}), (req, res) => {
  const { name, company_id, contact_id, stage_id, amount, owner, close_date, source, priority, forecast, score, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'name_required' });
  // A deal must only reference this org's company/contact/stage.
  const fkErr = fkError(req.orgId, 'companies', company_id, 'company_id')
    || fkError(req.orgId, 'vendors', contact_id, 'contact_id')
    || fkError(req.orgId, 'stages', stage_id, 'stage_id');
  if (fkErr) return res.status(400).json({ error: fkErr });
  let resolvedStage = stage_id;
  if (!resolvedStage) {
    const first = db.prepare(`SELECT id FROM stages WHERE ${orgFilter()} ORDER BY position ASC LIMIT 1`).get({ orgId: req.orgId });
    resolvedStage = first ? first.id : null;
  }
  const r = db.prepare(`
    INSERT INTO deals (organization_id, name, company_id, contact_id, stage_id, amount, owner, close_date, source, priority, forecast, score, notes)
    VALUES (?, ?, ?, ?, ?, COALESCE(?, 0), ?, ?, ?, COALESCE(?, 'med'), COALESCE(?, 'pipeline'), COALESCE(?, 50), ?)
  `).run(req.orgId, name, company_id || null, contact_id || null, resolvedStage, amount, owner || null, close_date || null, source || null, priority, forecast, score, notes || null);
  res.json({ id: r.lastInsertRowid });
});

router.put('/:id', body({
  name: S.string({ maxLength: 200 }),
  company_id: S.int({ min: 0 }),
  contact_id: S.int({ min: 0 }),
  stage_id: S.int({ min: 0 }),
  amount: S.number({ min: 0 }),
  owner: S.string({ maxLength: 200 }),
  close_date: S.string({ maxLength: 60 }),
  source: S.string({ maxLength: 200 }),
  priority: S.string({ maxLength: 60 }),
  forecast: S.string({ maxLength: 60 }),
  score: S.int({ min: 0, max: 100 }),
  notes: S.text(),
}), (req, res) => {
  // Validate any repointed foreign keys stay within the caller's org.
  const fkErr = fkError(req.orgId, 'companies', req.body.company_id, 'company_id')
    || fkError(req.orgId, 'vendors', req.body.contact_id, 'contact_id')
    || fkError(req.orgId, 'stages', req.body.stage_id, 'stage_id');
  if (fkErr) return res.status(400).json({ error: fkErr });
  const allowed = ['name', 'company_id', 'contact_id', 'stage_id', 'amount', 'owner', 'close_date', 'source', 'priority', 'forecast', 'score', 'notes'];
  const sets = [];
  const params = { id: req.params.id, orgId: req.orgId, updated_at: Date.now() };
  for (const k of allowed) if (req.body[k] !== undefined) { sets.push(`${k} = @${k}`); params[k] = req.body[k]; }
  if (!sets.length) return res.json({ ok: true });
  sets.push('updated_at = @updated_at');
  db.prepare(`UPDATE deals SET ${sets.join(', ')} WHERE id = @id AND ${orgFilter()}`).run(params);
  res.json({ ok: true });
});

router.put('/:id/stage', body({
  stage_id: S.int({ min: 0 }),
}), (req, res) => {
  const { stage_id } = req.body;
  if (!stage_id) return res.status(400).json({ error: 'stage_id_required' });
  const stage = db.prepare(`SELECT is_won, is_lost FROM stages WHERE id = @id AND ${orgFilter()}`).get({ id: stage_id, orgId: req.orgId });
  // Reject a stage that doesn't exist in the caller's org, instead of moving the
  // deal onto another tenant's stage_id (broken access control / IDOR).
  if (!stage) return res.status(404).json({ error: 'stage_not_found' });
  const r = db.prepare(`UPDATE deals SET stage_id = @stage_id, updated_at = @now WHERE id = @id AND ${orgFilter()}`)
    .run({ stage_id, now: Date.now(), id: req.params.id, orgId: req.orgId });
  if (stage && stage.is_won) {
    db.prepare(`UPDATE deals SET forecast = 'closed', score = 100 WHERE id = @id AND ${orgFilter()}`).run({ id: req.params.id, orgId: req.orgId });
  } else if (stage && stage.is_lost) {
    db.prepare(`UPDATE deals SET forecast = 'closed', score = 0 WHERE id = @id AND ${orgFilter()}`).run({ id: req.params.id, orgId: req.orgId });
  }
  try {
    // Fetch the deal and its contact separately — a `SELECT d.*, v.*` join would
    // collide on duplicate columns (id, created_at, notes, …) and overwrite the
    // deal's own id/fields with the vendor's, breaking downstream automations.
    const deal = db.prepare(`SELECT * FROM deals WHERE id = @id AND ${orgFilter()}`).get({ id: req.params.id, orgId: req.orgId });
    const vendor = deal && deal.contact_id
      ? db.prepare(`SELECT * FROM vendors WHERE id = @id AND ${orgFilter()}`).get({ id: deal.contact_id, orgId: req.orgId })
      : null;
    require('../automation').fire('deal_stage_changed', { deal, vendor, stage, orgId: req.orgId });
  } catch (_) {}
  res.json({ ok: true, changes: r.changes });
});

router.delete('/:id', (req, res) => {
  db.prepare(`UPDATE deals SET deleted_at = @now WHERE id = @id AND ${orgFilter()}`)
    .run({ id: req.params.id, orgId: req.orgId, now: Date.now() });
  res.json({ ok: true });
});

router.post('/delete-bulk', body({ ids: S.array({ of: S.int({ min: 1 }), maxItems: 10000 }) }), (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids_array_required' });
  const del = db.prepare(`UPDATE deals SET deleted_at = @now WHERE id = @id AND ${orgFilter()}`);
  const tx = db.transaction((rows) => { for (const id of rows) del.run({ id, orgId: req.orgId, now: Date.now() }); });
  tx(ids);
  res.json({ deleted: ids.length });
});

module.exports = router;
