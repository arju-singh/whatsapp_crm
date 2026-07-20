const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const settings = require('./settings');
const suppressions = require('./routes/suppressions');
const jobQueue = require('./queue');
const metrics = require('./metrics');
const { DEFAULT_ORG_ID } = require('./tenancy');

metrics.registerCounter('wa_messages_sent_total', 'Outbound WhatsApp messages sent');
metrics.registerCounter('wa_messages_failed_total', 'Outbound WhatsApp messages that failed a send attempt');
metrics.registerCounter('wa_messages_received_total', 'Inbound WhatsApp messages ingested');

// There is a single shared WhatsApp line for this deployment, so inbound
// messages belong to one "host" organization. It is configurable (env
// WA_HOST_ORG_ID or setting wa_host_org_id) and defaults to the default org —
// never silently to DEFAULT 1 via a column default. When the Cloud API provider
// lands (per-number → per-org), this becomes a phone-number-id lookup.
function waHostOrgId() {
  const raw = process.env.WA_HOST_ORG_ID || settings.get('wa_host_org_id');
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_ORG_ID;
}

// Outbound transport provider selector. 'webjs' (default) drives the existing
// whatsapp-web.js/Chromium client — kept as the instant rollback. 'cloud' is the
// official Meta Cloud API (stateless HTTPS). 'mock' is a no-network provider for
// tests. Only 'webjs' boots Chromium; the others never touch it.
const WA_PROVIDER = String(process.env.WA_PROVIDER || 'webjs').toLowerCase();
function providerKey() { return WA_PROVIDER; }
// The non-webjs provider module (lazy — cloud/mock don't require whatsapp.js, so
// there is no cycle). Returns null for webjs (handled inline with the client).
function externalProvider() {
  if (WA_PROVIDER === 'cloud') return require('./wa/cloud');
  if (WA_PROVIDER === 'mock') return require('./wa/mock');
  return null;
}
// Max delivery attempts before a message is terminally failed (both providers).
const MAX_SEND_ATTEMPTS = Number(process.env.WA_MAX_SEND_ATTEMPTS) || 5;

const state = {
  ready: false,
  qr: null,
  qrDataUrl: null,
  info: null,
  startedAt: Date.now(),
};

// Outbound sends now flow through the queue abstraction (src/queue). Nothing is
// buffered in this module anymore.

const STOP_KEYWORDS = /^\s*(stop|unsubscribe|remove|opt[\s-]?out|do not (contact|message)|leave me alone)\b/i;

// Pin the WhatsApp Web version. whatsapp-web.js ships with a bundled WWeb build
// that drifts out of sync with WhatsApp's servers over time; when it does, the
// phone accepts the QR scan but the pairing handshake never completes and it
// loops back to a fresh QR ("scan fails to link"). Pinning a current WWeb HTML
// from the maintained wppconnect/wa-version repo fixes that. Bump WA_WEB_VERSION
// when WhatsApp updates again (newest at github.com/wppconnect-team/wa-version);
// unset it to fall back to the library's bundled version.
const WA_WEB_VERSION = process.env.WA_WEB_VERSION || '2.3000.1039904970-alpha';
const WA_WEB_VERSION_HTML = process.env.WA_WEB_VERSION_HTML
  || `https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/${WA_WEB_VERSION}.html`;

// Resolve a Chrome/Chromium the bundled puppeteer can drive. whatsapp-web.js's
// puppeteer expects a pinned Chrome build that is often not downloaded (npm ci
// with PUPPETEER_SKIP_DOWNLOAD, a wiped cache, CI images, etc.), which surfaces
// as "Could not find Chrome (ver. X)" and leaves WhatsApp permanently offline.
// Prefer an explicit override, then a system-installed browser, then puppeteer's
// own download. Returns undefined to let puppeteer fall back to its default.
function resolveChromeExecutable() {
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;
  const byPlatform = {
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ],
    win32: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ],
    linux: [
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
    ],
  };
  for (const c of byPlatform[process.platform] || []) {
    try { if (fs.existsSync(c)) return c; } catch (_) {}
  }
  // Last resort: the bundled puppeteer-core's downloaded build, if any. We depend
  // on puppeteer-core (see package.json), NOT the full `puppeteer` package — the
  // old `require('puppeteer')` always threw MODULE_NOT_FOUND and was silently
  // swallowed, so this fallback never actually ran.
  try {
    const ep = require('puppeteer-core').executablePath();
    if (ep && fs.existsSync(ep)) return ep;
  } catch (_) {}
  return undefined;
}

const CHROME_EXECUTABLE = resolveChromeExecutable();
if (CHROME_EXECUTABLE) console.log(`[wa] using Chrome at ${CHROME_EXECUTABLE}`);
else console.warn('[wa] no Chrome found — set PUPPETEER_EXECUTABLE_PATH or run `npx puppeteer browsers install chrome`');

