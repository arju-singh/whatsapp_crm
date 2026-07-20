// WhatsApp Cloud API provider smoke test — needs NO real Meta credentials.
//
// Covers the provider abstraction end to end using the mock provider + synthetic
// (locally-signed) webhook payloads:
//   1. Signature verification, verify-token handshake, inbound/status parsing.
//   2. Outbound send through the shared pipeline via WA_PROVIDER=mock.
//   3. Retry-with-backoff: transient failure → next_attempt_at → requeue → sent.
//   4. Cloud webhook end-to-end: GET verify, signed inbound → ingest, bad
//      signature → 401, signed status → message advances to read.

const os = require('os');
const path = require('path');
const fs = require('fs');

// Configure provider + isolated DB + fake Meta secrets BEFORE requiring modules.
process.env.WA_PROVIDER = 'mock';
process.env.NODE_ENV = 'test';
process.env.WA_CLOUD_APP_SECRET = 'test-app-secret';
process.env.WA_CLOUD_VERIFY_TOKEN = 'test-verify-token';
const tmpDb = path.join(os.tmpdir(), `crm-cloud-test-${process.pid}.db`);
for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch (_) {} }
process.env.DB_PATH = tmpDb;

const db = require('../src/db');
require('../src/tenancy');
const cloud = require('../src/wa/cloud');
const mock = require('../src/wa/mock');
const wa = require('../src/whatsapp');
const scheduler = require('../src/scheduler');
const settings = require('../src/settings');
const express = require('express');

let failed = 0;
const ok = (m) => console.log('PASS:', m);
const fail = (m) => { failed++; console.error('FAIL:', m); };
const assert = (c, m) => (c ? ok(m) : fail(m));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) { if (pred()) return true; await sleep(10); }
  return pred();
}

// Make the send queue near-instant for the test.
settings.set('wa_min_delay_ms', '0');
settings.set('wa_max_delay_ms', '0');

const APP_SECRET = 'test-app-secret';
const sign = (raw) => cloud.signBody(Buffer.from(raw), APP_SECRET);

