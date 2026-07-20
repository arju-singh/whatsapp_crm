// ---------------------------------------------------------------------------
// Trusted public base-URL resolver.
//
// Security-sensitive links (password reset, email verification) must be built
// from a base the server controls — NOT from the request's Host header, which an
// attacker can spoof to receive a victim's reset token (host-header poisoning).
//
// Resolution order:
//   1. PUBLIC_BASE_URL (the correct production config) — always trusted.
//   2. Otherwise, the request Host only if it is in APP_ALLOWED_HOSTS.
//   3. Otherwise: in production, return null (caller refuses to build the link);
//      in development, trust the request Host for convenience.
// ---------------------------------------------------------------------------

function trustedBaseUrl(req) {
  const configured = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (configured) return configured;

  const host = req && typeof req.get === 'function' ? req.get('host') : null;
  const proto = (req && req.protocol) || 'https';
  const allowed = (process.env.APP_ALLOWED_HOSTS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (host && allowed.includes(host)) return `${proto}://${host}`;

  if (process.env.NODE_ENV === 'production') return null; // fail closed — no trusted base
  return host ? `${proto}://${host}` : null;
}

module.exports = { trustedBaseUrl };