const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'whatsapp-crm' }),
  ...(WA_WEB_VERSION ? {
    webVersion: WA_WEB_VERSION,
    webVersionCache: { type: 'remote', remotePath: WA_WEB_VERSION_HTML },
  } : {}),
  puppeteer: {
    headless: true,
    ...(CHROME_EXECUTABLE ? { executablePath: CHROME_EXECUTABLE } : {}),
    protocolTimeout: 180_000,
    timeout: 180_000,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
    ],
  },
});

client.on('qr', async (qr) => {
  state.qr = qr;
  state.ready = false;
  try {
    state.qrDataUrl = await qrcode.toDataURL(qr);
  } catch (_) {}
  qrcodeTerminal.generate(qr, { small: true });
  console.log('[wa] scan the QR above with WhatsApp → Linked Devices');
});

client.on('ready', () => {
  state.ready = true;
  state.qr = null;
  state.qrDataUrl = null;
  state.info = client.info ? { wid: client.info.wid?._serialized, pushname: client.info.pushname } : null;
  console.log('[wa] client ready', state.info);
  // Recover orphaned queued messages from a previous run
  try {
    const rows = db.prepare(`
      SELECT id FROM messages WHERE direction='out' AND status='queued'
      ORDER BY created_at ASC
    `).all();
    if (rows.length) {
      console.log(`[wa] requeueing ${rows.length} orphaned message(s) from DB`);
      for (const r of rows) enqueueMessage(r.id);
    }
  } catch (e) {
    console.error('[wa] requeue error', e.message);
  }
});

client.on('authenticated', () => console.log('[wa] authenticated — QR accepted, syncing…'));
client.on('auth_failure', (m) => console.error('[wa] auth failure', m));
client.on('disconnected', (reason) => {
  state.ready = false;
  console.warn('[wa] disconnected', reason);
});

// Diagnostics for the QR → linked handshake. Without these there is no trace
// between "QR shown" and "ready": a scan that the phone accepts fires
// `authenticated` then `loading_screen` (sync %) before `ready`; a scan that
// silently fails (e.g. WhatsApp Web version drift) shows neither. `change_state`
// surfaces CONFLICT / UNPAIRED / TIMEOUT etc. so a stuck link is visible.
client.on('loading_screen', (percent, message) => {
  console.log(`[wa] loading ${percent}% ${message || ''}`);
});
client.on('change_state', (s) => console.log('[wa] state →', s));

// Some whatsapp-web.js setups only emit `message_create` (which fires for ALL
// messages, including the ones the user typed on their phone). Mirror it to
// our normal handler if `message` didn't already cover it. We dedupe via the
// wa_message_id so the row isn't double-inserted.
client.on('message_create', (msg) => {
  // Only treat it as inbound if it isn't fromMe — `message` should already cover this,
  // but log it so we can compare what each event sees.
  if (msg && !msg.fromMe) {
    console.log(`[wa:message_create] from=${msg.from} body="${(msg.body || '').slice(0, 40)}"`);
  }
});

client.on('message_ack', (msg, ack) => {
  // ack: 1=sent, 2=delivered, 3=read, 4=played
  const stmt = db.prepare(`
    UPDATE messages
    SET delivered_at = COALESCE(delivered_at, CASE WHEN ? >= 2 THEN ? ELSE NULL END),
        read_at = COALESCE(read_at, CASE WHEN ? >= 3 THEN ? ELSE NULL END),
        status = CASE WHEN ? >= 3 THEN 'read' WHEN ? >= 2 THEN 'delivered' ELSE status END
    WHERE wa_message_id = ?
  `);
  const now = Date.now();
  try {
    stmt.run(ack, now, ack, now, ack, ack, msg.id?._serialized);
  } catch (e) {
    console.error('[wa] ack update failed', e.message);
  }
});

// Every inbound event — verbose log so you can tell from server logs whether
// the message listener fired at all, and why a message might be filtered.
client.on('message', async (msg) => {
  console.log(`[wa:inbound] event from=${msg.from} type=${msg.type} fromMe=${msg.fromMe} body="${(msg.body || '').slice(0, 60)}"`);
  if (msg.fromMe) {
    console.log('[wa:inbound] skipping — fromMe (you sent this from your own phone)');
    return;
  }
  if (!msg.from) {
    console.log('[wa:inbound] skipping — no .from on message');
    return;
  }
  if (!msg.from.endsWith('@c.us')) {
    console.log(`[wa:inbound] skipping — not a 1:1 chat (got ${msg.from})`);
    return;
  }
  const phone = msg.from.replace(/@c\.us$/, '').replace(/\D/g, '');
  if (!phone) {
    console.log('[wa:inbound] skipping — empty phone after normalize');
    return;
  }

  // Best-effort: use the sender's WhatsApp profile name for auto-created vendors.
  let pushname = null;
  try { const c = await msg.getContact(); pushname = c?.pushname || c?.name || null; } catch (_) {}

  // Hand off to the shared ingestion routine so this listener and the
  // /api/wa/webhook route (fed by an external whatsmeow bridge) behave identically.
  await ingestInbound({
    phone,
    body: msg.body || '',
    waMessageId: msg.id?._serialized,
    pushname,
    source: 'wwebjs',
  });
});

