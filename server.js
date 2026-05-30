const express = require('express');
const path = require('path');
const db = require('./src/db');
const wa = require('./src/whatsapp');
const scheduler = require('./src/scheduler');
const { makeAuthMiddleware, loadSession, parseCookies, SESSION_COOKIE } = require('./src/auth');

const app = express();
app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => { req.rawBody = buf; },
}));

// Public assets (no auth needed)
app.use('/avatars', express.static(path.join(__dirname, 'data', 'avatars'), { maxAge: '7d' }));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

// Root: serve marketing landing page when logged out, app when logged in.
app.get('/', (req, res) => {
  const sid = parseCookies(req)[SESSION_COOKIE];
  const session = loadSession(db, sid);
  if (session) return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

// Auth gate — runs for everything except whitelisted public paths.
// /api/auth/login,signup,logout are exempt (in PUBLIC_PATHS);
// /api/auth/me + /api/auth/change-password go through and get req.user populated.
app.use(makeAuthMiddleware(db));

app.use('/api/auth', require('./src/routes/auth'));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/wa/status', (req, res) => res.json(wa.getStatus()));
app.get('/api/wa/qr', (req, res) => {
  const dataUrl = wa.getQrDataUrl();
  if (!dataUrl) return res.status(404).json({ error: 'no_qr' });
  res.json({ dataUrl });
});
// Diagnostics: combine link state, recent inbound counts, and the most recent
// 5 inbound messages so you can confirm replies are actually landing.
app.get('/api/wa/diagnostics', (req, res) => {
  const db = require('./src/db');
  const status = wa.getStatus();
  const last5 = db.prepare(`
    SELECT m.id, m.body, m.created_at, m.wa_message_id, v.name AS vendor_name, v.phone
    FROM messages m JOIN vendors v ON v.id = m.vendor_id
    WHERE m.direction = 'in'
    ORDER BY m.created_at DESC LIMIT 5
  `).all();
  const counts = db.prepare(`
    SELECT
      SUM(CASE WHEN direction='in' THEN 1 ELSE 0 END) AS inbound_total,
      SUM(CASE WHEN direction='in' AND created_at >= ? THEN 1 ELSE 0 END) AS inbound_last_24h,
      SUM(CASE WHEN direction='out' AND status='sent'      THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN direction='out' AND status='delivered' THEN 1 ELSE 0 END) AS delivered,
      SUM(CASE WHEN direction='out' AND status='read'      THEN 1 ELSE 0 END) AS read_count
    FROM messages
  `).get(Date.now() - 24 * 3600 * 1000);
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
app.post('/api/wa/reinit', async (req, res) => {
  try {
    wa.safeReinit('manual reconnect via API');
    res.json({ ok: true, status: wa.getStatus() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// Wipe the LocalAuth session and force a fresh QR. Use this when reconnect
// keeps landing in "authenticated but not ready" — the saved session is wedged.
app.post('/api/wa/logout', async (req, res) => {
  try {
    wa.safeReinit('manual logout via API', { wipeSession: true });
    res.json({ ok: true, status: wa.getStatus() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.post('/api/wa/import-contacts', async (req, res) => {
  try {
    const onlySaved = req.body && req.body.onlySaved !== false;
    const result = await wa.importContacts({ onlySaved });
    res.json(result);
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});
app.post('/api/wa/enrich-contacts', async (req, res) => {
  try {
    const limit = Number(req.body?.limit) || 1000;
    const onlyMissing = req.body?.onlyMissing !== false;
    const delayMs = Number(req.body?.delayMs) || 250;
    const result = await wa.enrichContacts({ limit, onlyMissing, delayMs });
    res.json(result);
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});
app.post('/api/wa/cache-avatars', async (req, res) => {
  try {
    const limit = Number(req.body?.limit) || 5000;
    const result = await wa.cacheRemoteAvatars({ limit });
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

// Public unsubscribe endpoint (linked from emails)
app.get('/unsubscribe', (req, res) => {
  const { e, p } = req.query;
  if (e || p) {
    require('./src/routes/suppressions').addSuppression({
      phone: p, email: e, reason: 'email_unsubscribe', source: 'public_link',
    });
  }
  res.set('Content-Type', 'text/html').send(`
    <!doctype html><html><head><title>Unsubscribed</title>
    <style>body{font:16px/1.5 system-ui;max-width:520px;margin:60px auto;padding:0 20px;color:#222}</style>
    </head><body><h2>You're unsubscribed.</h2>
    <p>You won't receive further messages from us at this address. If this was a mistake, just reply to any past email and we'll re-add you.</p>
    </body></html>
  `);
});

app.use((err, req, res, next) => {
  console.error('[api] error', err);
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[server] dashboard at http://localhost:${PORT}`);
  wa.init();
  scheduler.start();
});
