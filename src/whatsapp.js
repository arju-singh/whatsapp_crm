const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const settings = require('./settings');
const suppressions = require('./routes/suppressions');

const state = {
  ready: false,
  qr: null,
  qrDataUrl: null,
  info: null,
  startedAt: Date.now(),
};

const queue = [];
let processing = false;

const STOP_KEYWORDS = /^\s*(stop|unsubscribe|remove|opt[\s-]?out|do not (contact|message)|leave me alone)\b/i;

const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'whatsapp-crm' }),
  puppeteer: {
    headless: true,
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
      for (const r of rows) queue.push(r.id);
      setImmediate(processQueue);
    }
  } catch (e) {
    console.error('[wa] requeue error', e.message);
  }
});

client.on('authenticated', () => console.log('[wa] authenticated'));
client.on('auth_failure', (m) => console.error('[wa] auth failure', m));
client.on('disconnected', (reason) => {
  state.ready = false;
  console.warn('[wa] disconnected', reason);
});

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

  // Try to find an existing vendor; if none, auto-create one so the inbound
  // message is never silently dropped. New leads land in the Inbox immediately.
  let vendor = db.prepare('SELECT id, email FROM vendors WHERE phone = ?').get(phone);
  if (!vendor) {
    try {
      // Try to use the sender's WhatsApp profile name; fall back to a placeholder.
      let pushname = null;
      try { const c = await msg.getContact(); pushname = c?.pushname || c?.name || null; } catch (_) {}
      const displayName = pushname || `WhatsApp +${phone}`;
      const r = db.prepare(`
        INSERT INTO vendors (name, phone, status, total_replied, last_replied_at, created_at, updated_at)
        VALUES (?, ?, 'replied', 0, NULL, ?, ?)
      `).run(displayName, phone, Date.now(), Date.now());
      vendor = { id: r.lastInsertRowid, email: null };
      console.log(`[wa] auto-created vendor #${vendor.id} for new inbound from +${phone}`);
    } catch (e) {
      console.error('[wa] failed to auto-create vendor for inbound:', e.message);
      return;
    }
  }

  const now = Date.now();
  const body = msg.body || '';
  db.prepare(`
    INSERT INTO messages (vendor_id, direction, body, status, wa_message_id, sent_at, created_at)
    VALUES (?, 'in', ?, 'received', ?, ?, ?)
  `).run(vendor.id, body, msg.id?._serialized, now, now);
  console.log(`[wa:inbound] STORED reply for vendor #${vendor.id} (+${phone}): "${body.slice(0, 60)}"`);
  db.prepare(`
    UPDATE vendors
    SET last_replied_at = ?, total_replied = total_replied + 1, status = 'replied', updated_at = ?
    WHERE id = ?
  `).run(now, now, vendor.id);
  // Cancel pending follow-ups if rule says stop_on_reply
  db.prepare(`
    UPDATE followups SET status = 'cancelled'
    WHERE vendor_id = ? AND status = 'pending'
      AND rule_id IN (SELECT id FROM followup_rules WHERE stop_on_reply = 1)
  `).run(vendor.id);

  // Fire message_received automations (AI draft, auto-tags, etc)
  try {
    const fullVendor = db.prepare('SELECT * FROM vendors WHERE id = ?').get(vendor.id);
    require('./automation').fire('message_received', { vendor: fullVendor, body });
  } catch (e) { console.error('[automation] message_received fire failed:', e.message); }

  // Best-effort: also auto-draft an AI reply (no-op if ai_auto_draft_inbound = 0 or no API key)
  setImmediate(() => {
    require('./ai-agent').maybeAutoDraftInbound(vendor.id).catch(() => {});
  });

  // Auto-suppress on STOP / UNSUBSCRIBE / REMOVE keywords
  if (STOP_KEYWORDS.test(body)) {
    suppressions.addSuppression({
      phone,
      email: vendor.email || null,
      reason: 'opt_out_keyword',
      source: 'whatsapp_inbound',
    });
    db.prepare(`
      UPDATE vendors SET status = 'opted_out', updated_at = ? WHERE id = ?
    `).run(now, vendor.id);
    db.prepare(`
      UPDATE messages SET status = 'cancelled'
      WHERE vendor_id = ? AND direction = 'out' AND status IN ('queued','scheduled')
    `).run(vendor.id);
    db.prepare(`
      INSERT INTO audit_log (event, vendor_id, detail) VALUES ('opt_out', ?, ?)
    `).run(vendor.id, `keyword: ${body.slice(0, 80)}`);
    console.log(`[wa] auto-suppressed ${phone} (opt-out keyword)`);
  }
});