// Shared inbound ingestion. Given a normalized phone + message body, upsert the
// vendor (auto-creating a lead so nothing is silently dropped), store the inbound
// message, open/refresh a support ticket, fire message_received automations,
// auto-draft an AI reply, and handle STOP/opt-out keywords. Called by both the
// whatsapp-web.js `message` listener and the /api/wa/webhook route, so every
// inbound path produces the same CRM side effects. Idempotent per wa_message_id.
async function ingestInbound({ phone, body = '', waMessageId = null, pushname = null, source = 'unknown' }) {
  phone = String(phone == null ? '' : phone).replace(/\D/g, '');
  if (!phone) {
    console.log(`[wa:inbound:${source}] skipping — empty phone after normalize`);
    return null;
  }
  body = body || '';

  // De-dupe on the provider message id so a webhook retry (or the same number
  // being linked to both the CRM session and the bridge) can't double-insert.
  if (waMessageId) {
    const dup = db.prepare('SELECT id FROM messages WHERE wa_message_id = ? LIMIT 1').get(waMessageId);
    if (dup) {
      console.log(`[wa:inbound:${source}] skipping — duplicate wa_message_id ${waMessageId}`);
      return null;
    }
  }

  // The shared WhatsApp line belongs to the host org; all inbound data is stamped
  // with it so nothing falls back to the DEFAULT 1 column default.
  const orgId = waHostOrgId();

  // Try to find an existing vendor (in the host org); if none, auto-create one so
  // the inbound message is never silently dropped. New leads land in the Inbox.
  let vendor = db.prepare('SELECT id, email, organization_id FROM vendors WHERE phone = ? AND organization_id = ?')
    .get(phone, orgId);
  if (!vendor) {
    try {
      const displayName = pushname || `WhatsApp +${phone}`;
      const r = db.prepare(`
        INSERT INTO vendors (organization_id, name, phone, status, total_replied, last_replied_at, created_at, updated_at)
        VALUES (?, ?, ?, 'replied', 0, NULL, ?, ?)
      `).run(orgId, displayName, phone, Date.now(), Date.now());
      vendor = { id: r.lastInsertRowid, email: null, organization_id: orgId };
      console.log(`[wa] auto-created vendor #${vendor.id} (org ${orgId}) for new inbound from +${phone}`);
    } catch (e) {
      console.error('[wa] failed to auto-create vendor for inbound:', e.message);
      return null;
    }
  }

  const now = Date.now();
  db.prepare(`
    INSERT INTO messages (organization_id, vendor_id, direction, body, status, wa_message_id, sent_at, created_at)
    VALUES (?, ?, 'in', ?, 'received', ?, ?, ?)
  `).run(orgId, vendor.id, body, waMessageId, now, now);
  metrics.inc('wa_messages_received_total', { source });
  console.log(`[wa:inbound:${source}] STORED reply for vendor #${vendor.id} (+${phone}): "${body.slice(0, 60)}"`);
  db.prepare(`
    UPDATE vendors
    SET last_replied_at = ?, total_replied = total_replied + 1, status = 'replied', updated_at = ?
    WHERE id = ? AND organization_id = ?
  `).run(now, now, vendor.id, orgId);
  // Cancel pending follow-ups if rule says stop_on_reply (same org only)
  db.prepare(`
    UPDATE followups SET status = 'cancelled'
    WHERE vendor_id = ? AND organization_id = ? AND status = 'pending'
      AND rule_id IN (SELECT id FROM followup_rules WHERE stop_on_reply = 1 AND organization_id = ?)
  `).run(vendor.id, orgId, orgId);

  // Turn every inbound message into a support ticket. One open ticket per
  // conversation: reuse the latest still-open ticket for this customer and just
  // refresh its timestamp, otherwise open a new one. STOP/opt-out messages are
  // handled below and never open a ticket.
  const isStop = STOP_KEYWORDS.test(body);
  if (!isStop) {
    try {
      const vrow = db.prepare('SELECT company_id FROM vendors WHERE id = ? AND organization_id = ?').get(vendor.id, orgId);
      const open = db.prepare(`
        SELECT id FROM tickets
        WHERE requester_id = ? AND organization_id = ? AND source = 'whatsapp' AND status != 'solved'
        ORDER BY created_at DESC LIMIT 1
      `).get(vendor.id, orgId);
      if (open) {
        db.prepare(`UPDATE tickets SET last_message_at = ?, updated_at = ? WHERE id = ? AND organization_id = ?`)
          .run(now, now, open.id, orgId);
      } else {
        const subject = (body.trim().split('\n')[0] || 'WhatsApp message').slice(0, 80);
        const t = db.prepare(`
          INSERT INTO tickets (organization_id, subject, body, company_id, requester_id, priority, status, source, last_message_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'med', 'open', 'whatsapp', ?, ?, ?)
        `).run(orgId, subject, body.slice(0, 2000), vrow?.company_id || null, vendor.id, now, now, now);
        console.log(`[wa:inbound] opened ticket #${t.lastInsertRowid} (org ${orgId}) for vendor #${vendor.id}`);
      }
    } catch (e) { console.error('[wa:inbound] ticket upsert failed:', e.message); }
  }

  // Fire message_received automations (AI draft, auto-tags, etc), scoped to org
  try {
    const fullVendor = db.prepare('SELECT * FROM vendors WHERE id = ? AND organization_id = ?').get(vendor.id, orgId);
    require('./automation').fire('message_received', { vendor: fullVendor, body, orgId });
  } catch (e) { console.error('[automation] message_received fire failed:', e.message); }

  // Best-effort: also auto-draft an AI reply (no-op if ai_auto_draft_inbound = 0 or no API key)
  setImmediate(() => {
    require('./ai-agent').maybeAutoDraftInbound(vendor.id, orgId).catch(() => {});
  });

  // Auto-suppress on STOP / UNSUBSCRIBE / REMOVE keywords (host org only)
  if (isStop) {
    suppressions.addSuppression({
      orgId,
      phone,
      email: vendor.email || null,
      reason: 'opt_out_keyword',
      source: 'whatsapp_inbound',
    });
    db.prepare(`
      UPDATE vendors SET status = 'opted_out', updated_at = ? WHERE id = ? AND organization_id = ?
    `).run(now, vendor.id, orgId);
    db.prepare(`
      UPDATE messages SET status = 'cancelled'
      WHERE vendor_id = ? AND organization_id = ? AND direction = 'out' AND status IN ('queued','scheduled')
    `).run(vendor.id, orgId);
    db.prepare(`
      INSERT INTO audit_log (event, vendor_id, detail) VALUES ('opt_out', ?, ?)
    `).run(vendor.id, `keyword: ${body.slice(0, 80)}`);
    console.log(`[wa] auto-suppressed ${phone} (org ${orgId}, opt-out keyword)`);
  }

  return vendor.id;
}

