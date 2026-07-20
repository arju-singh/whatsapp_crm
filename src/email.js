const crypto = require('crypto');
const db = require('./db');
const settings = require('./settings');
const suppressions = require('./routes/suppressions');

// --- Open-tracking token ---------------------------------------------------
// The open-tracking pixel used to embed the raw sequential email id, so anyone
// could enumerate /api/email/track/1.gif..N.gif and tamper with ANY tenant's
// open counts (a cross-tenant integrity write, since the pixel is unauthenticated).
// We now sign the id with a per-instance secret: the pixel URL carries `<id>.<sig>`
// and the route only records an open when the signature verifies. Unforgeable, so
// ids can't be enumerated; no DB/schema change required.
function trackSecret() {
  let s = settings.get('email_track_secret');
  if (!s) { s = crypto.randomBytes(32).toString('hex'); settings.set('email_track_secret', s); }
  return s;
}
function emailTrackToken(id) {
  const sig = crypto.createHmac('sha256', trackSecret()).update(String(id)).digest('hex').slice(0, 20);
  return `${id}.${sig}`;
}
// Returns the numeric email id if the token's signature is valid, else null.
function verifyEmailTrackToken(token) {
  const m = /^(\d+)\.([a-f0-9]{20})$/.exec(String(token || ''));
  if (!m) return null;
  const id = Number(m[1]);
  const expect = crypto.createHmac('sha256', trackSecret()).update(String(id)).digest('hex').slice(0, 20);
  const a = Buffer.from(m[2]);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return id;
}

let nodemailer;
try { nodemailer = require('nodemailer'); }
catch (_) { /* installed lazily; checked at send time */ }

const FROM = process.env.SMTP_FROM || process.env.SMTP_USER || '';
const HOST = process.env.SMTP_HOST || '';
const PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const USER = process.env.SMTP_USER || '';
const PASS = process.env.SMTP_PASS || '';
const SECURE = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || PORT === 465;
const PUBLIC_BASE = process.env.PUBLIC_BASE_URL || ''; // e.g. https://crm.example.com

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  if (!nodemailer) throw new Error('nodemailer not installed — run: npm i nodemailer');
  if (!HOST || !FROM) throw new Error('SMTP not configured (set SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM)');
  transporter = nodemailer.createTransport({
    host: HOST, port: PORT, secure: SECURE,
    auth: USER ? { user: USER, pass: PASS } : undefined,
  });
  return transporter;
}

function isConfigured() {
  return !!(nodemailer && HOST && FROM);
}

function renderTemplate(s, vars) {
  // Mirror the WhatsApp renderTemplate logic but inline so email.js doesn't depend on whatsapp.js.
  let out = String(s || '');
  let prev;
  do {
    prev = out;
    out = out.replace(/\{([^{}]+)\}/g, (m, inner) => {
      if (!inner.includes('|')) return m;
      const opts = inner.split('|');
      return opts[Math.floor(Math.random() * opts.length)];
    });
  } while (out !== prev);
  out = out.replace(/\{\{\s*(\w+)(?:\s*\|\s*([^}]*?))?\s*\}\}/g, (_, k, fb) => {
    const v = vars[k];
    if (v != null && String(v).length > 0) return String(v);
    return fb != null ? fb.trim() : '';
  });
  return out;
}

function instrumentHtml(html, emailId, toEmail) {
  const trackingPixel = PUBLIC_BASE
    ? `<img src="${PUBLIC_BASE}/api/email/track/${emailTrackToken(emailId)}.gif" width="1" height="1" alt="" style="display:none"/>`
    : '';
  const unsubUrl = PUBLIC_BASE
    ? `${PUBLIC_BASE}/unsubscribe?e=${encodeURIComponent(toEmail)}`
    : 'mailto:' + (FROM || 'noreply@example.com') + '?subject=unsubscribe';
  const footer = `
    <hr style="border:none;border-top:1px solid #ddd;margin:24px 0 12px"/>
    <p style="font:12px/1.5 system-ui,Arial,sans-serif;color:#888">
      Don't want these emails?
      <a href="${unsubUrl}" style="color:#888">Unsubscribe</a>
    </p>
    ${trackingPixel}
  `;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, footer + '</body>');
  return html + footer;
}

function sentTodayCount() {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const row = db.prepare(`
    SELECT COUNT(*) AS c FROM emails WHERE sent_at IS NOT NULL AND sent_at >= ?
  `).get(start.getTime());
  return row?.c || 0;
}