const SESSION_DIR = path.join(__dirname, '..', '.wwebjs_auth', 'session-whatsapp-crm');

// Chromium leaves Singleton{Lock,Cookie,Socket} symlinks in the userDataDir if
// it crashes or is killed mid-flight. The Lock target ends in `-<pid>`; if that
// PID is gone, the lock is stale and blocks the next launch with
// "browser is already running". Removing them lets init() re-claim the dir.
function clearStaleSingletons() {
  try {
    const target = fs.readlinkSync(path.join(SESSION_DIR, 'SingletonLock'));
    const pid = parseInt(target.split('-').pop(), 10);
    if (Number.isFinite(pid)) {
      try { process.kill(pid, 0); return; } catch (_) {}
    }
  } catch (_) { return; }
  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try { fs.unlinkSync(path.join(SESSION_DIR, name)); } catch (_) {}
  }
  console.log('[wa] cleared stale Chromium singleton lock');
}

let initAttempts = 0;
function init() {
  initAttempts++;
  clearStaleSingletons();
  console.log(`[wa] init attempt #${initAttempts}`);
  client.initialize().catch((e) => {
    console.error('[wa] init error:', e.message);
    if (/browser is already running/i.test(e.message)) clearStaleSingletons();
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
async function safeReinit(reason) {
  if (reinitInFlight) return;
  reinitInFlight = true;
  console.warn('[wa] reinit triggered:', reason);
  state.ready = false;
  queue.length = 0; // ready handler will re-queue 'queued' rows from DB
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
  clearStaleSingletons();
  initAttempts = 0;
  setTimeout(() => {
    reinitInFlight = false;
    init();
  }, 3000);
}

function getStatus() {
  return {
    ready: state.ready,
    hasQr: !!state.qrDataUrl,
    info: state.info,
    queueDepth: queue.length,
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

  // Suppression check
  const supp = suppressions.isSuppressed({ phone: row.phone, email: row.email });
  if (supp) {
    db.prepare(`UPDATE messages SET status='cancelled', error=? WHERE id=?`)
      .run(`suppressed: ${supp.reason}`, jobMessageId);
    db.prepare(`INSERT INTO audit_log (event, vendor_id, message_id, detail) VALUES ('blocked_suppressed', ?, ?, ?)`)
      .run(row.vendor_id, jobMessageId, supp.reason);
    return;
  }

  // Daily cap — push 30 min ahead and let scheduler retry
  if (sentTodayCount() >= settings.getInt('wa_daily_cap')) {
    const next = Date.now() + 30 * 60 * 1000;
    db.prepare(`UPDATE messages SET status='scheduled', scheduled_at=?, next_attempt_at=? WHERE id=?`)
      .run(next, next, jobMessageId);
    return;
  }

  const body = renderTemplate(row.body, {
    name: row.name,
    company: row.company || '',
    email: row.email || '',
  });

  try {
    if (!state.ready) throw new Error('whatsapp client not ready');
    const normalized = normalizeForSend(row.phone);
    if (normalized.length < 11 || normalized.length > 15) {
      throw new Error(`invalid phone format: "${row.phone}" → "${normalized}" (expected 11-15 digits with country code)`);
    }
    const jid = `${normalized}@c.us`;
    const isReg = await client.isRegisteredUser(jid).catch((e) => {
      throw new Error('isRegisteredUser failed: ' + (e?.message || String(e)));
    });
    if (!isReg) throw new Error(`number ${normalized} is not on WhatsApp`);

    const mediaPath = row.media_path || row.template_media_path;
    let sent;
    if (mediaPath && fs.existsSync(mediaPath)) {
      const media = MessageMedia.fromFilePath(mediaPath);
      sent = await client.sendMessage(jid, media, { caption: body });
    } else {
      sent = await client.sendMessage(jid, body);
    }
    const now = Date.now();
    db.prepare(`
      UPDATE messages SET status='sent', wa_message_id=?, sent_at=?, body=?, error=NULL WHERE id=?
    `).run(sent.id?._serialized, now, body, jobMessageId);
    db.prepare(`
      UPDATE vendors SET last_contacted_at=?, total_sent = total_sent + 1, updated_at=?,
        status = CASE WHEN status IN ('new') THEN 'contacted' ELSE status END
      WHERE id=?
    `).run(now, now, row.vendor_id);
    if (row.campaign_id) {
      db.prepare('UPDATE campaigns SET sent_count = sent_count + 1 WHERE id = ?').run(row.campaign_id);
    }
  } catch (e) {
    const errMsg = (e && e.message) ? String(e.message) : String(e);
    console.error(`[wa] send failed (msg #${jobMessageId} → ${row.phone}):`, errMsg);
    if (isFrameError(e)) {
      db.prepare(`UPDATE messages SET status='queued', error=NULL WHERE id=?`).run(jobMessageId);
      safeReinit(`detached frame on msg #${jobMessageId}`);
      return;
    }
    const attempts = (row.attempts || 0) + 1;
    if (!isPermanentError(errMsg) && attempts < settings.getInt('wa_max_attempts')) {
      const backoff = Math.min(60 * 60 * 1000, 60 * 1000 * Math.pow(2, attempts));
      const next = Date.now() + backoff;
      db.prepare(`
        UPDATE messages SET status='scheduled', attempts=?, error=?, scheduled_at=?, next_attempt_at=? WHERE id=?
      `).run(attempts, errMsg.slice(0, 500), next, next, jobMessageId);
      return;
    }
    db.prepare('UPDATE messages SET status=?, attempts=?, error=? WHERE id=?')
      .run('failed', attempts, errMsg.slice(0, 500), jobMessageId);
    if (row.campaign_id) {
      db.prepare('UPDATE campaigns SET failed_count = failed_count + 1 WHERE id = ?').run(row.campaign_id);
    }
  }
}

async function processQueue() {
  if (processing) return;
  processing = true;
  while (queue.length) {
    const id = queue.shift();
    await sendOne(id);
    const min = settings.getInt('wa_min_delay_ms');
    const max = settings.getInt('wa_max_delay_ms');
    const wait = min + Math.random() * Math.max(0, max - min);
    await new Promise((r) => setTimeout(r, wait));
  }
  processing = false;
}

function enqueueMessage(messageId) {
  queue.push(messageId);
  setImmediate(processQueue);
}

async function importContacts({ onlySaved = true } = {}) {
  if (!state.ready) throw new Error('whatsapp_not_ready');
  const all = await client.getContacts();
  const upsert = db.prepare(`
    INSERT INTO vendors (name, phone, status, created_at, updated_at)
    VALUES (?, ?, 'new', ?, ?)
    ON CONFLICT(phone) DO UPDATE SET
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
      const existing = db.prepare('SELECT id FROM vendors WHERE phone = ?').get(phone);
      const now = Date.now();
      upsert.run(name, phone, now, now);
      if (existing) updated++; else inserted++;
    }
  });
  tx(all);
  return { total: all.length, inserted, updated, skipped };
}

const AVATAR_DIR = path.join(__dirname, '..', 'data', 'avatars');
if (!fs.existsSync(AVATAR_DIR)) fs.mkdirSync(AVATAR_DIR, { recursive: true });

async function downloadAvatar(url, vendorId) {
  if (!url || !/^https?:\/\//.test(url)) return null;
  try {
    const r = await fetch(url, { redirect: 'follow' });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 200) return null; // suspicious — probably error blob
    const fpath = path.join(AVATAR_DIR, `${vendorId}.jpg`);
    fs.writeFileSync(fpath, buf);
    return `/avatars/${vendorId}.jpg`;
  } catch (_) {
    return null;
  }
}

async function cacheRemoteAvatars({ limit = 5000 } = {}) {
  const rows = db.prepare(`
    SELECT id, profile_pic_url FROM vendors
    WHERE profile_pic_url LIKE 'http%' LIMIT ?
  `).all(limit);
  const upd = db.prepare(`UPDATE vendors SET profile_pic_url = ?, updated_at = ? WHERE id = ?`);
  let cached = 0, failed = 0;
  for (const r of rows) {
    const local = await downloadAvatar(r.profile_pic_url, r.id);
    if (local) {
      upd.run(local, Date.now(), r.id);
      cached++;
    } else {
      failed++;
    }
  }
  return { processed: rows.length, cached, failed };
}

async function enrichContacts({ limit = 1000, onlyMissing = true, delayMs = 250 } = {}) {
  if (!state.ready) throw new Error('whatsapp_not_ready');
  const where = onlyMissing ? 'WHERE enriched_at IS NULL' : '';
  const targets = db.prepare(`SELECT id, phone FROM vendors ${where} ORDER BY id ASC LIMIT ?`).all(limit);
  const upd = db.prepare(`
    UPDATE vendors
    SET profile_pic_url = ?, about_text = ?, is_business = ?, enriched_at = ?, updated_at = ?
    WHERE id = ?
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
      upd.run(localPath || remotePicUrl || null, aboutText || null, isBiz, now, now, t.id);
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

module.exports = {
  init,
  client,
  getStatus,
  getQrDataUrl,
  enqueueMessage,
  renderTemplate,
  importContacts,
  enrichContacts,
  cacheRemoteAvatars,
};
