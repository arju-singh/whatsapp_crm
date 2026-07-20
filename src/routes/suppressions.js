const express = require('express');
const db = require('../db');
const { body, S } = require('../validate');
const { orgFilter } = require('../tenancy');

const router = express.Router();

// Suppression matching uses digits-only (no country-code prefix), preserved here.
const normPhone = (p) => require('../phone').digitsOnly(p);

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT id, phone, email, reason, source, created_at
    FROM suppressions WHERE ${orgFilter()} ORDER BY created_at DESC LIMIT 1000
  `).all({ orgId: req.orgId });
  res.json(rows);
});

router.post('/', body({
  phone: S.string({ maxLength: 32 }),
  email: S.string({ maxLength: 254 }),
  reason: S.string({ maxLength: 200 }),
  source: S.string({ maxLength: 60 }),
}), (req, res) => {
  const { phone, email, reason, source } = req.body;
  if (!phone && !email) return res.status(400).json({ error: 'phone_or_email_required' });
  const r = db.prepare(`
    INSERT INTO suppressions (organization_id, phone, email, reason, source) VALUES (?, ?, ?, ?, ?)
  `).run(req.orgId, normPhone(phone) || null, (email || '').toLowerCase() || null, reason || 'manual', source || 'ui');
  res.json({ id: r.lastInsertRowid });
});

router.delete('/:id', (req, res) => {
  db.prepare(`UPDATE suppressions SET deleted_at = @now WHERE id = @id AND ${orgFilter()}`)
    .run({ id: req.params.id, orgId: req.orgId, now: Date.now() });
  res.json({ ok: true });
});

router.get('/check', (req, res) => {
  const { phone, email } = req.query;
  const p = normPhone(phone);
  const e = (email || '').toLowerCase();
  const row = db.prepare(`
    SELECT id, phone, email, reason FROM suppressions
    WHERE ((@p != '' AND phone = @p) OR (@e != '' AND email = @e)) AND ${orgFilter()} LIMIT 1
  `).get({ p, e, orgId: req.orgId });
  res.json({ suppressed: !!row, match: row || null });
});

// Suppression checks/writes are ALWAYS org-scoped: a suppression is a promise a
// specific tenant made to a specific contact, and must never block (or be
// created for) another tenant. `orgId` is required — a null org returns no match
// / writes nothing, so a caller that forgot to resolve org fails closed instead
// of leaking across tenants.
function isSuppressed(orgId, { phone, email }) {
  if (orgId == null) return null;
  const p = normPhone(phone);
  const e = (email || '').toLowerCase();
  if (!p && !e) return null;
  return db.prepare(`
    SELECT id, phone, email, reason FROM suppressions
    WHERE ((? != '' AND phone = ?) OR (? != '' AND email = ?))
      AND organization_id = ? AND deleted_at IS NULL LIMIT 1
  `).get(p, p, e, e, orgId) || null;
}

function addSuppression({ orgId, phone, email, reason, source }) {
  if (orgId == null) return null;
  const p = normPhone(phone);
  const e = (email || '').toLowerCase();
  if (!p && !e) return null;
  const existing = isSuppressed(orgId, { phone: p, email: e });
  if (existing) return existing;
  const r = db.prepare(`
    INSERT INTO suppressions (organization_id, phone, email, reason, source) VALUES (?, ?, ?, ?, ?)
  `).run(orgId, p || null, e || null, reason || 'auto', source || 'system');
  return { id: r.lastInsertRowid, orgId, phone: p, email: e, reason };
}

module.exports = router;
module.exports.isSuppressed = isSuppressed;
module.exports.addSuppression = addSuppression;
module.exports.normPhone = normPhone;