const SESSION_DIR = path.join(__dirname, '..', '.wwebjs_auth', 'session-whatsapp-crm');

// Kill any orphan Chromium processes that have our session dir in their args.
// Returns the number of procs killed. Used to recover from "browser is already
// running" errors when an old puppeteer Chromium is still holding the userDataDir.
function killOrphanChromium() {
  const { execSync } = require('child_process');
  let killed = 0;
  try {
    const out = execSync(`pgrep -f "${SESSION_DIR.replace(/[/]/g, '\\/')}" 2>/dev/null || true`, { encoding: 'utf8' });
    const pids = out.trim().split('\n').filter(Boolean).map((s) => parseInt(s, 10)).filter((p) => p && p !== process.pid);
    for (const pid of pids) {
      try { process.kill(pid, 'SIGKILL'); killed++; } catch (_) {}
    }
    if (killed) console.log(`[wa] killed ${killed} orphan chromium proc(s)`);
  } catch (_) {}
  return killed;
}

// Remove the Singleton symlinks Chromium leaves behind. Safe to call unconditionally
// once we've already killed any owners via killOrphanChromium.
function clearStaleSingletons() {
  let cleared = 0;
  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try { fs.unlinkSync(path.join(SESSION_DIR, name)); cleared++; } catch (_) {}
  }
  if (cleared) console.log('[wa] cleared chromium singleton files');
}

let initAttempts = 0;
function init() {
  // Cloud/mock providers are stateless — no Chromium, no QR, no session.
  if (WA_PROVIDER !== 'webjs') {
    console.log(`[wa] provider=${WA_PROVIDER} — skipping whatsapp-web.js/Chromium init`);
    return;
  }
  initAttempts++;
  killOrphanChromium();
  clearStaleSingletons();
  console.log(`[wa] init attempt #${initAttempts}`);
  client.initialize().catch((e) => {
    console.error('[wa] init error:', e.message);
    if (/browser is already running/i.test(e.message)) {
      killOrphanChromium();
      clearStaleSingletons();
    }
    if (initAttempts < 10) {
      const delay = Math.min(60_000, 2000 * Math.pow(2, initAttempts - 1));
      console.log(`[wa] retrying in ${delay}ms...`);
      setTimeout(init, delay);
    } else {
      console.error('[wa] giving up after 10 attempts. Restart the server to retry.');
    }
  });
}

function isFrameError(err) {
  const m = (err && err.message) ? err.message : String(err);
  return /detached Frame|Target closed|Session closed|Execution context was destroyed|Protocol error.*Connection closed/i.test(m);
}