async function main() {
  // --- 1. Pure functions ----------------------------------------------------
  const raw = Buffer.from(JSON.stringify({ a: 1 }));
  assert(cloud.verifySignature(raw, cloud.signBody(raw, APP_SECRET)).ok, 'signature verifies with correct secret');
  assert(!cloud.verifySignature(raw, 'sha256=deadbeef').ok, 'wrong signature is rejected');
  assert(cloud.verifyToken({ mode: 'subscribe', token: 'test-verify-token', challenge: 'C' }).ok, 'verify token handshake accepts correct token');
  assert(!cloud.verifyToken({ mode: 'subscribe', token: 'nope', challenge: 'C' }).ok, 'verify token handshake rejects wrong token');
  const inb = cloud.parseInbound({ entry: [{ changes: [{ value: { contacts: [{ wa_id: '15551230000', profile: { name: 'Jo' } }], messages: [{ from: '15551230000', id: 'wamid.X', type: 'text', timestamp: '1700000000', text: { body: 'hi' } }] } }] }] });
  assert(inb.length === 1 && inb[0].phone === '15551230000' && inb[0].body === 'hi' && inb[0].pushname === 'Jo', 'parseInbound extracts phone/body/name');
  const sts = cloud.parseStatuses({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.X', status: 'delivered', timestamp: '1' }] } }] }] });
  assert(sts.length === 1 && sts[0].status === 'delivered', 'parseStatuses maps delivery status');

  // Seed a vendor in the host org (default org 1, created by tenancy on fresh DB).
  const orgId = 1;
  const vid = db.prepare("INSERT INTO vendors (organization_id, name, phone, status) VALUES (?, ?, ?, 'new')").run(orgId, 'Cloud Test', '15557770001').lastInsertRowid;

  // --- 2. Outbound send via mock provider through the shared pipeline --------
  mock._reset();
  const m1 = db.prepare("INSERT INTO messages (organization_id, vendor_id, direction, body, status) VALUES (?, ?, 'out', ?, 'queued')").run(orgId, vid, 'Hello via mock').lastInsertRowid;
  wa.enqueueMessage(m1);
  await waitFor(() => db.prepare('SELECT status FROM messages WHERE id=?').get(m1).status === 'sent');
  const row1 = db.prepare('SELECT status, wa_message_id FROM messages WHERE id=?').get(m1);
  assert(row1.status === 'sent' && row1.wa_message_id, 'mock provider sends through the pipeline (status=sent, provider id stored)');
  assert(mock._getOutbox().length === 1 && mock._lastSent().body === 'Hello via mock', 'mock outbox captured the outbound send');

  // --- 3. Retry-with-backoff on transient failure ---------------------------
  mock._reset();
  mock._setForceFail(true);
  const m2 = db.prepare("INSERT INTO messages (organization_id, vendor_id, direction, body, status) VALUES (?, ?, 'out', ?, 'queued')").run(orgId, vid, 'Retry me').lastInsertRowid;
  wa.enqueueMessage(m2);
  await waitFor(() => db.prepare('SELECT status FROM messages WHERE id=?').get(m2).status === 'failed');
  const rf = db.prepare('SELECT status, attempts, next_attempt_at FROM messages WHERE id=?').get(m2);
  assert(rf.status === 'failed' && rf.attempts >= 1 && rf.next_attempt_at, 'transient failure is retryable (next_attempt_at set, not terminal)');

  // Simulate the backoff elapsing, recover the provider, let the scheduler retry.
  db.prepare('UPDATE messages SET next_attempt_at=? WHERE id=?').run(Date.now() - 1000, m2);
  mock._setForceFail(false);
  scheduler.requeueFailedMessages();
  await waitFor(() => db.prepare('SELECT status FROM messages WHERE id=?').get(m2).status === 'sent');
  assert(db.prepare('SELECT status FROM messages WHERE id=?').get(m2).status === 'sent', 'failed message is retried and sent after backoff');

  // --- 4. Cloud webhook end-to-end ------------------------------------------
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
  app.use('/api/wa/cloud/webhook', require('../src/wa/webhook'));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/wa/cloud/webhook`;
  const postSigned = (rawBody) => fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(rawBody) }, body: rawBody });

  try {
    // GET verification handshake
    const g = await fetch(`${base}?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=ping123`);
    assert(g.status === 200 && (await g.text()) === 'ping123', 'GET webhook echoes challenge on valid verify token');
    const gbad = await fetch(`${base}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=x`);
    assert(gbad.status === 403, 'GET webhook rejects an invalid verify token');

    // Signed inbound message → ingested into host org
    const inbound = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { contacts: [{ wa_id: '15558880002', profile: { name: 'Webhook User' } }], messages: [{ from: '15558880002', id: 'wamid.CLOUDIN1', type: 'text', timestamp: '1700000000', text: { body: 'inbound via cloud' } }] } }] }] });
    const pi = await postSigned(inbound);
    assert(pi.status === 200, 'POST signed inbound accepted (200)');
    await waitFor(() => db.prepare("SELECT COUNT(*) c FROM vendors WHERE phone='15558880002'").get().c > 0);
    const inVend = db.prepare("SELECT id, organization_id FROM vendors WHERE phone='15558880002'").get();
    assert(inVend && inVend.organization_id === orgId, 'inbound webhook auto-created the vendor in the host org');
    assert(!!db.prepare("SELECT id FROM messages WHERE wa_message_id='wamid.CLOUDIN1' AND direction='in'").get(), 'inbound webhook stored the message');

    // Forged signature → 401
    const pbad = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=bad' }, body: inbound });
    assert(pbad.status === 401, 'POST with a bad signature is rejected (401)');

    // Signed status update advances our earlier sent message to read
    const statusPayload = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: row1.wa_message_id, status: 'read', timestamp: '1700000005' }] } }] }] });
    await postSigned(statusPayload);
    await waitFor(() => db.prepare('SELECT status FROM messages WHERE id=?').get(m1).status === 'read');
    const r1 = db.prepare('SELECT status, read_at FROM messages WHERE id=?').get(m1);
    assert(r1.status === 'read' && r1.read_at, 'status webhook advanced the message to read');
  } finally {
    server.close();
  }
}

main()
  .catch((e) => fail('unexpected error: ' + (e && e.stack ? e.stack : e)))
  .finally(() => {
    try { db.close(); } catch (_) {}
    for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch (_) {} }
    console.log(failed ? `\nCLOUD PROVIDER TEST: FAILED (${failed})` : '\nCLOUD PROVIDER TEST: PASSED');
    process.exit(failed ? 1 : 0);
  });
