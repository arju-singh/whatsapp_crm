// Smoke test for the Voice AI Agent: schema migration, assistant builder,
// mid-call tool execution against the CRM, and provider-webhook ingestion.
// Runs against the real dev DB with a throwaway contact, then cleans up.
//
//   node scripts/smoke-voice.js
//
// Exits non-zero on the first failed assertion.

const assert = (cond, msg) => { if (!cond) { console.error('  ✗ ' + msg); process.exit(1); } console.log('  ✓ ' + msg); };

const db = require('../src/db');
require('../src/tenancy');                 // adds organization_id/deleted_at to calls, etc.
const modules = require('../src/modules/registry');
modules.init(db);                          // runs the voice module migration
const voice = require('../src/voice-agent');
const settings = require('../src/settings');

const ORG = 1;
const PHONE = '910000000199';              // unlikely-to-exist test number
let vendorId, callId, kbId;

function cleanup() {
  try {
    if (vendorId) {
      db.prepare('DELETE FROM calls WHERE vendor_id = ?').run(vendorId);
      db.prepare('DELETE FROM tasks WHERE vendor_id = ?').run(vendorId);
      db.prepare('DELETE FROM calendar_events WHERE contact_id = ?').run(vendorId);
      db.prepare('DELETE FROM vendors WHERE id = ?').run(vendorId);
    }
    if (kbId) db.prepare('DELETE FROM kb_articles WHERE id = ?').run(kbId);
    if (callId) db.prepare('DELETE FROM call_events WHERE call_id = ?').run(callId);
  } catch (e) { console.error('cleanup warn:', e.message); }
}

