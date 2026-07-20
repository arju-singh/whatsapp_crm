require('./src/loadenv'); // load .env before any module reads process.env
require('./src/async-routes'); // forward async route errors to the error handler (before any router is built)

// Keep the whole CRM/API alive when a background library (notably whatsapp-web.js
// + puppeteer) throws an async error we can't attach a catch to. WhatsApp Web
// periodically reloads its page, which makes an in-flight `Client.inject`
// reject with "Execution context was destroyed…"; unguarded, that killed the
// entire server. Log loudly and stay up — the WA layer has its own re-init/retry.
process.on('unhandledRejection', (reason) => {
  console.error('[fatal-guard] unhandledRejection:', reason && reason.stack ? reason.stack : reason);
});
process.on('uncaughtException', (err) => {
  console.error('[fatal-guard] uncaughtException:', err && err.stack ? err.stack : err);
});

const express = require('express');
const path = require('path');
const db = require('./src/db');
const wa = require('./src/whatsapp');
const scheduler = require('./src/scheduler');
const rateLimit = require('./src/ratelimit');
const { S, body } = require('./src/validate');
const { makeAuthMiddleware, loadSession, parseCookies, SESSION_COOKIE } = require('./src/auth');
const { requirePerm } = require('./src/permissions');
const securityHeaders = require('./src/security');
const { tenantContext } = require('./src/tenancy');
const logger = require('./src/logger');
const modules = require('./src/modules/registry');

const app = express();

// Conservative security headers (CSP, nosniff, frame-ancestors, HSTS in prod) on
// every response. Set first so even error/static responses carry them.
app.use(securityHeaders());

// Correlate every request with an id (echoed as X-Request-Id, exposed as req.id)
// and log one structured line per API request on completion. Mounted before the
// auth gate so auth-rejected (401) requests are logged too; org/user are read at
// completion, so they're populated for requests that reach the tenant middleware.
app.use(logger.requestId);
app.use(logger.requestLogger);

// Trust the reverse proxy in front of us (nginx, Cloudflare, a PaaS router) so
// req.ip and req.protocol reflect the real client instead of the proxy. The hop
// count is configurable: set TRUST_PROXY to a number (hops), 'true'/'false', or
// a subnet. Defaults to 1 hop in production, off in development. Getting this
// right is what makes IP-based rate limiting spoof-resistant.
const trustProxy = process.env.TRUST_PROXY != null
  ? (/^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY)
    : process.env.TRUST_PROXY === 'true' ? true
      : process.env.TRUST_PROXY === 'false' ? false
        : process.env.TRUST_PROXY)
  : (process.env.NODE_ENV === 'production' ? 1 : false);
app.set('trust proxy', trustProxy);

// Strip the framework fingerprint header (information disclosure).
app.disable('x-powered-by');

app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => { req.rawBody = buf; },
}));

// Public assets (no auth needed)
app.use('/avatars', express.static(path.join(__dirname, 'data', 'avatars'), { maxAge: '7d' }));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

// Legal pages — pretty (extensionless) URLs. The .html versions are served by
// express.static and whitelisted in PUBLIC_PATHS.
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, 'public', 'terms.html')));
app.get('/cookies', (req, res) => res.sendFile(path.join(__dirname, 'public', 'cookies.html')));

