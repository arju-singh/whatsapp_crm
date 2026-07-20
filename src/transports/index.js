// ---------------------------------------------------------------------------
// Messaging transport layer.
//
// The CRM should never call a specific channel directly. Instead it hands an
// already-persisted outbound row to this layer, which routes it to the right
// transport (WhatsApp today, Email today, Twilio/SMS/Telegram tomorrow). Adding
// a channel = adding a transport here; no business code changes.
//
//   const transports = require('./transports');
//   transports.sendMessage('whatsapp', messageRowId);   // instead of wa.enqueueMessage(id)
//   transports.sendMessage('email', emailRowId);         // instead of email.enqueue(id)
//
// This is the seam the platform's "Messaging" core module is built around. It is
// intentionally additive: existing routes keep working; they migrate to
// sendMessage() one at a time. A transport is gated by its feature module being
// enabled for the org (whatsapp/email modules) — enforce that at the call site
// with requireModule, the same as any other module-owned capability.
// ---------------------------------------------------------------------------

// Lazy requires: whatsapp.js boots Puppeteer and email.js reads SMTP env, so we
// defer loading until a transport is actually used (and to avoid cycles).
const TRANSPORTS = {
  whatsapp: {
    key: 'whatsapp',
    module: 'whatsapp',
    label: 'WhatsApp',
    isReady() {
      try { return !!require('../whatsapp').getStatus().ready; } catch (_) { return false; }
    },
    deliver(rowId, opts = {}) {
      return require('../whatsapp').enqueueMessage(rowId, opts);
    },
  },
  email: {
    key: 'email',
    module: 'email',
    label: 'Email',
    isReady() {
      try { return !!require('../email').isConfigured(); } catch (_) { return false; }
    },
    deliver(rowId) {
      return require('../email').enqueue(rowId);
    },
  },
};

function get(channel) {
  const t = TRANSPORTS[channel];
  if (!t) throw new Error(`unknown_transport: ${channel}`);
  return t;
}

/**
 * Route a persisted outbound row to its channel for delivery.
 * @param {'whatsapp'|'email'} channel target transport
 * @param {number} rowId id in that channel's table (messages for whatsapp, emails for email)
 * @param {{priority?: boolean}} [opts] delivery hints (e.g. jump the send queue)
 * @returns {*} the transport's deliver() result
 */
function sendMessage(channel, rowId, opts = {}) {
  return get(channel).deliver(rowId, opts);
}

/**
 * Is a channel currently able to send (linked / configured)?
 * @param {'whatsapp'|'email'} channel
 * @returns {boolean}
 */
function isReady(channel) {
  return get(channel).isReady();
}

// Channel availability for the UI / health checks.
function channels() {
  return Object.values(TRANSPORTS).map((t) => ({
    key: t.key, label: t.label, module: t.module, ready: t.isReady(),
  }));
}

module.exports = { sendMessage, isReady, channels, TRANSPORTS };
