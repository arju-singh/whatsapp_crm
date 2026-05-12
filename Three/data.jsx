// =============================================================
// Mock data for Three CRM
// Realistic enough to be believable; small enough to maintain.
// =============================================================

const COMPANIES = [
  { id: 'c1', name: 'Helia Optics', domain: 'helia.optics', industry: 'Hardware', size: '120-250', city: 'Berlin', tier: 'Enterprise', mrr: 48000, since: '2023-04', logo: 'HE', color: '#E07A5F' },
  { id: 'c2', name: 'Northwind Mfg', domain: 'northwind.co', industry: 'Manufacturing', size: '500+', city: 'Pittsburgh', tier: 'Enterprise', mrr: 92500, since: '2021-09', logo: 'NW', color: '#3D5A80' },
  { id: 'c3', name: 'Casita Foods', domain: 'casita.com', industry: 'CPG / Retail', size: '50-120', city: 'Mexico City', tier: 'Growth', mrr: 14200, since: '2024-02', logo: 'CA', color: '#81B29A' },
  { id: 'c4', name: 'Plumb Studios', domain: 'plumb.design', industry: 'Agency', size: '10-50', city: 'Brooklyn', tier: 'Growth', mrr: 6400, since: '2024-08', logo: 'PL', color: '#6B4E71' },
  { id: 'c5', name: 'Aperture Labs', domain: 'aperture.io', industry: 'Software', size: '50-120', city: 'Toronto', tier: 'Growth', mrr: 22800, since: '2023-11', logo: 'AP', color: '#2B59C3' },
  { id: 'c6', name: 'Mercer & Vale', domain: 'mercervale.law', industry: 'Legal', size: '120-250', city: 'London', tier: 'Enterprise', mrr: 36000, since: '2022-06', logo: 'MV', color: '#1B1B1E' },
  { id: 'c7', name: 'Quill Botanicals', domain: 'quillbot.shop', industry: 'CPG / Retail', size: '10-50', city: 'Portland', tier: 'Starter', mrr: 1800, since: '2025-01', logo: 'QB', color: '#588157' },
  { id: 'c8', name: 'Tessera Health', domain: 'tessera.health', industry: 'Healthcare', size: '500+', city: 'Boston', tier: 'Enterprise', mrr: 78000, since: '2022-11', logo: 'TS', color: '#C9184A' },
  { id: 'c9', name: 'Ridgepath Outdoors', domain: 'ridgepath.co', industry: 'CPG / Retail', size: '120-250', city: 'Boulder', tier: 'Growth', mrr: 18900, since: '2023-07', logo: 'RP', color: '#A47148' },
  { id: 'c10', name: 'Stellaris Ventures', domain: 'stellaris.vc', industry: 'Finance', size: '10-50', city: 'Singapore', tier: 'Growth', mrr: 9200, since: '2024-05', logo: 'ST', color: '#414535' },
];

