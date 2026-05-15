const crypto = require('crypto');

const SESSION_DAYS = 30;
const SESSION_COOKIE = 'sid';
const ROLES = ['user', 'admin', 'super_admin'];

function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(plain), salt, 64).toString('hex');
  return `s1:${salt}:${hash}`;
}

function verifyPassword(plain, stored) {
  if (!stored || !stored.startsWith('s1:')) return false;
  const [, salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(String(plain), salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(candidate, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers && req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function setSessionCookie(res, sid, maxAgeSec) {
  const secure = process.env.NODE_ENV === 'production' ? 'Secure; ' : '';
  res.setHeader('Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(sid)}; Path=/; HttpOnly; ${secure}SameSite=Lax; Max-Age=${maxAgeSec}`);
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? 'Secure; ' : '';
  res.setHeader('Set-Cookie',
    `${SESSION_COOKIE}=; Path=/; HttpOnly; ${secure}SameSite=Lax; Max-Age=0`);
}

function newSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

function loadSession(db, sid) {
  if (!sid) return null;
  const row = db.prepare(`
    SELECT s.id AS sid, s.expires_at, u.id, u.name, u.phone, u.role, u.active
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = ? AND s.expires_at > ? AND u.active = 1
  `).get(sid, Date.now());
  return row || null;
}

function roleAtLeast(userRole, required) {
  const i = ROLES.indexOf(userRole);
  const j = ROLES.indexOf(required);
  return i >= 0 && j >= 0 && i >= j;
}

function makeAuthMiddleware(db) {
  const PUBLIC_PATHS = new Set([
    '/login', '/login.html', '/login.js', '/login.css',
    '/unsubscribe', '/favicon.ico',
    '/api/auth/login', '/api/auth/signup', '/api/auth/logout',
  ]);
  const PUBLIC_PREFIXES = ['/avatars/', '/styles', '/fonts'];

  return function authMiddleware(req, res, next) {
    if (PUBLIC_PATHS.has(req.path)) return next();
    for (const p of PUBLIC_PREFIXES) if (req.path.startsWith(p)) return next();

    const sid = parseCookies(req)[SESSION_COOKIE];
    const session = loadSession(db, sid);
    if (!session) {
      if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'unauthorized' });
      return res.redirect('/login');
    }
    req.user = {
      id: session.id, name: session.name, phone: session.phone, role: session.role,
      sid: session.sid,
    };
    next();
  };
}

function requireRole(required) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' });
    if (!roleAtLeast(req.user.role, required)) {
      return res.status(403).json({ error: 'forbidden', need: required });
    }
    next();
  };
}

module.exports = {
  hashPassword, verifyPassword,
  parseCookies, setSessionCookie, clearSessionCookie,
  newSessionId, loadSession,
  roleAtLeast, makeAuthMiddleware, requireRole,
  SESSION_COOKIE, SESSION_DAYS, ROLES,
};