async function sendOne(emailId) {
  const row = db.prepare(`
    SELECT e.*, v.name, v.company, v.email AS vendor_email
    FROM emails e LEFT JOIN vendors v ON v.id = e.vendor_id
    WHERE e.id = ?
  `).get(emailId);
  if (!row) return;
  if (row.status !== 'queued' && row.status !== 'scheduled') return;

  const claim = db.prepare(`
    UPDATE emails SET status='sending' WHERE id = ? AND status IN ('queued','scheduled')
  `).run(emailId);
  if (claim.changes === 0) return;

  if (suppressions.isSuppressed(row.organization_id, { email: row.to_email })) {
    db.prepare(`UPDATE emails SET status='cancelled', error='suppressed' WHERE id=?`).run(emailId);
    db.prepare(`INSERT INTO audit_log (event, vendor_id, email_id, detail) VALUES ('blocked_suppressed', ?, ?, 'email')`)
      .run(row.vendor_id || null, emailId);
    return;
  }

  if (sentTodayCount() >= settings.getInt('email_daily_cap')) {
    const next = Date.now() + 30 * 60 * 1000;
    db.prepare(`UPDATE emails SET status='scheduled', scheduled_at=?, next_attempt_at=? WHERE id=?`)
      .run(next, next, emailId);
    return;
  }

  const vars = { name: row.name || '', company: row.company || '', email: row.vendor_email || row.to_email };
  const subject = renderTemplate(row.subject || '', vars);
  const text = row.body_text ? renderTemplate(row.body_text, vars) : undefined;
  const html = row.body_html ? instrumentHtml(renderTemplate(row.body_html, vars), emailId, row.to_email) : undefined;

  try {
    const tx = getTransporter();
    const info = await tx.sendMail({
      from: FROM, to: row.to_email, subject, text, html,
      headers: PUBLIC_BASE ? {
        'List-Unsubscribe': `<${PUBLIC_BASE}/unsubscribe?e=${encodeURIComponent(row.to_email)}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      } : undefined,
    });
    const now = Date.now();
    db.prepare(`
      UPDATE emails SET status='sent', message_id=?, sent_at=?, body_html=?, body_text=?, subject=?, error=NULL WHERE id=?
    `).run(info.messageId || null, now, html || null, text || null, subject, emailId);
    if (row.vendor_id) {
      db.prepare(`UPDATE vendors SET last_contacted_at=?, updated_at=? WHERE id=?`).run(now, now, row.vendor_id);
    }
  } catch (e) {
    const errMsg = (e && e.message) ? String(e.message) : String(e);
    console.error(`[email] send failed (#${emailId} → ${row.to_email}):`, errMsg);
    const attempts = (row.attempts || 0) + 1;
    const permanent = /no recipients|invalid address|550|5\.\d\.\d/i.test(errMsg);
    if (!permanent && attempts < settings.getInt('email_max_attempts')) {
      const backoff = Math.min(60 * 60 * 1000, 60 * 1000 * Math.pow(2, attempts));
      const next = Date.now() + backoff;
      db.prepare(`
        UPDATE emails SET status='scheduled', attempts=?, error=?, scheduled_at=?, next_attempt_at=? WHERE id=?
      `).run(attempts, errMsg.slice(0, 500), next, next, emailId);
    } else {
      db.prepare(`UPDATE emails SET status='failed', attempts=?, error=? WHERE id=?`)
        .run(attempts, errMsg.slice(0, 500), emailId);
    }
  }
}

let processing = false;
async function processQueue() {
  if (processing) return;
  processing = true;
  try {
    const now = Date.now();
    const due = db.prepare(`
      SELECT id FROM emails
      WHERE status = 'queued' OR (status = 'scheduled' AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
      ORDER BY created_at ASC LIMIT 50
    `).all(now);
    for (const r of due) {
      // Re-claim from scheduled if needed (sendOne also claims, but moving to queued is fine)
      db.prepare(`UPDATE emails SET status='queued' WHERE id=? AND status='scheduled'`).run(r.id);
      await sendOne(r.id);
    }
  } finally {
    processing = false;
  }
}

function enqueue(emailId) {
  setImmediate(() => sendOne(emailId).catch((e) => console.error('[email] sendOne error', e)));
}

// Direct transactional send — for verification, password-reset, and support
// emails. Bypasses the campaign `emails` table, suppressions, and daily caps
// (these are operational, not marketing). Returns {ok} or throws if SMTP is
// unconfigured so callers can degrade gracefully.
async function sendRaw({ to, subject, html, text, replyTo }) {
  if (!to) throw new Error('recipient required');
  const tx = getTransporter();
  const info = await tx.sendMail({ from: FROM, to, subject, html, text, replyTo });
  return { ok: true, messageId: info.messageId || null };
}

module.exports = { sendOne, processQueue, enqueue, isConfigured, renderTemplate, sendRaw, PUBLIC_BASE, emailTrackToken, verifyEmailTrackToken };