const CONTACTS = [
  { id: 'p1', name: 'Sana Mehrotra', title: 'VP Operations', companyId: 'c1', email: 'sana@helia.optics', phone: '+49 30 555 9821', avatar: 'SM', tags: ['champion','decision-maker'], lastTouch: '2026-05-04', score: 92, owner: 'You', ai: 'High intent — replied within 12 min last week.' },
  { id: 'p2', name: 'Marcus Thackeray', title: 'CFO', companyId: 'c2', email: 'm.thackeray@northwind.co', phone: '+1 412 555 0188', avatar: 'MT', tags: ['economic-buyer'], lastTouch: '2026-04-29', score: 78, owner: 'You', ai: 'Procurement cycle starts Q3.' },
  { id: 'p3', name: 'Itzel Bautista', title: 'Head of Growth', companyId: 'c3', email: 'itzel@casita.com', phone: '+52 55 4421 9087', avatar: 'IB', tags: ['evaluator'], lastTouch: '2026-05-05', score: 86, owner: 'Yara K.', ai: 'Asked for case study yesterday.' },
  { id: 'p4', name: 'Chris Plumb', title: 'Founder', companyId: 'c4', email: 'chris@plumb.design', phone: '+1 718 555 4413', avatar: 'CP', tags: ['champion'], lastTouch: '2026-05-02', score: 71, owner: 'You', ai: 'Renewal in 38 days.' },
  { id: 'p5', name: 'Devika Rao', title: 'CTO', companyId: 'c5', email: 'devika@aperture.io', phone: '+1 416 555 6612', avatar: 'DR', tags: ['technical','champion'], lastTouch: '2026-05-06', score: 88, owner: 'You', ai: 'Pushed proof-of-concept to staging.' },
  { id: 'p6', name: 'Edward Mercer', title: 'Managing Partner', companyId: 'c6', email: 'e.mercer@mercervale.law', phone: '+44 20 7946 0123', avatar: 'EM', tags: ['economic-buyer','slow-mover'], lastTouch: '2026-04-21', score: 64, owner: 'Yara K.', ai: 'Requires legal redlines.' },
  { id: 'p7', name: 'Ondine Salis', title: 'Brand Director', companyId: 'c7', email: 'ondine@quillbot.shop', phone: '+1 503 555 8841', avatar: 'OS', tags: ['evaluator'], lastTouch: '2026-05-05', score: 58, owner: 'You', ai: 'Smaller plan — likely Starter renewal.' },
  { id: 'p8', name: 'Dr. Asher Levin', title: 'Director, Clinical Ops', companyId: 'c8', email: 'a.levin@tessera.health', phone: '+1 617 555 2210', avatar: 'AL', tags: ['decision-maker'], lastTouch: '2026-05-01', score: 81, owner: 'Marcus B.', ai: 'Compliance review passed.' },
  { id: 'p9', name: 'Halle Korr', title: 'COO', companyId: 'c9', email: 'halle@ridgepath.co', phone: '+1 720 555 1090', avatar: 'HK', tags: ['champion'], lastTouch: '2026-05-06', score: 84, owner: 'Marcus B.', ai: 'Expansion conversation queued.' },
  { id: 'p10', name: 'Bao Tran', title: 'Principal', companyId: 'c10', email: 'bao@stellaris.vc', phone: '+65 6911 4422', avatar: 'BT', tags: ['referrer'], lastTouch: '2026-04-30', score: 69, owner: 'Yara K.', ai: 'Referred two new leads.' },
  { id: 'p11', name: 'Rosa Whitfield', title: 'Procurement Lead', companyId: 'c2', email: 'r.whitfield@northwind.co', phone: '+1 412 555 9931', avatar: 'RW', tags: ['gatekeeper'], lastTouch: '2026-04-26', score: 55, owner: 'You', ai: 'Wants three vendor quotes.' },
  { id: 'p12', name: 'Yusuf Adeyemi', title: 'Head of Engineering', companyId: 'c5', email: 'yusuf@aperture.io', phone: '+1 416 555 7799', avatar: 'YA', tags: ['technical'], lastTouch: '2026-05-03', score: 76, owner: 'You', ai: 'Needs SSO documentation.' },
];

const STAGES = [
  { id: 's1', name: 'Discovery', color: '#A8A29E', probability: 10 },
  { id: 's2', name: 'Qualified', color: '#D4A373', probability: 25 },
  { id: 's3', name: 'Proposal', color: '#E07A5F', probability: 50 },
  { id: 's4', name: 'Negotiation', color: '#3D5A80', probability: 75 },
  { id: 's5', name: 'Closed Won', color: '#588157', probability: 100 },
  { id: 's6', name: 'Closed Lost', color: '#5C5C5C', probability: 0 },
];

