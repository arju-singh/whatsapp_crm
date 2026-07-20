// Tenant-isolation smoke test.
//
// Proves that no endpoint lets one organization read or write another org's data.
// Runs against a THROWAWAY database (DB_PATH) so it never touches the live DB,
// mounts the real routers behind a mock auth+tenant middleware, and drives two
// separate tenants (org A / org B) through the HTTP surface.
//
// Assertions cover: cross-tenant list/read/update/delete, IDOR by id, cross-org
// foreign-key injection, cross-tenant messaging, per-org phone uniqueness, global
// user-account isolation, and the no-shared-default-org provisioning rule.

const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');

// Point the DB layer at a fresh temp file BEFORE anything requires it.
const tmpDb = path.join(os.tmpdir(), `crm-isolation-test-${process.pid}.db`);
for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + suffix); } catch (_) {} }
process.env.DB_PATH = tmpDb;
process.env.NODE_ENV = 'test';

const db = require('../src/db');
require('../src/tenancy');
const { provisionOrgForUser, DEFAULT_ORG_ID } = require('../src/tenancy');
const { hashPassword } = require('../src/auth');
const express = require('express');

let failed = 0;
const ok = (m) => console.log('PASS:', m);
const fail = (m) => { failed++; console.error('FAIL:', m); };
const assert = (cond, m) => (cond ? ok(m) : fail(m));

// --- Seed two tenants -------------------------------------------------------
function mkUser(name, phone) {
  const r = db.prepare("INSERT INTO users (name, phone, password_hash, role, active) VALUES (?, ?, ?, 'user', 1)")
    .run(name, phone, hashPassword('pw-' + phone));
  return r.lastInsertRowid;
}
const userA = mkUser('Alice', '910000000001');
const userB = mkUser('Bob', '910000000002');
const orgA = provisionOrgForUser(userA, "Alice's WS", 'owner');
const orgB = provisionOrgForUser(userB, "Bob's WS", 'owner');

assert(orgA !== orgB, 'each user gets a distinct organization');
assert(orgA !== DEFAULT_ORG_ID && orgB !== DEFAULT_ORG_ID, 'new orgs are NOT the shared default org');

// Provisioning is idempotent (no second org for the same user).
assert(provisionOrgForUser(userA, 'again') === orgA, 'provisionOrgForUser is idempotent');

// A membership-less user must resolve to their OWN new org, never the default.
const lonelyUser = mkUser('Nomad', '910000000003');
const { tenantContext } = require('../src/tenancy');
let resolvedOrg = null;
tenantContext({ user: { id: lonelyUser, name: 'Nomad' }, headers: {} }, {}, () => {});
resolvedOrg = db.prepare('SELECT organization_id o FROM memberships WHERE user_id = ?').get(lonelyUser)?.o;
assert(resolvedOrg && resolvedOrg !== DEFAULT_ORG_ID, 'membership-less user is self-provisioned into their own org (not org 1)');

// --- Mock app: current tenant/user driven by request headers ----------------
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const uid = Number(req.headers['x-test-user']);
  const oid = Number(req.headers['x-test-org']);
  // Role is overridable per-request (x-test-role) so we can prove the send
  // permission gates; defaults to full perms so isolation checks are never
  // masked by an authorization failure.
  const role = req.headers['x-test-role'] || 'super_admin';
  req.user = { id: uid, name: 'tester', role };
  req.orgId = oid;
  req.orgRole = req.headers['x-test-role'] || 'owner';
  req.memberships = db.prepare('SELECT organization_id, role FROM memberships WHERE user_id = ?').all(uid);
  next();
});
app.use('/api/vendors', require('../src/routes/vendors'));
app.use('/api/companies', require('../src/routes/companies'));
app.use('/api/deals', require('../src/routes/deals'));
app.use('/api/messages', require('../src/routes/messages'));
app.use('/api/tasks', require('../src/routes/tasks'));
app.use('/api/email', require('../src/routes/email'));
app.use('/api/users', require('../src/routes/users'));