let reinitInFlight = false;
async function safeReinit(reason, { wipeSession = false } = {}) {
  if (reinitInFlight) return;
  reinitInFlight = true;
  console.warn('[wa] reinit triggered:', reason, wipeSession ? '(wiping session)' : '');
  state.ready = false;
  state.qr = null;
  state.qrDataUrl = null;
  state.info = null;
  // In-flight sends live in the queue now; the ready handler re-queues 'queued'
  // rows from the DB after reconnect.
  // Grab the Chromium child before destroy() — destroy() detaches it from the client.
  const browserProc = client.pupBrowser?.process?.();
  try {
    // destroy() can hang when the frame is detached. Cap the wait so we always
    // make it to the force-kill below.
    await Promise.race([
      client.destroy(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('destroy timeout')), 10_000)),
    ]);
  } catch (e) {
    console.warn('[wa] destroy error:', e.message);
  }
  // If destroy left the Chromium child alive, kill it ourselves — otherwise it
  // keeps the SingletonLock and the next initialize() fails with
  // "browser is already running".
  if (browserProc && browserProc.pid && !browserProc.killed) {
    try { browserProc.kill('SIGKILL'); } catch (_) {}
  }
  killOrphanChromium();
  clearStaleSingletons();
  if (wipeSession) {
    try {
      fs.rmSync(SESSION_DIR, { recursive: true, force: true });
      console.log('[wa] wiped session dir:', SESSION_DIR);
    } catch (e) {
      console.warn('[wa] failed to wipe session dir:', e.message);
    }
  }
  initAttempts = 0;
  setTimeout(() => {
    reinitInFlight = false;
    init();
  }, 3000);
}

// Watchdog: if `authenticated` fires but `ready` doesn't follow within 90s,
// the session is wedged on a sync/loading screen. Auto-recover once by wiping
// the session so the next init forces a fresh QR scan.
let authWatchdog = null;
client.on('authenticated', () => {
  if (authWatchdog) clearTimeout(authWatchdog);
  authWatchdog = setTimeout(() => {
    if (!state.ready) {
      console.warn('[wa] authenticated but not ready after 90s — wiping session and re-initializing');
      safeReinit('authenticated-but-not-ready watchdog', { wipeSession: true });
    }
  }, 90_000);
});
client.on('ready', () => {
  if (authWatchdog) { clearTimeout(authWatchdog); authWatchdog = null; }
});

function getStatus() {
  const ext = externalProvider();
  const ready = ext ? ext.isReady() : state.ready;
  let queueDepth = 0;
  try {
    const s = jobQueue.stats('wa-send');
    if (s && typeof s.then !== 'function') queueDepth = s.waiting || 0; // sync (memory driver)
  } catch (_) {}
  return {
    provider: WA_PROVIDER,
    ready,
    hasQr: WA_PROVIDER === 'webjs' ? !!state.qrDataUrl : false,
    info: WA_PROVIDER === 'webjs' ? state.info : { provider: WA_PROVIDER },
    queueDepth,
    uptimeMs: Date.now() - state.startedAt,
  };
}

function getQrDataUrl() {
  return state.qrDataUrl;
}

function normalizeForSend(phone) {
  let digits = String(phone || '').replace(/\D/g, '').replace(/^0+/, '');
  if (digits.length === 10) digits = settings.get('default_country_code') + digits;
  return digits;
}

function toJid(phone) {
  return `${normalizeForSend(phone)}@c.us`;
}

function renderTemplate(body, vars = {}) {
  // Pass 1: spintax — {a|b|c} picks one branch at random. Nested braces not supported.
  let out = body;
  let prev;
  do {
    prev = out;
    out = out.replace(/\{([^{}]+)\}/g, (m, inner) => {
      if (!inner.includes('|')) return m;
      const opts = inner.split('|');
      return opts[Math.floor(Math.random() * opts.length)];
    });
  } while (out !== prev);
  // Pass 2: variables with optional fallback `{{var|fallback}}`. Tolerates spaces in name (matches the no-spintax syntax we doubled-brace as `\{\{...\}\}`).
  out = out.replace(/\{\{\s*(\w+)(?:\s*\|\s*([^}]*?))?\s*\}\}/g, (_, k, fallback) => {
    const v = vars[k];
    if (v != null && String(v).length > 0) return String(v);
    return fallback != null ? fallback.trim() : '';
  });
  return out;
}

function isQuietHour(date = new Date()) {
  const h = date.getHours();
  const qs = settings.getInt('quiet_start');
  const qe = settings.getInt('quiet_end');
  if (qs === qe) return false;
  if (qs < qe) return h >= qs && h < qe;
  return h >= qs || h < qe;
}

function nextSendableTime(date = new Date()) {
  const d = new Date(date);
  while (isQuietHour(d)) d.setTime(d.getTime() + 30 * 60 * 1000);
  return d.getTime();
}

function sentTodayCount() {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const row = db.prepare(`
    SELECT COUNT(*) AS c FROM messages
    WHERE direction = 'out' AND sent_at IS NOT NULL AND sent_at >= ?
  `).get(start.getTime());
  return row?.c || 0;
}