// SEO: robots.txt + sitemap.xml served dynamically so absolute URLs match the
// real host (or PUBLIC_BASE_URL when set behind a proxy).
function siteBase(req) {
  // Prefer a trusted base; for public SEO files a host fallback is acceptable.
  return require('./src/baseurl').trustedBaseUrl(req) || `${req.protocol}://${req.get('host')}`;
}
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(
    `User-agent: *\nAllow: /$\nAllow: /privacy\nAllow: /terms\nAllow: /cookies\nDisallow: /api/\nDisallow: /login\n\nSitemap: ${siteBase(req)}/sitemap.xml\n`);
});
app.get('/sitemap.xml', (req, res) => {
  const base = siteBase(req);
  const urls = ['/', '/privacy', '/terms', '/cookies'];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${base}${u}</loc></url>`).join('\n') +
    `\n</urlset>\n`;
  res.type('application/xml').send(body);
});

// Google Search Console / Bing ownership verification via the HTML-file method.
// Set GOOGLE_SITE_VERIFICATION to the token Google gives you (the part between
// "google" and ".html" in the file it asks you to upload, e.g. "abc123def456").
// Then this serves /google<token>.html with the exact body Google expects.
// Bing's file method works the same way via BING_SITE_VERIFICATION.
const GSC_TOKEN = (process.env.GOOGLE_SITE_VERIFICATION || '').trim();
if (GSC_TOKEN) {
  const file = `/google${GSC_TOKEN}.html`;
  app.get(file, (req, res) => res.type('text/html').send(`google-site-verification: google${GSC_TOKEN}.html`));
}
const BING_TOKEN = (process.env.BING_SITE_VERIFICATION || '').trim();
if (BING_TOKEN) {
  app.get('/BingSiteAuth.xml', (req, res) =>
    res.type('application/xml').send(`<?xml version="1.0"?>\n<users><user>${BING_TOKEN}</user></users>`));
}

// In production, serve the precompiled bundle (index.prod.html) if it exists —
// no in-browser Babel, no CDN compile. Falls back to the dev index.html (live
// JSX via Babel) otherwise. Run `npm run build` to generate the prod assets.
const PROD_INDEX = path.join(__dirname, 'public', 'index.prod.html');
const useProdBuild = process.env.NODE_ENV === 'production'
  && require('fs').existsSync(PROD_INDEX);
const APP_INDEX = useProdBuild ? PROD_INDEX : path.join(__dirname, 'public', 'index.html');
if (useProdBuild) console.log('[server] serving precompiled prod build (index.prod.html)');

// Root: serve marketing landing page when logged out, app when logged in.
app.get('/', (req, res) => {
  const sid = parseCookies(req)[SESSION_COOKIE];
  const session = loadSession(db, sid);
  if (session) return res.sendFile(APP_INDEX);
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

// Unauthenticated liveness/readiness probe for load balancers, Docker
// healthchecks, and uptime monitors. Reports process liveness plus DB and
// WhatsApp-link status. Returns 200 as long as the process + DB are up (WA being
// unlinked is degraded, not down). Placed before the auth gate on purpose.
app.get('/healthz', (req, res) => {
  let dbOk = false;
  try { db.prepare('SELECT 1').get(); dbOk = true; } catch (_) {}
  let wa = { linked: false };
  try { const s = require('./src/whatsapp').getStatus(); wa = { linked: !!s.ready }; } catch (_) {}
  const ok = dbOk;
  res.status(ok ? 200 : 503).json({
    status: ok ? 'ok' : 'degraded',
    db: dbOk ? 'up' : 'down',
    whatsapp: wa.linked ? 'linked' : 'unlinked',
    uptime_s: Math.round(process.uptime()),
  });
});

// Readiness probe — stricter than /healthz: reports whether the app can actually
// serve traffic (DB writable + queue driver connected + messaging provider linked
// where required). Orchestrators gate rollout/traffic on this; 503 = not ready.
app.get('/readyz', (req, res) => {
  const checks = {};
  try { db.prepare('SELECT 1').get(); checks.db = true; } catch (_) { checks.db = false; }
  try { checks.queue = require('./src/queue').isReady(); } catch (_) { checks.queue = false; }
  try { checks.whatsapp = !!require('./src/whatsapp').getStatus().ready; } catch (_) { checks.whatsapp = false; }
  // WhatsApp being unlinked is "degraded", not "not ready" — DB + queue are the
  // hard requirements for the API to accept work.
  const ready = checks.db && checks.queue;
  res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready', checks });
});

// Prometheus metrics exposition. Placed before the auth gate so a scraper needs
// no session. If METRICS_TOKEN is set, require it (?token= or X-Metrics-Token).
app.get('/metrics', (req, res) => {
  const token = process.env.METRICS_TOKEN;
  if (token) {
    const provided = String(req.get('x-metrics-token') || req.query.token || '');
    if (provided !== token) return res.status(401).type('text/plain').send('unauthorized');
  }
  res.set('Content-Type', 'text/plain; version=0.0.4').send(require('./src/metrics').render());
});

// Auth gate — runs for everything except whitelisted public paths.
// /api/auth/login,signup,logout are exempt (in PUBLIC_PATHS);
// /api/auth/me + /api/auth/change-password go through and get req.user populated.
app.use(makeAuthMiddleware(db));

// Resolve the active organization for every authenticated request (sets
// req.orgId / req.orgRole). Must run after auth so req.user exists.
app.use(tenantContext);

// Global API rate limit (defence-in-depth on top of the stricter per-route
// limits below). Keyed by IP+user so neither a single account nor a single IP
// can flood the API. Generous by default so normal dashboard use is unaffected;
// tune with RATE_LIMIT_API_MAX / RATE_LIMIT_API_WINDOW_MS.
const apiLimiter = rateLimit({
  bucket: 'api',
  max: Number(process.env.RATE_LIMIT_API_MAX) || 600,
  windowMs: Number(process.env.RATE_LIMIT_API_WINDOW_MS) || 60 * 1000,
  keyBy: 'ip+user',
});
app.use('/api', apiLimiter);

// Stricter limiter for expensive / side-effecting WhatsApp control endpoints
// (session re-init, bulk contact import, avatar caching). Per-user.
const waHeavyLimiter = rateLimit({ bucket: 'wa-heavy', max: 20, windowMs: 5 * 60 * 1000, keyBy: 'user' });
// These endpoints take destructive/global action on the single shared WhatsApp
// session (reconnect, wipe-session, bulk contact import). Restrict to admins so a
// low-privilege account can't disrupt messaging for the whole org.
const waAdmin = [waHeavyLimiter, requirePerm('whatsapp.admin')];

app.use('/api/auth', require('./src/routes/auth'));
app.use(express.static(path.join(__dirname, 'public')));

// The WhatsApp session/QR/diagnostics all concern the single shared WA resource
// and expose message content + linking material, so they are admin-only. Without
// requirePerm here, ANY authenticated user (even a viewer, any org) could read
// the QR and the most-recent inbound messages of the whole platform.
app.get('/api/wa/status', requirePerm('whatsapp.admin'), (req, res) => res.json(wa.getStatus()));
app.get('/api/wa/qr', requirePerm('whatsapp.admin'), (req, res) => {
  const dataUrl = wa.getQrDataUrl();
  if (!dataUrl) return res.status(404).json({ error: 'no_qr' });
  res.json({ dataUrl });
});
// Diagnostics: combine link state, recent inbound counts, and the most recent
// 5 inbound messages so you can confirm replies are actually landing. Scoped to
// the caller's active org so an admin of one tenant can't read another's messages.
app.get('/api/wa/diagnostics', requirePerm('whatsapp.admin'), (req, res) => {
  const db = require('./src/db');
  const status = wa.getStatus();
  const orgId = req.orgId;
  const last5 = db.prepare(`
    SELECT m.id, m.body, m.created_at, m.wa_message_id, v.name AS vendor_name, v.phone
    FROM messages m JOIN vendors v ON v.id = m.vendor_id
    WHERE m.direction = 'in' AND m.organization_id = ?
    ORDER BY m.created_at DESC LIMIT 5
  `).all(orgId);
  const counts = db.prepare(`
    SELECT
      SUM(CASE WHEN direction='in' THEN 1 ELSE 0 END) AS inbound_total,
      SUM(CASE WHEN direction='in' AND created_at >= ? THEN 1 ELSE 0 END) AS inbound_last_24h,
      SUM(CASE WHEN direction='out' AND status='sent'      THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN direction='out' AND status='delivered' THEN 1 ELSE 0 END) AS delivered,
      SUM(CASE WHEN direction='out' AND status='read'      THEN 1 ELSE 0 END) AS read_count
    FROM messages WHERE organization_id = ?
  `).get(Date.now() - 24 * 3600 * 1000, orgId);
  res.json({
    linked: status.ready,
    pushname: status.info?.pushname || null,
    wid: status.info?.wid || null,
    has_qr: !!status.qr,
    started_at: status.startedAt,
    counts,
    recent_inbound: last5,
    hint: !status.ready
      ? 'WhatsApp client is NOT linked. Open /api/wa/qr or sidebar bottom-left to scan.'
      : (counts.inbound_total === 0
        ? 'Linked, but no inbound messages logged yet. Reply from a different phone (not the linked one).'
        : 'Linked and receiving.'),
  });
});
// Inbound webhook for an external whatsmeow bridge (verygoodplugins/whatsapp-mcp).
// The bridge POSTs every incoming WhatsApp message here; we funnel it through the
// same ingestion path as the built-in whatsapp-web.js listener so replies land in
// the Inbox, open tickets, fire automations, and honour opt-out — regardless of
// which engine received them. Machine-to-machine, so it does NOT use the normal
// session auth. Instead: if WA_WEBHOOK_SECRET is set the caller must present it
// (?token= or x-webhook-token header); otherwise only loopback callers are allowed.
app.post('/api/wa/webhook', (req, res) => {
  const secret = process.env.WA_WEBHOOK_SECRET;
  if (secret) {
    const crypto = require('crypto');
    const provided = String(req.get('x-webhook-token') || req.query.token || '');
    const a = Buffer.from(provided);
    const b = Buffer.from(secret);
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!ok) return res.status(401).json({ error: 'bad_token' });
  } else {
    // No secret configured — accept loopback only (the bridge posts from localhost).
    const ip = req.ip || '';
    const loopback = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    if (!loopback) return res.status(403).json({ error: 'loopback_only', hint: 'set WA_WEBHOOK_SECRET to allow remote callers' });
  }

  const p = req.body || {};
  // Always 200 on well-formed calls (even when we intentionally skip) so the
  // bridge doesn't retry; only malformed JSON / auth failures are non-200.
  try {
    if (p.isFromMe) return res.json({ ok: true, skipped: 'from_me' });
    if (p.eventType && p.eventType !== 'message') return res.json({ ok: true, skipped: `event_${p.eventType}` });
    const chatJID = String(p.chatJID || '');
    if (chatJID.endsWith('@g.us')) return res.json({ ok: true, skipped: 'group' });

    // Resolve the phone. whatsmeow JIDs look like "<phone>@s.whatsapp.net" or
    // "<phone>:<device>@s.whatsapp.net". Prefer the sender; if it's a privacy LID
    // (@lid, no phone) fall back to the 1:1 chat JID.
    let ident = String(p.sender || '');
    if (ident.endsWith('@lid') && chatJID.endsWith('@s.whatsapp.net')) ident = chatJID;
    const phone = ident.split('@')[0].split(':')[0].replace(/\D/g, '');
    if (!phone) return res.json({ ok: true, skipped: 'no_phone' });

    wa.ingestInbound({
      phone,
      body: p.content || '',
      waMessageId: p.messageId || null,
      pushname: null,
      source: 'bridge',
    }).then((vendorId) => {
      console.log(`[wa:webhook] ingested from +${phone} → vendor ${vendorId ?? 'skip'}`);
    }).catch((e) => console.error('[wa:webhook] ingest failed:', e.message));

    return res.json({ ok: true });
  } catch (e) {
    console.error('[wa:webhook] handler error:', e.message);
    return res.status(400).json({ error: 'bad_payload' });
  }
});
// WhatsApp Cloud API webhook (official Meta provider). Machine-to-machine; it
// verifies Meta's token (GET) and the X-Hub-Signature-256 HMAC (POST) in-route,
// and is whitelisted in PUBLIC_PATHS. Mounted regardless of WA_PROVIDER so the
// endpoint can be verified with Meta before cutover. Shares ingestInbound +
// applyStatusUpdate with the webjs path.
app.use('/api/wa/cloud/webhook', require('./src/wa/webhook'));
app.post('/api/wa/reinit', waAdmin, async (req, res) => {
  try {
    wa.safeReinit('manual reconnect via API');
    res.json({ ok: true, status: wa.getStatus() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// Wipe the LocalAuth session and force a fresh QR. Use this when reconnect
// keeps landing in "authenticated but not ready" — the saved session is wedged.
app.post('/api/wa/logout', waAdmin, async (req, res) => {
  try {
    wa.safeReinit('manual logout via API', { wipeSession: true });
    res.json({ ok: true, status: wa.getStatus() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.post('/api/wa/import-contacts', waAdmin,
  body({ onlySaved: S.bool({ default: true }) }), async (req, res) => {
    try {
      const onlySaved = req.body.onlySaved !== false;
      const result = await wa.importContacts({ onlySaved });
      res.json(result);
    } catch (e) {
      res.status(503).json({ error: e.message });
    }
  });
app.post('/api/wa/enrich-contacts', waAdmin,
  body({
    limit: S.int({ min: 1, max: 100000, default: 1000 }),
    onlyMissing: S.bool({ default: true }),
    delayMs: S.int({ min: 0, max: 60000, default: 250 }),
  }), async (req, res) => {
    try {
      const { limit, delayMs } = req.body;
      const onlyMissing = req.body.onlyMissing !== false;
      const result = await wa.enrichContacts({ limit, onlyMissing, delayMs });
      res.json(result);
    } catch (e) {
      res.status(503).json({ error: e.message });
    }
  });
app.post('/api/wa/cache-avatars', waAdmin,
  body({ limit: S.int({ min: 1, max: 100000, default: 5000 }) }), async (req, res) => {
    try {
      const result = await wa.cacheRemoteAvatars({ limit: req.body.limit });
      res.json(result);
    } catch (e) {
      res.status(503).json({ error: e.message });
    }
  });

app.use('/api/vendors', require('./src/routes/vendors'));
app.use('/api/contacts', require('./src/routes/vendors')); // alias — Three CRM language
app.use('/api/templates', require('./src/routes/templates'));
app.use('/api/messages', require('./src/routes/messages'));
app.use('/api/campaigns', require('./src/routes/campaigns'));
app.use('/api/followups', require('./src/routes/followups'));
app.use('/api/calls', require('./src/routes/calls'));
app.use('/api/voice', require('./src/routes/voice'));
app.use('/api/tasks', require('./src/routes/tasks'));
app.use('/api/activities', require('./src/routes/activities'));
app.use('/api/suppressions', require('./src/routes/suppressions'));
app.use('/api/email', require('./src/routes/email'));
app.use('/api/inbox', require('./src/routes/inbox'));
app.use('/api/settings', require('./src/routes/settings'));
app.use('/api/companies', require('./src/routes/companies'));
app.use('/api/stages', require('./src/routes/stages'));
app.use('/api/deals', require('./src/routes/deals'));
app.use('/api/tickets', require('./src/routes/tickets'));
app.use('/api/automations', require('./src/routes/automations'));
app.use('/api/team', require('./src/routes/team'));
app.use('/api/notifications', require('./src/routes/notifications'));
app.use('/api/calendar', require('./src/routes/calendar'));
app.use('/api/ai', require('./src/routes/ai'));
app.use('/api/reports', require('./src/routes/reports'));
app.use('/api/leads', require('./src/routes/leads'));
app.use('/api/users', require('./src/routes/users'));
// SaaS pre-launch routes
app.use('/api/auth', require('./src/routes/oauth'));      // /api/auth/google[/callback|/config]
app.use('/api/analytics', require('./src/routes/analytics'));
app.use('/api/support', require('./src/routes/support'));
app.use('/api/billing', require('./src/routes/billing'));

// --- Platform layer (multi-tenancy + module registry) ---------------------
// Initialize modules (run their migrations, register permissions, enable for the
// default org), expose the platform API the frontend reads to know which org it's
// in and which modules/nav/permissions are active, then mount module-owned routes
// (each gated by its module being enabled for the org).
modules.init(db);
app.use('/api/platform', modules.platformRouter(db));
modules.mountModules(app, db);

// Public unsubscribe endpoint (linked from emails). Rate-limited per IP and the
// e/p params are length-capped before they reach the suppression list.
app.get('/unsubscribe', rateLimit({ bucket: 'unsubscribe', max: 30, windowMs: 10 * 60 * 1000 }), (req, res) => {
  const e = req.query.e != null ? String(req.query.e).slice(0, 254) : undefined;
  const p = req.query.p != null ? String(req.query.p).replace(/\D/g, '').slice(0, 20) : undefined;
  if (e || p) {
    // Public link carries no org, so resolve which org(s) actually hold this
    // contact and suppress in each of those (never a shared/default org). This
    // honours the unsubscribe everywhere the person is known without writing into
    // any tenant that doesn't have them.
    const supp = require('./src/routes/suppressions');
    const orgIds = new Set();
    if (e) {
      for (const r of db.prepare('SELECT DISTINCT organization_id o FROM emails WHERE LOWER(to_email) = LOWER(?)').all(e)) orgIds.add(r.o);
      for (const r of db.prepare('SELECT DISTINCT organization_id o FROM vendors WHERE LOWER(email) = LOWER(?) AND deleted_at IS NULL').all(e)) orgIds.add(r.o);
    }
    if (p) {
      for (const r of db.prepare('SELECT DISTINCT organization_id o FROM vendors WHERE phone = ? AND deleted_at IS NULL').all(p)) orgIds.add(r.o);
    }
    for (const o of orgIds) {
      supp.addSuppression({ orgId: o, phone: p, email: e, reason: 'email_unsubscribe', source: 'public_link' });
    }
  }
  res.set('Content-Type', 'text/html').send(`
    <!doctype html><html><head><title>Unsubscribed</title>
    <style>body{font:16px/1.5 system-ui;max-width:520px;margin:60px auto;padding:0 20px;color:#222}</style>
    </head><body><h2>You're unsubscribed.</h2>
    <p>You won't receive further messages from us at this address. If this was a mistake, just reply to any past email and we'll re-add you.</p>
    </body></html>
  `);
});

// Centralised error handler. Logs the full error server-side but only leaks
// internal messages to the client in development — production returns a generic
// message to avoid disclosing stack/SQL/internal details (OWASP A09).
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error('api_error', { req: req.id, method: req.method, path: req.path, err: err && err.message, stack: err && err.stack });
  // Body-parser raises this when JSON is malformed or exceeds the size limit.
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json' });
  const isDev = process.env.NODE_ENV !== 'production';
  res.status(err.status || 500).json({ error: isDev ? err.message : 'internal_error' });
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`[server] dashboard at http://localhost:${PORT}`);
  wa.init();
  scheduler.start();
});
// Boot-time listen failures (e.g. EADDRINUSE) must not throw unhandled.
server.on('error', (err) => {
  console.error('[server] listen error:', err.message);
  process.exit(1);
});

// Graceful shutdown: on SIGTERM/SIGINT (docker stop, Ctrl-C) stop accepting new
// connections, stop the cron scheduler, tear down the WhatsApp client/Chromium,
// and close the DB so nothing is left half-written or orphaned. Falls back to a
// hard exit if cleanup hangs.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} received — shutting down gracefully`);
  const hardKill = setTimeout(() => {
    console.error('[server] cleanup timed out — forcing exit');
    process.exit(1);
  }, 10_000);
  hardKill.unref();
  try { server.close(); } catch (_) {}
  try { if (scheduler.stop) scheduler.stop(); } catch (_) {}
  // Drain in-flight jobs / close workers + Redis before tearing down the DB.
  try { await require('./src/queue').close({ timeoutMs: 8_000 }); } catch (e) { console.error('[server] queue close error:', e.message); }
  try { if (wa.shutdown) await wa.shutdown(); } catch (e) { console.error('[server] wa shutdown error:', e.message); }
  try { db.close(); } catch (_) {}
  clearTimeout(hardKill);
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