const server = app.listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, { org, user, role, body } = {}) => {
    const headers = {
      'content-type': 'application/json',
      'x-test-org': String(org),
      'x-test-user': String(user),
    };
    if (role) headers['x-test-role'] = role;
    const r = await fetch(base + p, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    let j; try { j = JSON.parse(await r.text()); } catch { j = null; }
    return { status: r.status, body: j };
  };
  const asA = (m, p, body) => call(m, p, { org: orgA, user: userA, body });
  const asB = (m, p, body) => call(m, p, { org: orgB, user: userB, body });

  try {
    // Seed org A and org B data. Same phone in both orgs proves per-org uniqueness.
    const SHARED_PHONE = '919999900001';
    const vA = await asA('POST', '/api/vendors', { name: 'A-Contact', phone: SHARED_PHONE });
    const vB = await asB('POST', '/api/vendors', { name: 'B-Contact', phone: SHARED_PHONE });
    assert(vA.status === 200 && vA.body.id, 'org A creates a vendor');
    assert(vB.status === 200 && vB.body.id, 'org B creates a vendor with the SAME phone (per-org uniqueness)');
    const vendorA = vA.body.id;

    const cA = await asA('POST', '/api/companies', { name: 'A-Corp' });
    const cB = await asB('POST', '/api/companies', { name: 'B-Corp' });
    const companyA = cA.body.id;
    const companyB = cB.body.id;

    // 1) Cross-tenant LIST: B must not see A's vendor.
    const listB = await asB('GET', '/api/vendors');
    const bSeesA = (listB.body.rows || []).some((r) => r.id === vendorA);
    assert(!bSeesA, 'org B vendor list excludes org A vendors');

    // 2) Cross-tenant READ by id (IDOR): B fetching A's vendor → 404.
    const readAsB = await asB('GET', `/api/vendors/${vendorA}`);
    assert(readAsB.status === 404, 'org B cannot read org A vendor by id (404)');

    // 3) Cross-tenant UPDATE: B updating A's vendor must not change it.
    await asB('PUT', `/api/vendors/${vendorA}`, { name: 'HACKED' });
    const afterUpd = await asA('GET', `/api/vendors/${vendorA}`);
    assert(afterUpd.status === 200 && afterUpd.body.vendor.name === 'A-Contact', 'org B cannot update org A vendor');

    // 4) Cross-tenant DELETE: B deleting A's vendor must not remove it.
    await asB('DELETE', `/api/vendors/${vendorA}`);
    const afterDel = await asA('GET', `/api/vendors/${vendorA}`);
    assert(afterDel.status === 200 && afterDel.body.vendor, 'org B cannot delete org A vendor');

    // 5) Cross-org FK injection: B creating a deal pointing at A's company → 400.
    const badDeal = await asB('POST', '/api/deals', { name: 'B-Deal', company_id: companyA });
    assert(badDeal.status === 400 && badDeal.body.error === 'invalid_company_id', 'org B cannot attach org A company to a deal');

    // ...but B's own company is accepted.
    const goodDeal = await asB('POST', '/api/deals', { name: 'B-Deal', company_id: companyB });
    assert(goodDeal.status === 200 && goodDeal.body.id, 'org B can attach its OWN company to a deal');

    // 6) Cross-tenant messaging: B sending to A's vendor → 404 (no send).
    const badSend = await asB('POST', '/api/messages/send', { vendor_id: vendorA, body: 'hi' });
    assert(badSend.status === 404, 'org B cannot send a message to org A vendor');

    // 7) Global user-account isolation: B's user list excludes A's account.
    const usersB = await asB('GET', '/api/users');
    const bSeesUserA = (usersB.body.rows || []).some((u) => u.id === userA);
    assert(!bSeesUserA, 'org B user list excludes org A accounts');

    // 8) Cross-org account takeover: B editing A's user → 404.
    const editUserA = await asB('PUT', `/api/users/${userA}`, { name: 'pwned', role: 'super_admin' });
    assert(editUserA.status === 404, 'org B cannot edit an org A user account');
    const stillAlice = db.prepare('SELECT name, role FROM users WHERE id = ?').get(userA);
    assert(stillAlice.name === 'Alice' && stillAlice.role === 'user', 'org A user account is unchanged after B attempt');

    // 9) Tasks IDOR: B cannot see, update, or delete A's task.
    const tA = await asA('POST', '/api/tasks', { title: 'A-Task' });
    assert(tA.status === 200 && tA.body.id, 'org A creates a task');
    const taskA = tA.body.id;
    const tListB = await asB('GET', '/api/tasks');
    const bSeesTaskA = Array.isArray(tListB.body) && tListB.body.some((t) => t.id === taskA);
    assert(!bSeesTaskA, 'org B task list excludes org A tasks');
    await asB('PUT', `/api/tasks/${taskA}`, { title: 'HACKED' });
    await asB('DELETE', `/api/tasks/${taskA}`);
    const taskStill = db.prepare('SELECT title, deleted_at FROM tasks WHERE id = ?').get(taskA);
    assert(taskStill.title === 'A-Task' && taskStill.deleted_at == null, 'org B cannot update or delete org A task');

    // 10) Authorization gate: a viewer role is forbidden from sending; owner is not.
    const viewerSend = await call('POST', '/api/messages/send', { org: orgB, user: userB, role: 'viewer', body: { vendor_id: 999999, body: 'x' } });
    assert(viewerSend.status === 403, 'viewer role is forbidden from POST /messages/send (requirePerm)');
    const ownerSend = await asB('POST', '/api/messages/send', { vendor_id: 999999, body: 'x' });
    assert(ownerSend.status !== 403, 'owner role passes the send permission gate (not a 403)');

    // 11) Email open-tracking: raw-id enumeration cannot record opens; only a signed token can.
    const { emailTrackToken } = require('../src/email');
    const emailId = db.prepare("INSERT INTO emails (organization_id, vendor_id, direction, to_email, subject, status) VALUES (?, ?, 'out', ?, ?, 'sent')")
      .run(orgA, vendorA, 'x@example.com', 'hi').lastInsertRowid;
    await fetch(`${base}/api/email/track/${emailId}.gif`); // raw id — must be ignored
    let openCount = db.prepare('SELECT open_count FROM emails WHERE id = ?').get(emailId).open_count;
    assert(openCount === 0, 'raw-id enumeration does NOT record an email open (token required)');
    await fetch(`${base}/api/email/track/${emailTrackToken(emailId)}.gif`); // signed token — records
    openCount = db.prepare('SELECT open_count FROM emails WHERE id = ?').get(emailId).open_count;
    assert(openCount === 1, 'valid signed token records the email open');

    // 12) Background-job isolation: a follow-up rule never schedules against another org's message.
    const scheduler = require('../src/scheduler');
    const now = Date.now();
    const tplA = db.prepare("INSERT INTO templates (organization_id, name, body) VALUES (?, 'A-tpl', 'hi')").run(orgA).lastInsertRowid;
    db.prepare("INSERT INTO followup_rules (organization_id, name, trigger, delay_hours, template_id, active, channel) VALUES (?, 'A-rule', 'no_reply', 1, ?, 1, 'whatsapp')").run(orgA, tplA);
    const msgA = db.prepare("INSERT INTO messages (organization_id, vendor_id, direction, body, status, sent_at) VALUES (?, ?, 'out', 'hi', 'sent', ?)").run(orgA, vendorA, now).lastInsertRowid;
    const vB2 = db.prepare("INSERT INTO vendors (organization_id, name, phone, status) VALUES (?, 'B-v2', '918888800002', 'new')").run(orgB).lastInsertRowid;
    const msgB = db.prepare("INSERT INTO messages (organization_id, vendor_id, direction, body, status, sent_at) VALUES (?, ?, 'out', 'hi', 'sent', ?)").run(orgB, vB2, now).lastInsertRowid;
    scheduler.scheduleFollowups();
    const fA = db.prepare('SELECT COUNT(*) c FROM followups WHERE parent_message_id = ?').get(msgA).c;
    const fB = db.prepare('SELECT COUNT(*) c FROM followups WHERE parent_message_id = ?').get(msgB).c;
    assert(fA === 1, "scheduler creates a follow-up for the rule's OWN org message");
    assert(fB === 0, 'scheduler never schedules an org A rule against an org B message');

  } catch (e) {
    fail('unexpected error: ' + (e && e.stack ? e.stack : e));
  } finally {
    server.close();
    try { db.close(); } catch (_) {}
    for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + suffix); } catch (_) {} }
    console.log(failed ? `\nTENANT ISOLATION TEST: FAILED (${failed})` : '\nTENANT ISOLATION TEST: PASSED');
    process.exit(failed ? 1 : 0);
  }
});
