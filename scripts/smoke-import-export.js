// Smoke test: export+import roundtrip against the real DB.
// Mounts only the /api/settings route — does not start WhatsApp or scheduler.
const express = require('express');
const http = require('http');
const db = require('../src/db');
const settings = require('../src/settings');

const app = express();
app.use(express.json({ limit: '10mb' }));
// Stand in for the real auth + tenant middleware (server.js mounts these before
// the routers). The settings export/import routes are gated by
// requirePerm('settings.manage'); without an authenticated user they 401.
app.use((req, _res, next) => {
  req.user = { id: 1, name: 'smoke', role: 'super_admin' };
  req.orgRole = 'super_admin';
  next();
});
app.use('/api/settings', require('../src/routes/settings'));

const server = app.listen(0, async () => {
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  let failed = false;
  const fail = (msg) => { failed = true; console.error('FAIL:', msg); };
  const ok = (msg) => console.log('PASS:', msg);

  const fetchJson = async (path, opts = {}) => {
    const r = await fetch(base + path, opts);
    const text = await r.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    return { status: r.status, body, headers: Object.fromEntries(r.headers) };
  };

  try {
    // Snapshot pre-state so we can restore at the end
    const preSettings = db.prepare('SELECT key, value FROM settings').all();

    // 1) Seed two recognizable values + a fake secret
    settings.set('default_country_code', '44');
    settings.set('test_number', '+15551234567');
    settings.set('resend_webhook_secret', 'whsec_smoketest_xyz');

    // Ensure at least one whatsapp template + one email template + one rule are present
    const tplName = '__smoke_tpl_' + Date.now();
    db.prepare('INSERT INTO templates (name, body, category) VALUES (?, ?, ?)')
      .run(tplName, 'Hello {{name}}', 'smoke');
    const emTplName = '__smoke_em_' + Date.now();
    db.prepare(
      'INSERT INTO email_templates (name, subject, body_html, body_text, category) VALUES (?, ?, ?, ?, ?)'
    ).run(emTplName, 'Smoke Subject', '<p>hi</p>', 'hi', 'smoke');
    const tplId = db.prepare('SELECT id FROM templates WHERE name = ?').get(tplName).id;
    const ruleName = '__smoke_rule_' + Date.now();
    db.prepare(`
      INSERT INTO followup_rules (name, trigger, delay_hours, template_id, max_attempts, active, stop_on_reply, channel)
      VALUES (?, 'no_reply', 48, ?, 2, 1, 1, 'whatsapp')
    `).run(ruleName, tplId);

    // 2) Export WITHOUT secrets — verify redaction
    const exp1 = await fetchJson('/api/settings/export');
    if (exp1.status !== 200) fail(`export(no secrets) status=${exp1.status}`);
    if (exp1.body.version !== 1) fail('export version != 1');
    if (exp1.body.secrets_included !== false) fail('secrets_included should be false');
    if ('resend_webhook_secret' in exp1.body.settings) fail('secret leaked when not requested');
    if (exp1.body.settings.default_country_code !== '44') fail('default_country_code missing from export');
    if (!exp1.body.templates.find((t) => t.name === tplName)) fail('wa template missing from export');
    if (!exp1.body.email_templates.find((t) => t.name === emTplName)) fail('email template missing');
    const ruleInBundle = exp1.body.followup_rules.find((r) => r.name === ruleName);
    if (!ruleInBundle) fail('rule missing from export');
    if (ruleInBundle && ruleInBundle.template_name !== tplName) fail('rule.template_name not resolved');
    ok('export without secrets returns redacted bundle');

    // 3) Export WITH secrets
    const exp2 = await fetchJson('/api/settings/export?include_secrets=1');
    if (exp2.body.secrets_included !== true) fail('secrets_included should be true');
    if (exp2.body.settings.resend_webhook_secret !== 'whsec_smoketest_xyz') fail('secret missing when requested');
    ok('export with secrets includes redacted keys');

    // 4) Mutate state, then import the redacted bundle in MERGE mode
    settings.set('default_country_code', '99'); // change to verify import overwrites
    settings.set('test_number', 'CHANGED');
    db.prepare('DELETE FROM templates WHERE name = ?').run(tplName); // delete to verify re-insert
    db.prepare('DELETE FROM followup_rules WHERE name = ?').run(ruleName);

    const imp1 = await fetchJson('/api/settings/import?mode=merge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(exp1.body), // redacted bundle (no secret)
    });
    if (imp1.status !== 200 || !imp1.body.ok) fail(`import status=${imp1.status} body=${JSON.stringify(imp1.body)}`);
    if (settings.get('default_country_code') !== '44') fail('merge did not restore default_country_code');
    if (settings.get('test_number') !== '+15551234567') fail('merge did not restore test_number');
    // secret was redacted in bundle and import should NOT have wiped the existing one
    if (settings.get('resend_webhook_secret') !== 'whsec_smoketest_xyz') fail('redacted-secret import wiped existing secret');
    if (!db.prepare('SELECT id FROM templates WHERE name = ?').get(tplName)) fail('wa template not re-inserted');
    const restoredRule = db.prepare('SELECT * FROM followup_rules WHERE name = ?').get(ruleName);
    if (!restoredRule) fail('rule not restored');
    if (restoredRule && restoredRule.delay_hours !== 48) fail('rule delay_hours mismatch');
    ok('merge import restores values, redacted secret preserves existing');

    // 5) Bad version rejected
    const bad = await fetchJson('/api/settings/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: 99 }),
    });
    if (bad.status !== 400 || bad.body.error !== 'unsupported_version') fail(`bad version not rejected: ${JSON.stringify(bad)}`);
    ok('unsupported_version rejected');

    // 6) Rule referencing missing template is skipped, not errored
    const badBundle = {
      version: 1,
      settings: {},
      templates: [],
      email_templates: [],
      followup_rules: [{
        name: '__smoke_orphan_' + Date.now(),
        trigger: 'no_reply',
        delay_hours: 24,
        template_name: '__definitely_not_a_real_template__',
        channel: 'whatsapp',
      }],
    };
    const orphan = await fetchJson('/api/settings/import?mode=merge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(badBundle),
    });
    if (orphan.status !== 200) fail('orphan rule import failed');
    if (!orphan.body.skipped.followup_rules_missing_template.length) fail('orphan rule should have been reported as skipped');
    ok('rule with missing template is skipped, not errored');

    // 7) Cleanup
    db.prepare('DELETE FROM templates WHERE name = ?').run(tplName);
    db.prepare('DELETE FROM email_templates WHERE name = ?').run(emTplName);
    db.prepare('DELETE FROM followup_rules WHERE name = ?').run(ruleName);
    // restore settings to pre-test values
    db.prepare('DELETE FROM settings').run();
    const restoreStmt = db.prepare(
      'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)'
    );
    for (const r of preSettings) restoreStmt.run(r.key, r.value, Date.now());
    settings.reload();

    console.log(failed ? '\nSMOKE TEST: FAILED' : '\nSMOKE TEST: PASSED');
    server.close(() => process.exit(failed ? 1 : 0));
  } catch (e) {
    console.error('exception:', e);
    server.close(() => process.exit(1));
  }
});