const DEALS = [
  { id: 'd1', name: 'Helia — Annual Platform', companyId: 'c1', contactId: 'p1', amount: 145000, stage: 's3', owner: 'You', close: '2026-06-30', created: '2026-03-12', source: 'Outbound', priority: 'high', forecast: 'commit', score: 88 },
  { id: 'd2', name: 'Northwind — Multi-site Rollout', companyId: 'c2', contactId: 'p2', amount: 320000, stage: 's4', owner: 'You', close: '2026-05-20', created: '2026-01-08', source: 'Partner', priority: 'high', forecast: 'commit', score: 91 },
  { id: 'd3', name: 'Casita — Growth Plan', companyId: 'c3', contactId: 'p3', amount: 28000, stage: 's2', owner: 'Yara K.', close: '2026-07-12', created: '2026-04-22', source: 'Inbound', priority: 'med', forecast: 'best-case', score: 74 },
  { id: 'd4', name: 'Plumb — Renewal + Seats', companyId: 'c4', contactId: 'p4', amount: 19200, stage: 's3', owner: 'You', close: '2026-06-14', created: '2026-04-02', source: 'Renewal', priority: 'med', forecast: 'commit', score: 79 },
  { id: 'd5', name: 'Aperture — Enterprise Tier', companyId: 'c5', contactId: 'p5', amount: 88000, stage: 's4', owner: 'You', close: '2026-05-30', created: '2026-02-19', source: 'Inbound', priority: 'high', forecast: 'commit', score: 93 },
  { id: 'd6', name: 'Mercer & Vale — DocReview Add-on', companyId: 'c6', contactId: 'p6', amount: 64000, stage: 's2', owner: 'Yara K.', close: '2026-08-04', created: '2026-04-14', source: 'Outbound', priority: 'med', forecast: 'pipeline', score: 62 },
  { id: 'd7', name: 'Quill — Starter Annual', companyId: 'c7', contactId: 'p7', amount: 4800, stage: 's1', owner: 'You', close: '2026-07-01', created: '2026-05-01', source: 'Inbound', priority: 'low', forecast: 'pipeline', score: 51 },
  { id: 'd8', name: 'Tessera — Compliance Bundle', companyId: 'c8', contactId: 'p8', amount: 210000, stage: 's3', owner: 'Marcus B.', close: '2026-06-22', created: '2026-03-01', source: 'Partner', priority: 'high', forecast: 'commit', score: 84 },
  { id: 'd9', name: 'Ridgepath — Expansion', companyId: 'c9', contactId: 'p9', amount: 42000, stage: 's2', owner: 'Marcus B.', close: '2026-07-18', created: '2026-04-09', source: 'Renewal', priority: 'med', forecast: 'best-case', score: 77 },
  { id: 'd10', name: 'Stellaris — Pilot', companyId: 'c10', contactId: 'p10', amount: 12000, stage: 's1', owner: 'Yara K.', close: '2026-08-12', created: '2026-04-30', source: 'Referral', priority: 'low', forecast: 'pipeline', score: 60 },
  { id: 'd11', name: 'Northwind — EU Region', companyId: 'c2', contactId: 'p11', amount: 180000, stage: 's2', owner: 'You', close: '2026-09-01', created: '2026-04-18', source: 'Partner', priority: 'med', forecast: 'best-case', score: 70 },
  { id: 'd12', name: 'Aperture — SSO + Audit', companyId: 'c5', contactId: 'p12', amount: 36000, stage: 's3', owner: 'You', close: '2026-06-08', created: '2026-04-05', source: 'Expansion', priority: 'med', forecast: 'commit', score: 82 },
  { id: 'd13', name: 'Helia — POC Hardware', companyId: 'c1', contactId: 'p1', amount: 24000, stage: 's5', owner: 'You', close: '2026-04-15', created: '2026-02-01', source: 'Outbound', priority: 'med', forecast: 'closed', score: 100 },
  { id: 'd14', name: 'Tessera — Training Package', companyId: 'c8', contactId: 'p8', amount: 18000, stage: 's6', owner: 'Marcus B.', close: '2026-04-30', created: '2026-02-22', source: 'Inbound', priority: 'low', forecast: 'closed', score: 0 },
];

