// =============================================================
// Three CRM — Data layer.
// Loads everything from /api/* on mount, exposes window globals
// (COMPANIES, CONTACTS, DEALS, …) and helpers (fmtMoney, getCompany,
// getContact, getStage). Views call useStore() to subscribe to
// re-renders when refresh() runs after a mutation.
// =============================================================

const api = async (path, opts = {}) => {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)
      ? JSON.stringify(opts.body) : opts.body,
  });
  if (!res.ok) {
    let err;
    try { err = await res.json(); } catch (_) { err = { error: res.statusText }; }
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
};
window.api = api;

// Fetch shape for the contacts API (vendors). Adapt fields to what views expect.
function adaptContact(v) {
  return {
    id: 'p' + v.id,
    raw_id: v.id,
    name: v.name,
    title: v.title || '',
    companyId: v.company_id ? 'c' + v.company_id : null,
    raw_company_id: v.company_id || null,
    company: v.company || '',
    email: v.email || '',
    phone: v.phone || '',
    address: v.address || '',
    city: v.city || '',
    hours: v.hours || '',
    businessType: v.category || '',
    avatar: v.avatar || (v.name || '').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase(),
    profilePicUrl: v.profile_pic_url || null,
    aboutText: v.about_text || '',
    isBusiness: !!v.is_business,
    tags: typeof v.tags === 'string' && v.tags ? v.tags.split(',').map((t) => t.trim()).filter(Boolean) : (v.tags || []),
    lastTouch: v.last_replied_at || v.last_contacted_at
      ? new Date(v.last_replied_at || v.last_contacted_at).toISOString().slice(0, 10)
      : '',
    score: typeof v.score === 'number' ? v.score : 50,
    owner: v.owner || 'You',
    ai: v.ai_note || '',
    status: v.status || 'new',
  };
}

function adaptCompany(c) {
  return {
    id: 'c' + c.id,
    raw_id: c.id,
    name: c.name,
    domain: c.domain || '',
    industry: c.industry || '',
    size: c.size || '',
    city: c.city || '',
    tier: c.tier || 'Starter',
    mrr: c.mrr || 0,
    since: c.since || '',
    logo: c.logo || (c.name || '').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase(),
    color: c.color || '#7A7670',
    contactsCount: c.contacts_count || 0,
    openPipe: c.open_pipe || 0,
  };
}

function adaptStage(s) {
  return {
    id: 's' + s.id,
    raw_id: s.id,
    name: s.name,
    color: s.color,
    probability: s.probability,
    isWon: !!s.is_won,
    isLost: !!s.is_lost,
  };
}

function adaptDeal(d) {
  return {
    id: 'd' + d.id,
    raw_id: d.id,
    name: d.name,
    companyId: d.company_id ? 'c' + d.company_id : null,
    contactId: d.contact_id ? 'p' + d.contact_id : null,
    raw_company_id: d.company_id,
    raw_contact_id: d.contact_id,
    raw_stage_id: d.stage_id,
    amount: d.amount || 0,
    stage: d.stage_id ? 's' + d.stage_id : null,
    owner: d.owner || 'You',
    close: d.close_date || '',
    created: d.created_at ? new Date(d.created_at).toISOString().slice(0, 10) : '',
    source: d.source || '',
    priority: d.priority || 'med',
    forecast: d.forecast || 'pipeline',
    score: d.score || 50,
    company_name: d.company_name,
    company_logo: d.company_logo,
    company_color: d.company_color,
    contact_name: d.contact_name,
    contact_avatar: d.contact_avatar,
  };
}

function adaptTask(t) {
  return {
    id: 't' + t.id,
    raw_id: t.id,
    title: t.title,
    dealId: t.deal_id ? 'd' + t.deal_id : null,
    raw_deal_id: t.deal_id,
    raw_vendor_id: t.vendor_id,
    due: t.due_at ? new Date(t.due_at).toISOString().slice(0, 10) : '',
    priority: t.priority || 'normal',
    type: t.type || 'task',
    done: !!t.completed,
    owner: t.owner || 'You',
  };
}

