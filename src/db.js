const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'crm.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  company TEXT,
  email TEXT,
  category TEXT,
  tags TEXT,
  status TEXT DEFAULT 'new',
  notes TEXT,
  last_contacted_at INTEGER,
  last_replied_at INTEGER,
  total_sent INTEGER DEFAULT 0,
  total_replied INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);

CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  template_id INTEGER,
  status TEXT DEFAULT 'draft',
  total_targets INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  started_at INTEGER,
  finished_at INTEGER,
  FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER,
  campaign_id INTEGER,
  followup_id INTEGER,
  direction TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT DEFAULT 'queued',
  wa_message_id TEXT,
  error TEXT,
  scheduled_at INTEGER,
  sent_at INTEGER,
  delivered_at INTEGER,
  read_at INTEGER,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS followup_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  trigger TEXT NOT NULL,
  delay_hours INTEGER NOT NULL,
  template_id INTEGER NOT NULL,
  max_attempts INTEGER DEFAULT 3,
  active INTEGER DEFAULT 1,
  stop_on_reply INTEGER DEFAULT 1,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS followups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id INTEGER NOT NULL,
  vendor_id INTEGER NOT NULL,
  parent_message_id INTEGER,
  attempt INTEGER DEFAULT 1,
  status TEXT DEFAULT 'pending',
  scheduled_at INTEGER NOT NULL,
  fired_at INTEGER,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  FOREIGN KEY (rule_id) REFERENCES followup_rules(id) ON DELETE CASCADE,
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER NOT NULL,
  direction TEXT NOT NULL DEFAULT 'out',
  disposition TEXT,
  outcome TEXT,
  duration_sec INTEGER,
  notes TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER,
  title TEXT NOT NULL,
  description TEXT,
  due_at INTEGER,
  priority TEXT DEFAULT 'normal',
  completed INTEGER DEFAULT 0,
  completed_at INTEGER,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS suppressions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT,
  email TEXT,
  reason TEXT,
  source TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);

CREATE TABLE IF NOT EXISTS email_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT,
  category TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);

CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER,
  campaign_id INTEGER,
  template_id INTEGER,
  direction TEXT NOT NULL DEFAULT 'out',
  to_email TEXT NOT NULL,
  subject TEXT,
  body_html TEXT,
  body_text TEXT,
  status TEXT DEFAULT 'queued',
  error TEXT,
  message_id TEXT,
  attempts INTEGER DEFAULT 0,
  next_attempt_at INTEGER,
  scheduled_at INTEGER,
  sent_at INTEGER,
  opened_at INTEGER,
  open_count INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,
  vendor_id INTEGER,
  message_id INTEGER,
  email_id INTEGER,
  detail TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_messages_vendor ON messages(vendor_id);
