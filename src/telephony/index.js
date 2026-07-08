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

  // --- Conversational AI voice agents -------------------------------------
  // Unlike the human-bridge providers above, these launch an AUTONOMOUS agent
  // that speaks with the customer (STT→LLM→TTS) and calls our tools mid-call.
  // The caller (src/routes/voice.js) builds the assistant config via
  // voice-agent.buildAssistant() and passes it in `payload.assistant`; the
  // provider runs it and POSTs events to our /api/voice/webhook.

  // Vapi (https://vapi.ai) — REST create-call. Key: VAPI_API_KEY (settings:
  // voice_vapi_key). Number to dial FROM: a Vapi phoneNumberId (settings:
  // voice_vapi_phone_number_id) or a BYO SIP/Twilio number id.
  vapi: {
    key: 'vapi',
    label: 'Vapi (AI voice agent)',
    isReady() {
      return !!(env('VAPI_API_KEY') || settings.get('voice_vapi_key'));
    },
    async dial({ to, assistant, assistantId, metadata }) {
      if (!this.isReady()) throw new Error('vapi_not_configured');
      const key = settings.get('voice_vapi_key') || env('VAPI_API_KEY');
      const phoneNumberId = settings.get('voice_vapi_phone_number_id') || env('VAPI_PHONE_NUMBER_ID');
      const contact = e164(to);
      if (!contact) throw new Error('destination_required');
      if (!phoneNumberId) throw new Error('vapi_phone_number_id_required');

      const bodyObj = {
        phoneNumberId,
        customer: { number: contact },
        metadata: metadata || {},
      };
      // Prefer a saved assistantId if provided; otherwise send the inline config.
      if (assistantId) bodyObj.assistantId = assistantId;
      else bodyObj.assistant = assistant;

      const data = await httpsPost('https://api.vapi.ai/call', key, bodyObj);
      return {
        status: mapVapiStatus(data.status) || 'initiated',
        providerCallId: data.id || null,
        dryRun: false,
        to: contact,
      };
    },
  },

  // Retell AI (https://retellai.com) — create-phone-call. Key: RETELL_API_KEY
  // (settings: voice_retell_key). Requires a Retell agent id (voice_retell_agent_id)
  // and a Retell-registered from-number (voice_retell_from_number). Dynamic per-call
  // context is passed as retell_llm_dynamic_variables + metadata.
  retell: {
    key: 'retell',
    label: 'Retell AI (AI voice agent)',
    isReady() {
      return !!((env('RETELL_API_KEY') || settings.get('voice_retell_key'))
        && (env('RETELL_AGENT_ID') || settings.get('voice_retell_agent_id')));
    },
    async dial({ to, metadata, assistant }) {
      if (!this.isReady()) throw new Error('retell_not_configured');
      const key = settings.get('voice_retell_key') || env('RETELL_API_KEY');
      const agentId = settings.get('voice_retell_agent_id') || env('RETELL_AGENT_ID');
      const fromNumber = e164(settings.get('voice_retell_from_number') || env('RETELL_FROM_NUMBER'));
      const contact = e164(to);
      if (!contact) throw new Error('destination_required');
      if (!fromNumber) throw new Error('retell_from_number_required');

      // Retell agents are configured in Retell's dashboard; we pass the dynamic
      // greeting + system context as variables and the CRM linkage as metadata.
      const dyn = {};
      if (assistant) {
        if (assistant.firstMessage) dyn.first_message = assistant.firstMessage;
        const sys = assistant.model && Array.isArray(assistant.model.messages)
          && assistant.model.messages.find((m) => m.role === 'system');
        if (sys) dyn.system_prompt = sys.content;
      }
      const data = await httpsPost('https://api.retellai.com/v2/create-phone-call', key, {
        from_number: fromNumber,
        to_number: contact,
        override_agent_id: agentId,
        retell_llm_dynamic_variables: dyn,
        metadata: metadata || {},
      });
      return {
        status: 'initiated',
        providerCallId: data.call_id || null,
        dryRun: false,
        to: contact,
      };
    },
  },
};

// Bearer-auth JSON POST used by the AI voice providers. Kept local (no SDK dep),
// mirroring the raw-HTTPS approach in ai-agent.js / voice-agent.js.
function httpsPost(url, bearer, bodyObj) {
  const { URL } = require('url');
  const u = new URL(url);
  const payload = JSON.stringify(bodyObj || {});
  return new Promise((resolve, reject) => {
    const req = require('https').request({
      host: u.hostname, path: u.pathname + u.search, port: u.port || 443, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        Authorization: `Bearer ${bearer}`,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed; try { parsed = text ? JSON.parse(text) : {}; } catch (_) { parsed = { raw: text }; }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
        else reject(new Error(`voice_provider ${res.statusCode}: ${parsed.message || parsed.error || text.slice(0, 300)}`));
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// Map Vapi call status → our calls.status vocabulary.
function mapVapiStatus(s) {
  return {
    queued: 'initiated', scheduled: 'initiated', ringing: 'ringing',
    'in-progress': 'connected', forwarding: 'connected', ended: 'completed',
  }[s] || s || 'initiated';
}

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
