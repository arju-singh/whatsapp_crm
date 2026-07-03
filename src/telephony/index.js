// ---------------------------------------------------------------------------
// Calling provider layer.
//
// The CRM never talks to a phone carrier directly. It persists a `calls` row and
// hands it to placeCall(), which routes to the active telephony provider — the
// exact mirror of the messaging transport layer (src/transports). Providers share
// one interface { isReady(), dial(payload) }; adding Plivo/Exotel/Vonage/Twilio is
// a new entry here with zero business-code changes.
//
//   const telephony = require('./telephony');
//   await telephony.placeCall({ callId, to, from, agent, orgId });   // active provider
//   telephony.providers();      // readiness for each provider (settings UI / health)
//
// The default provider is 'log' (dry-run): it records the call without any
// external account, so calling works out of the box and on machines with no
// carrier creds — the same dry-run philosophy as the estateflow adapters.
// ---------------------------------------------------------------------------

const crypto = require('crypto');
const settings = require('../settings');

const env = (k) => (process.env[k] || '').trim();

// Factory for providers that aren't implemented yet but should appear in the
// registry (so the UI can show them and report "configure me"). They become
// ready the moment their credentials are present; dialing is wired per provider.
function scaffold(key, label, credKeys) {
  return {
    key,
    label,
    isReady() { return credKeys.every((k) => env(k)); },
    async dial() {
      if (!this.isReady()) throw new Error(`${key}_not_configured`);
      throw new Error(`${key}_dial_not_implemented`);
    },
  };
}

// Normalize a phone to E.164 (+<digits>). Our contacts are stored as bare
// digits (e.g. 919996256333); carriers want a leading +.
function e164(n) {
  const s = String(n || '').trim();
  if (!s) return '';
  return s.startsWith('+') ? s : '+' + s.replace(/[^0-9]/g, '');
}

const PROVIDERS = {
  // Dry-run default — always available. Records the intent to call; no carrier.
  log: {
    key: 'log',
    label: 'Log only (dry-run)',
    isReady() { return true; },
    async dial({ to }) {
      return { status: 'logged', providerCallId: null, dryRun: true, to };
    },
  },

  // Real Twilio instant-bridge over the REST API (no SDK dependency). Rings the
  // AGENT first; when they answer, TwiML bridges the call to the CONTACT. The
  // agent number comes from the per-call `from`, else settings, else env.
  //   Required env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_CALLER_ID
  //   Agent number: payload.from | settings 'call_agent_number' | TWILIO_AGENT_NUMBER
  //   Optional:     TWILIO_STATUS_CALLBACK (public URL for call-status webhooks)
  twilio: {
    key: 'twilio',
    label: 'Twilio',
    isReady() {
      return !!(env('TWILIO_ACCOUNT_SID') && env('TWILIO_AUTH_TOKEN') && env('TWILIO_CALLER_ID'));
    },
    async dial({ to, from }) {
      if (!this.isReady()) throw new Error('twilio_not_configured');
      const sid = env('TWILIO_ACCOUNT_SID');
      const token = env('TWILIO_AUTH_TOKEN');
      const callerId = e164(env('TWILIO_CALLER_ID'));
      const contact = e164(to);
      if (!contact) throw new Error('destination_required');
      const agentNumber = e164(from || settings.get('call_agent_number') || env('TWILIO_AGENT_NUMBER'));
      if (!agentNumber) throw new Error('twilio_agent_number_required');

      // When the agent answers, Twilio runs this TwiML and dials the contact.
      const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Dial callerId="${callerId}">${contact}</Dial></Response>`;
      const params = new URLSearchParams({ To: agentNumber, From: callerId, Twiml: twiml });
      const cb = env('TWILIO_STATUS_CALLBACK');
      if (cb) {
        params.set('StatusCallback', cb);
        params.set('StatusCallbackEvent', 'initiated ringing answered completed');
      }

      const auth = Buffer.from(`${sid}:${token}`).toString('base64');
      const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
        method: 'POST',
        headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error('twilio_error: ' + (data.message || `HTTP ${resp.status}`));
      return {
        status: data.status || 'initiated',
        providerCallId: data.sid || null,
        dryRun: false,
        to: contact,
        bridgedVia: agentNumber,
      };
    },
  },

  plivo: scaffold('plivo', 'Plivo', ['PLIVO_AUTH_ID', 'PLIVO_AUTH_TOKEN', 'PLIVO_CALLER_ID']),
  exotel: scaffold('exotel', 'Exotel', ['EXOTEL_SID', 'EXOTEL_TOKEN', 'EXOTEL_CALLER_ID']),
  vonage: scaffold('vonage', 'Vonage', ['VONAGE_API_KEY', 'VONAGE_API_SECRET', 'VONAGE_CALLER_ID']),
};

function get(key) {
  const p = PROVIDERS[key];
  if (!p) throw new Error(`unknown_call_provider: ${key}`);
  return p;
}

// Which provider an org dials through. Settings (DB) override env, which falls
// back to the dry-run logger so nothing is required to start.
function activeProviderKey() {
  return (settings.get('call_provider') || env('CALL_PROVIDER') || 'log').toLowerCase();
}

// Place a call through an explicit provider. payload: { callId, to, from, agent, orgId }.
async function placeCallWith(providerKey, payload) {
  return get(providerKey).dial(payload || {});
}

// Place a call through the org's active provider.
async function placeCall(payload) {
  return placeCallWith(activeProviderKey(), payload);
}

function isReady(providerKey) {
  return get(providerKey).isReady();
}

// Provider availability for the UI / health checks (active flagged).
function providers() {
  const active = activeProviderKey();
  return Object.values(PROVIDERS).map((p) => ({
    key: p.key, label: p.label, ready: p.isReady(), active: p.key === active,
  }));
}

// --- Twilio status webhook helpers ----------------------------------------

// Validate Twilio's X-Twilio-Signature on a status callback. Twilio computes
// HMAC-SHA1(authToken) over the exact callback URL with every POST param
// appended in alphabetical order (key+value, no separators), base64-encoded.
// `url` MUST be the exact URL Twilio posted to (the configured StatusCallback).
function validateTwilioSignature(signature, url, params) {
  const token = env('TWILIO_AUTH_TOKEN');
  if (!token || !signature) return false;
  const data = Object.keys(params || {}).sort()
    .reduce((acc, k) => acc + k + params[k], url);
  const expected = crypto.createHmac('sha1', token)
    .update(Buffer.from(data, 'utf-8')).digest('base64');
  try {
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (_) { return false; }
}

// Map a Twilio CallStatus to our calls.status vocabulary.
function mapTwilioStatus(twilioStatus) {
  return {
    queued: 'initiated', initiated: 'initiated', ringing: 'ringing',
    'in-progress': 'connected', completed: 'completed',
    busy: 'failed', failed: 'failed', 'no-answer': 'failed', canceled: 'failed',
  }[twilioStatus] || twilioStatus || 'initiated';
}

module.exports = {
  placeCall, placeCallWith, activeProviderKey, isReady, providers, PROVIDERS,
  validateTwilioSignature, mapTwilioStatus,
};
