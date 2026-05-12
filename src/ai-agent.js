// =============================================================
// AI agent — draft-only Claude integration.
//
// On inbound message (or on-demand via API), pulls the last 20 thread
// messages + business profile from settings, calls Claude Messages API,
// and stores the suggested reply in `ai_drafts` for the user to approve.
//
// Requires settings.anthropic_api_key. Falls back gracefully if missing.
// Uses prompt caching on the system prompt to keep costs minimal.
// =============================================================
const db = require('./db');
const settings = require('./settings');

// Lightweight HTTPS POST — avoid pulling the full Anthropic SDK as a dep.
const https = require('https');

const ANTHROPIC_API_HOST = 'api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';

function postJson({ host, path, headers, body }) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      host, path, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed;
        try { parsed = JSON.parse(text); } catch (_) { parsed = { raw: text }; }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
        else reject(new Error(`anthropic_${res.statusCode}: ${parsed.error ? parsed.error.message : text.slice(0, 200)}`));
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function getKey() {
  const key = settings.get('anthropic_api_key') || process.env.ANTHROPIC_API_KEY || '';
  if (!key) throw new Error('anthropic_api_key_not_set');
  return key;
}

function getModel() {
  return settings.get('ai_model') || 'claude-sonnet-4-6';
}

function buildSystem() {
  const profile = settings.get('ai_business_profile') || 'I run a small WhatsApp outreach business.';
  return [
    {
      type: 'text',
      cache_control: { type: 'ephemeral' },
      text: [
        'You are an AI sales assistant for a CRM. Your job is to draft a friendly, concise WhatsApp reply to a contact based on the conversation so far.',
        '',
        'Rules:',
        '- Keep replies under 4 sentences.',
        '- Match the contact\'s language: if they wrote Hindi/Hinglish, reply in Hinglish. If English, reply in English.',
        '- Be warm and professional, not pushy.',
        '- Never invent prices, stock, dates, or customer names.',
        '- If the contact asks something you cannot answer, suggest the user follow up personally.',
        '- Output JSON: {"reply": "...", "rationale": "...", "confidence": "low|med|high"}',
        '',
        'Business context:',
        profile,
      ].join('\n'),
    },
  ];
}

function fetchThread(vendorId, limit = 20) {
  const messages = db.prepare(`
    SELECT direction, body, created_at FROM messages
    WHERE vendor_id = ? AND body IS NOT NULL AND body <> ''
    ORDER BY created_at DESC LIMIT ?
  `).all(vendorId, limit);
  return messages.reverse();
}

function fetchVendor(vendorId) {
  return db.prepare('SELECT * FROM vendors WHERE id = ?').get(vendorId);
}

async function draftReply(vendorId, { trigger = 'manual' } = {}) {
  const key = getKey();
  const vendor = fetchVendor(vendorId);
  if (!vendor) throw new Error('vendor_not_found');
  const thread = fetchThread(vendorId, 20);
  if (!thread.length) throw new Error('no_messages_to_reply_to');

  // Skip if a pending draft already exists
  const existing = db.prepare(`SELECT id FROM ai_drafts WHERE vendor_id = ? AND status = 'pending'`).get(vendorId);
  if (existing) return { skipped: true, draft_id: existing.id };

  const userBlock = [
    `Contact: ${vendor.name}` + (vendor.company && vendor.company !== vendor.name ? ` (${vendor.company})` : ''),
    vendor.title ? `Role/notes: ${vendor.title}` : null,
    vendor.city ? `City: ${vendor.city}` : null,
    vendor.category ? `Type: ${vendor.category}` : null,
    '',
    'Conversation history (oldest → newest):',
    ...thread.map((m) => `[${m.direction === 'in' ? 'them' : 'us'}] ${m.body}`),
    '',
    'Draft a reply for "us" to send next.',
  ].filter(Boolean).join('\n');

  const result = await postJson({
    host: ANTHROPIC_API_HOST,
    path: '/v1/messages',
    headers: {
      'x-api-key': key,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: {
      model: getModel(),
      max_tokens: 600,
      system: buildSystem(),
      messages: [{ role: 'user', content: userBlock }],
    },
  });

  const text = (result.content || []).map((c) => c.text || '').join('');
  let parsed;
  try { parsed = JSON.parse(text); } catch (_) {
    // Sometimes Claude wraps the JSON in markdown. Strip code fences.
    const stripped = text.replace(/```(?:json)?\n?/g, '').replace(/```$/g, '').trim();
    try { parsed = JSON.parse(stripped); } catch (_2) {
      parsed = { reply: text, rationale: '(could not parse rationale)', confidence: 'low' };
    }
  }

  const r = db.prepare(`
    INSERT INTO ai_drafts (vendor_id, channel, trigger, body, rationale, status, model)
    VALUES (?, 'whatsapp', ?, ?, ?, 'pending', ?)
  `).run(vendorId, trigger, parsed.reply || '(empty)', parsed.rationale || '', getModel());

  return {
    draft_id: r.lastInsertRowid,
    body: parsed.reply,
    rationale: parsed.rationale,
    confidence: parsed.confidence,
    usage: result.usage,
  };
}

function listDrafts({ status = 'pending', vendor_id = null } = {}) {
  const filters = [];
  const params = {};
  if (status) { filters.push('d.status = @status'); params.status = status; }
  if (vendor_id) { filters.push('d.vendor_id = @vendor_id'); params.vendor_id = vendor_id; }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  return db.prepare(`
    SELECT d.*, v.name AS vendor_name, v.phone AS vendor_phone
    FROM ai_drafts d JOIN vendors v ON v.id = d.vendor_id
    ${where} ORDER BY d.created_at DESC LIMIT 200
  `).all(params);
}

function approveDraft(draftId) {
  const draft = db.prepare('SELECT * FROM ai_drafts WHERE id = ?').get(draftId);
  if (!draft) throw new Error('draft_not_found');
  if (draft.status !== 'pending') throw new Error('draft_not_pending');
  const wa = require('./whatsapp');
  const r = db.prepare(`
    INSERT INTO messages (vendor_id, direction, body, status) VALUES (?, 'out', ?, 'queued')
  `).run(draft.vendor_id, draft.body);
  db.prepare(`UPDATE ai_drafts SET status = 'sent', acted_at = ? WHERE id = ?`).run(Date.now(), draftId);
  wa.enqueueMessage(r.lastInsertRowid);
  return { ok: true, message_id: r.lastInsertRowid };
}

function dismissDraft(draftId) {
  db.prepare(`UPDATE ai_drafts SET status = 'dismissed', acted_at = ? WHERE id = ?`).run(Date.now(), draftId);
  return { ok: true };
}

function editDraft(draftId, body) {
  db.prepare('UPDATE ai_drafts SET body = ? WHERE id = ?').run(body, draftId);
  return { ok: true };
}

// Inbound auto-draft: called from automation engine when a message arrives.
// Won't fire if ai_auto_draft_inbound = 0 or if no API key set.
async function maybeAutoDraftInbound(vendorId) {
  if (settings.get('ai_auto_draft_inbound') !== '1') return;
  if (!settings.get('anthropic_api_key') && !process.env.ANTHROPIC_API_KEY) return;
  try {
    return await draftReply(vendorId, { trigger: 'inbound' });
  } catch (e) {
    console.error('[ai] auto-draft failed:', e.message);
  }
}

module.exports = { draftReply, listDrafts, approveDraft, dismissDraft, editDraft, maybeAutoDraftInbound };
