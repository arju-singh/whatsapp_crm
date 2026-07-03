const express = require('express');
const db = require('../db');
const rateLimit = require('../ratelimit');
const { requirePerm } = require('../permissions');

const router = express.Router();

const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'connect@akshaykotish.com';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Store a feedback row and best-effort notify the support inbox by email.
function record({ type, name, email, message, url, userId, userAgent }) {
  const r = db.prepare(`
    INSERT INTO feedback (type, name, email, message, url, user_id, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(type, name || null, email || null, message, url || null, userId || null, userAgent || null);
  const mail = require('../email');
  if (mail.isConfigured()) {
    mail.sendRaw({
      to: SUPPORT_EMAIL,
      replyTo: email && EMAIL_RE.test(email) ? email : undefined,
      subject: `[WhatsApp CRM ${type}] ${(message || '').slice(0, 60)}`,
      text: `Type: ${type}\nFrom: ${name || '—'} <${email || '—'}>\nURL: ${url || '—'}\nUser: ${userId || 'anonymous'}\n\n${message}`,
    }).catch((e) => console.error('[support] notify email failed:', e.message));
  } else {
    console.log(`[support] ${type} #${r.lastInsertRowid} stored (SMTP not configured, not emailed)`);
  }
  return r.lastInsertRowid;
}

// Public contact form (from the landing page).
router.post('/contact', rateLimit({ bucket: 'contact', max: 5, windowMs: 10 * 60 * 1000 }), (req, res) => {
  const { name, email, message } = req.body || {};
  if (!message || String(message).trim().length < 3) return res.status(400).json({ error: 'message_required' });
  if (email && !EMAIL_RE.test(String(email))) return res.status(400).json({ error: 'invalid_email' });
  const id = record({
    type: 'contact',
    name: name && String(name).slice(0, 120),
    email: email && String(email).slice(0, 200),
    message: String(message).slice(0, 4000),
    url: req.body.url && String(req.body.url).slice(0, 300),
    userAgent: req.headers['user-agent'] || null,
  });
  res.json({ ok: true, id });
});

// Authenticated in-app bug report.
router.post('/bug', rateLimit({ bucket: 'bug', max: 20, windowMs: 10 * 60 * 1000 }), (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  const { message, url } = req.body || {};
  if (!message || String(message).trim().length < 3) return res.status(400).json({ error: 'message_required' });
  const id = record({
    type: 'bug',
    name: req.user.name,
    email: null,
    message: String(message).slice(0, 4000),
    url: url && String(url).slice(0, 300),
    userId: req.user.id,
    userAgent: req.headers['user-agent'] || null,
  });
  res.json({ ok: true, id });
});

// Admin-only triage list — feedback rows include names/emails submitted via the
// public contact form, so this must not be readable by every logged-in user.
router.get('/', requirePerm('support.manage'), (req, res) => {
  const status = req.query.status;
  const rows = status
    ? db.prepare(`SELECT * FROM feedback WHERE status = ? ORDER BY created_at DESC LIMIT 200`).all(status)
    : db.prepare(`SELECT * FROM feedback ORDER BY created_at DESC LIMIT 200`).all();
  res.json(rows);
});

router.put('/:id', requirePerm('support.manage'), (req, res) => {
  const { status } = req.body || {};
  if (!status) return res.json({ ok: true });
  db.prepare(`UPDATE feedback SET status = ? WHERE id = ?`).run(String(status), req.params.id);
  res.json({ ok: true });
});

module.exports = router;
