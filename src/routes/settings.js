const express = require('express');
const db = require('../db');
const settings = require('../settings');
const { requirePerm } = require('../permissions');

const router = express.Router();

const EXPORT_VERSION = 1;
// Sensitive values that must never be sent to the client. Includes the
// Anthropic API key and inbound-webhook signing secrets (OWASP A02 — sensitive
// data exposure / hard-coded-secret leakage).
const SECRET_KEYS = new Set(['resend_webhook_secret', 'mailgun_signing_key', 'anthropic_api_key', 'gemini_api_key', 'foursquare_api_key', 'here_api_key', 'tomtom_api_key',
  'voice_webhook_secret', 'voice_vapi_key', 'voice_retell_key']);

// Return settings for the UI with every secret redacted. The UI gets a
// `secrets_set` map so it can show "configured / not configured" without ever
// receiving the secret material itself.
router.get('/', (req, res) => {
  const all = settings.getAll();
  const values = {};
  const secrets_set = {};
  for (const [k, v] of Object.entries(all)) {
    if (SECRET_KEYS.has(k)) {
      secrets_set[k] = !!(v && String(v).length);
      values[k] = ''; // redacted — never expose secret material client-side
    } else {
      values[k] = v;
    }
  }
  res.json({ values, secrets_set, defaults: settings.DEFAULTS, env_keys: settings.ENV_MAP });
});

router.put('/', requirePerm('settings.manage'), (req, res) => {
  const updates = req.body || {};
  const allowed = Object.keys(settings.DEFAULTS);
  const applied = {};
  for (const k of Object.keys(updates)) {
    if (!allowed.includes(k)) continue;
    const v = updates[k];
    // Never clobber a configured secret with a blank value — the UI submits the
    // redacted (empty) field on every save, so a blank means "leave unchanged".
    if (SECRET_KEYS.has(k) && (v == null || String(v) === '')) continue;
    settings.set(k, v);
    applied[k] = SECRET_KEYS.has(k) ? '(updated)' : v;
  }
  // Re-read but redact secrets in the echoed values.
  const safeValues = {};
  for (const [k, v] of Object.entries(settings.getAll())) safeValues[k] = SECRET_KEYS.has(k) ? '' : v;
  res.json({ ok: true, applied, values: safeValues });
});

router.get('/export', requirePerm('settings.manage'), (req, res) => {
  const includeSecrets = req.query.include_secrets === '1';

  const settingsRows = db.prepare('SELECT key, value FROM settings').all();
  const settingsObj = {};
  for (const row of settingsRows) {
    if (!includeSecrets && SECRET_KEYS.has(row.key)) continue;
    settingsObj[row.key] = row.value;
  }

  const templates = db.prepare(
    'SELECT name, body, category FROM templates ORDER BY id'
  ).all();
  const email_templates = db.prepare(
    'SELECT name, subject, body_html, body_text, category FROM email_templates ORDER BY id'
  ).all();
  const followup_rules = db.prepare(`
    SELECT r.name, r.trigger, r.delay_hours, r.max_attempts, r.active, r.stop_on_reply,
           COALESCE(r.channel, 'whatsapp') AS channel,
           CASE WHEN r.channel = 'email' THEN et.name ELSE t.name END AS template_name
    FROM followup_rules r
    LEFT JOIN templates t ON t.id = r.template_id AND COALESCE(r.channel, 'whatsapp') = 'whatsapp'
    LEFT JOIN email_templates et ON et.id = r.template_id AND r.channel = 'email'
    ORDER BY r.id
  `).all();

  const bundle = {
    version: EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    secrets_included: includeSecrets,
    settings: settingsObj,
    templates,
    email_templates,
    followup_rules,
  };

  const filename = `wa-crm-config-${new Date().toISOString().slice(0, 10)}.json`;
  res.set('Content-Type', 'application/json');
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(JSON.stringify(bundle, null, 2));
});

