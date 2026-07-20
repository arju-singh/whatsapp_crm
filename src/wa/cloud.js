// ---------------------------------------------------------------------------
// WhatsApp Business Cloud API provider (official Meta Graph API).
//
// Stateless HTTPS — no Chromium, no session pinned to a process. Selected via
// WA_PROVIDER=cloud (see src/whatsapp.js). Every function here is pure/testable
// and requires NO real Meta credentials to unit-test the webhook parsing and
// signature logic (see scripts/smoke-cloud-provider.js).
//
// Env:
//   WA_CLOUD_TOKEN            permanent access token (Bearer)
//   WA_CLOUD_PHONE_NUMBER_ID  the WABA phone-number id we send from
//   WA_CLOUD_APP_SECRET       app secret — verifies X-Hub-Signature-256
//   WA_CLOUD_VERIFY_TOKEN     shared token for the GET webhook handshake
//   WA_CLOUD_API_VERSION      Graph version (default v21.0)
//   WA_CLOUD_GRAPH_BASE       override base URL (tests point this at a stub)
//   WA_CLOUD_RATE_PER_SEC     outbound token-bucket refill/sec (default 40)
// ---------------------------------------------------------------------------

const crypto = require('crypto');

function cfg() {
  return {
    token: process.env.WA_CLOUD_TOKEN || '',
    phoneNumberId: process.env.WA_CLOUD_PHONE_NUMBER_ID || '',
    appSecret: process.env.WA_CLOUD_APP_SECRET || '',
    verifyToken: process.env.WA_CLOUD_VERIFY_TOKEN || '',
    apiVersion: process.env.WA_CLOUD_API_VERSION || 'v21.0',
    graphBase: (process.env.WA_CLOUD_GRAPH_BASE || 'https://graph.facebook.com').replace(/\/$/, ''),
    ratePerSec: Number(process.env.WA_CLOUD_RATE_PER_SEC) || 40,
  };
}

function isReady() {
  const c = cfg();
  return !!(c.token && c.phoneNumberId);
}

function hasAppSecret() {
  return !!cfg().appSecret;
}

// --- Outbound rate limiter (token bucket) ----------------------------------
// Meta enforces per-number throughput; this smooths bursts so we never trip the
// API's rate limits even if several workers call sendText concurrently.
const bucket = { tokens: 0, capacity: 0, last: 0 };
function refill() {
  const c = cfg();
  const cap = Math.max(1, c.ratePerSec);
  const now = Date.now();
  if (bucket.last === 0) { bucket.last = now; bucket.tokens = cap; bucket.capacity = cap; }
  bucket.capacity = cap;
  const elapsed = (now - bucket.last) / 1000;
  bucket.tokens = Math.min(cap, bucket.tokens + elapsed * cap);
  bucket.last = now;
}
async function takeToken() {
  refill();
  while (bucket.tokens < 1) {
    const waitMs = Math.ceil((1 - bucket.tokens) / Math.max(1, bucket.capacity) * 1000);
    await new Promise((r) => setTimeout(r, Math.min(1000, Math.max(10, waitMs))));
    refill();
  }
  bucket.tokens -= 1;
}

// Cloud API error codes that are permanent (no retry): invalid number, etc.
// 131026 = message undeliverable, 131047 = re-engagement outside 24h window,
// 100 = invalid parameter. Everything else (throttling, transient) is retryable.
const PERMANENT_CODES = new Set([131026, 131047, 131051, 100, 131008]);
function isPermanentCloudError(code) {
  return PERMANENT_CODES.has(Number(code));
}