const TASKS = [
  { id: 't1', title: 'Send revised proposal to Sana', dealId: 'd1', due: '2026-05-07', priority: 'high', type: 'email', done: false, owner: 'You' },
  { id: 't2', title: 'Legal redlines call w/ Mercer', dealId: 'd6', due: '2026-05-08', priority: 'med', type: 'call', done: false, owner: 'Yara K.' },
  { id: 't3', title: 'Demo: Aperture eng team', dealId: 'd5', due: '2026-05-07', priority: 'high', type: 'meeting', done: false, owner: 'You' },
  { id: 't4', title: 'Follow up: Northwind procurement', dealId: 'd2', due: '2026-05-09', priority: 'high', type: 'email', done: false, owner: 'You' },
  { id: 't5', title: 'Quote for SSO add-on', dealId: 'd12', due: '2026-05-07', priority: 'med', type: 'task', done: false, owner: 'You' },
  { id: 't6', title: 'Onboarding call: Casita', dealId: 'd3', due: '2026-05-12', priority: 'med', type: 'meeting', done: false, owner: 'Yara K.' },
  { id: 't7', title: 'Renewal sequence: Plumb', dealId: 'd4', due: '2026-05-10', priority: 'med', type: 'email', done: true, owner: 'You' },
  { id: 't8', title: 'Send case study to Itzel', dealId: 'd3', due: '2026-05-06', priority: 'high', type: 'email', done: true, owner: 'Yara K.' },
  { id: 't9', title: 'Pilot kickoff: Stellaris', dealId: 'd10', due: '2026-05-15', priority: 'low', type: 'meeting', done: false, owner: 'Yara K.' },
  { id: 't10', title: 'Contract review: Tessera', dealId: 'd8', due: '2026-05-11', priority: 'high', type: 'task', done: false, owner: 'Marcus B.' },
  { id: 't11', title: 'Q2 board prep', due: '2026-05-14', priority: 'med', type: 'task', done: false, owner: 'You' },
  { id: 't12', title: 'Update pricing one-pager', due: '2026-05-08', priority: 'low', type: 'task', done: false, owner: 'You' },
];

const ACTIVITIES = [
  { id: 'a1', kind: 'email', title: 'Sana replied to "Revised proposal"', time: '2 min ago', dealId: 'd1', body: 'Looks great — one ask: can we move payment terms to NET-45?' },
  { id: 'a2', kind: 'meeting', title: 'Demo booked w/ Aperture eng', time: '38 min ago', dealId: 'd5', body: 'Tomorrow 10:00 PT — Devika + 4 attendees' },
  { id: 'a3', kind: 'note', title: 'Note added on Northwind', time: '1 h ago', dealId: 'd2', body: 'Marcus pushed close to May 20. Procurement reviewing today.' },
  { id: 'a4', kind: 'deal', title: 'Helia POC moved to Closed Won', time: '3 h ago', dealId: 'd13', body: '+$24,000 ARR' },
  { id: 'a5', kind: 'call', title: 'Call: Edward Mercer (12 min)', time: 'Yesterday', dealId: 'd6', body: 'Wants signed NDA before next step.' },
  { id: 'a6', kind: 'email', title: 'Itzel replied: "Send case study"', time: 'Yesterday', dealId: 'd3', body: 'Great — looking forward to reviewing it with the team.' },
  { id: 'a7', kind: 'ai', title: 'AI flagged a churn risk', time: 'Yesterday', dealId: 'd4', body: 'Plumb usage down 38% MoM — recommend a check-in.' },
  { id: 'a8', kind: 'deal', title: 'New deal: Stellaris Pilot', time: '2 d ago', dealId: 'd10', body: 'Created from referral by Bao Tran' },
];

