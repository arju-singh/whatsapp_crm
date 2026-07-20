// ---------------------------------------------------------------------------
// Mock WhatsApp provider. Selected via WA_PROVIDER=mock.
//
// No network, no credentials, no Chromium — records outbound sends to an
// in-memory outbox and returns a deterministic provider message id. Lets the
// full send pipeline (queue, suppression, retry, status) be exercised in tests
// without touching Meta or WhatsApp Web. It also re-exports the Cloud provider's
// webhook parsers/signature helpers so tests can drive inbound/status flows.
// ---------------------------------------------------------------------------

const cloud = require('./cloud');

const _outbox = [];
let _forceFail = false;      // when true, sendText throws (transient) — tests retries
let _seq = 0;

function isReady() { return true; }

async function sendText({ to, body, mediaPath }) {
  if (_forceFail) {
    const e = new Error('mock_forced_failure');
    e.permanent = false;
    throw e;
  }
  _seq += 1;
  const id = `mock-wamid-${_seq}`;
  _outbox.push({ to: String(to).replace(/\D/g, ''), body, mediaPath: mediaPath || null, id, at: Date.now() });
  return { providerMessageId: id, status: 'sent' };
}

// Test controls
function _reset() { _outbox.length = 0; _forceFail = false; _seq = 0; }
function _setForceFail(v) { _forceFail = !!v; }
function _getOutbox() { return _outbox.slice(); }
function _lastSent() { return _outbox[_outbox.length - 1] || null; }

module.exports = {
  key: 'mock',
  isReady,
  sendText,
  // webhook helpers reused from the cloud provider (same envelope shape)
  verifyToken: cloud.verifyToken,
  verifySignature: cloud.verifySignature,
  signBody: cloud.signBody,
  parseInbound: cloud.parseInbound,
  parseStatuses: cloud.parseStatuses,
  mapStatus: cloud.mapStatus,
  // test-only
  _reset,
  _setForceFail,
  _getOutbox,
  _lastSent,
};
