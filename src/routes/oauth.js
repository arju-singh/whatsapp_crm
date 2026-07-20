const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { newSessionId, setSessionCookie, SESSION_DAYS } = require('../auth');

const router = express.Router();

// --- Google OAuth config (env-gated; no keys committed) ---------------------
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
// OAuth users come pre-verified by Google; activate them immediately unless
// you flip this off to keep manual admin approval.
const AUTO_ACTIVATE = String(process.env.OAUTH_AUTO_ACTIVATE ?? 'true').toLowerCase() !== 'false';

const { trustedBaseUrl } = require('../baseurl');
function isConfigured() { return !!(CLIENT_ID && CLIENT_SECRET); }
function redirectUri(req) {
  const base = trustedBaseUrl(req);
  return base ? `${base}/api/auth/google/callback` : null;
}

// Step 1: bounce the user to Google's consent screen with a CSRF state cookie.
router.get('/google', (req, res) => {
  if (!isConfigured()) return res.status(503).json({ error: 'oauth_not_configured' });
  if (!redirectUri(req)) return res.status(503).json({ error: 'base_url_not_configured', hint: 'set PUBLIC_BASE_URL' });
  const state = crypto.randomBytes(16).toString('hex');
  res.setHeader('Set-Cookie',
    `oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`);
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// Step 2: Google redirects back with a code; exchange it, fetch the profile,
// find-or-create the user, mint a session.
router.get('/google/callback', async (req, res) => {
  if (!isConfigured()) return res.status(503).send('OAuth not configured');
  const { code, state } = req.query;
  const cookieState = (req.headers.cookie || '').split(';')
    .map((c) => c.trim()).find((c) => c.startsWith('oauth_state='))?.slice('oauth_state='.length);
  if (!code || !state || state !== cookieState) {
    return res.status(400).send('Invalid OAuth state. <a href="/login">Try again</a>.');
  }
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code),
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: redirectUri(req),
        grant_type: 'authorization_code',
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(tokens?.error_description || 'token_exchange_failed');

    const profRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const prof = await profRes.json();
    if (!profRes.ok || !prof.email) throw new Error('failed_to_load_profile');

    const email = String(prof.email).toLowerCase();
    let user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email);
    if (!user) {
      // No phone for OAuth users — store a unique non-numeric placeholder so the
      // NOT NULL UNIQUE phone constraint is satisfied. They sign in via Google.
      const placeholderPhone = `google:${prof.sub}`;
      const r = db.prepare(`
        INSERT INTO users (name, phone, email, password_hash, role, active, email_verified)
        VALUES (?, ?, ?, '', 'user', ?, 1)
      `).run(prof.name || email, placeholderPhone, email, AUTO_ACTIVATE ? 1 : 0);
      user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(r.lastInsertRowid);
      // Own isolated org + owner membership (tenant-isolation, S1) — OAuth users
      // must never default into the shared org either.
      try {
        require('../tenancy').provisionOrgForUser(user.id, `${prof.name || email}'s Workspace`, 'owner');
      } catch (e) {
        console.error('[oauth] failed to provision org on signup:', e.message);
      }
      db.prepare(`INSERT INTO audit_log (event, detail) VALUES ('oauth_signup', ?)`)
        .run(JSON.stringify({ user_id: user.id, provider: 'google', email }).slice(0, 500));
    } else if (!user.email_verified) {
      db.prepare(`UPDATE users SET email_verified = 1 WHERE id = ?`).run(user.id);
    }

    if (!user.active) {
      return res.status(403).send('Your account is pending approval. <a href="/login">Back to sign in</a>.');
    }

    const sid = newSessionId();
    const expiresAt = Date.now() + SESSION_DAYS * 24 * 3600 * 1000;
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, user_agent, ip) VALUES (?, ?, ?, ?, ?)`)
      .run(sid, user.id, expiresAt, req.headers['user-agent'] || null, req.ip || null);
    db.prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`).run(Date.now(), user.id);
    db.prepare(`INSERT INTO audit_log (event, detail) VALUES ('login', ?)`)
      .run(JSON.stringify({ user_id: user.id, provider: 'google' }).slice(0, 500));
    setSessionCookie(res, sid, SESSION_DAYS * 24 * 3600);
    // clear state cookie + go to the app
    res.setHeader('Set-Cookie', [
      res.getHeader('Set-Cookie'),
      'oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
    ].flat());
    res.redirect('/');
  } catch (e) {
    console.error('[oauth] google callback failed:', e.message);
    res.status(502).send('Google sign-in failed. <a href="/login">Try again</a>.');
  }
});

// Lets the login page decide whether to show the "Continue with Google" button.
router.get('/google/config', (req, res) => res.json({ google: isConfigured() }));

module.exports = router;
