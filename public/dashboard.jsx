// =============================================================
// Dashboard — KPIs, charts, AI insights, recent activity. All live.
// =============================================================

const KpiCard = ({ label, value, delta, deltaKind = 'up', spark, color = '#E07A5F' }) => (
  <div className="card" style={{ padding: 16 }}>
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
      {delta && (
        <span className={'chip ' + (deltaKind === 'up' ? 'sage' : 'gray')} style={{ fontSize: 10 }}>
          <Icon name={deltaKind === 'up' ? 'arrow-up' : 'arrow-down'} size={10} />{delta}
        </span>
      )}
    </div>
    <div className="serif" style={{ fontSize: 32, marginTop: 6, letterSpacing: '-0.02em' }}>{value}</div>
    {spark && <div style={{ color, marginTop: 8 }}><Sparkline data={spark} w={200} h={32} stroke={color} fill={color} /></div>}
  </div>
);

const RevenueChart = () => {
  const data = window.REVENUE_BY_MONTH || [];
  if (!data.length) return <div style={{ padding: 24, color: 'var(--muted)' }}>No data yet</div>;
  const W = 720, H = 220, pad = 32;
  const max = Math.max(...data.map((d) => Math.max(d.booked, d.target)), 1) * 1.1;
  const bw = (W - pad * 2) / data.length;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      {[0, 0.25, 0.5, 0.75, 1].map((p, i) => (
        <g key={i}>
          <line x1={pad} x2={W - pad} y1={pad + (H - pad * 2) * (1 - p)} y2={pad + (H - pad * 2) * (1 - p)} stroke="rgba(26,26,26,0.06)" />
          <text x={pad - 6} y={pad + (H - pad * 2) * (1 - p) + 3} fontSize="9" fill="var(--muted)" textAnchor="end">{Math.round(max * p / 1000)}k</text>
        </g>
      ))}
      {data.map((d, i) => {
        const x = pad + bw * i + bw * 0.2;
        const w = bw * 0.6;
        const bh = (d.booked / max) * (H - pad * 2);
        const th = (d.target / max) * (H - pad * 2);
        const isPartial = i === data.length - 1;
        return (
          <g key={i}>
            <line x1={x - 2} x2={x + w + 2} y1={H - pad - th} y2={H - pad - th} stroke="var(--ink-3)" strokeDasharray="3 3" strokeWidth="1" />
            <rect x={x} y={H - pad - bh} width={w} height={bh} style={{ fill: isPartial ? 'var(--accent-soft)' : 'var(--accent)' }} rx="2" />
            <text x={x + w / 2} y={H - pad + 14} fontSize="10" fill="var(--muted)" textAnchor="middle">{d.m}</text>
          </g>
        );
      })}
      <text x={W - pad} y={pad - 8} fontSize="10" fill="var(--muted)" textAnchor="end">— target</text>
    </svg>
  );
};

const FunnelChart = () => {
  const data = window.FUNNEL || [];
  if (!data.length) return null;
  const max = data[0].count || 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {data.map((d, i) => {
        const w = (d.count / max) * 100;
        const conv = i === 0 ? 100 : (d.count / Math.max(1, data[i - 1].count)) * 100;
        return (
          <div key={i} className="row" style={{ gap: 12 }}>
            <div style={{ width: 80, fontSize: 12, color: 'var(--ink-2)' }}>{d.stage}</div>
            <div style={{ flex: 1, height: 28, background: 'var(--paper-2)', borderRadius: 4, position: 'relative', overflow: 'hidden' }}>
              <div style={{
                width: `${w}%`, height: '100%',
                background: `linear-gradient(90deg, var(--accent), ${i === 0 ? 'var(--accent)' : 'var(--blue)'})`,
                opacity: 0.85 - i * 0.08,
                display: 'flex', alignItems: 'center', paddingLeft: 10,
                fontSize: 12, color: 'white', fontWeight: 600,
              }}>{d.count.toLocaleString()}</div>
            </div>
            <div className="mono" style={{ width: 56, fontSize: 11, color: 'var(--muted)', textAlign: 'right' }}>{conv.toFixed(0)}%</div>
          </div>
        );
      })}
    </div>
  );
};

