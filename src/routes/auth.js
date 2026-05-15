const express = require('express');
const db = require('../db');
const {
  hashPassword, verifyPassword, newSessionId, loadSession,
  setSessionCookie, clearSessionCookie, parseCookies,
  SESSION_COOKIE, SESSION_DAYS,
} = require('../auth');

const router = express.Router();

function normalizePhone(p) {
  let d = String(p || '').replace(/\D/g, '').replace(/^0+/, '');
  if (d.length === 10) d = '91' + d;
  return d;
}

router.post('/signup', (req, res) => {
  const { name, password } = req.body || {};
  const phone = normalizePhone(req.body && req.body.phone);
  if (!name || !phone || !password) return res.status(400).json({ error: 'name_phone_password_required' });
  if (phone.length < 11) return res.status(400).json({ error: 'invalid_phone' });
  if (String(password).length < 6) return res.status(400).json({ error: 'password_too_short' });
  const existing = db.prepare(`SELECT id FROM users WHERE phone = ?`).get(phone);
  if (existing) return res.status(409).json({ error: 'phone_already_registered' });
  try {
    db.prepare(`INSERT INTO users (name, phone, password_hash, role, active) VALUES (?, ?, ?, 'user', 0)`)
      .run(name, phone, hashPassword(password));
    res.json({ ok: true, pending: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/login', (req, res) => {
  const phone = normalizePhone(req.body && req.body.phone);
  const password = req.body && req.body.password;
  if (!phone || !password) return res.status(400).json({ error: 'phone_and_password_required' });

  const user = db.prepare(`SELECT * FROM users WHERE phone = ?`).get(phone);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  if (!user.active) {
    return res.status(403).json({ error: 'account_pending_approval' });
  }
  const sid = newSessionId();
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 3600 * 1000;
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at, user_agent, ip) VALUES (?, ?, ?, ?, ?)`)
    .run(sid, user.id, expiresAt, req.headers['user-agent'] || null, req.ip || null);
  db.prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`).run(Date.now(), user.id);
  setSessionCookie(res, sid, SESSION_DAYS * 24 * 3600);
  res.json({ user: { id: user.id, name: user.name, phone: user.phone, role: user.role } });
});

router.post('/logout', (req, res) => {
  const sid = parseCookies(req)[SESSION_COOKIE];
  if (sid) db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sid);
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  res.json({ user: req.user });
});

router.post('/change-password', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  const { current, next } = req.body || {};
  if (!current || !next || String(next).length < 6) {
    return res.status(400).json({ error: 'password_too_short' });
  }
  const u = db.prepare(`SELECT password_hash FROM users WHERE id = ?`).get(req.user.id);
  if (!u || !verifyPassword(current, u.password_hash)) return res.status(401).json({ error: 'wrong_current_password' });
  db.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`)
    .run(hashPassword(next), Date.now(), req.user.id);
  // Invalidate all other sessions
  db.prepare(`DELETE FROM sessions WHERE user_id = ? AND id != ?`).run(req.user.id, req.user.sid);
  res.json({ ok: true });
});

module.exports = router;