CREATE INDEX IF NOT EXISTS idx_messages_campaign ON messages(campaign_id);
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
CREATE INDEX IF NOT EXISTS idx_followups_status ON followups(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_vendors_status ON vendors(status);
CREATE INDEX IF NOT EXISTS idx_calls_vendor ON calls(vendor_id);
CREATE INDEX IF NOT EXISTS idx_tasks_vendor ON tasks(vendor_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_at, completed);
CREATE INDEX IF NOT EXISTS idx_suppressions_phone ON suppressions(phone);
CREATE INDEX IF NOT EXISTS idx_suppressions_email ON suppressions(email);
CREATE INDEX IF NOT EXISTS idx_emails_vendor ON emails(vendor_id);
CREATE INDEX IF NOT EXISTS idx_emails_status ON emails(status);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
`);

function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

ensureColumn('messages', 'attempts', 'INTEGER DEFAULT 0');
ensureColumn('messages', 'next_attempt_at', 'INTEGER');
ensureColumn('messages', 'media_path', 'TEXT');
ensureColumn('templates', 'media_path', 'TEXT');
ensureColumn('templates', 'updated_at', 'INTEGER');
ensureColumn('vendors', 'timezone', 'TEXT');
ensureColumn('vendors', 'consent_at', 'INTEGER');
ensureColumn('campaigns', 'channel', 'TEXT DEFAULT \'whatsapp\'');
ensureColumn('followup_rules', 'channel', 'TEXT DEFAULT \'whatsapp\'');

// Three-CRM extensions: contacts get a richer profile, deals/companies/tickets/etc.
ensureColumn('vendors', 'title', 'TEXT');
ensureColumn('vendors', 'avatar', 'TEXT');
ensureColumn('vendors', 'score', 'INTEGER DEFAULT 50');
ensureColumn('vendors', 'ai_note', 'TEXT');
ensureColumn('vendors', 'owner', 'TEXT');
ensureColumn('vendors', 'company_id', 'INTEGER');
ensureColumn('vendors', 'instagram', 'TEXT');
ensureColumn('campaigns', 'owner', 'TEXT');
ensureColumn('campaigns', 'opened_count', 'INTEGER DEFAULT 0');
ensureColumn('campaigns', 'replied_count', 'INTEGER DEFAULT 0');
ensureColumn('campaigns', 'booked_count', 'INTEGER DEFAULT 0');
ensureColumn('tasks', 'type', 'TEXT DEFAULT \'task\'');
ensureColumn('tasks', 'owner', 'TEXT');
ensureColumn('tasks', 'deal_id', 'INTEGER');

db.exec(`
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  domain TEXT,
  industry TEXT,
  size TEXT,
  city TEXT,
  tier TEXT DEFAULT 'Starter',
  mrr INTEGER DEFAULT 0,
  since TEXT,
  logo TEXT,
  color TEXT,
  notes TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);