function adaptTicket(t) {
  return {
    id: 'tk' + t.id,
    raw_id: t.id,
    subject: t.subject,
    companyId: t.company_id ? 'c' + t.company_id : null,
    requester: t.requester_id ? 'p' + t.requester_id : null,
    company_name: t.company_name,
    company_logo: t.company_logo,
    company_color: t.company_color,
    requester_name: t.requester_name,
    priority: t.priority,
    status: t.status,
    sla: t.sla,
    assignee: t.assignee,
    age: t.created_at ? humanAge(t.created_at) : '',
  };
}

function adaptAutomation(a) {
  return {
    id: 'au' + a.id,
    raw_id: a.id,
    name: a.name,
    trigger: a.trigger,
    actions: Array.isArray(a.actions) ? a.actions.length : 0,
    status: a.status,
    runs: a.runs || 0,
    last: a.last_run_at ? humanAge(a.last_run_at) : 'never',
  };
}

function adaptTeam(u) {
  return {
    id: 'u' + u.id,
    raw_id: u.id,
    name: u.is_self ? `You (${u.name})` : u.name,
    role: u.role || '',
    avatar: u.avatar || (u.name || '').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase(),
    quota: u.quota || 0,
    attained: u.attained || 0,
    color: u.color || '#7A7670',
  };
}

function adaptCampaign(c) {
  return {
    id: 'cm' + c.id,
    raw_id: c.id,
    name: c.name,
    channel: c.channel === 'email' ? 'Email' : 'WhatsApp',
    status: c.status === 'running' ? 'live' : c.status,
    sent: c.sent_count || 0,
    opened: c.opened_count || c.read_count || 0,
    replied: c.replied_count || c.reply_count || 0,
    booked: c.booked_count || 0,
    owner: c.owner || 'You',
  };
}

function adaptNotif(n) {
  return {
    id: 'n' + n.id,
    raw_id: n.id,
    kind: n.kind || 'info',
    text: n.text,
    time: humanAge(n.created_at),
    unread: !!n.unread,
  };
}

function humanAge(ts) {
  if (!ts) return '';
  const d = Date.now() - Number(ts);
  if (d < 60_000) return Math.max(1, Math.round(d / 1000)) + 's';
  if (d < 3_600_000) return Math.round(d / 60_000) + 'm';
  if (d < 86_400_000) return Math.round(d / 3_600_000) + 'h';
  if (d < 30 * 86_400_000) return Math.round(d / 86_400_000) + 'd';
  return new Date(Number(ts)).toISOString().slice(0, 10);
}

// ---- formatters / lookup helpers ---------------------------------------
function fmtMoney(n) {
  if (n == null) return '$0';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'k';
  return '$' + n;
}
function getCompany(id) { return (window.COMPANIES || []).find((c) => c.id === id) || null; }
function getContact(id) { return (window.CONTACTS || []).find((c) => c.id === id) || null; }
function getStage(id) { return (window.STAGES || []).find((s) => s.id === id) || null; }

// ---- store + provider --------------------------------------------------
const STORE = { ready: false, error: null, data: {} };
window.STORE = STORE;

