// ---------------------------------------------------------------------------
// Voice AI Agent routes (mounted at /api/voice in server.js).
//
// Split into two trust zones:
//   • /webhook  — PUBLIC. The voice provider (Vapi/Retell) POSTs call events here
//     with no CRM session. Whitelisted in auth PUBLIC_PATHS; authenticated by a
//     shared secret verified INSIDE the handler (same model as the Twilio/Stripe
//     webhooks). This is why voice routes live here and not in the module router
//     (which sits behind the auth + module gate).
//   • everything else — authenticated dashboard/API: place AI calls, list/inspect
//     transcribed calls, analytics, and manage the knowledge base.
// ---------------------------------------------------------------------------

const crypto = require('crypto');
const express = require('express');
const db = require('../db');
const telephony = require('../telephony');
const voice = require('../voice-agent');
const settings = require('../settings');
const { body, S } = require('../validate');
const { orgFilter } = require('../tenancy');
const { requirePerm } = require('../permissions');

const router = express.Router();

// --- PUBLIC: provider event webhook ---------------------------------------
// Verifies the shared secret (X-Vapi-Secret / x-webhook-token / ?token=) against
// settings.voice_webhook_secret. If no secret is configured we accept (dev), so
// the pipeline works out of the box; set one before exposing the URL publicly.
router.post('/webhook', async (req, res) => {
  const secret = voice.serverSecret();
  if (secret) {
    const provided = String(req.get('x-vapi-secret') || req.get('x-webhook-token') || req.query.token || '');
    const a = Buffer.from(provided);
    const b = Buffer.from(secret);
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!ok) return res.status(401).json({ error: 'bad_secret' });
  } else if (process.env.NODE_ENV === 'production') {
    // Fail closed in production: an unconfigured secret must NOT mean "accept
    // anything", or anyone could POST forged call events. Mirrors the email
    // (rejectIfRequired) and Stripe webhook behaviour.
    return res.status(401).json({ error: 'webhook_secret_not_configured' });
  }
  try {
    const result = await voice.handleWebhook(req.body || {});
    return res.json(result || {});
  } catch (e) {
    console.error('[voice:webhook] handler error:', e.message);
    // 200 so the provider doesn't spam retries on our processing errors.
    return res.json({ error: 'processing_error' });
  }
});

// --- AUTHENTICATED from here on -------------------------------------------

// Providers + readiness for the settings/console UI.
router.get('/providers', (req, res) => {
  res.json({
    active: voice.activeProvider(),
    configured: voice.voiceConfigured(),
    server_url_set: !!voice.serverUrl(),
    providers: telephony.providers().filter((p) => ['log', 'vapi', 'retell'].includes(p.key)),
  });
});

// Non-secret voice config for the console (persona, provider state).
router.get('/config', (req, res) => {
  res.json({
    company_name: voice.companyName(),
    agent_name: voice.agentName(),
    provider: voice.activeProvider(),
    configured: voice.voiceConfigured(),
    server_url_set: !!voice.serverUrl(),
    recording: settings.get('voice_recording') !== '0',
    qualified_score: Number(settings.get('voice_qualified_score')) || 70,
  });
});