CREATE TABLE IF NOT EXISTS stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color TEXT,
  probability INTEGER DEFAULT 0,
  position INTEGER DEFAULT 0,
  is_won INTEGER DEFAULT 0,
  is_lost INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS deals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  company_id INTEGER,
  contact_id INTEGER,
  stage_id INTEGER,
  amount INTEGER DEFAULT 0,
  owner TEXT,
  close_date TEXT,
  source TEXT,
  priority TEXT DEFAULT 'med',
  forecast TEXT DEFAULT 'pipeline',
  score INTEGER DEFAULT 50,
  notes TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL,
  FOREIGN KEY (contact_id) REFERENCES vendors(id) ON DELETE SET NULL,
  FOREIGN KEY (stage_id) REFERENCES stages(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL,
  body TEXT,
  company_id INTEGER,
  requester_id INTEGER,
  priority TEXT DEFAULT 'med',
  status TEXT DEFAULT 'open',
  sla TEXT,
  assignee TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL,
  FOREIGN KEY (requester_id) REFERENCES vendors(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS automations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  trigger TEXT NOT NULL,
  actions_json TEXT,
  status TEXT DEFAULT 'on',
  runs INTEGER DEFAULT 0,
  last_run_at INTEGER,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);

CREATE TABLE IF NOT EXISTS team_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT,
  email TEXT,
  avatar TEXT,
  color TEXT,
  quota INTEGER DEFAULT 0,
  attained INTEGER DEFAULT 0,
  is_self INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT,
  text TEXT,
  link TEXT,
  unread INTEGER DEFAULT 1,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  color TEXT,
  deal_id INTEGER,
  contact_id INTEGER,
  notes TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE SET NULL,
  FOREIGN KEY (contact_id) REFERENCES vendors(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS ai_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER,
  channel TEXT DEFAULT 'whatsapp',
  trigger TEXT,
  body TEXT NOT NULL,
  rationale TEXT,
  status TEXT DEFAULT 'pending',
  model TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  acted_at INTEGER,
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  phone TEXT,
  address TEXT,
  city TEXT,
  category TEXT,
  source TEXT,
  source_url TEXT,
  rating TEXT,
  hours TEXT,
  imported INTEGER DEFAULT 0,
  vendor_id INTEGER,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_messages_next_attempt ON messages(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_drafts_vendor ON ai_drafts(vendor_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage_id);
CREATE INDEX IF NOT EXISTS idx_deals_company ON deals(company_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status, priority);
CREATE INDEX IF NOT EXISTS idx_calendar_starts ON calendar_events(starts_at);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(unread, created_at);
CREATE INDEX IF NOT EXISTS idx_vendors_company ON vendors(company_id);
`);

// One-time seed: only runs if every Three-CRM table is empty.
function seedThreeData() {
  const empty = (tbl) => db.prepare(`SELECT COUNT(*) AS c FROM ${tbl}`).get().c === 0;
  if (!(empty('companies') && empty('stages') && empty('deals') && empty('team_members'))) return;

  const insCompany = db.prepare(`
    INSERT INTO companies (name, domain, industry, size, city, tier, mrr, since, logo, color)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const companies = [
    ['Helia Optics', 'helia.optics', 'Hardware', '120-250', 'Berlin', 'Enterprise', 48000, '2023-04', 'HE', '#E07A5F'],
    ['Northwind Mfg', 'northwind.co', 'Manufacturing', '500+', 'Pittsburgh', 'Enterprise', 92500, '2021-09', 'NW', '#3D5A80'],
    ['Casita Foods', 'casita.com', 'CPG / Retail', '50-120', 'Mexico City', 'Growth', 14200, '2024-02', 'CA', '#81B29A'],
    ['Plumb Studios', 'plumb.design', 'Agency', '10-50', 'Brooklyn', 'Growth', 6400, '2024-08', 'PL', '#6B4E71'],
    ['Aperture Labs', 'aperture.io', 'Software', '50-120', 'Toronto', 'Growth', 22800, '2023-11', 'AP', '#2B59C3'],
    ['Mercer & Vale', 'mercervale.law', 'Legal', '120-250', 'London', 'Enterprise', 36000, '2022-06', 'MV', '#1B1B1E'],
    ['Quill Botanicals', 'quillbot.shop', 'CPG / Retail', '10-50', 'Portland', 'Starter', 1800, '2025-01', 'QB', '#588157'],
    ['Tessera Health', 'tessera.health', 'Healthcare', '500+', 'Boston', 'Enterprise', 78000, '2022-11', 'TS', '#C9184A'],
    ['Ridgepath Outdoors', 'ridgepath.co', 'CPG / Retail', '120-250', 'Boulder', 'Growth', 18900, '2023-07', 'RP', '#A47148'],
    ['Stellaris Ventures', 'stellaris.vc', 'Finance', '10-50', 'Singapore', 'Growth', 9200, '2024-05', 'ST', '#414535'],
  ];
  const compIds = {};
  const seedTx = db.transaction(() => {
    companies.forEach((c, i) => {
      const r = insCompany.run(...c);
      compIds['c' + (i + 1)] = r.lastInsertRowid;
    });

    const insStage = db.prepare(`INSERT INTO stages (name, color, probability, position, is_won, is_lost) VALUES (?, ?, ?, ?, ?, ?)`);
    const stages = [
      ['Discovery', '#A8A29E', 10, 1, 0, 0],
      ['Qualified', '#D4A373', 25, 2, 0, 0],
      ['Proposal', '#E07A5F', 50, 3, 0, 0],
      ['Negotiation', '#3D5A80', 75, 4, 0, 0],
      ['Closed Won', '#588157', 100, 5, 1, 0],
      ['Closed Lost', '#5C5C5C', 0, 6, 0, 1],
    ];
    const stageIds = {};
    stages.forEach((s, i) => {
      const r = insStage.run(...s);
      stageIds['s' + (i + 1)] = r.lastInsertRowid;
    });

    const insVendor = db.prepare(`
      INSERT INTO vendors (name, phone, company, email, title, avatar, score, ai_note, owner, company_id, tags, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const contacts = [
      ['Sana Mehrotra', '493055598211', 'Helia Optics', 'sana@helia.optics', 'VP Operations', 'SM', 92, 'High intent — replied within 12 min last week.', 'You', compIds.c1, 'champion,decision-maker', 'replied'],
      ['Marcus Thackeray', '14125550188', 'Northwind Mfg', 'm.thackeray@northwind.co', 'CFO', 'MT', 78, 'Procurement cycle starts Q3.', 'You', compIds.c2, 'economic-buyer', 'contacted'],
      ['Itzel Bautista', '525544219087', 'Casita Foods', 'itzel@casita.com', 'Head of Growth', 'IB', 86, 'Asked for case study yesterday.', 'Yara K.', compIds.c3, 'evaluator', 'replied'],
      ['Chris Plumb', '17185554413', 'Plumb Studios', 'chris@plumb.design', 'Founder', 'CP', 71, 'Renewal in 38 days.', 'You', compIds.c4, 'champion', 'contacted'],
      ['Devika Rao', '14165556612', 'Aperture Labs', 'devika@aperture.io', 'CTO', 'DR', 88, 'Pushed proof-of-concept to staging.', 'You', compIds.c5, 'technical,champion', 'replied'],
      ['Edward Mercer', '442079460123', 'Mercer & Vale', 'e.mercer@mercervale.law', 'Managing Partner', 'EM', 64, 'Requires legal redlines.', 'Yara K.', compIds.c6, 'economic-buyer,slow-mover', 'contacted'],
      ['Ondine Salis', '15035558841', 'Quill Botanicals', 'ondine@quillbot.shop', 'Brand Director', 'OS', 58, 'Smaller plan — likely Starter renewal.', 'You', compIds.c7, 'evaluator', 'new'],
      ['Dr. Asher Levin', '16175552210', 'Tessera Health', 'a.levin@tessera.health', 'Director, Clinical Ops', 'AL', 81, 'Compliance review passed.', 'Marcus B.', compIds.c8, 'decision-maker', 'contacted'],
      ['Halle Korr', '17205551090', 'Ridgepath Outdoors', 'halle@ridgepath.co', 'COO', 'HK', 84, 'Expansion conversation queued.', 'Marcus B.', compIds.c9, 'champion', 'replied'],
      ['Bao Tran', '6569114422', 'Stellaris Ventures', 'bao@stellaris.vc', 'Principal', 'BT', 69, 'Referred two new leads.', 'Yara K.', compIds.c10, 'referrer', 'contacted'],
      ['Rosa Whitfield', '14125559931', 'Northwind Mfg', 'r.whitfield@northwind.co', 'Procurement Lead', 'RW', 55, 'Wants three vendor quotes.', 'You', compIds.c2, 'gatekeeper', 'new'],
      ['Yusuf Adeyemi', '14165557799', 'Aperture Labs', 'yusuf@aperture.io', 'Head of Engineering', 'YA', 76, 'Needs SSO documentation.', 'You', compIds.c5, 'technical', 'contacted'],
    ];
    const vendorIds = {};
    contacts.forEach((c, i) => {
      const r = insVendor.run(...c);
      vendorIds['p' + (i + 1)] = r.lastInsertRowid;
    });

    const insDeal = db.prepare(`
      INSERT INTO deals (name, company_id, contact_id, stage_id, amount, owner, close_date, source, priority, forecast, score, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const baseTime = Date.now();
    const deals = [
      ['Helia — Annual Platform', compIds.c1, vendorIds.p1, stageIds.s3, 145000, 'You', '2026-06-30', 'Outbound', 'high', 'commit', 88, baseTime - 50 * 86400000],
      ['Northwind — Multi-site Rollout', compIds.c2, vendorIds.p2, stageIds.s4, 320000, 'You', '2026-05-20', 'Partner', 'high', 'commit', 91, baseTime - 110 * 86400000],
      ['Casita — Growth Plan', compIds.c3, vendorIds.p3, stageIds.s2, 28000, 'Yara K.', '2026-07-12', 'Inbound', 'med', 'best-case', 74, baseTime - 14 * 86400000],
      ['Plumb — Renewal + Seats', compIds.c4, vendorIds.p4, stageIds.s3, 19200, 'You', '2026-06-14', 'Renewal', 'med', 'commit', 79, baseTime - 36 * 86400000],
      ['Aperture — Enterprise Tier', compIds.c5, vendorIds.p5, stageIds.s4, 88000, 'You', '2026-05-30', 'Inbound', 'high', 'commit', 93, baseTime - 78 * 86400000],
      ['Mercer & Vale — DocReview Add-on', compIds.c6, vendorIds.p6, stageIds.s2, 64000, 'Yara K.', '2026-08-04', 'Outbound', 'med', 'pipeline', 62, baseTime - 24 * 86400000],
      ['Quill — Starter Annual', compIds.c7, vendorIds.p7, stageIds.s1, 4800, 'You', '2026-07-01', 'Inbound', 'low', 'pipeline', 51, baseTime - 7 * 86400000],
      ['Tessera — Compliance Bundle', compIds.c8, vendorIds.p8, stageIds.s3, 210000, 'Marcus B.', '2026-06-22', 'Partner', 'high', 'commit', 84, baseTime - 70 * 86400000],
      ['Ridgepath — Expansion', compIds.c9, vendorIds.p9, stageIds.s2, 42000, 'Marcus B.', '2026-07-18', 'Renewal', 'med', 'best-case', 77, baseTime - 30 * 86400000],
      ['Stellaris — Pilot', compIds.c10, vendorIds.p10, stageIds.s1, 12000, 'Yara K.', '2026-08-12', 'Referral', 'low', 'pipeline', 60, baseTime - 8 * 86400000],
      ['Northwind — EU Region', compIds.c2, vendorIds.p11, stageIds.s2, 180000, 'You', '2026-09-01', 'Partner', 'med', 'best-case', 70, baseTime - 20 * 86400000],
      ['Aperture — SSO + Audit', compIds.c5, vendorIds.p12, stageIds.s3, 36000, 'You', '2026-06-08', 'Expansion', 'med', 'commit', 82, baseTime - 33 * 86400000],
      ['Helia — POC Hardware', compIds.c1, vendorIds.p1, stageIds.s5, 24000, 'You', '2026-04-15', 'Outbound', 'med', 'closed', 100, baseTime - 95 * 86400000],
      ['Tessera — Training Package', compIds.c8, vendorIds.p8, stageIds.s6, 18000, 'Marcus B.', '2026-04-30', 'Inbound', 'low', 'closed', 0, baseTime - 75 * 86400000],
    ];
    deals.forEach((d) => insDeal.run(...d));

    const insTeam = db.prepare(`INSERT INTO team_members (name, role, email, avatar, color, quota, attained, is_self) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    [
      ['Aria Sloane', 'AE — West', 'aria@sloane.co', 'AS', '#E07A5F', 250000, 192400, 1],
      ['Yara Kareem', 'AE — Central', 'yara@sloane.co', 'YK', '#3D5A80', 220000, 168000, 0],
      ['Marcus Bell', 'AE — Enterprise', 'marcus@sloane.co', 'MB', '#588157', 400000, 312000, 0],
      ['Priya Anand', 'SDR Lead', 'priya@sloane.co', 'PA', '#6B4E71', 80, 71, 0],
      ['Theo Lim', 'CS Manager', 'theo@sloane.co', 'TL', '#A47148', 0, 0, 0],
    ].forEach((u) => insTeam.run(...u));

    const insTicket = db.prepare(`INSERT INTO tickets (subject, company_id, requester_id, priority, status, sla, assignee) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    [
      ['API rate-limit on /v2/contacts', compIds.c5, vendorIds.p12, 'urgent', 'open', '2h', 'Marcus B.'],
      ['Cannot export CSV from reports', compIds.c2, vendorIds.p11, 'high', 'open', '8h', 'You'],
      ['SSO redirect loop', compIds.c5, vendorIds.p5, 'high', 'pending', '4h', 'Marcus B.'],
      ['How to merge duplicate contacts?', compIds.c4, vendorIds.p4, 'low', 'open', '24h', 'Yara K.'],
      ['Invoice missing PO number', compIds.c8, vendorIds.p8, 'med', 'pending', '12h', 'You'],
      ['Data import — column mismatch', compIds.c3, vendorIds.p3, 'med', 'open', '8h', 'Yara K.'],
      ['Webhook 500 errors', compIds.c1, vendorIds.p1, 'urgent', 'open', '1h', 'Marcus B.'],
      ['Team seat upgrade question', compIds.c9, vendorIds.p9, 'low', 'solved', '24h', 'Yara K.'],
    ].forEach((t) => insTicket.run(...t));

    const insAuto = db.prepare(`INSERT INTO automations (name, trigger, actions_json, status, runs, last_run_at) VALUES (?, ?, ?, ?, ?, ?)`);
    const now = Date.now();
    [
      ['Welcome new contact', 'Contact created', '[{"a":"send_email"},{"a":"add_tag"},{"a":"create_task"},{"a":"slack_notify"}]', 'on', 312, now - 2 * 60 * 1000],
      ['Stale deal alert (14d)', 'Deal idle 14 days', '[{"a":"slack_notify"},{"a":"create_task"}]', 'on', 47, now - 60 * 60 * 1000],
      ['Renewal 60-day sequence', 'Contract -60 days', '[{"a":"send_email"},{"a":"create_task"},{"a":"send_email"},{"a":"send_email"},{"a":"slack_notify"},{"a":"create_task"}]', 'on', 28, now - 6 * 60 * 60 * 1000],
      ['Hot lead → Slack', 'Lead score > 85', '[{"a":"slack_notify"}]', 'on', 91, now - 12 * 60 * 1000],
      ['Lost reason survey', 'Deal → Closed Lost', '[{"a":"send_email"},{"a":"create_task"},{"a":"add_tag"}]', 'off', 14, now - 3 * 86400000],
      ['Upsell signal', 'Usage > 80% of plan', '[{"a":"slack_notify"},{"a":"create_task"},{"a":"send_email"},{"a":"add_tag"},{"a":"create_task"}]', 'on', 22, now - 86400000],
    ].forEach((a) => insAuto.run(...a));

    const insNotif = db.prepare(`INSERT INTO notifications (kind, text, link, unread, created_at) VALUES (?, ?, ?, ?, ?)`);
    [
      ['email', 'Sana Mehrotra replied — "Revised proposal"', 'inbox', 1, now - 2 * 60 * 1000],
      ['ai', 'AI: 2 deals show buying signals this week', 'dashboard', 1, now - 18 * 60 * 1000],
      ['meeting', 'Demo with Aperture starts in 1 hour', 'calendar', 1, now - 59 * 60 * 1000],
      ['task', 'Yara assigned you: "Forecast review"', 'tasks', 0, now - 2 * 60 * 60 * 1000],
      ['deal', 'Helia POC closed-won (+$24k)', 'deals', 0, now - 3 * 60 * 60 * 1000],
    ].forEach((n) => insNotif.run(...n));

    // Calendar — sample week of events
    const insEv = db.prepare(`INSERT INTO calendar_events (title, starts_at, ends_at, color, deal_id, contact_id) VALUES (?, ?, ?, ?, ?, ?)`);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const at = (dayOff, hr, min) => {
      const d = new Date(monday); d.setDate(monday.getDate() + dayOff); d.setHours(hr, min, 0, 0);
      return d.getTime();
    };
    [
      ['Standup', at(0, 9, 0), at(0, 10, 0), '#7A7670', null, null],
      ['Northwind procurement', at(0, 10, 0), at(0, 11, 0), '#3D5A80', null, vendorIds.p2],
      ['Pipeline review', at(0, 14, 0), at(0, 15, 30), '#6B4E71', null, null],
      ['Casita onboarding', at(1, 9, 0), at(1, 10, 0), '#588157', null, vendorIds.p3],
      ['Aperture eng demo', at(1, 10, 0), at(1, 11, 0), '#E07A5F', null, vendorIds.p5],
      ['1:1 — Yara', at(1, 13, 0), at(1, 14, 0), '#7A7670', null, null],
      ['Helia close call', at(1, 16, 0), at(1, 17, 0), '#E07A5F', null, vendorIds.p1],
      ['Mercer redlines', at(2, 11, 0), at(2, 12, 0), '#D4A373', null, vendorIds.p6],
      ['Forecast prep', at(2, 14, 0), at(2, 15, 0), '#3D5A80', null, null],
      ['Tessera contract', at(3, 9, 0), at(3, 10, 30), '#E07A5F', null, vendorIds.p8],
      ['Plumb check-in', at(3, 11, 0), at(3, 12, 0), '#588157', null, vendorIds.p4],
      ['Stellaris pilot kickoff', at(3, 15, 0), at(3, 16, 0), '#6B4E71', null, vendorIds.p10],
      ['Q2 board prep', at(4, 10, 0), at(4, 11, 0), '#7A7670', null, null],
      ['Team sync', at(4, 14, 0), at(4, 15, 0), '#3D5A80', null, null],
    ].forEach((e) => insEv.run(...e));

    // Sample CRM tasks attached to deals (using new owner/type/deal_id columns)
    const insTask = db.prepare(`INSERT INTO tasks (vendor_id, title, due_at, priority, type, owner, deal_id, completed, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const day = (offset) => {
      const d = new Date(today); d.setDate(today.getDate() + offset); d.setHours(17, 0, 0, 0); return d.getTime();
    };
    [
      [vendorIds.p1, 'Send revised proposal to Sana', day(0), 'high', 'email', 'You', 1, 0, null],
      [vendorIds.p6, 'Legal redlines call w/ Mercer', day(1), 'med', 'call', 'Yara K.', 6, 0, null],
      [vendorIds.p5, 'Demo: Aperture eng team', day(0), 'high', 'meeting', 'You', 5, 0, null],
      [vendorIds.p2, 'Follow up: Northwind procurement', day(2), 'high', 'email', 'You', 2, 0, null],
      [vendorIds.p12, 'Quote for SSO add-on', day(0), 'med', 'task', 'You', 12, 0, null],
      [vendorIds.p3, 'Onboarding call: Casita', day(5), 'med', 'meeting', 'Yara K.', 3, 0, null],
      [vendorIds.p4, 'Renewal sequence: Plumb', day(3), 'med', 'email', 'You', 4, 1, Date.now()],
      [vendorIds.p3, 'Send case study to Itzel', day(-1), 'high', 'email', 'Yara K.', 3, 1, Date.now()],
      [vendorIds.p10, 'Pilot kickoff: Stellaris', day(8), 'low', 'meeting', 'Yara K.', 10, 0, null],
      [vendorIds.p8, 'Contract review: Tessera', day(4), 'high', 'task', 'Marcus B.', 8, 0, null],
      [null, 'Q2 board prep', day(7), 'med', 'task', 'You', null, 0, null],
      [null, 'Update pricing one-pager', day(1), 'low', 'task', 'You', null, 0, null],
    ].forEach((t) => insTask.run(...t));
  });
  seedTx();
  console.log('[db] seeded sample CRM data (companies, deals, contacts, tasks, calendar, etc.)');
}

// Auto-seed disabled — you have your own real contacts. To re-seed demo data,
// run: node -e "require('./src/db'); /* call seedThreeData manually */"
// try { seedThreeData(); } catch (e) { console.error('[db] seed failed:', e.message); }

module.exports = db;