// --- Outbound send ----------------------------------------------------------
async function sendText({ to, body, mediaPath }) {
  const c = cfg();
  if (!c.token || !c.phoneNumberId) throw new Error('cloud_not_configured');
  await takeToken();

  const url = `${c.graphBase}/${c.apiVersion}/${c.phoneNumberId}/messages`;
  // Text-only for the initial provider. Media requires a separate upload/hosted
  // link step (Cloud API does not accept a local file path); documented follow-up.
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: String(to).replace(/\D/g, ''),
    type: 'text',
    text: { preview_url: false, body },
  };
  if (mediaPath) console.warn('[wa:cloud] media not yet supported on cloud provider — sending text only');

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let json = {};
  try { json = await res.json(); } catch (_) {}
  if (!res.ok) {
    const err = (json && json.error) || {};
    const e = new Error(`cloud_send_failed: ${err.message || res.status}`);
    e.code = err.code;
    e.permanent = isPermanentCloudError(err.code);
    throw e;
  }
  const id = json && json.messages && json.messages[0] && json.messages[0].id;
  return { providerMessageId: id || null, status: 'sent' };
}

// --- Webhook: GET verification handshake ------------------------------------
// Meta calls GET ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
function verifyToken({ mode, token, challenge }) {
  const c = cfg();
  if (mode === 'subscribe' && c.verifyToken && token && token === c.verifyToken) {
    return { ok: true, challenge };
  }
  return { ok: false };
}

// --- Webhook: POST payload signature ----------------------------------------
// Meta signs the raw body with the app secret: X-Hub-Signature-256: sha256=<hex>.
function verifySignature(rawBody, signatureHeader) {
  const c = cfg();
  if (!c.appSecret) return { ok: false, reason: 'no_app_secret' };
  if (!signatureHeader) return { ok: false, reason: 'no_signature' };
  const buf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8');
  const expected = 'sha256=' + crypto.createHmac('sha256', c.appSecret).update(buf).digest('hex');
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  return { ok };
}

// Compute a signature for a body — used by tests to sign synthetic payloads.
function signBody(rawBody, appSecret) {
  const buf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8');
  return 'sha256=' + crypto.createHmac('sha256', appSecret).update(buf).digest('hex');
}

// --- Webhook: parse inbound messages ---------------------------------------
function textOf(m) {
  if (m.text) return m.text.body || '';
  if (m.button) return m.button.text || '';
  if (m.interactive) {
    return m.interactive.list_reply?.title || m.interactive.button_reply?.title || '';
  }
  return '';
}
function parseInbound(payload) {
  const out = [];
  for (const entry of (payload && payload.entry) || []) {
    for (const change of (entry && entry.changes) || []) {
      const value = (change && change.value) || {};
      const contacts = value.contacts || [];
      for (const m of value.messages || []) {
        const phone = String(m.from || '').replace(/\D/g, '');
        const contact = contacts.find((ct) => ct.wa_id === m.from);
        out.push({
          phone,
          body: textOf(m),
          waMessageId: m.id || null,
          pushname: (contact && contact.profile && contact.profile.name) || null,
          timestamp: Number(m.timestamp) ? Number(m.timestamp) * 1000 : Date.now(),
          type: m.type || 'text',
        });
      }
    }
  }
  return out;
}

// --- Webhook: parse delivery/read/failed statuses --------------------------
function mapStatus(s) {
  switch (String(s || '').toLowerCase()) {
    case 'sent': return 'sent';
    case 'delivered': return 'delivered';
    case 'read': return 'read';
    case 'failed': return 'failed';
    default: return null;
  }
}
function parseStatuses(payload) {
  const out = [];
  for (const entry of (payload && payload.entry) || []) {
    for (const change of (entry && entry.changes) || []) {
      for (const s of (change && change.value && change.value.statuses) || []) {
        out.push({
          waMessageId: s.id || null,
          status: mapStatus(s.status),
          timestamp: Number(s.timestamp) ? Number(s.timestamp) * 1000 : Date.now(),
          error: (s.errors && s.errors[0] && (s.errors[0].title || s.errors[0].message)) || null,
        });
      }
    }
  }
  return out;
}

module.exports = {
  key: 'cloud',
  isReady,
  hasAppSecret,
  sendText,
  verifyToken,
  verifySignature,
  signBody,
  parseInbound,
  parseStatuses,
  mapStatus,
  isPermanentCloudError,
};
