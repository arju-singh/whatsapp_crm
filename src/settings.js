const db = require('./db');

const DEFAULTS = {
  quiet_start: '21',
  quiet_end: '9',
  wa_daily_cap: '200',
  wa_max_attempts: '3',
  wa_min_delay_ms: '4000',
  wa_max_delay_ms: '9000',
  email_daily_cap: '500',
  email_max_attempts: '3',
  default_country_code: '91',
  default_region: 'IN',
  test_number: '',
  resend_webhook_secret: '',
  mailgun_signing_key: '',
  webhook_signature_required: '0',
  anthropic_api_key: '',
  gemini_api_key: '',
  ai_business_profile: 'I run a small CRM/outreach tool that helps Indian pet shops, vets, and pet groomers find products, distributors, and grow their business. We send polite, helpful WhatsApp messages in a mix of Hindi/Hinglish/English depending on what the contact uses.',
  ai_model: 'claude-sonnet-4-6',
  ai_auto_draft_inbound: '1',
  foursquare_api_key: '',
  here_api_key: '',
  tomtom_api_key: '',
};

const ENV_MAP = {
  quiet_start: 'QUIET_START',
  quiet_end: 'QUIET_END',
  wa_daily_cap: 'WA_DAILY_CAP',
  wa_max_attempts: 'WA_MAX_ATTEMPTS',
  wa_min_delay_ms: 'WA_MIN_DELAY_MS',
  wa_max_delay_ms: 'WA_MAX_DELAY_MS',
  email_daily_cap: 'EMAIL_DAILY_CAP',
  email_max_attempts: 'EMAIL_MAX_ATTEMPTS',
  default_country_code: 'DEFAULT_COUNTRY_CODE',
  default_region: 'DEFAULT_REGION',
  test_number: 'TEST_NUMBER',
  resend_webhook_secret: 'RESEND_WEBHOOK_SECRET',
  mailgun_signing_key: 'MAILGUN_SIGNING_KEY',
  webhook_signature_required: 'WEBHOOK_SIGNATURE_REQUIRED',
  anthropic_api_key: 'ANTHROPIC_API_KEY',
  gemini_api_key: 'GEMINI_API_KEY',
  ai_business_profile: 'AI_BUSINESS_PROFILE',
  ai_model: 'AI_MODEL',
  ai_auto_draft_inbound: 'AI_AUTO_DRAFT_INBOUND',
  foursquare_api_key: 'FOURSQUARE_API_KEY',
  here_api_key: 'HERE_API_KEY',
  tomtom_api_key: 'TOMTOM_API_KEY',
};

const cache = new Map();
let cacheLoaded = false;

function loadCache() {
  cache.clear();
  for (const row of db.prepare('SELECT key, value FROM settings').all()) {
    cache.set(row.key, row.value);
  }
  cacheLoaded = true;
}

function get(key) {
  if (!cacheLoaded) loadCache();
  if (cache.has(key)) return cache.get(key);
  const envKey = ENV_MAP[key];
  if (envKey && process.env[envKey] != null && process.env[envKey] !== '') return process.env[envKey];
  return DEFAULTS[key];
}

function getInt(key) {
  const v = get(key);
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

function set(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value == null ? null : String(value), Date.now());
  cache.set(key, value == null ? null : String(value));
}

function getAll() {
  if (!cacheLoaded) loadCache();
  const out = {};
  for (const k of Object.keys(DEFAULTS)) out[k] = get(k);
  return out;
}

function reload() { loadCache(); }

module.exports = { get, getInt, set, getAll, reload, DEFAULTS, ENV_MAP };
