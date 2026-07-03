const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const rateLimit = require('../ratelimit');
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

function normalizeEmail(e) {
  return String(e || '').trim().toLowerCase();
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function audit(event, userId, detail) {
  try {
    db.prepare(`INSERT INTO audit_log (event, detail) VALUES (?, ?)`)
      .run(event, JSON.stringify({ user_id: userId, ...detail }).slice(0, 500));
  } catch (_) { /* audit is best-effort */ }
}

function publicBase(req) {
  return process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
}

// Fire-and-forget verification email. No-op (logged) if SMTP isn't configured.
function sendVerificationEmail(req, user, token) {
  const email = require('../email');
  if (!email.isConfigured()) {
    console.log(`[auth] SMTP not configured — skipping verification email for ${user.email}. Verify link: ${publicBase(req)}/api/auth/verify?token=${token}`);
    return;
  }
  const url = `${publicBase(req)}/api/auth/verify?token=${token}`;
  email.sendRaw({
    to: user.email,
    subject: 'Verify your WhatsApp CRM email',
    html: `<div style="font:16px/1.6 system-ui,Arial,sans-serif;color:#222;max-width:520px">
      <h2 style="font-weight:600">Confirm your email</h2>
      <p>Hi ${user.name || 'there'}, please confirm your email to activate your WhatsApp CRM account.</p>
      <p><a href="${url}" style="display:inline-block;background:#1A1A1A;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none">Verify email</a></p>
      <p style="color:#888;font-size:13px">Or paste this link: ${url}</p>
    </div>`,
    text: `Confirm your WhatsApp CRM email: ${url}`,
  }).catch((e) => console.error('[auth] verification email failed:', e.message));
}

// ---- Signup ----------------------------------------------------------------
router.post('/signup', rateLimit({ bucket: 'signup', max: 10, windowMs: 15 * 60 * 1000 }), (req, res) => {
  const { name, password } = req.body || {};
  const phone = normalizePhone(req.body && req.body.phone);
  const email = normalizeEmail(req.body && req.body.email);
  if (!name || !phone || !password) return res.status(400).json({ error: 'name_phone_password_required' });
  if (phone.length < 11) return res.status(400).json({ error: 'invalid_phone' });
  if (String(password).length < 6) return res.status(400).json({ error: 'password_too_short' });
  if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: 'invalid_email' });
  const existing = db.prepare(`SELECT id FROM users WHERE phone = ?`).get(phone);
  if (existing) return res.status(409).json({ error: 'phone_already_registered' });
  if (email) {
    const e2 = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email);
    if (e2) return res.status(409).json({ error: 'email_already_registered' });
  }
  try {
    const token = email ? crypto.randomBytes(24).toString('hex') : null;
    const r = db.prepare(`
      INSERT INTO users (name, phone, email, password_hash, role, active, email_verified, verify_token, verify_sent_at)
      VALUES (?, ?, ?, ?, 'user', 0, 0, ?, ?)
    `).run(name, phone, email || null, hashPassword(password), token, token ? Date.now() : null);
    audit('user_signup', r.lastInsertRowid, { phone, email: email || null });
    if (email && token) sendVerificationEmail(req, { name, email }, token);
    res.json({ ok: true, pending: true, email_verification: !!email });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- Email verification ----------------------------------------------------
router.get('/verify', (req, res) => {
  const token = String(req.query.token || '');
  const page = (title, msg) => res.set('Content-Type', 'text/html').send(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
     <style>body{font:16px/1.6 system-ui;max-width:480px;margin:80px auto;padding:0 24px;color:#1A1A1A}
     a{color:#1A1A1A}</style></head><body><h2>${title}</h2><p>${msg}</p>
     <p><a href="/login">Go to sign in →</a></p></body></html>`);
  if (!token) return res.status(400).send('Missing token');
  const user = db.prepare(`SELECT id FROM users WHERE verify_token = ?`).get(token);
  if (!user) return res.status(400) && page('Link invalid or expired', 'This verification link is no longer valid. Try signing in or request a new link.');
  db.prepare(`UPDATE users SET email_verified = 1, verify_token = NULL, updated_at = ? WHERE id = ?`)
    .run(Date.now(), user.id);
  audit('email_verified', user.id, {});
  page('Email verified ✓', 'Your email is confirmed. An admin will activate your account shortly (or it may already be active).');
});

// ---- Login -----------------------------------------------------------------
router.post('/login', rateLimit({ bucket: 'login', max: 10, windowMs: 15 * 60 * 1000 }), (req, res) => {
  const phone = normalizePhone(req.body && req.body.phone);
  const password = req.body && req.body.password;
  if (!phone || !password) return res.status(400).json({ error: 'phone_and_password_required' });

  const user = db.prepare(`SELECT * FROM users WHERE phone = ?`).get(phone);
  if (!user || !verifyPassword(password, user.password_hash)) {
    audit('login_failed', user ? user.id : null, { phone });
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
  audit('login', user.id, {});
  setSessionCookie(res, sid, SESSION_DAYS * 24 * 3600);
  res.json({ user: { id: user.id, name: user.name, phone: user.phone, role: user.role } });
});

// ---- Forgot / reset password ----------------------------------------------
// Accepts phone or email. Always returns ok (no account enumeration). If an
// email is on file and SMTP is configured, sends a reset link.
router.post('/forgot', rateLimit({ bucket: 'forgot', max: 5, windowMs: 15 * 60 * 1000 }), (req, res) => {
  const phone = normalizePhone(req.body && req.body.phone);
  const email = normalizeEmail(req.body && req.body.email);
  let user = null;
  if (email) user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email);
  if (!user && phone) user = db.prepare(`SELECT * FROM users WHERE phone = ?`).get(phone);
  if (user && user.email) {
    const token = crypto.randomBytes(24).toString('hex');
    const expires = Date.now() + 60 * 60 * 1000; // 1 hour
    db.prepare(`UPDATE users SET reset_token = ?, reset_expires_at = ? WHERE id = ?`).run(token, expires, user.id);
    audit('password_reset_requested', user.id, {});
    const mail = require('../email');
    const url = `${publicBase(req)}/reset.html?token=${token}`;
    if (mail.isConfigured()) {
      mail.sendRaw({
        to: user.email,
        subject: 'Reset your WhatsApp CRM password',
        html: `<div style="font:16px/1.6 system-ui,Arial,sans-serif;color:#222;max-width:520px">
          <h2 style="font-weight:600">Reset your password</h2>
          <p>We received a request to reset your password. This link expires in 1 hour.</p>
          <p><a href="${url}" style="display:inline-block;background:#1A1A1A;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none">Choose a new password</a></p>
          <p style="color:#888;font-size:13px">If you didn't request this, you can ignore this email. Link: ${url}</p>
        </div>`,
        text: `Reset your WhatsApp CRM password (expires in 1h): ${url}`,
      }).catch((e) => console.error('[auth] reset email failed:', e.message));
    } else {
      console.log(`[auth] SMTP not configured — reset link for ${user.email}: ${url}`);
    }
  }
  res.json({ ok: true });
});

router.post('/reset', rateLimit({ bucket: 'reset', max: 10, windowMs: 15 * 60 * 1000 }), (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: 'token_and_password_required' });
  if (String(password).length < 6) return res.status(400).json({ error: 'password_too_short' });
  const user = db.prepare(`SELECT * FROM users WHERE reset_token = ? AND reset_expires_at > ?`)
    .get(String(token), Date.now());
  if (!user) return res.status(400).json({ error: 'invalid_or_expired_token' });
  db.prepare(`UPDATE users SET password_hash = ?, reset_token = NULL, reset_expires_at = NULL, updated_at = ? WHERE id = ?`)
    .run(hashPassword(password), Date.now(), user.id);
  // Reset invalidates all existing sessions for safety.
  db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(user.id);
  audit('password_reset', user.id, {});
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  const sid = parseCookies(req)[SESSION_COOKIE];
  if (sid) {
    const s = db.prepare(`SELECT user_id FROM sessions WHERE id = ?`).get(sid);
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sid);
    if (s) audit('logout', s.user_id, {});
  }
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
  audit('password_changed', req.user.id, {});
  res.json({ ok: true });
});

module.exports = router;