function isPermanentError(msg) {
  return /not on WhatsApp|invalid phone format|suppressed|opted out|isRegisteredUser failed/i.test(msg);
}

async function sendOne(jobMessageId) {
  const row = db.prepare(`
    SELECT m.*, v.phone, v.name, v.company, v.email,
           t.media_path AS template_media_path
    FROM messages m
    JOIN vendors v ON v.id = m.vendor_id
    LEFT JOIN campaigns c ON c.id = m.campaign_id
    LEFT JOIN templates t ON t.id = c.template_id
    WHERE m.id = ?
  `).get(jobMessageId);
  if (!row) return;
  if (row.status !== 'queued' && row.status !== 'scheduled') return;

  // Idempotency: claim the row by transitioning queued/scheduled → sending. If the
  // UPDATE matches 0 rows, another worker already grabbed it.
  const claim = db.prepare(`
    UPDATE messages SET status='sending'
    WHERE id = ? AND status IN ('queued','scheduled')
  `).run(jobMessageId);
  if (claim.changes === 0) return;

  // Suppression check (scoped to the message's own org)
  const supp = suppressions.isSuppressed(row.organization_id, { phone: row.phone, email: row.email });
  if (supp) {
    db.prepare(`UPDATE messages SET status='cancelled', error=? WHERE id=?`)
      .run(`suppressed: ${supp.reason}`, jobMessageId);
    db.prepare(`INSERT INTO audit_log (event, vendor_id, message_id, detail) VALUES ('blocked_suppressed', ?, ?, ?)`)
      .run(row.vendor_id, jobMessageId, supp.reason);
    return;
  }

  const body = renderTemplate(row.body, {
    name: row.name,
    company: row.company || '',
    email: row.email || '',
  });

  try {
    const normalized = normalizeForSend(row.phone);
    if (normalized.length < 11 || normalized.length > 15) {
      throw new Error(`invalid phone format: "${row.phone}" → "${normalized}" (expected 11-15 digits with country code)`);
    }
    const mediaPath = row.media_path || row.template_media_path;

    // Wire-send is delegated to the active provider. webjs keeps its exact prior
    // behavior (registration check + Chromium client); cloud/mock are HTTPS / no-op.
    let providerMessageId;
    const ext = externalProvider();
    if (ext) {
      if (!ext.isReady()) throw new Error(`${WA_PROVIDER}_provider_not_ready`);
      const result = await ext.sendText({ to: normalized, body, mediaPath: mediaPath && fs.existsSync(mediaPath) ? mediaPath : null });
      providerMessageId = result.providerMessageId;
    } else {
      // webjs
      if (!state.ready) throw new Error('whatsapp client not ready');
      const jid = `${normalized}@c.us`;
      const isReg = await client.isRegisteredUser(jid).catch((e) => {
        throw new Error('isRegisteredUser failed: ' + (e?.message || String(e)));
      });
      if (!isReg) throw new Error(`number ${normalized} is not on WhatsApp`);
      let sent;
      if (mediaPath && fs.existsSync(mediaPath)) {
        const media = MessageMedia.fromFilePath(mediaPath);
        sent = await client.sendMessage(jid, media, { caption: body });
      } else {
        sent = await client.sendMessage(jid, body);
      }
      providerMessageId = sent.id?._serialized;
    }

    const now = Date.now();
    db.prepare(`
      UPDATE messages SET status='sent', wa_message_id=?, sent_at=?, body=?, error=NULL, next_attempt_at=NULL WHERE id=?
    `).run(providerMessageId, now, body, jobMessageId);
    db.prepare(`
      UPDATE vendors SET last_contacted_at=?, total_sent = total_sent + 1, updated_at=?,
        status = CASE WHEN status IN ('new') THEN 'contacted' ELSE status END
      WHERE id=? AND organization_id=?
    `).run(now, now, row.vendor_id, row.organization_id);
    if (row.campaign_id) {
      db.prepare('UPDATE campaigns SET sent_count = sent_count + 1 WHERE id = ? AND organization_id = ?').run(row.campaign_id, row.organization_id);
    }
    metrics.inc('wa_messages_sent_total', { provider: WA_PROVIDER });
  } catch (e) {
    const errMsg = (e && e.message) ? String(e.message) : String(e);
    metrics.inc('wa_messages_failed_total', { provider: WA_PROVIDER });
    console.error(`[wa] send failed (msg #${jobMessageId} → ${row.phone}):`, errMsg);
    // webjs Chromium frame death: bounce back to queued and reinit the client.
    if (WA_PROVIDER === 'webjs' && isFrameError(e)) {
      db.prepare(`UPDATE messages SET status='queued', error=NULL WHERE id=?`).run(jobMessageId);
      safeReinit(`detached frame on msg #${jobMessageId}`);
      return;
    }
    // Retry policy (both providers): transient failures get exponential backoff up
    // to MAX_SEND_ATTEMPTS via next_attempt_at (scheduler requeues failed→queued);
    // permanent failures (bad number, opted out, permanent Cloud error) are terminal.
    const attempts = (row.attempts || 0) + 1;
    const permanent = isPermanentError(errMsg) || e.permanent === true;
    const willRetry = !permanent && attempts < MAX_SEND_ATTEMPTS;
    const backoff = Math.min(60 * 60 * 1000, 60_000 * Math.pow(2, attempts - 1));
    db.prepare('UPDATE messages SET status=?, attempts=?, error=?, next_attempt_at=? WHERE id=?')
      .run('failed', attempts, errMsg.slice(0, 500), willRetry ? Date.now() + backoff : null, jobMessageId);
    if (row.campaign_id && !willRetry) {
      db.prepare('UPDATE campaigns SET failed_count = failed_count + 1 WHERE id = ? AND organization_id = ?').run(row.campaign_id, row.organization_id);
    }
  }
}

