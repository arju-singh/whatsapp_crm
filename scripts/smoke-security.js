// Security hardening smoke test (Priority 4). No network, no real credentials.
//
// Covers: host-header base-URL trust, SSRF private-address blocking, Stripe
// webhook replay window, async-route error forwarding (no hung request), CSV/XLSX
// prototype-pollution stripping, and per-account login lockout.

const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

process.env.NODE_ENV = 'test';
const tmpDb = path.join(os.tmpdir(), `crm-security-test-${process.pid}.db`);
for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch (_) {} }
process.env.DB_PATH = tmpDb;
process.env.LOGIN_MAX_FAILS = '3';      // trigger lockout quickly (before the IP limiter's 10)
process.env.LOGIN_LOCK_MINUTES = '15';

require('../src/async-routes'); // install the async-error patch (as server.js does)
const db = require('../src/db');
require('../src/tenancy');
const express = require('express');

let failed = 0;
const ok = (m) => console.log('PASS:', m);
const fail = (m) => { failed++; console.error('FAIL:', m); };
const assert = (c, m) => (c ? ok(m) : fail(m));

async function main() {
  // --- 1. Host-header base-URL trust (S2) -----------------------------------
  const { trustedBaseUrl } = require('../src/baseurl');
  const reqWith = (host) => ({ get: (h) => (h.toLowerCase() === 'host' ? host : null), protocol: 'https' });
  delete process.env.PUBLIC_BASE_URL;
  process.env.APP_ALLOWED_HOSTS = '';
  const savedNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  assert(trustedBaseUrl(reqWith('evil.example')) === null, 'prod: untrusted Host header yields no base URL (reset-link poisoning blocked)');
  process.env.PUBLIC_BASE_URL = 'https://app.example.com';
  assert(trustedBaseUrl(reqWith('evil.example')) === 'https://app.example.com', 'prod: PUBLIC_BASE_URL is used regardless of Host header');
  delete process.env.PUBLIC_BASE_URL;
  process.env.APP_ALLOWED_HOSTS = 'good.example';
  assert(trustedBaseUrl(reqWith('good.example')) === 'https://good.example', 'prod: allowlisted Host is accepted');
  assert(trustedBaseUrl(reqWith('evil.example')) === null, 'prod: non-allowlisted Host still rejected');
  process.env.NODE_ENV = savedNodeEnv;

  // --- 2. SSRF private-address blocking (S9) --------------------------------
  const ssrf = require('../src/ssrf');
  assert(ssrf.isBlockedIp('127.0.0.1'), 'SSRF blocks loopback 127.0.0.1');
  assert(ssrf.isBlockedIp('10.0.0.5') && ssrf.isBlockedIp('192.168.1.1') && ssrf.isBlockedIp('169.254.1.1'), 'SSRF blocks private/link-local ranges');
  assert(ssrf.isBlockedIp('::1'), 'SSRF blocks IPv6 loopback');
  assert(!ssrf.isBlockedIp('8.8.8.8'), 'SSRF allows a public IP');
  assert(await ssrf.hostIsBlocked('localhost'), 'SSRF blocks localhost by resolution');
  assert(await ssrf.safeFetch('http://127.0.0.1:1/x') === null, 'safeFetch refuses a private URL');
  assert(await ssrf.safeFetch('file:///etc/passwd') === null, 'safeFetch refuses a non-http(s) scheme');

  // --- 3. Stripe webhook replay window (S7) ---------------------------------
  const billing = require('../src/routes/billing');
  const secret = 'whsec_test';
  const now = Math.floor(Date.now() / 1000);
  const mkSig = (t, body) => {
    const v1 = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
    return `t=${t},v1=${v1}`;
  };
  const body = JSON.stringify({ id: 'evt_1' });
  assert(billing.verifyStripeSig(Buffer.from(body), mkSig(now, body), secret) === true, 'Stripe: fresh signed event verifies');
  assert(billing.verifyStripeSig(Buffer.from(body), mkSig(now - 3600, body), secret) === false, 'Stripe: replayed event (old timestamp) is rejected');
  assert(billing.verifyStripeSig(Buffer.from(body), mkSig(now, body).replace(/v1=.*/, 'v1=deadbeef'), secret) === false, 'Stripe: bad signature is rejected');

  // --- 4. Async-route error forwarding (Q5) ---------------------------------
  const app = express();
  app.use(express.json());
  app.get('/boom', async () => { throw new Error('kaboom'); });
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => res.status(500).json({ error: 'internal' }));
  const server = app.listen(0);
  try {
    const r = await Promise.race([
      fetch(`http://127.0.0.1:${server.address().port}/boom`).then((x) => x.status),
      new Promise((res) => setTimeout(() => res('timeout'), 2000)),
    ]);
    assert(r === 500, 'async handler throw reaches the error middleware (500, not a hung request)');
  } finally { server.close(); }

  // --- 5. Prototype-pollution stripping on import (S4) -----------------------
  // Mount vendors route with a mock tenant, import a CSV whose header is __proto__.
  const app2 = express();
  app2.use(express.json());
  app2.use((req, _res, next) => { req.user = { id: 1, role: 'super_admin' }; req.orgId = 1; req.orgRole = 'owner'; next(); });
  app2.use('/api/vendors', require('../src/routes/vendors'));
  const server2 = app2.listen(0);
  try {
    const csv = 'name,phone,__proto__\nProto Test,919812345678,polluted\n';
    const boundary = '----smoketest';
    const payload = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="p.csv"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n--${boundary}--\r\n`;
    const resp = await fetch(`http://127.0.0.1:${server2.address().port}/api/vendors/import`, {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body: payload,
    });
    const j = await resp.json();
    assert(resp.status === 200 && j.inserted >= 1, 'import with a __proto__ column still succeeds');
    assert(({}).polluted === undefined, 'Object.prototype was NOT polluted by the crafted header');
  } finally { server2.close(); }

  // --- 6. Per-account login lockout (S11) -----------------------------------
  const { hashPassword } = require('../src/auth');
  db.prepare("INSERT INTO users (name, phone, password_hash, role, active) VALUES (?, ?, ?, 'user', 1)")
    .run('LockMe', '919800000009', hashPassword('correct-horse'));
  const app3 = express();
  app3.use(express.json());
  app3.use('/api/auth', require('../src/routes/auth'));
  const server3 = app3.listen(0);
  try {
    const base3 = `http://127.0.0.1:${server3.address().port}/api/auth/login`;
    const tryLogin = (pw) => fetch(base3, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: '919800000009', password: pw }) });
    for (let i = 0; i < 3; i++) await tryLogin('wrong');
    const locked = await tryLogin('correct-horse'); // correct pw, but account now locked
    assert(locked.status === 429, 'account locks after LOGIN_MAX_FAILS bad attempts (429, even with correct password)');
  } finally { server3.close(); }
}

main()
  .catch((e) => fail('unexpected error: ' + (e && e.stack ? e.stack : e)))
  .finally(() => {
    try { db.close(); } catch (_) {}
    for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch (_) {} }
    console.log(failed ? `\nSECURITY TEST: FAILED (${failed})` : '\nSECURITY TEST: PASSED');
    process.exit(failed ? 1 : 0);
  });