(async () => {
  console.log('\n[1] schema migration');
  const cols = db.prepare('PRAGMA table_info(calls)').all().map((r) => r.name);
  for (const c of ['mode', 'transcript', 'summary', 'sentiment', 'lead_score', 'meeting_at', 'structured_json']) {
    assert(cols.includes(c), `calls.${c} column exists`);
  }
  assert(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='call_events'").get(), 'call_events table exists');
  assert(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='kb_articles'").get(), 'kb_articles table exists');

  console.log('\n[2] fixtures');
  db.prepare('DELETE FROM vendors WHERE phone = ?').run(PHONE); // idempotent re-run
  vendorId = db.prepare(`INSERT INTO vendors (name, phone, company, status, organization_id) VALUES (?, ?, ?, 'new', ?)`)
    .run('Test Prospect', PHONE, 'Test Co', ORG).lastInsertRowid;
  callId = db.prepare(`INSERT INTO calls (organization_id, vendor_id, direction, mode, status, provider) VALUES (?, ?, 'out', 'ai', 'initiated', 'log')`)
    .run(ORG, vendorId).lastInsertRowid;
  kbId = db.prepare(`INSERT INTO kb_articles (organization_id, product, title, content, tags) VALUES (?, 'ZetsGeo', 'ZetsGeo pricing', 'ZetsGeo starts at 4999 INR per month for rental verification.', 'pricing')`)
    .run(ORG).lastInsertRowid;
  assert(vendorId && callId && kbId, 'inserted vendor, call, kb article');

  console.log('\n[3] assistant builder');
  const vendor = db.prepare('SELECT * FROM vendors WHERE id = ?').get(vendorId);
  const asst = voice.buildAssistant({ orgId: ORG, vendor, product: 'ZetsGeo', metadata: { callId, orgId: ORG, vendorId } });
  assert(asst.model && Array.isArray(asst.model.tools) && asst.model.tools.length >= 6, 'assistant advertises tool schemas');
  assert(asst.model.messages[0].content.includes(voice.agentName()), 'system prompt carries the agent persona');
  assert(asst.model.messages[0].content.toLowerCase().includes('ai assistant'), 'system prompt discloses AI identity');
  assert(asst.metadata.callId === callId, 'assistant metadata links back to the call');

  const ctx = { orgId: ORG, callId, vendorId };

  console.log('\n[4] tool: knowledge_base_search');
  const kb = await voice.executeTool('knowledge_base_search', { query: 'ZetsGeo pricing' }, ctx);
  assert(kb.hits && kb.hits.length === 1 && /4999/.test(kb.hits[0].answer), 'RAG search returns the KB fact');

  console.log('\n[5] tool: log_call_outcome');
  await voice.executeTool('log_call_outcome', { summary: 'Interested in rental verification.', sentiment: 'positive', lead_score: 82, interested_products: 'ZetsGeo', next_step: 'Send WA details', outcome: 'qualified' }, ctx);
  let call = db.prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  assert(call.sentiment === 'positive' && call.lead_score === 82 && call.summary, 'call outcome persisted');
  let v = db.prepare('SELECT * FROM vendors WHERE id = ?').get(vendorId);
  assert(v.score === 82 && v.status === 'contacted', 'vendor score/status synced from outcome');

  console.log('\n[6] tool: schedule_meeting');
  const when = '2026-08-01T15:30:00+05:30';
  const mtg = await voice.executeTool('schedule_meeting', { datetime: when, title: 'ZetsGeo demo' }, ctx);
  assert(mtg.ok, 'schedule_meeting ok');
  call = db.prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  assert(call.meeting_at === Date.parse(when), 'meeting time stamped on call');
  assert(db.prepare('SELECT COUNT(*) c FROM calendar_events WHERE contact_id = ?').get(vendorId).c === 1, 'calendar event created');

  console.log('\n[7] webhook: tool-calls dispatch shape');
  const toolResp = await voice.handleWebhook({
    message: {
      type: 'tool-calls',
      call: { id: 'prov_abc', metadata: { callId, orgId: ORG, vendorId } },
      toolCallList: [{ id: 'tc_1', name: 'lookup_contact', arguments: {} }],
    },
  });
  assert(toolResp.results && toolResp.results[0].toolCallId === 'tc_1', 'tool-calls returns Vapi results shape');
  assert(/Test Prospect/.test(toolResp.results[0].result), 'lookup_contact resolved via metadata');

  console.log('\n[8] webhook: end-of-call-report persistence');
  await voice.handleWebhook({
    message: {
      type: 'end-of-call-report',
      call: { id: 'prov_abc', metadata: { callId, orgId: ORG, vendorId } },
      endedReason: 'customer-ended-call',
      durationSeconds: 143,
      cost: 0.0721,
      recordingUrl: 'https://example.com/rec.mp3',
      transcript: '[assistant] Hi... [user] Yes, interested.',
      analysis: {
        summary: 'Prospect qualified for ZetsGeo; demo booked.',
        structuredData: { sentiment: 'positive', lead_score: 88, language: 'Hinglish', next_step: 'demo', interested_products: 'ZetsGeo' },
      },
      messages: [
        { role: 'system', message: 'sys' },
        { role: 'bot', message: 'Hello' },
        { role: 'user', message: 'Yes interested' },
      ],
    },
  });
  call = db.prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  assert(call.status === 'completed', 'end-of-call marks status completed');
  assert(call.duration_sec === 143 && Math.abs(call.cost - 0.0721) < 1e-6, 'duration + cost persisted');
  assert(call.recording_url && call.transcript && call.language === 'Hinglish', 'recording/transcript/language persisted');
  assert(call.lead_score === 88, 'structured lead_score overwrote via report');
  const evCount = db.prepare('SELECT COUNT(*) c FROM call_events WHERE call_id = ?').get(callId).c;
  assert(evCount > 0, `conversation turns logged to call_events (${evCount})`);

  console.log('\n[9] analytics');
  const stats = voice.stats(ORG, { sinceDays: 3650 });
  assert(stats.totals.total >= 1 && stats.totals.qualified >= 1 && stats.totals.meetings >= 1, 'stats aggregate AI calls');
  assert(Array.isArray(stats.by_language), 'stats break down by language');

  console.log('\n[10] provider readiness (unconfigured → dry-run)');
  assert(voice.activeProvider() === (settings.get('voice_provider') || 'log').toLowerCase(), 'active provider reflects settings');

  cleanup();
  console.log('\n✅ voice smoke passed\n');
  process.exit(0);
})().catch((e) => { console.error('\n✗ smoke crashed:', e); cleanup(); process.exit(1); });