// Shared status-update applied from webhooks (Cloud API delivery/read/failed) and
// the webjs message_ack handler. Advances a message forward through sent →
// delivered → read (never backward) and marks hard failures.
function applyStatusUpdate(waMessageId, status, tsMs = Date.now()) {
  if (!waMessageId || !status) return;
  if (status === 'failed') {
    db.prepare(`UPDATE messages SET status='failed', error=COALESCE(error,'delivery_failed')
      WHERE wa_message_id=? AND status NOT IN ('read','delivered')`).run(waMessageId);
    return;
  }
  const rank = { sent: 1, delivered: 2, read: 3 }[status];
  if (!rank) return;
  db.prepare(`
    UPDATE messages
    SET delivered_at = COALESCE(delivered_at, CASE WHEN ? >= 2 THEN ? ELSE NULL END),
        read_at = COALESCE(read_at, CASE WHEN ? >= 3 THEN ? ELSE NULL END),
        status = CASE WHEN ? >= 3 THEN 'read' WHEN ? >= 2 THEN 'delivered'
                      WHEN status IN ('sending','queued') THEN 'sent' ELSE status END
    WHERE wa_message_id = ?
  `).run(rank, tsMs, rank, tsMs, rank, rank, waMessageId);
}

// Anti-ban pacing: the delay applied AFTER each send before the next one starts.
function sendPaceMs() {
  const min = settings.getInt('wa_min_delay_ms');
  const max = settings.getInt('wa_max_delay_ms');
  return min + Math.random() * Math.max(0, max - min);
}

// The outbound send worker. Registered once against the queue abstraction:
// concurrency 1 (serialize sends on the single line) + per-send pacing. In the
// memory driver this runs in-process (original behavior); in the redis driver it
// runs in worker.js processes for horizontal scaling — same handler either way.
let workerRegistered = false;
function registerSendWorker() {
  if (workerRegistered) return;
  workerRegistered = true;
  jobQueue.registerWorker('wa-send', async ({ id }) => { await sendOne(id); },
    { concurrency: 1, paceMs: sendPaceMs });
}
registerSendWorker();

// priority=true puts the message at the FRONT of the send queue so a live 1:1
// reply goes out ahead of any queued bulk-campaign messages. Used for inbox
// replies. Fire-and-forget: the worker (in-process or remote) does the send.
function enqueueMessage(messageId, { priority = false } = {}) {
  jobQueue.add('wa-send', { id: messageId }, { priority });
}

async function importContacts({ onlySaved = true } = {}) {
  if (!state.ready) throw new Error('whatsapp_not_ready');
  const orgId = waHostOrgId();
  const all = await client.getContacts();
  // Upsert into the host org, keyed by the per-org unique (organization_id, phone).
  const upsert = db.prepare(`
    INSERT INTO vendors (organization_id, name, phone, status, created_at, updated_at)
    VALUES (?, ?, ?, 'new', ?, ?)
    ON CONFLICT(organization_id, phone) DO UPDATE SET
      name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE vendors.name END,
      updated_at = excluded.updated_at
  `);
  let inserted = 0, skipped = 0, updated = 0;
  const tx = db.transaction((rows) => {
    for (const c of rows) {
      if (!c || !c.id || !c.id.user) { skipped++; continue; }
      // Filter: skip groups, broadcast lists, status, business catalogs
      if (c.id.server !== 'c.us') { skipped++; continue; }
      if (c.isGroup || c.isBusiness === undefined && c.isMe) { skipped++; continue; }
      if (c.isMe) { skipped++; continue; }
      if (onlySaved && !c.isMyContact) { skipped++; continue; }
      const phone = String(c.id.user).replace(/\D/g, '');
      if (!phone || phone.length < 10) { skipped++; continue; }
      const name = c.name || c.pushname || c.shortName || c.verifiedName || `+${phone}`;
      const existing = db.prepare('SELECT id FROM vendors WHERE phone = ? AND organization_id = ?').get(phone, orgId);
      const now = Date.now();
      upsert.run(orgId, name, phone, now, now);
      if (existing) updated++; else inserted++;
    }
  });
  tx(all);
  // Fire-and-forget enrichment in the background so profile pics + About text
  // populate automatically without making the import call wait.
  setImmediate(() => {
    enrichContacts({ limit: 5000, onlyMissing: true, delayMs: 200 })
      .then((r) => console.log('[wa] auto-enrich after import:', r))
      .catch((e) => console.error('[wa] auto-enrich failed:', e.message));
  });
  return { total: all.length, inserted, updated, skipped, enrichmentStarted: true };
}