router.post('/import', requirePerm('settings.manage'), (req, res) => {
  const bundle = req.body;
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    return res.status(400).json({ error: 'invalid_bundle' });
  }
  if (typeof bundle.version !== 'number' || bundle.version > EXPORT_VERSION) {
    return res.status(400).json({ error: 'unsupported_version', supported: EXPORT_VERSION });
  }
  const mode = req.query.mode === 'replace' ? 'replace' : 'merge';
  const counts = { settings: 0, templates: 0, email_templates: 0, followup_rules: 0 };
  const skipped = { followup_rules_missing_template: [] };

  const tx = db.transaction(() => {
    if (bundle.settings && typeof bundle.settings === 'object') {
      const allowed = new Set(Object.keys(settings.DEFAULTS));
      if (mode === 'replace') db.prepare('DELETE FROM settings').run();
      for (const [k, v] of Object.entries(bundle.settings)) {
        if (!allowed.has(k)) continue;
        // skip empty secrets so a redacted bundle doesn't clobber a configured value
        if (SECRET_KEYS.has(k) && (v == null || v === '')) continue;
        settings.set(k, v);
        counts.settings++;
      }
    }

    if (Array.isArray(bundle.templates)) {
      if (mode === 'replace') db.prepare('DELETE FROM templates').run();
      const findByName = db.prepare('SELECT id FROM templates WHERE name = ?');
      const ins = db.prepare('INSERT INTO templates (name, body, category) VALUES (?, ?, ?)');
      const upd = db.prepare('UPDATE templates SET body = ?, category = ?, updated_at = ? WHERE name = ?');
      for (const t of bundle.templates) {
        if (!t || !t.name || !t.body) continue;
        if (findByName.get(t.name)) upd.run(t.body, t.category || null, Date.now(), t.name);
        else ins.run(t.name, t.body, t.category || null);
        counts.templates++;
      }
    }

    if (Array.isArray(bundle.email_templates)) {
      if (mode === 'replace') db.prepare('DELETE FROM email_templates').run();
      const findByName = db.prepare('SELECT id FROM email_templates WHERE name = ?');
      const ins = db.prepare(
        'INSERT INTO email_templates (name, subject, body_html, body_text, category) VALUES (?, ?, ?, ?, ?)'
      );
      const upd = db.prepare(
        'UPDATE email_templates SET subject = ?, body_html = ?, body_text = ?, category = ? WHERE name = ?'
      );
      for (const t of bundle.email_templates) {
        if (!t || !t.name || !t.subject || !t.body_html) continue;
        if (findByName.get(t.name)) upd.run(t.subject, t.body_html, t.body_text || null, t.category || null, t.name);
        else ins.run(t.name, t.subject, t.body_html, t.body_text || null, t.category || null);
        counts.email_templates++;
      }
    }

    if (Array.isArray(bundle.followup_rules)) {
      if (mode === 'replace') db.prepare('DELETE FROM followup_rules').run();
      const findRule = db.prepare('SELECT id FROM followup_rules WHERE name = ?');
      const findWaTpl = db.prepare('SELECT id FROM templates WHERE name = ?');
      const findEmailTpl = db.prepare('SELECT id FROM email_templates WHERE name = ?');
      const ins = db.prepare(`
        INSERT INTO followup_rules (name, trigger, delay_hours, template_id, max_attempts, active, stop_on_reply, channel)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const upd = db.prepare(`
        UPDATE followup_rules
        SET trigger = ?, delay_hours = ?, template_id = ?, max_attempts = ?, active = ?, stop_on_reply = ?, channel = ?
        WHERE name = ?
      `);
      for (const r of bundle.followup_rules) {
        if (!r || !r.name || !r.trigger || !r.delay_hours || !r.template_name) continue;
        const channel = r.channel === 'email' ? 'email' : 'whatsapp';
        const tpl = channel === 'email' ? findEmailTpl.get(r.template_name) : findWaTpl.get(r.template_name);
        if (!tpl) {
          skipped.followup_rules_missing_template.push({ rule: r.name, template: r.template_name, channel });
          continue;
        }
        const args = [
          r.trigger, r.delay_hours, tpl.id,
          r.max_attempts == null ? 3 : r.max_attempts,
          r.active == null ? 1 : r.active,
          r.stop_on_reply == null ? 1 : r.stop_on_reply,
          channel,
        ];
        if (findRule.get(r.name)) upd.run(...args, r.name);
        else ins.run(r.name, ...args);
        counts.followup_rules++;
      }
    }
  });

  try {
    tx();
    settings.reload();
    res.json({ ok: true, mode, counts, skipped });
  } catch (e) {
    res.status(400).json({ error: 'import_failed', message: e.message });
  }
});

module.exports = router;
