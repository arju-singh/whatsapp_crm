// Smoke test: webhook signature verification (Resend/Svix + Mailgun).
// Mounts only the /api/email route — does not start WhatsApp or scheduler.
const express = require('express');
const crypto = require('crypto');
const db = require('../src/db');
const settings = require('../src/settings');

const app = express();
app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => { req.rawBody = buf; },
}));
app.use('/api/email', require('../src/routes/email'));

// --- helpers to build valid Resend (Svix) signatures ---
function svixSign({ id, timestamp, body, secret }) {
  const raw = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  const key = Buffer.from(raw, 'base64');
  const payload = `${id}.${timestamp}.${body}`;
  return crypto.createHmac('sha256', key).update(payload).digest('base64');
}

function mailgunSign({ timestamp, token, key }) {
  return crypto.createHmac('sha256', key).update(timestamp + token).digest('hex');
}

// Use a real-shaped whsec_ secret: 32 random bytes base64 with prefix.
const TEST_SECRET = 'whsec_' + crypto.randomBytes(32).toString('base64');
const MAILGUN_KEY = 'mg-smoke-' + crypto.randomBytes(8).toString('hex');

const server = app.listen(0, async () => {
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  let failed = false;
  const fail = (msg) => { failed = true; console.error('FAIL:', msg); };
  const ok = (msg) => console.log('PASS:', msg);

  const post = async (path, body, headers = {}) => {
    const r = await fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await r.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: r.status, body: parsed };
  };

  // Snapshot settings to restore after
  const preSettings = db.prepare('SELECT key, value FROM settings').all();

  try {
    // --- 1) Resend: valid signature → 200 ---
    settings.set('resend_webhook_secret', TEST_SECRET);
    settings.set('mailgun_signing_key', MAILGUN_KEY);
    settings.set('webhook_signature_required', '1');

    const resendBody = {
      type: 'email.delivered',
      data: { email_id: 'evt_smoke', to: ['x@example.com'] },
    };
    const resendBodyStr = JSON.stringify(resendBody);
    const tsNow = Math.floor(Date.now() / 1000).toString();
    const idNow = 'msg_smoke_' + Date.now();
    const sigGood = svixSign({ id: idNow, timestamp: tsNow, body: resendBodyStr, secret: TEST_SECRET });

    let r = await post('/api/email/webhook/resend', resendBodyStr, {
      'svix-id': idNow,
      'svix-timestamp': tsNow,
      'svix-signature': `v1,${sigGood}`,
    });
    if (r.status !== 200 || r.body.verified !== true) fail(`resend valid sig: ${JSON.stringify(r)}`);
    else ok('resend valid signature accepted (verified=true)');

    // --- 2) Resend: tampered body → 401 invalid_signature ---
    const tampered = resendBodyStr.replace('email.delivered', 'email.bounced');
    r = await post('/api/email/webhook/resend', tampered, {
      'svix-id': idNow,
      'svix-timestamp': tsNow,
      'svix-signature': `v1,${sigGood}`,
    });
    if (r.status !== 401 || r.body.error !== 'invalid_signature' || r.body.reason !== 'signature_mismatch') {
      fail(`resend tampered body should be 401 signature_mismatch: ${JSON.stringify(r)}`);
    } else ok('resend tampered body → 401 signature_mismatch');

    // --- 3) Resend: timestamp skew (>5 min) → 401 timestamp_skew ---
    const tsOld = (Math.floor(Date.now() / 1000) - 600).toString();
    const sigOld = svixSign({ id: idNow, timestamp: tsOld, body: resendBodyStr, secret: TEST_SECRET });
    r = await post('/api/email/webhook/resend', resendBodyStr, {
      'svix-id': idNow,
      'svix-timestamp': tsOld,
      'svix-signature': `v1,${sigOld}`,
    });
    if (r.status !== 401 || r.body.reason !== 'timestamp_skew') {
      fail(`resend old timestamp should be 401 timestamp_skew: ${JSON.stringify(r)}`);
    } else ok('resend stale timestamp → 401 timestamp_skew');

    // --- 4) Resend: required + secret missing → 401 webhook_secret_not_configured ---
    settings.set('resend_webhook_secret', '');
    r = await post('/api/email/webhook/resend', resendBody, {
      'svix-id': idNow,
      'svix-timestamp': tsNow,
      'svix-signature': `v1,whatever`,
    });
    if (r.status !== 401 || r.body.error !== 'webhook_secret_not_configured') {
      fail(`resend required+no-secret should be 401 webhook_secret_not_configured: ${JSON.stringify(r)}`);
    } else ok('resend required + no secret → 401 webhook_secret_not_configured');

    // --- 5) Resend: required=0 + secret missing → 200 (back-compat passthrough) ---
    settings.set('webhook_signature_required', '0');
    r = await post('/api/email/webhook/resend', resendBody);
    if (r.status !== 200 || r.body.verified !== false) {
      fail(`resend optional+no-secret should pass: ${JSON.stringify(r)}`);
    } else ok('resend optional + no secret → 200 verified=false');

    // restore for mailgun tests
    settings.set('resend_webhook_secret', TEST_SECRET);
    settings.set('webhook_signature_required', '1');

    // --- 6) Mailgun: valid signature → 200 ---
    const mgTs = Math.floor(Date.now() / 1000).toString();
    const mgToken = crypto.randomBytes(16).toString('hex');
    const mgSigGood = mailgunSign({ timestamp: mgTs, token: mgToken, key: MAILGUN_KEY });
    const mgBody = {
      signature: { timestamp: mgTs, token: mgToken, signature: mgSigGood },
      'event-data': { event: 'delivered', recipient: 'x@example.com', message: { headers: { 'message-id': 'mg_smoke' } } },
    };
    r = await post('/api/email/webhook/mailgun', mgBody);
    if (r.status !== 200 || r.body.verified !== true) fail(`mailgun valid: ${JSON.stringify(r)}`);
    else ok('mailgun valid signature accepted (verified=true)');

    // --- 7) Mailgun: bad signature → 401 invalid_signature ---
    const mgBad = JSON.parse(JSON.stringify(mgBody));
    mgBad.signature.signature = '0'.repeat(mgSigGood.length);
    r = await post('/api/email/webhook/mailgun', mgBad);
    if (r.status !== 401 || r.body.error !== 'invalid_signature' || r.body.reason !== 'signature_mismatch') {
      fail(`mailgun bad sig: ${JSON.stringify(r)}`);
    } else ok('mailgun bad signature → 401 signature_mismatch');

    // --- 8) Mailgun: missing signature object → 401 missing_signature_object ---
    r = await post('/api/email/webhook/mailgun', { 'event-data': { event: 'delivered' } });
    if (r.status !== 401 || r.body.reason !== 'missing_signature_object') {
      fail(`mailgun missing sig obj: ${JSON.stringify(r)}`);
    } else ok('mailgun missing signature object → 401 missing_signature_object');

  } catch (e) {
    failed = true;
    console.error('exception:', e);
  } finally {
    db.prepare('DELETE FROM settings').run();
    const restore = db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)');
    for (const r of preSettings) restore.run(r.key, r.value, Date.now());
    settings.reload();

    console.log(failed ? '\nSMOKE TEST: FAILED' : '\nSMOKE TEST: PASSED');
    server.close(() => process.exit(failed ? 1 : 0));
  }
});