async function loadAll() {
  const [
    companiesRaw, contactsRaw, stagesRaw, dealsRaw, tasksRaw, ticketsRaw,
    automationsRaw, teamRaw, notifsRaw, campaignsRaw, calendarRaw,
    revenueRaw, sourcesRaw, funnelRaw, heatmapRaw, kpiRaw, leaderboardRaw,
    pipelineTrendRaw, summaryRaw, insightsRaw, waStatus,
  ] = await Promise.all([
    api('/api/companies'),
    api('/api/contacts').then((r) => r.rows || r),
    api('/api/stages'),
    api('/api/deals'),
    api('/api/tasks?scope=all&limit=500'),
    api('/api/tickets'),
    api('/api/automations'),
    api('/api/team'),
    api('/api/notifications'),
    api('/api/campaigns'),
    api('/api/calendar'),
    api('/api/reports/revenue'),
    api('/api/reports/sources'),
    api('/api/reports/funnel'),
    api('/api/reports/heatmap'),
    api('/api/reports/kpis'),
    api('/api/reports/leaderboard'),
    api('/api/reports/pipeline-trend'),
    api('/api/ai/dashboard-summary'),
    api('/api/ai/insights'),
    api('/api/wa/status').catch(() => ({ ready: false, hasQr: false })),
  ]);

  window.COMPANIES = companiesRaw.map(adaptCompany);
  window.CONTACTS = contactsRaw.map(adaptContact);
  window.STAGES = stagesRaw.map(adaptStage);
  window.DEALS = dealsRaw.map(adaptDeal);
  window.TASKS = tasksRaw.map(adaptTask);
  window.TICKETS = ticketsRaw.map(adaptTicket);
  window.AUTOMATIONS = automationsRaw.map(adaptAutomation);
  window.TEAM = teamRaw.map(adaptTeam);
  window.NOTIFICATIONS = (notifsRaw.rows || []).map(adaptNotif);
  window.NOTIFICATIONS_UNREAD = notifsRaw.unread || 0;
  window.CAMPAIGNS = campaignsRaw.map(adaptCampaign);
  window.CALENDAR = (calendarRaw || []).map((e) => ({
    id: 'ev' + e.id,
    raw_id: e.id,
    title: e.title,
    starts_at: e.starts_at,
    ends_at: e.ends_at,
    color: e.color || '#7A7670',
    deal: e.deal_name || null,
    contact: e.contact_name || null,
  }));
  window.REVENUE_BY_MONTH = revenueRaw;
  window.SOURCES = sourcesRaw;
  window.FUNNEL = funnelRaw;
  window.HEATMAP = heatmapRaw;
  window.KPIS = kpiRaw;
  window.LEADERBOARD = leaderboardRaw.map(adaptTeam);
  window.PIPELINE_TREND = pipelineTrendRaw;
  window.DASH_SUMMARY = summaryRaw;
  window.AI_INSIGHTS = insightsRaw.insights || [];
  window.WA_STATUS = waStatus;

  // Generate an activity feed from the most recent messages/tasks/calls/deals
  const acts = [];
  for (const d of (dealsRaw || []).slice(0, 4)) {
    acts.push({
      id: 'a-d' + d.id,
      kind: 'deal',
      title: `${d.company_name || 'Deal'} — ${d.name}`,
      time: humanAge(d.created_at) + ' ago',
      dealId: 'd' + d.id,
      body: `${fmtMoney(d.amount)} · stage ${d.stage_name || '?'}`,
    });
  }
  for (const t of (tasksRaw || []).slice(0, 3)) {
    acts.push({
      id: 'a-t' + t.id,
      kind: 'note',
      title: t.title,
      time: humanAge(t.created_at) + ' ago',
      dealId: t.deal_id ? 'd' + t.deal_id : null,
      body: '',
    });
  }
  acts.sort((a, b) => a.time > b.time ? 1 : -1);
  window.ACTIVITIES = acts.slice(0, 8);

  STORE.ready = true;
  STORE.data = { loadedAt: Date.now() };
  STORE.error = null;
}

let refreshing = null;
async function refreshStore() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      await loadAll();
      window.dispatchEvent(new CustomEvent('store:change'));
    } catch (e) {
      STORE.error = e.message;
      STORE.ready = true; // unlock the UI even if a fetch failed
      window.dispatchEvent(new CustomEvent('store:change'));
      console.error('[store] refresh failed', e);
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}
window.refreshStore = refreshStore;

const useStore = () => {
  const [, force] = React.useReducer((x) => x + 1, 0);
  React.useEffect(() => {
    const h = () => force();
    window.addEventListener('store:change', h);
    return () => window.removeEventListener('store:change', h);
  }, []);
  return { ready: STORE.ready, error: STORE.error };
};

Object.assign(window, { fmtMoney, getCompany, getContact, getStage, useStore, humanAge });

// kick off the first load before React mounts; views render once STORE.ready === true
refreshStore();