// Place an autonomous AI voice call to a contact. Persists the `calls` row first
// (org-stamped, mode='ai'), builds the multilingual assistant, and hands it to the
// active AI provider. With no provider configured it records a dry-run intent so
// the flow works end-to-end out of the box (same philosophy as the 'log' dialer).
router.post('/dial', requirePerm('voice.make'), body({
  vendor_id: S.int({ min: 1 }),
  product: S.string({ maxLength: 120 }),
}), async (req, res) => {
  const { vendor_id, product } = req.body || {};
  if (!vendor_id) return res.status(400).json({ error: 'vendor_id_required' });
  const vendor = db.prepare(`SELECT * FROM vendors WHERE id = @id AND ${orgFilter()}`).get({ id: vendor_id, orgId: req.orgId });
  if (!vendor) return res.status(404).json({ error: 'vendor_not_found' });
  if (!vendor.phone) return res.status(400).json({ error: 'vendor_has_no_phone' });

  const suppressed = db.prepare(`SELECT 1 FROM suppressions WHERE phone = @phone AND ${orgFilter()} LIMIT 1`)
    .get({ phone: String(vendor.phone).replace(/\D/g, ''), orgId: req.orgId });
  if (suppressed) return res.status(409).json({ error: 'contact_suppressed' });

  const providerKey = voice.activeProvider();
  const ready = (() => { try { return telephony.isReady(providerKey); } catch (_) { return false; } })();

  const r = db.prepare(`
    INSERT INTO calls (organization_id, vendor_id, direction, mode, disposition, status, provider, assistant, caller)
    VALUES (?, ?, 'out', 'ai', 'initiated', 'initiated', ?, ?, ?)
  `).run(req.orgId, vendor.id, providerKey, product || null, (req.user && req.user.name) || 'AI agent');
  const callId = r.lastInsertRowid;

  const metadata = { callId, orgId: req.orgId, vendorId: vendor.id };

  // Dry-run path: no AI provider configured, or provider explicitly 'log'.
  if (providerKey === 'log' || !ready) {
    db.prepare('UPDATE calls SET status = ? WHERE id = ?').run('initiated', callId);
    return res.json({
      id: callId, provider: providerKey, status: 'initiated', dry_run: true,
      to: vendor.phone,
      note: providerKey === 'log'
        ? 'Voice provider is set to dry-run (log). Set voice_provider=vapi and add credentials to place a real AI call.'
        : `Provider "${providerKey}" is selected but not configured — recorded a dry-run. Add its API key + phone number in settings.`,
    });
  }

  try {
    const assistant = voice.buildAssistant({ orgId: req.orgId, vendor, product, metadata });
    const result = await telephony.placeCallWith(providerKey, { to: vendor.phone, assistant, metadata });
    db.prepare('UPDATE calls SET status = ?, provider_call_id = ? WHERE id = ?')
      .run(result.status || 'initiated', result.providerCallId || null, callId);
    db.prepare(`UPDATE vendors SET last_contacted_at = @now, updated_at = @now,
        status = CASE WHEN status = 'new' THEN 'contacted' ELSE status END
      WHERE id = @id AND ${orgFilter()}`).run({ now: Date.now(), id: vendor.id, orgId: req.orgId });
    res.json({ id: callId, provider: providerKey, status: result.status || 'initiated', dry_run: false, to: vendor.phone, provider_call_id: result.providerCallId });
  } catch (e) {
    db.prepare('UPDATE calls SET status = ? WHERE id = ?').run('failed', callId);
    res.status(502).json({ error: 'dial_failed', detail: e.message, provider: providerKey, id: callId });
  }
});

// List AI-mode calls (newest first).
router.get('/', (req, res) => {
  const { vendor_id, limit = 100 } = req.query;
  const filters = [orgFilter('c'), "c.mode = 'ai'"];
  const params = { orgId: req.orgId, limit: Math.min(Number(limit) || 100, 500) };
  if (vendor_id) { filters.push('c.vendor_id = @vendor_id'); params.vendor_id = vendor_id; }
  const rows = db.prepare(`
    SELECT c.id, c.vendor_id, c.status, c.disposition, c.outcome, c.sentiment, c.lead_score,
           c.language, c.summary, c.next_step, c.meeting_at, c.handoff, c.duration_sec,
           c.recording_url, c.cost, c.ended_reason, c.assistant, c.provider, c.created_at,
           v.name AS vendor_name, v.phone AS vendor_phone, v.company AS vendor_company
    FROM calls c JOIN vendors v ON v.id = c.vendor_id
    WHERE ${filters.join(' AND ')}
    ORDER BY c.created_at DESC LIMIT @limit
  `).all(params);
  res.json(rows);
});