const TICKETS = [
  { id: 'tk1', subject: 'API rate-limit on /v2/contacts', companyId: 'c5', requester: 'p12', priority: 'urgent', status: 'open', sla: '2h', assignee: 'Marcus B.', age: '47m' },
  { id: 'tk2', subject: 'Cannot export CSV from reports', companyId: 'c2', requester: 'p11', priority: 'high', status: 'open', sla: '8h', assignee: 'You', age: '3h' },
  { id: 'tk3', subject: 'SSO redirect loop', companyId: 'c5', requester: 'p5', priority: 'high', status: 'pending', sla: '4h', assignee: 'Marcus B.', age: '5h' },
  { id: 'tk4', subject: 'How to merge duplicate contacts?', companyId: 'c4', requester: 'p4', priority: 'low', status: 'open', sla: '24h', assignee: 'Yara K.', age: '1d' },
  { id: 'tk5', subject: 'Invoice missing PO number', companyId: 'c8', requester: 'p8', priority: 'med', status: 'pending', sla: '12h', assignee: 'You', age: '6h' },
  { id: 'tk6', subject: 'Data import — column mismatch', companyId: 'c3', requester: 'p3', priority: 'med', status: 'open', sla: '8h', assignee: 'Yara K.', age: '4h' },
  { id: 'tk7', subject: 'Webhook 500 errors', companyId: 'c1', requester: 'p1', priority: 'urgent', status: 'open', sla: '1h', assignee: 'Marcus B.', age: '22m' },
  { id: 'tk8', subject: 'Team seat upgrade question', companyId: 'c9', requester: 'p9', priority: 'low', status: 'solved', sla: '24h', assignee: 'Yara K.', age: '2d' },
];

const CAMPAIGNS = [
  { id: 'cm1', name: 'Q2 Outbound — Manufacturing', channel: 'Email', status: 'live', sent: 1240, opened: 562, replied: 38, booked: 11, owner: 'You' },
  { id: 'cm2', name: 'Webinar Follow-up — May', channel: 'Email', status: 'live', sent: 488, opened: 311, replied: 64, booked: 22, owner: 'Yara K.' },
  { id: 'cm3', name: 'LinkedIn — CFO Persona', channel: 'LinkedIn', status: 'live', sent: 220, opened: 0, replied: 17, booked: 6, owner: 'Marcus B.' },
  { id: 'cm4', name: 'Renewal Nudge — Q2', channel: 'Email', status: 'paused', sent: 96, opened: 71, replied: 19, booked: 8, owner: 'You' },
  { id: 'cm5', name: 'Spring Trade Show — Berlin', channel: 'Event', status: 'draft', sent: 0, opened: 0, replied: 0, booked: 0, owner: 'You' },
];

const AUTOMATIONS = [
  { id: 'au1', name: 'Welcome new contact', trigger: 'Contact created', actions: 4, status: 'on', runs: 312, last: '2 min ago' },
  { id: 'au2', name: 'Stale deal alert (14d)', trigger: 'Deal idle 14 days', actions: 2, status: 'on', runs: 47, last: '1 h ago' },
  { id: 'au3', name: 'Renewal 60-day sequence', trigger: 'Contract -60 days', actions: 6, status: 'on', runs: 28, last: 'Today' },
  { id: 'au4', name: 'Hot lead → Slack', trigger: 'Lead score > 85', actions: 1, status: 'on', runs: 91, last: '12 min ago' },
  { id: 'au5', name: 'Lost reason survey', trigger: 'Deal → Closed Lost', actions: 3, status: 'off', runs: 14, last: '3 d ago' },
  { id: 'au6', name: 'Upsell signal', trigger: 'Usage > 80% of plan', actions: 5, status: 'on', runs: 22, last: 'Yesterday' },
];

const TEAM = [
  { id: 'u1', name: 'You (Aria Sloane)', role: 'AE — West', avatar: 'AS', quota: 250000, attained: 192400, color: '#E07A5F' },
  { id: 'u2', name: 'Yara Kareem', role: 'AE — Central', avatar: 'YK', quota: 220000, attained: 168000, color: '#3D5A80' },
  { id: 'u3', name: 'Marcus Bell', role: 'AE — Enterprise', avatar: 'MB', quota: 400000, attained: 312000, color: '#588157' },
  { id: 'u4', name: 'Priya Anand', role: 'SDR Lead', avatar: 'PA', quota: 80, attained: 71, color: '#6B4E71' },
  { id: 'u5', name: 'Theo Lim', role: 'CS Manager', avatar: 'TL', quota: 0, attained: 0, color: '#A47148' },
];

