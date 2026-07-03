const express = require('express');
const db = require('../db');
const { body, S } = require('../validate');
const { orgFilter } = require('../tenancy');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(db.prepare(`SELECT * FROM stages WHERE ${orgFilter()} ORDER BY position ASC, id ASC`).all({ orgId: req.orgId }));
});

router.post('/', body({
  name: S.string({ required: true, maxLength: 200 }),
  color: S.string({ maxLength: 60 }),
  probability: S.int({ min: 0, max: 100 }),
  position: S.int({ min: 0 }),
  is_won: S.flag(),
  is_lost: S.flag(),
}), (req, res) => {
  const { name, color, probability, position, is_won, is_lost } = req.body;
  if (!name) return res.status(400).json({ error: 'name_required' });
  const r = db.prepare(`
    INSERT INTO stages (organization_id, name, color, probability, position, is_won, is_lost)
    VALUES (?, ?, ?, COALESCE(?, 0), COALESCE(?, 99), COALESCE(?, 0), COALESCE(?, 0))
  `).run(req.orgId, name, color || '#A8A29E', probability, position, is_won, is_lost);
  res.json({ id: r.lastInsertRowid });
});

router.put('/:id', body({
  name: S.string({ maxLength: 200 }),
  color: S.string({ maxLength: 60 }),
  probability: S.int({ min: 0, max: 100 }),
  position: S.int({ min: 0 }),
  is_won: S.flag(),
  is_lost: S.flag(),
}), (req, res) => {
  const allowed = ['name', 'color', 'probability', 'position', 'is_won', 'is_lost'];
  const sets = [];
  const params = { id: req.params.id, orgId: req.orgId };
  for (const k of allowed) if (req.body[k] !== undefined) { sets.push(`${k} = @${k}`); params[k] = req.body[k]; }
  if (!sets.length) return res.json({ ok: true });
  db.prepare(`UPDATE stages SET ${sets.join(', ')} WHERE id = @id AND ${orgFilter()}`).run(params);
  res.json({ ok: true });
});

router.put('/reorder', body({
  order: S.array({ of: S.int({ min: 0 }), maxItems: 1000 }),
}), (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order_array_required' });
  const upd = db.prepare(`UPDATE stages SET position = @position WHERE id = @id AND ${orgFilter()}`);
  const tx = db.transaction(() => { order.forEach((id, idx) => upd.run({ position: idx + 1, id, orgId: req.orgId })); });
  tx();
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare(`UPDATE stages SET deleted_at = @now WHERE id = @id AND ${orgFilter()}`)
    .run({ id: req.params.id, orgId: req.orgId, now: Date.now() });
  res.json({ ok: true });
});

module.exports = router;