// Analytics summary for the console.
router.get('/stats/summary', (req, res) => {
  const sinceDays = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
  res.json(voice.stats(req.orgId, { sinceDays }));
});

// Full call detail + turn-by-turn transcript / tool-call trail.
router.get('/:id(\\d+)', (req, res) => {
  const call = db.prepare(`
    SELECT c.*, v.name AS vendor_name, v.phone AS vendor_phone, v.company AS vendor_company
    FROM calls c JOIN vendors v ON v.id = c.vendor_id
    WHERE c.id = @id AND ${orgFilter('c')}
  `).get({ id: req.params.id, orgId: req.orgId });
  if (!call) return res.status(404).json({ error: 'call_not_found' });
  const events = db.prepare(`
    SELECT role, type, tool_name, content, created_at FROM call_events
    WHERE call_id = @id AND organization_id = @orgId AND deleted_at IS NULL
    ORDER BY created_at ASC, id ASC LIMIT 2000
  `).all({ id: req.params.id, orgId: req.orgId });
  let structured = null;
  if (call.structured_json) { try { structured = JSON.parse(call.structured_json); } catch (_) {} }
  res.json({ call: { ...call, structured }, events });
});

// --- Knowledge base (RAG source the agent answers from) --------------------
router.get('/kb', requirePerm('voice.read'), (req, res) => {
  const q = req.query.q ? `%${String(req.query.q)}%` : null;
  const filters = [orgFilter()];
  const params = { orgId: req.orgId };
  if (q) { filters.push('(title LIKE @q OR content LIKE @q OR tags LIKE @q OR product LIKE @q)'); params.q = q; }
  const rows = db.prepare(`SELECT * FROM kb_articles WHERE ${filters.join(' AND ')} ORDER BY updated_at DESC LIMIT 500`).all(params);
  res.json(rows);
});

router.post('/kb', requirePerm('voice.manage'), body({
  title: S.string({ maxLength: 200 }),
  content: S.text({ maxLength: 20000 }),
  product: S.string({ maxLength: 120 }),
  tags: S.string({ maxLength: 500 }),
}), (req, res) => {
  const { title, content, product, tags } = req.body || {};
  if (!title || !content) return res.status(400).json({ error: 'title_and_content_required' });
  const r = db.prepare(`INSERT INTO kb_articles (organization_id, product, title, content, tags) VALUES (?, ?, ?, ?, ?)`)
    .run(req.orgId, product || null, title, content, tags || null);
  res.json({ id: r.lastInsertRowid });
});

router.put('/kb/:id(\\d+)', requirePerm('voice.manage'), body({
  title: S.string({ maxLength: 200 }),
  content: S.text({ maxLength: 20000 }),
  product: S.string({ maxLength: 120 }),
  tags: S.string({ maxLength: 500 }),
  active: S.int({ min: 0, max: 1 }),
}), (req, res) => {
  const allowed = ['title', 'content', 'product', 'tags', 'active'];
  const sets = [], params = { id: req.params.id, orgId: req.orgId, now: Date.now() };
  for (const k of allowed) if (req.body[k] !== undefined) { sets.push(`${k} = @${k}`); params[k] = req.body[k]; }
  if (!sets.length) return res.json({ ok: true });
  sets.push('updated_at = @now');
  db.prepare(`UPDATE kb_articles SET ${sets.join(', ')} WHERE id = @id AND ${orgFilter()}`).run(params);
  res.json({ ok: true });
});

router.delete('/kb/:id(\\d+)', requirePerm('voice.manage'), (req, res) => {
  db.prepare(`UPDATE kb_articles SET deleted_at = @now WHERE id = @id AND ${orgFilter()}`)
    .run({ id: req.params.id, orgId: req.orgId, now: Date.now() });
  res.json({ ok: true });
});

module.exports = router;