const AVATAR_DIR = path.join(__dirname, '..', 'data', 'avatars');
if (!fs.existsSync(AVATAR_DIR)) fs.mkdirSync(AVATAR_DIR, { recursive: true });

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const { safeFetch } = require('./ssrf');

async function downloadAvatar(url, vendorId) {
  if (!url || !/^https?:\/\//.test(url)) return null;
  try {
    const r = await safeFetch(url);
    if (!r || !r.ok) return null;
    const len = Number(r.headers.get('content-length'));
    if (Number.isFinite(len) && len > MAX_AVATAR_BYTES) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 200 || buf.length > MAX_AVATAR_BYTES) return null; // too small (error blob) or too large
    const fpath = path.join(AVATAR_DIR, `${vendorId}.jpg`);
    fs.writeFileSync(fpath, buf);
    return `/avatars/${vendorId}.jpg`;
  } catch (_) {
    return null;
  }
}

async function cacheRemoteAvatars({ limit = 5000 } = {}) {
  const orgId = waHostOrgId();
  const rows = db.prepare(`
    SELECT id, profile_pic_url FROM vendors
    WHERE profile_pic_url LIKE 'http%' AND organization_id = ? LIMIT ?
  `).all(orgId, limit);
  const upd = db.prepare(`UPDATE vendors SET profile_pic_url = ?, updated_at = ? WHERE id = ? AND organization_id = ?`);
  let cached = 0, failed = 0;
  for (const r of rows) {
    const local = await downloadAvatar(r.profile_pic_url, r.id);
    if (local) {
      upd.run(local, Date.now(), r.id, orgId);
      cached++;
    } else {
      failed++;
    }
  }
  return { processed: rows.length, cached, failed };
}

async function enrichContacts({ limit = 1000, onlyMissing = true, delayMs = 250 } = {}) {
  if (!state.ready) throw new Error('whatsapp_not_ready');
  const orgId = waHostOrgId();
  const where = onlyMissing
    ? 'WHERE organization_id = @orgId AND enriched_at IS NULL'
    : 'WHERE organization_id = @orgId';
  const targets = db.prepare(`SELECT id, phone FROM vendors ${where} ORDER BY id ASC LIMIT @limit`).all({ orgId, limit });
  const upd = db.prepare(`
    UPDATE vendors
    SET profile_pic_url = ?, about_text = ?, is_business = ?, enriched_at = ?, updated_at = ?
    WHERE id = ? AND organization_id = ?
  `);
  let enriched = 0, withPic = 0, withAbout = 0, errors = 0;
  for (const t of targets) {
    const jid = `${t.phone}@c.us`;
    try {
      const contact = await client.getContactById(jid).catch(() => null);
      const remotePicUrl = contact ? await contact.getProfilePicUrl().catch(() => null) : null;
      const localPath = remotePicUrl ? await downloadAvatar(remotePicUrl, t.id) : null;
      const aboutObj = contact ? await contact.getAbout().catch(() => null) : null;
      const aboutText = aboutObj && typeof aboutObj === 'object' ? (aboutObj.status || aboutObj.about || null) : aboutObj;
      const isBiz = contact && (contact.isBusiness || contact.isEnterprise) ? 1 : 0;
      const now = Date.now();
      upd.run(localPath || remotePicUrl || null, aboutText || null, isBiz, now, now, t.id, orgId);
      if (localPath || remotePicUrl) withPic++;
      if (aboutText) withAbout++;
      enriched++;
    } catch (e) {
      errors++;
    }
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  }
  return { processed: targets.length, enriched, withPic, withAbout, errors };
}

// Clean teardown for graceful shutdown: destroy the WhatsApp client so the
// headless Chromium child exits instead of being orphaned (and leaving the
// session singleton lock behind for the next boot to clean up).
async function shutdown() {
  if (WA_PROVIDER !== 'webjs') return; // nothing to tear down for cloud/mock
  try { if (client) await client.destroy(); } catch (_) {}
}

module.exports = {
  init,
  client,
  getStatus,
  getQrDataUrl,
  safeReinit,
  enqueueMessage,
  ingestInbound,
  applyStatusUpdate,
  providerKey,
  renderTemplate,
  importContacts,
  enrichContacts,
  cacheRemoteAvatars,
  shutdown,
};