const SourcesPie = () => {
  const data = window.SOURCES || [];
  if (!data.length) return <div style={{ color: 'var(--muted)' }}>No sources yet</div>;
  const total = data.reduce((s, x) => s + x.value, 0) || 1;
  let acc = 0;
  const cx = 70, cy = 70, r = 55, ir = 36;
  return (
    <div className="row" style={{ gap: 20, alignItems: 'center' }}>
      <svg width="140" height="140">
        {data.map((s, i) => {
          const a0 = (acc / total) * Math.PI * 2 - Math.PI / 2;
          acc += s.value;
          const a1 = (acc / total) * Math.PI * 2 - Math.PI / 2;
          const x0 = cx + Math.cos(a0) * r, y0 = cy + Math.sin(a0) * r;
          const x1 = cx + Math.cos(a1) * r, y1 = cy + Math.sin(a1) * r;
          const xi0 = cx + Math.cos(a0) * ir, yi0 = cy + Math.sin(a0) * ir;
          const xi1 = cx + Math.cos(a1) * ir, yi1 = cy + Math.sin(a1) * ir;
          const large = (a1 - a0) > Math.PI ? 1 : 0;
          const d = `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${xi1} ${yi1} A ${ir} ${ir} 0 ${large} 0 ${xi0} ${yi0} Z`;
          return <path key={i} d={d} fill={s.color} />;
        })}
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
        {data.map((s, i) => (
          <div key={i} className="row" style={{ justifyContent: 'space-between' }}>
            <div className="row" style={{ gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color }}></span>
              <span style={{ fontSize: 12 }}>{s.src}</span>
            </div>
            <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{s.value}%</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const ActivityFeed = ({ items }) => (
  <div style={{ display: 'flex', flexDirection: 'column' }}>
    {items.map((a, i) => {
      const iconMap = { email: 'mail', meeting: 'meeting', note: 'note', deal: 'money', call: 'phone', ai: 'sparkle' };
      const colorMap = { email: '#3D5A80', meeting: '#6B4E71', note: '#7A7670', deal: '#588157', call: '#D4A373', ai: '#E07A5F' };
      return (
        <div key={i} className="row" style={{ gap: 12, padding: '10px 0', borderBottom: i < items.length - 1 ? '1px solid var(--rule-2)' : 'none', alignItems: 'flex-start' }}>
          <div style={{ width: 28, height: 28, borderRadius: 6, background: (colorMap[a.kind] || '#7A7670') + '22', color: colorMap[a.kind] || '#7A7670', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Icon name={iconMap[a.kind] || 'note'} size={14} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 500 }}>{a.title}</div>
            {a.body && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{a.body}</div>}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted-2)', whiteSpace: 'nowrap' }}>{a.time}</div>
        </div>
      );
    })}
  </div>
);

// ─────────────────────────────────────────────────────────────────────────
// Lead-focused dashboard widgets (vendor pipeline, calls, follow-ups, etc.)
// ─────────────────────────────────────────────────────────────────────────

const startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0,0,0,0); return x.getTime(); };
const startOfWeek = () => { const x = new Date(); x.setDate(x.getDate() - x.getDay()); x.setHours(0,0,0,0); return x.getTime(); };

const LeadKpiCard = ({ label, value, sub, accent, icon, onClick, deltaKind, delta }) => (
  <div className="card" style={{ padding: 14, cursor: onClick ? 'pointer' : 'default', borderTop: `2px solid ${accent || 'var(--accent)'}` }} onClick={onClick}>
    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <div className="row" style={{ gap: 6, alignItems: 'center' }}>
        {icon && <span style={{ width: 22, height: 22, borderRadius: 4, background: (accent || 'var(--accent)') + '22', color: accent || 'var(--accent)', display: 'grid', placeItems: 'center' }}><Icon name={icon} size={12} /></span>}
        <span style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
      </div>
      {delta != null && <span className={'chip ' + (deltaKind === 'up' ? 'sage' : deltaKind === 'down' ? 'gray' : '')} style={{ fontSize: 10 }}>{delta}</span>}
    </div>
    <div className="serif" style={{ fontSize: 28, marginTop: 6, letterSpacing: '-0.02em', lineHeight: 1.1 }}>{value}</div>
    {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
  </div>
);

const HBars = ({ rows, color = 'var(--accent)' }) => {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map((r, i) => (
        <div key={i} className="row" style={{ gap: 8 }}>
          <div style={{ width: 110, fontSize: 12, color: 'var(--ink-2)' }} className="trunc" title={r.label}>{r.label}</div>
          <div style={{ flex: 1, height: 18, background: 'var(--paper-2)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${(r.value / max) * 100}%`, height: '100%', background: r.color || color, transition: 'width .3s' }} />
          </div>
          <div className="mono" style={{ width: 36, fontSize: 11, color: 'var(--muted)', textAlign: 'right' }}>{r.value}</div>
        </div>
      ))}
      {rows.length === 0 && <div style={{ fontSize: 12, color: 'var(--muted)' }}>No data yet.</div>}
    </div>
  );
};

const fmtRelDay = (ms) => {
  if (!ms) return '—';
  const d = Math.floor((Date.now() - ms) / 86_400_000);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 7) return d + 'd ago';
  if (d < 30) return Math.floor(d / 7) + 'w ago';
  return new Date(ms).toLocaleDateString();
};

const Dashboard = ({ openAI, setRoute }) => {
  const summary = window.DASH_SUMMARY || {};
  const insights = window.AI_INSIGHTS || [];
  const today = new Date();
  const weekday = today.toLocaleDateString('en-US', { weekday: 'long' });
  const month = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  const me = (window.TEAM || []).find((u) => (u.name || '').startsWith('You'));
  const myFirstName = me ? me.name.replace(/^You \(/, '').replace(/\)$/, '').split(' ')[0] : 'there';
  const pipe = summary.pipeline_value || 0;

  // ── Lead metrics derived from the loaded store ──────────────────────────
  const contacts = window.CONTACTS || [];
  const deals = window.DEALS || [];
  const stages = window.STAGES || [];
  const tasks = window.TASKS || [];

  const contactsByStatus = React.useMemo(() => {
    const m = new Map();
    contacts.forEach((c) => { const k = c.status || 'new'; m.set(k, (m.get(k) || 0) + 1); });
    return m;
  }, [contacts]);

  const cityRows = React.useMemo(() => {
    const m = new Map();
    contacts.forEach((c) => { if (c.city) m.set(c.city, (m.get(c.city) || 0) + 1); });
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value }));
  }, [contacts]);

  const stageRows = React.useMemo(() => {
    return stages.map((s) => ({
      label: s.name,
      value: deals.filter((d) => d.stage === s.id).length,
      color: s.color,
    }));
  }, [stages, deals]);

  const wonStageIds = new Set(stages.filter((s) => s.isWon).map((s) => s.id));
  const lostStageIds = new Set(stages.filter((s) => s.isLost).map((s) => s.id));
  const openDeals = deals.filter((d) => !wonStageIds.has(d.stage) && !lostStageIds.has(d.stage));
  const wonDeals  = deals.filter((d) => wonStageIds.has(d.stage));
  const lostDeals = deals.filter((d) => lostStageIds.has(d.stage));
  const openPipelineValue = openDeals.reduce((s, d) => s + (d.amount || 0), 0);
  const wonValue = wonDeals.reduce((s, d) => s + (d.amount || 0), 0);
  const conversionPct = contacts.length ? Math.round((wonDeals.length / contacts.length) * 100) : 0;

  const todayMs = startOfDay();
  const tomorrowMs = todayMs + 86_400_000;
  const weekMs = startOfWeek();
  const overdueTasks = tasks.filter((t) => !t.done && t.due && new Date(t.due).getTime() < todayMs);
  const todayTasks   = tasks.filter((t) => !t.done && t.due && new Date(t.due).getTime() >= todayMs && new Date(t.due).getTime() < tomorrowMs);
  const upcomingFollowups = tasks
    .filter((t) => !t.done && t.due)
    .sort((a, b) => new Date(a.due).getTime() - new Date(b.due).getTime())
    .slice(0, 6);

  // ── Calls — fetched once on mount ──────────────────────────────────────
  const [calls, setCalls] = React.useState([]);
  React.useEffect(() => {
    api('/api/calls?limit=200').then(setCalls).catch(() => setCalls([]));
  }, [contacts.length]); // re-fetch if contacts change (e.g. after refreshStore)
  const callsToday = calls.filter((c) => c.created_at >= todayMs).length;
  const callsWeek  = calls.filter((c) => c.created_at >= weekMs).length;
  const talkSecToday = calls.filter((c) => c.created_at >= todayMs).reduce((s, c) => s + (c.duration_sec || 0), 0);
  const interestedToday = calls.filter((c) => c.created_at >= todayMs && c.outcome === 'interested').length;

  // Daily call volume for last 7 days (sparkline)
  const dailyCalls = React.useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => startOfDay(new Date(Date.now() - (6 - i) * 86_400_000)));
    return days.map((dStart) => calls.filter((c) => c.created_at >= dStart && c.created_at < dStart + 86_400_000).length);
  }, [calls]);

  const recentLeads = [...contacts].sort((a, b) => (b.raw_id || 0) - (a.raw_id || 0)).slice(0, 6);
  const recentCalls = calls.slice(0, 6);
  const tasksOpen = tasks.filter((t) => !t.done).slice(0, 5);

  const fmtTalk = (sec) => {
    if (!sec) return '0m';
    const m = Math.floor(sec / 60), s = sec % 60;
    return m + 'm' + (s ? ' ' + s + 's' : '');
  };

  return (
    <div className="page slide-up">
      <div className="page-h">
        <div>
          <div className="page-eyebrow">{weekday}, {month} · Live data</div>
          <h1 className="page-title">Good morning, <em>{myFirstName}</em>.</h1>
          <div className="page-sub">
            <strong>{contacts.length}</strong> leads, <strong>{openDeals.length}</strong> open deals,{' '}
            <strong>{callsToday}</strong> calls today, <strong>{overdueTasks.length}</strong> overdue.
          </div>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => setRoute('contacts')}><Icon name="people" size={12} />Leads / Clients</button>
          <button className="btn" onClick={() => setRoute('deals')}><Icon name="pipeline" size={12} />Pipeline</button>
          <button className="btn primary" onClick={() => window.openNewContact && window.openNewContact()}><Icon name="plus" size={12} />New lead</button>
        </div>
      </div>

      {/* ── Lead KPI grid (8 cards) ─────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 12 }}>
        <LeadKpiCard label="Total leads"        value={contacts.length}                                   sub={cityRows.length + ' cities'}                              accent="#E07A5F" icon="people"     onClick={() => setRoute('contacts')} />
        <LeadKpiCard label="Open pipeline"      value={openDeals.length}                                  sub={openPipelineValue ? fmtMoney(openPipelineValue) : 'no value set'} accent="#3D5A80" icon="pipeline"   onClick={() => setRoute('deals')} />
        <LeadKpiCard label="Won deals"          value={wonDeals.length}                                   sub={wonValue ? fmtMoney(wonValue) : (lostDeals.length + ' lost')}    accent="#588157" icon="check"      onClick={() => setRoute('deals')} />
        <LeadKpiCard label="Conversion"         value={conversionPct + '%'}                               sub={wonDeals.length + ' won / ' + contacts.length + ' leads'}        accent="#6B4E71" icon="chart"      />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        <LeadKpiCard label="Calls today"        value={callsToday}                                        sub={'Talk time ' + fmtTalk(talkSecToday)}                            accent="#D4A373" icon="phone"      onClick={() => setRoute('contacts')} />
        <LeadKpiCard label="Calls this week"    value={callsWeek}                                         sub={interestedToday + ' interested today'}                            accent="#A47148" icon="phone"      />
        <LeadKpiCard label="Overdue"            value={overdueTasks.length}                               sub={overdueTasks.length ? 'needs attention' : 'all clear'}            accent={overdueTasks.length ? '#C9184A' : '#588157'} icon="bell" onClick={() => setRoute('followUps')} />
        <LeadKpiCard label="Today + follow-ups" value={todayTasks.length + ' / ' + upcomingFollowups.length} sub={'due today / pending'}                                          accent="#2B59C3" icon="check-list" onClick={() => setRoute('followUps')} />
      </div>

      {/* ── Lead-state breakdown row ────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div className="card">
          <div className="card-h"><div className="card-title">Leads by status</div><span className="chip">{contacts.length}</span></div>
          <div className="card-b">
            <HBars
              rows={[
                { label: 'New',            value: contactsByStatus.get('new') || 0,           color: '#A8A29E' },
                { label: 'Contacted',      value: contactsByStatus.get('contacted') || 0,     color: '#D4A373' },
                { label: 'Interested',     value: contactsByStatus.get('interested') || 0,    color: '#588157' },
                { label: 'Follow-up',      value: contactsByStatus.get('follow_up') || 0,     color: '#3D5A80' },
                { label: 'Not interested', value: contactsByStatus.get('not_interested') || 0,color: '#5C5C5C' },
                { label: 'Won',            value: contactsByStatus.get('won') || 0,           color: '#588157' },
                { label: 'Lost',           value: contactsByStatus.get('lost') || 0,          color: '#C9184A' },
              ].filter((r) => r.value > 0)}
            />
          </div>
        </div>
        <div className="card">
          <div className="card-h"><div className="card-title">Pipeline by stage</div><span className="chip">{deals.length} deals</span></div>
          <div className="card-b"><HBars rows={stageRows.filter((r) => r.value > 0)} /></div>
        </div>
        <div className="card">
          <div className="card-h"><div className="card-title">Top cities</div><span className="chip">{cityRows.length}</span></div>
          <div className="card-b"><HBars rows={cityRows} /></div>
        </div>
      </div>

      {/* ── Daily call volume + Recent leads + Recent calls ─────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div className="card">
          <div className="card-h"><div className="card-title">Calls · last 7 days</div><span className="chip">{dailyCalls.reduce((s, n) => s + n, 0)}</span></div>
          <div className="card-b">
            <div style={{ color: '#D4A373' }}>
              <Sparkline data={dailyCalls.length ? dailyCalls : [0,0,0,0,0,0,0]} w={300} h={60} stroke="#D4A373" fill="#D4A373" />
            </div>
            <div className="row" style={{ justifyContent: 'space-between', marginTop: 8, fontSize: 10, color: 'var(--muted)' }}>
              <span>6d ago</span><span>5d</span><span>4d</span><span>3d</span><span>2d</span><span>1d</span><span>today</span>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-h"><div className="card-title">Recent leads</div><button className="btn ghost sm" onClick={() => setRoute('contacts')}>View all<Icon name="arrow-right" size={12} /></button></div>
          <div className="card-b" style={{ padding: 0 }}>
            {recentLeads.map((c, i) => (
              <div key={c.id} className="row" style={{ padding: '8px 14px', borderBottom: i < recentLeads.length - 1 ? '1px solid var(--rule-2)' : 'none', gap: 10, cursor: 'pointer' }} onClick={() => setRoute('contacts')}>
                <Avatar name={c.avatar} color={(getCompany(c.companyId) || {}).color || '#7A7670'} size="sm" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }} className="trunc">{c.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }} className="trunc">{c.businessType || c.title || '—'} · {c.city || '—'}</div>
                </div>
                <span className={'chip ' + (c.status === 'interested' || c.status === 'won' ? 'sage' : c.status === 'lost' ? 'gray' : '')} style={{ fontSize: 9 }}>{c.status}</span>
              </div>
            ))}
            {recentLeads.length === 0 && <div style={{ padding: 24, fontSize: 12, color: 'var(--muted)' }}>No leads yet.</div>}
          </div>
        </div>
        <div className="card">
          <div className="card-h"><div className="card-title">Recent calls</div><span className="chip">{calls.length}</span></div>
          <div className="card-b" style={{ padding: 0 }}>
            {recentCalls.map((h, i) => (
              <div key={h.id} className="row" style={{ padding: '8px 14px', borderBottom: i < recentCalls.length - 1 ? '1px solid var(--rule-2)' : 'none', gap: 10 }}>
                <span style={{ width: 28, height: 28, borderRadius: 6, background: '#D4A37322', color: '#D4A373', display: 'grid', placeItems: 'center' }}><Icon name="phone" size={12} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500 }} className="trunc">{h.vendor_name || '—'}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>{h.disposition || '—'} · {fmtTalk(h.duration_sec)} · {fmtRelDay(h.created_at)}</div>
                </div>
                {h.outcome && <span className="chip" style={{ fontSize: 9 }}>{h.outcome}</span>}
              </div>
            ))}
            {recentCalls.length === 0 && <div style={{ padding: 24, fontSize: 12, color: 'var(--muted)' }}>No calls logged yet.</div>}
          </div>
        </div>
      </div>

      {/* ── Upcoming follow-ups + Overdue ──────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div className="card">
          <div className="card-h"><div className="card-title">Upcoming follow-ups</div><button className="btn ghost sm" onClick={() => setRoute('tasks')}>View all<Icon name="arrow-right" size={12} /></button></div>
          <div className="card-b" style={{ padding: 0 }}>
            {upcomingFollowups.map((t, i) => (
              <div key={t.id} className="row" style={{ padding: '10px 16px', borderBottom: i < upcomingFollowups.length - 1 ? '1px solid var(--rule-2)' : 'none', gap: 10 }}>
                <input type="checkbox" onChange={async () => { await api(`/api/tasks/${t.raw_id}`, { method: 'PUT', body: { completed: true } }); await refreshStore(); }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500 }} className="trunc">{t.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t.due || 'no due date'} · {t.type}</div>
                </div>
                <span className={'chip ' + (t.priority === 'high' ? 'accent' : t.priority === 'med' ? 'ochre' : 'gray')} style={{ fontSize: 10 }}>{t.priority}</span>
              </div>
            ))}
            {upcomingFollowups.length === 0 && <div style={{ padding: 24, fontSize: 12, color: 'var(--muted)' }}>Nothing pending. 🎉</div>}
          </div>
        </div>
        <div className="card" style={overdueTasks.length ? { borderColor: '#C9184A55' } : {}}>
          <div className="card-h"><div className="card-title">Overdue · {overdueTasks.length}</div>{overdueTasks.length > 0 && <span className="chip" style={{ background: '#C9184A22', color: '#C9184A', fontSize: 10 }}>action needed</span>}</div>
          <div className="card-b" style={{ padding: 0 }}>
            {overdueTasks.slice(0, 6).map((t, i) => (
              <div key={t.id} className="row" style={{ padding: '10px 16px', borderBottom: i < Math.min(overdueTasks.length, 6) - 1 ? '1px solid var(--rule-2)' : 'none', gap: 10 }}>
                <input type="checkbox" onChange={async () => { await api(`/api/tasks/${t.raw_id}`, { method: 'PUT', body: { completed: true } }); await refreshStore(); }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500 }} className="trunc">{t.title}</div>
                  <div style={{ fontSize: 11, color: '#C9184A' }}>{t.due ? 'Due ' + fmtRelDay(new Date(t.due).getTime()) : 'no due date'}</div>
                </div>
                <span className={'chip ' + (t.priority === 'high' ? 'accent' : 'gray')} style={{ fontSize: 10 }}>{t.priority}</span>
              </div>
            ))}
            {overdueTasks.length === 0 && <div style={{ padding: 24, fontSize: 12, color: 'var(--muted)' }}>Nothing overdue. ✨</div>}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginBottom: 16 }}>
        <div className="card">
          <div className="card-h">
            <div>
              <div className="card-title">Revenue vs target</div>
              <div className="card-sub">Booked revenue against monthly quota — last 7 months</div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <span className="chip dot" style={{ color: 'var(--accent)' }}>Booked</span>
              <span className="chip" style={{ borderStyle: 'dashed' }}>Target</span>
            </div>
          </div>
          <div className="card-b"><RevenueChart /></div>
        </div>
        <div className="card">
          <div className="card-h">
            <div className="card-title">Pipeline sources</div>
            <Icon name="dot-3" size={14} className="muted" />
          </div>
          <div className="card-b"><SourcesPie /></div>
        </div>
      </div>

      {insights.length > 0 && (
        <div className="card ai-glow" style={{ marginBottom: 16 }}>
          <div className="card-h" style={{ borderBottom: 'none', paddingBottom: 0 }}>
            <div className="row" style={{ gap: 8 }}>
              <span className="ai-mark"><Icon name="sparkle" size={10} />AI Insights</span>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{insights.length} things to consider</span>
            </div>
            <button className="btn ghost sm" onClick={openAI}>Ask follow-up<Icon name="arrow-right" size={12} /></button>
          </div>
          <div className="card-b" style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(3, insights.length)}, 1fr)`, gap: 12 }}>
            {insights.slice(0, 3).map((c, i) => (
              <div key={i} style={{ padding: 12, background: 'var(--card)', borderRadius: 8, border: '1px solid var(--rule-2)' }}>
                <div className="row" style={{ gap: 6, marginBottom: 6 }}>
                  <Icon name={c.kind === 'up' ? 'flame' : 'bell'} size={14} style={{ color: c.kind === 'up' ? 'var(--accent)' : 'var(--err)' }} />
                  <strong style={{ fontSize: 13 }}>{c.title}</strong>
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>{c.body}</div>
                <div className="row" style={{ marginTop: 10, gap: 6 }}>
                  <button className="btn sm" onClick={() => setRoute('deals')}>Open deal</button>
                  <button className="btn sm ghost">Dismiss</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div className="card">
          <div className="card-h">
            <div className="card-title">Funnel · last 90 days</div>
            <span className="chip">{(window.FUNNEL || [])[0]?.count.toLocaleString() || 0} → {(window.FUNNEL || []).slice(-1)[0]?.count.toLocaleString() || 0}</span>
          </div>
          <div className="card-b"><FunnelChart /></div>
        </div>
        <div className="card">
          <div className="card-h">
            <div className="card-title">Today &amp; tomorrow</div>
            <button className="btn ghost sm" onClick={() => setRoute('tasks')}>View all<Icon name="arrow-right" size={12} /></button>
          </div>
          <div className="card-b" style={{ padding: 0 }}>
            {tasksOpen.map((t, i) => (
              <div key={t.id} className="row" style={{ padding: '10px 16px', borderBottom: i < tasksOpen.length - 1 ? '1px solid var(--rule-2)' : 'none', gap: 10 }}>
                <input type="checkbox" onChange={async () => {
                  await api(`/api/tasks/${t.raw_id}`, { method: 'PUT', body: { completed: true } });
                  await refreshStore();
                }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 500 }}>{t.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t.due || 'no due date'} · {t.owner}</div>
                </div>
                <span className={'chip ' + (t.priority === 'high' ? 'accent' : t.priority === 'med' ? 'ochre' : 'gray')} style={{ fontSize: 10 }}>{t.priority}</span>
              </div>
            ))}
            {tasksOpen.length === 0 && <div style={{ padding: 24, fontSize: 12, color: 'var(--muted)' }}>Nothing due. 🌤</div>}
          </div>
        </div>
        <div className="card">
          <div className="card-h">
            <div className="card-title">Recent activity</div>
            <button className="btn ghost sm"><Icon name="filter" size={12} /></button>
          </div>
          <div className="card-b"><ActivityFeed items={(window.ACTIVITIES || []).slice(0, 6)} /></div>
        </div>
      </div>
    </div>
  );
};

window.Dashboard = Dashboard;
window.ActivityFeed = ActivityFeed;
window.FunnelChart = FunnelChart;
