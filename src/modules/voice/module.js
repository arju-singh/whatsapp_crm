// ---------------------------------------------------------------------------
// Feature module: Voice AI Agent.
//
// Turns the CRM's outbound calling into a *conversational* AI sales executive.
// Where the `calling` module bridges a human agent to a contact (Twilio Dial),
// this module drives a fully autonomous voice agent (Vapi/Retell) that speaks
// with the customer, runs CRM tools mid-call (lookup contact, log outcome, book
// a meeting, send a WhatsApp summary), and files a structured, transcribed,
// sentiment-scored call record when it hangs up.
//
// The reasoning + live STT→LLM→TTS pipeline lives in the provider (Vapi/Retell);
// this platform is the BRAIN'S TOOL LAYER and system-of-record — the exact seam
// the WhatsApp AI agent already uses, now shared with voice.
//
//   Provider  →  /api/voice/webhook  →  voice-agent.js (tools + persistence)
//
// Routes live in src/routes/voice.js (mounted in server.js, NOT here) because the
// webhook must be publicly reachable — a carrier/provider POSTs to it with no CRM
// session. This manifest owns only schema, permissions, and navigation, mirroring
// the `calling` module.
// ---------------------------------------------------------------------------

module.exports = {
  key: 'voice',
  name: 'Voice AI Agent',
  description: 'Autonomous multilingual AI sales agent that calls contacts, qualifies leads, books meetings, and logs transcribed, sentiment-scored calls.',
  core: false,
  dependsOn: ['contacts', 'calling'],
  permissions: ['voice.read', 'voice.make', 'voice.manage'],
  nav: [
    { label: 'Voice AI', icon: 'phone', path: '/voice', perm: 'voice.read' },
  ],

  // Schema owned by this module. Idempotent — safe to run on every boot.
  //   1. AI-conversation columns on the shared `calls` table (voice metadata that
  //      the base call record + the `calling` provider columns don't cover).
  //   2. call_events: turn-by-turn transcript segments + tool-call audit trail.
  //   3. kb_articles: the retrieval knowledge base the agent answers from (RAG).
  //
  // Note: tenancy.js has already run by the time modules initialize, so it will
  // NOT retro-add organization_id/deleted_at to tables created here — we declare
  // them inline and index org ourselves, matching the platform's tenant pattern.
  migrate(db) {
    const cols = db.prepare('PRAGMA table_info(calls)').all().map((r) => r.name);
    const add = (col, ddl) => { if (!cols.includes(col)) db.exec(`ALTER TABLE calls ADD COLUMN ${col} ${ddl}`); };
    add('mode', "TEXT DEFAULT 'human'");   // 'human' (bridge) | 'ai' (autonomous voice agent)
    add('assistant', 'TEXT');              // product/persona key the agent ran as
    add('language', 'TEXT');               // detected primary language of the call
    add('transcript', 'TEXT');             // full plain-text transcript
    add('summary', 'TEXT');                // AI-generated call summary
    add('sentiment', 'TEXT');              // positive | neutral | negative
    add('lead_score', 'INTEGER');          // 0-100 qualification score
    add('interested_products', 'TEXT');    // comma/JSON list surfaced during the call
    add('next_step', 'TEXT');              // agreed next action
    add('meeting_at', 'INTEGER');          // booked demo/meeting time (epoch ms)
    add('handoff', 'INTEGER DEFAULT 0');   // 1 if the agent requested a human transfer
    add('cost', 'REAL');                   // provider-reported call cost (USD)
    add('ended_reason', 'TEXT');           // provider end reason
    add('structured_json', 'TEXT');        // full structured extraction blob (JSON)
    add('started_at', 'INTEGER');          // answered/connected time
    add('ended_at', 'INTEGER');            // hangup time

    db.exec(`
      CREATE TABLE IF NOT EXISTS call_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id INTEGER DEFAULT 1,
        call_id INTEGER,
        provider_call_id TEXT,
        role TEXT,                 -- assistant | user | tool | system | status
        type TEXT,                 -- transcript | tool_call | tool_result | status | end
        tool_name TEXT,
        content TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        deleted_at INTEGER,
        FOREIGN KEY (call_id) REFERENCES calls(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_call_events_call ON call_events(call_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_call_events_org ON call_events(organization_id);
      CREATE INDEX IF NOT EXISTS idx_call_events_provider ON call_events(provider_call_id);

      CREATE TABLE IF NOT EXISTS kb_articles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id INTEGER DEFAULT 1,
        product TEXT,              -- which offering this fact belongs to (optional)
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        tags TEXT,
        active INTEGER DEFAULT 1,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        deleted_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_kb_org ON kb_articles(organization_id, active);
    `);
  },
};