const NOTIFICATIONS = [
  { id: 'n1', kind: 'email', text: 'Sana Mehrotra replied — "Revised proposal"', time: '2 min', unread: true },
  { id: 'n2', kind: 'ai', text: 'AI: 2 deals show buying signals this week', time: '18 min', unread: true },
  { id: 'n3', kind: 'meeting', text: 'Demo with Aperture starts in 1 hour', time: '59 min', unread: true },
  { id: 'n4', kind: 'task', text: 'Yara assigned you: "Forecast review"', time: '2 h', unread: false },
  { id: 'n5', kind: 'deal', text: 'Helia POC closed-won (+$24k)', time: '3 h', unread: false },
];

// ---- Chart-ready data --------------------------------------------------

const PIPELINE_TREND = [
  { week: 'W14', value: 412000 }, { week: 'W15', value: 488000 },
  { week: 'W16', value: 542000 }, { week: 'W17', value: 601000 },
  { week: 'W18', value: 648000 }, { week: 'W19', value: 712000 },
  { week: 'W20', value: 786000 }, { week: 'W21', value: 854000 },
];

const REVENUE_BY_MONTH = [
  { m: 'Nov', booked: 142000, target: 180000 },
  { m: 'Dec', booked: 198000, target: 180000 },
  { m: 'Jan', booked: 168000, target: 200000 },
  { m: 'Feb', booked: 224000, target: 200000 },
  { m: 'Mar', booked: 251000, target: 220000 },
  { m: 'Apr', booked: 218000, target: 220000 },
  { m: 'May', booked: 156000, target: 240000 }, // partial
];

const FUNNEL = [
  { stage: 'Leads',     count: 1842 },
  { stage: 'MQL',       count: 612 },
  { stage: 'SQL',       count: 244 },
  { stage: 'Opp',       count: 98  },
  { stage: 'Proposal',  count: 41  },
  { stage: 'Won',       count: 18  },
];

const SOURCES = [
  { src: 'Outbound', value: 38, color: '#E07A5F' },
  { src: 'Inbound', value: 27, color: '#3D5A80' },
  { src: 'Partner', value: 18, color: '#588157' },
  { src: 'Referral', value: 11, color: '#D4A373' },
  { src: 'Event', value: 6, color: '#6B4E71' },
];

const HEATMAP = (() => {
  // 7 days x 24 hours, response-rate-ish
  const out = [];
  for (let d=0; d<7; d++) {
    const row = [];
    for (let h=0; h<24; h++) {
      let v = 0;
      if (h >= 8 && h <= 18) v = 0.2 + Math.random() * 0.5;
      if (h >= 9 && h <= 11) v += 0.25;
      if (h >= 13 && h <= 15) v += 0.2;
      if (d === 5 || d === 6) v *= 0.3;
      row.push(Math.min(1, v));
    }
    out.push(row);
  }
  return out;
})();

// ---- Helpers ----
function fmtMoney(n) {
  if (n >= 1e6) return '$' + (n/1e6).toFixed(2).replace(/\.?0+$/,'') + 'M';
  if (n >= 1e3) return '$' + Math.round(n/1e3) + 'k';
  return '$' + n;
}
function getCompany(id) { return COMPANIES.find(c => c.id === id); }
function getContact(id) { return CONTACTS.find(c => c.id === id); }
function getStage(id) { return STAGES.find(s => s.id === id); }

Object.assign(window, {
  COMPANIES, CONTACTS, STAGES, DEALS, TASKS, ACTIVITIES, TICKETS,
  CAMPAIGNS, AUTOMATIONS, TEAM, NOTIFICATIONS,
  PIPELINE_TREND, REVENUE_BY_MONTH, FUNNEL, SOURCES, HEATMAP,
  fmtMoney, getCompany, getContact, getStage
});
