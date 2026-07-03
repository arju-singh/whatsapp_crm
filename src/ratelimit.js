// Lightweight in-memory rate limiter — no external dependency. Good enough for
// a single-process Node app (the whole CRM runs in one process). Keyed by a
// bucket name plus a client identity (IP, authenticated user, or both) so
// different endpoints get independent budgets.
//
// OWASP: rate limiting is the primary defence against credential stuffing,
// brute force, scraping and resource-exhaustion (API4:2023 / A04). We key by
// IP for anonymous traffic and by user id once authenticated, so a single
// abusive account can't hide behind many IPs and a shared NAT can't lock out
// legitimate users of the same gateway.
//
// Usage:
//   const rateLimit = require('./ratelimit');
//   router.post('/login', rateLimit({ bucket: 'login', max: 10, windowMs: 15*60*1000 }), handler)
//   app.use('/api', rateLimit({ bucket: 'api', max: 600, windowMs: 60*1000, keyBy: 'ip+user' }))

const buckets = new Map(); // key -> { count, resetAt }

// Resolve the client IP. When the app sets `trust proxy` (see server.js),
// Express has already parsed X-Forwarded-For into req.ip using the trusted hop
// count, so req.ip is the safe, spoof-resistant source. We fall back to the raw
// socket address only when req.ip is unavailable.
function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

// Build the rate-limit identity for a request.
//   'ip'      → per source IP (default; right for anonymous endpoints)
//   'user'    → per authenticated user id, falling back to IP when logged out
//   'ip+user' → both, so an account is limited and so is each IP it uses
function identity(req, keyBy) {
  const ip = clientIp(req);
  const uid = req.user && req.user.id;
  if (keyBy === 'user') return uid ? `u:${uid}` : `ip:${ip}`;
  if (keyBy === 'ip+user') return uid ? `u:${uid}|ip:${ip}` : `ip:${ip}`;
  return `ip:${ip}`;
}

// Periodically sweep expired buckets so the map doesn't grow unbounded.
let sweepTimer = null;
function ensureSweeper() {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  }, 5 * 60 * 1000);
  if (sweepTimer.unref) sweepTimer.unref(); // don't keep the process alive
}

function rateLimit({ bucket = 'default', max = 60, windowMs = 60 * 1000, keyBy = 'ip' } = {}) {
  ensureSweeper();
  return function rateLimitMiddleware(req, res, next) {
    const key = `${bucket}:${identity(req, keyBy)}`;
    const now = Date.now();
    let entry = buckets.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      buckets.set(key, entry);
    }
    entry.count += 1;
    const remaining = Math.max(0, max - entry.count);
    const resetSec = Math.ceil((entry.resetAt - now) / 1000);
    // Standard rate-limit headers so well-behaved clients can self-throttle.
    res.set('X-RateLimit-Limit', String(max));
    res.set('X-RateLimit-Remaining', String(remaining));
    res.set('X-RateLimit-Reset', String(resetSec));
    if (entry.count > max) {
      // Graceful 429: tell the client exactly how long to wait.
      res.set('Retry-After', String(resetSec));
      return res.status(429).json({
        error: 'rate_limited',
        message: 'Too many requests. Please slow down and try again shortly.',
        retry_after_seconds: resetSec,
      });
    }
    next();
  };
}

module.exports = rateLimit;
