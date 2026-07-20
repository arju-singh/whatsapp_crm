// Security headers middleware — no external dependency (avoids pulling in helmet).
// Sets a conservative-but-compatible set of headers on every response. The CSP
// is tuned for this app: it serves its own JS/CSS plus React/Babel from unpkg
// (the index.html uses in-browser Babel), inline styles, data: images, and
// remote avatars over https.
function securityHeaders() {
  const isProd = process.env.NODE_ENV === 'production';
  // Development serves JSX compiled in-browser by Babel, which requires
  // 'unsafe-eval'. The production build ships a precompiled bundle, so eval is
  // dropped in prod (removes the most dangerous XSS→in-page-exec vector).
  // 'unsafe-inline' remains for inline bootstrap; move to nonces to remove it.
  const scriptSrc = isProd
    ? "script-src 'self' 'unsafe-inline' https://unpkg.com"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com";
  const csp = [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    // API calls + Google OAuth/userinfo are same-origin or to fixed hosts.
    "connect-src 'self' https://accounts.google.com https://openidconnect.googleapis.com",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');

  return function securityHeadersMiddleware(req, res, next) {
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-XSS-Protection', '0'); // modern browsers: rely on CSP, disable legacy auditor
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    if (isProd) {
      // 1 year HSTS, only meaningful once served over HTTPS in production.
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  };
}

module.exports = securityHeaders;
