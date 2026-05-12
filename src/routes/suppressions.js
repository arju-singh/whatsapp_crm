const express = require('express');
const db = require('../db');

const router = express.Router();

function normPhone(p) {
  return String(p || '').replace(/\D/g, '').replace(/^0+/, '');
}

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT id, phone, email, reason, source, created_at
    FROM suppressions ORDER BY created_at DESC LIMIT 1000
  `).all();
  res.json(rows);
});

router.post('/', (req, res) => {
  const { phone, email, reason, source } = req.body;
  if (!phone && !email) return res.status(400).json({ error: 'phone_or_email_required' });
  const r = db.prepare(`
    INSERT INTO suppressions (phone, email, reason, source) VALUES (?, ?, ?, ?)
  `).run(normPhone(phone) || null, (email || '').toLowerCase() || null, reason || 'manual', source || 'ui');
  res.json({ id: r.lastInsertRowid });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM suppressions WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.get('/check', (req, res) => {
  const { phone, email } = req.query;
  const p = normPhone(phone);
  const e = (email || '').toLowerCase();
  const row = db.prepare(`
    SELECT id, phone, email, reason FROM suppressions
    WHERE (? != '' AND phone = ?) OR (? != '' AND email = ?) LIMIT 1
  `).get(p, p, e, e);
  res.json({ suppressed: !!row, match: row || null });
});

function isSuppressed({ phone, email }) {
  const p = normPhone(phone);
  const e = (email || '').toLowerCase();
  if (!p && !e) return null;
  return db.prepare(`
    SELECT id, phone, email, reason FROM suppressions
    WHERE (? != '' AND phone = ?) OR (? != '' AND email = ?) LIMIT 1
  `).get(p, p, e, e) || null;
}

function addSuppression({ phone, email, reason, source }) {
  const p = normPhone(phone);
  const e = (email || '').toLowerCase();
  if (!p && !e) return null;
  const existing = isSuppressed({ phone: p, email: e });
  if (existing) return existing;
  const r = db.prepare(`
    INSERT INTO suppressions (phone, email, reason, source) VALUES (?, ?, ?, ?)
  `).run(p || null, e || null, reason || 'auto', source || 'system');
  return { id: r.lastInsertRowid, phone: p, email: e, reason };
}

module.exports = router;
module.exports.isSuppressed = isSuppressed;
module.exports.addSuppression = addSuppression;
module.exports.normPhone = normPhone;
