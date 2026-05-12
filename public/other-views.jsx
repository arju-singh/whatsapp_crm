// =============================================================
// Reports, Campaigns, Tickets, Automations, Team, Settings — live.
// =============================================================

const Reports = () => {
  const { ready } = useStore();
  if (!ready) return null;
  const kpis = window.KPIS || {};
  const heatmap = window.HEATMAP || [];
  const leaderboard = window.LEADERBOARD || [];
  return (
    <div className="page slide-up">
      <div className="page-h">
        <div>
          <div className="page-eyebrow">Q2 2026 · Live data</div>
          <h1 className="page-title">Reports &amp; <em>analytics</em></h1>
          <div className="page-sub">Custom dashboards, conversion analysis, and team performance.</div>
        </div>
        <div className="page-actions">
          <button className="btn"><Icon name="filter" size={12} />Last 90 days</button>
          <button className="btn" onClick={() => window.print()}><Icon name="doc" size={12} />Export PDF</button>
          <button className="btn primary"><Icon name="plus" size={12} />New report</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        {[
          { l: 'Avg deal size', v: fmtMoney(kpis.avg_deal_size || 0), d: '+12%' },
          { l: 'Sales cycle', v: (kpis.sales_cycle_days || 0) + ' days', d: '-8d' },
          { l: 'Win rate', v: (kpis.win_rate || 0) + '%', d: '+4pt' },
          { l: 'Activities/deal', v: kpis.activities_per_deal || '0', d: '+1.6' },
        ].map((k, i) => (
          <div key={i} className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{k.l}</div>
            <div className="serif" style={{ fontSize: 28, marginTop: 4 }}>{k.v}</div>
            <div className="row" style={{ gap: 4, marginTop: 4 }}>
              <Icon name="arrow-up" size={10} style={{ color: 'var(--sage)' }} />
              <span style={{ fontSize: 11, color: 'var(--sage)' }}>{k.d}</span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>vs prev period</span>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginBottom: 16 }}>
        <div className="card">
          <div className="card-h">
            <div>
              <div className="card-title">Activity heatmap</div>
              <div className="card-sub">Inbound message density · 7 days × 24 hours</div>
            </div>
            <span className="chip">Local timezone</span>
          </div>
          <div className="card-b">
            <div style={{ display: 'grid', gridTemplateColumns: '40px repeat(24, 1fr)', gap: 2, fontSize: 9 }}>
              <div></div>
              {Array.from({ length: 24 }, (_, i) => <div key={i} style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 9 }}>{i % 4 === 0 ? i : ''}</div>)}
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, di) => (
                <React.Fragment key={d}>
                  <div style={{ fontSize: 10, color: 'var(--muted)', alignSelf: 'center' }}>{d}</div>
                  {(heatmap[di] || []).map((v, hi) => (
                    <div key={hi} style={{
                      aspectRatio: '1', borderRadius: 2,
                      background: `rgba(224,122,95,${(+v).toFixed(2)})`,
                      border: v > 0.05 ? '0' : '1px solid var(--rule-2)',
                    }} title={`${d} ${hi}:00 — ${(v * 100).toFixed(0)}%`} />
                  ))}
                </React.Fragment>
              ))}
            </div>
            <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end', gap: 4, fontSize: 10, color: 'var(--muted)' }}>
              <span>Less</span>
              {[0.1, 0.3, 0.5, 0.7, 0.9].map((v) => <div key={v} style={{ width: 12, height: 12, background: `rgba(224,122,95,${v})`, borderRadius: 2 }}></div>)}
              <span>More</span>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-h"><div className="card-title">Stage conversion</div></div>
          <div className="card-b"><FunnelChart /></div>
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <div className="card-title">Rep leaderboard</div>
          <button className="btn ghost sm"><Icon name="dot-3" /></button>
        </div>
        <div className="card-b" style={{ padding: 0 }}>
          <table className="table">
            <thead><tr><th>Rep</th><th>Quota</th><th>Attained</th><th>%</th><th>Open pipe</th><th>Activities</th><th>Trend</th></tr></thead>
            <tbody>
              {leaderboard.map((u) => {
                const pct = u.quota > 0 ? (u.attained / u.quota) * 100 : 0;
                return (
                  <tr key={u.id}>
                    <td>
                      <div className="row" style={{ gap: 10 }}>
                        <Avatar name={u.avatar} color={u.color} />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{u.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{u.role}</div>
                        </div>
                      </div>
                    </td>
                    <td className="num">{fmtMoney(u.quota)}</td>
                    <td className="num">{fmtMoney(u.attained)}</td>
                    <td>
                      <div className="row" style={{ gap: 8 }}>
                        <div style={{ flex: 1, height: 6, background: 'var(--paper-2)', borderRadius: 3, overflow: 'hidden', minWidth: 80 }}>
                          <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: pct >= 90 ? 'var(--sage)' : pct >= 70 ? 'var(--ochre)' : 'var(--accent)' }} />
                        </div>
                        <span className="mono" style={{ fontSize: 11 }}>{pct.toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className="num">{fmtMoney(u.open_pipe || 0)}</td>
                    <td className="num">{u.activities || 0}</td>
                    <td><div style={{ color: u.color }}><Sparkline data={[20, 28, 24, 32, 38, 30, 42]} stroke={u.color} fill={u.color} w={80} h={24} /></div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const Campaigns = () => {
  const { ready } = useStore();
  if (!ready) return null;
  const statusColor = { live: 'sage', paused: 'ochre', draft: 'gray', running: 'sage' };
  const cs = window.CAMPAIGNS || [];
  const reached = cs.reduce((s, c) => s + c.sent, 0);
  return (
    <div className="page slide-up">
      <div className="page-h">
        <div>
          <div className="page-eyebrow">{cs.length} campaigns · {reached.toLocaleString()} reached</div>
          <h1 className="page-title">Marketing <em>campaigns</em></h1>
        </div>
        <div className="page-actions">
          <button className="btn"><Icon name="doc" size={12} />Templates</button>
          <button className="btn primary" onClick={() => window.openNewCampaign && window.openNewCampaign()}><Icon name="plus" size={12} />New campaign</button>
        </div>
      </div>

      {cs.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>No campaigns yet — bulk-send from the Inbox or via API to create one.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          {cs.map((c) => {
            const openRate = c.sent ? (c.opened / c.sent * 100) : 0;
            const replyRate = c.sent ? (c.replied / c.sent * 100) : 0;
            return (
              <div key={c.id} className="card" style={{ padding: 16 }}>
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                  <div>
                    <div className="row" style={{ gap: 8, marginBottom: 4 }}>
                      <span className={'chip ' + (statusColor[c.status] || 'gray')}>{c.status}</span>
                      <span className="chip">{c.channel}</span>
                    </div>
                    <div className="serif" style={{ fontSize: 18 }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>by {c.owner}</div>
                  </div>
                  <button className="icon-btn" onClick={async () => {
                    if (!confirm('Delete campaign?')) return;
                    await api(`/api/campaigns/${c.raw_id}`, { method: 'DELETE' });
                    refreshStore();
                  }}><Icon name="trash" size={14} /></button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--rule-2)' }}>
                  {[
                    { l: 'Sent', v: c.sent.toLocaleString() },
                    { l: 'Open', v: `${openRate.toFixed(0)}%` },
                    { l: 'Reply', v: `${replyRate.toFixed(0)}%` },
                    { l: 'Booked', v: c.booked },
                  ].map((s) => (
                    <div key={s.l}>
                      <div style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{s.l}</div>
                      <div className="serif" style={{ fontSize: 18, marginTop: 2 }}>{s.v}</div>
                    </div>
                  ))}
                </div>
                {c.sent > 0 && (
                  <div style={{ marginTop: 12, height: 4, background: 'var(--paper-2)', borderRadius: 2, display: 'flex', overflow: 'hidden' }}>
                    <div style={{ width: `${(c.opened / c.sent * 100)}%`, background: 'var(--blue)' }} />
                    <div style={{ width: `${(c.replied / c.sent * 100)}%`, background: 'var(--accent)' }} />
                    <div style={{ width: `${(c.booked / c.sent * 100)}%`, background: 'var(--sage)' }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const Tickets = () => {
  const { ready } = useStore();
  if (!ready) return null;
  const ticks = window.TICKETS || [];
  const priColor = { urgent: '#C9184A', high: '#E07A5F', med: '#D4A373', low: '#7A7670' };
  const statusColor = { open: 'accent', pending: 'ochre', solved: 'sage' };
  const grouped = {
    open: ticks.filter((t) => t.status === 'open'),
    pending: ticks.filter((t) => t.status === 'pending'),
    solved: ticks.filter((t) => t.status === 'solved'),
  };

  const setStatus = async (t, status) => {
    await api(`/api/tickets/${t.raw_id}`, { method: 'PUT', body: { status } });
    await refreshStore();
  };

  return (
    <div className="page slide-up">
      <div className="page-h">
        <div>
          <div className="page-eyebrow">{grouped.open.length} open · {ticks.filter((t) => t.priority === 'urgent' && t.status !== 'solved').length} urgent</div>
          <h1 className="page-title">Customer <em>tickets</em></h1>
        </div>
        <div className="page-actions">
          <button className="btn"><Icon name="filter" size={12} />Mine</button>
          <button className="btn primary" onClick={() => window.openNewTicket && window.openNewTicket()}><Icon name="plus" size={12} />New ticket</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {Object.entries(grouped).map(([status, items]) => (
          <div key={status}>
            <div className="row" style={{ gap: 8, marginBottom: 8 }}>
              <strong style={{ fontSize: 14, textTransform: 'capitalize' }}>{status}</strong>
              <span className={'chip ' + statusColor[status]}>{items.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {items.map((t) => (
                <div key={t.id} className="card" style={{ padding: 12, borderLeft: `3px solid ${priColor[t.priority]}` }}>
                  <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                    <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>#{t.id.toUpperCase()}</span>
                    <span className="chip" style={{ fontSize: 10, color: priColor[t.priority] }}>{t.priority}</span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{t.subject}</div>
                  <div className="row" style={{ gap: 6, marginBottom: 8 }}>
                    {t.company_color && <div style={{ width: 14, height: 14, borderRadius: 2, background: t.company_color, color: 'white', fontSize: 7, display: 'grid', placeItems: 'center', fontWeight: 700 }}>{t.company_logo}</div>}
                    <span style={{ fontSize: 11 }}>{t.company_name || '—'}</span>
                    {t.requester_name && <span style={{ fontSize: 11, color: 'var(--muted)' }}>· {t.requester_name}</span>}
                  </div>
                  <div className="row" style={{ justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', borderTop: '1px solid var(--rule-2)', paddingTop: 8 }}>
                    <span>SLA: {t.sla} · {t.age} ago</span>
                    <span>{t.assignee}</span>
                  </div>
                  <div className="row" style={{ gap: 4, marginTop: 8 }}>
                    {status !== 'open' && <button className="btn sm" onClick={() => setStatus(t, 'open')}>Reopen</button>}
                    {status !== 'pending' && status !== 'solved' && <button className="btn sm" onClick={() => setStatus(t, 'pending')}>Pending</button>}
                    {status !== 'solved' && <button className="btn sm primary" onClick={() => setStatus(t, 'solved')}>Solve</button>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const Automations = () => {
  const { ready } = useStore();
  const [meta, setMeta] = React.useState({ triggers: [], actions: [] });
  const [editing, setEditing] = React.useState(null);
  const [testing, setTesting] = React.useState(null);
  const [fullList, setFullList] = React.useState([]);

  const loadFull = React.useCallback(() => {
    api('/api/automations').then(setFullList).catch(() => setFullList([]));
  }, []);

  React.useEffect(() => {
    api('/api/automations/meta').then(setMeta).catch(() => {});
    loadFull();
  }, [loadFull]);

  if (!ready) return null;

  const toggle = async (a) => {
    await api(`/api/automations/${a.id}/toggle`, { method: 'PUT' });
    loadFull(); refreshStore();
  };

  const testRun = async (a) => {
    setTesting(a.id);
    try {
      // Try with a sample vendor for context
      const sampleVendor = (window.CONTACTS || [])[0];
      const r = await api(`/api/automations/${a.id}/run`, { method: 'POST', body: { vendor_id: sampleVendor && sampleVendor.raw_id } });
      const lines = (r.results || []).map((x) => `• ${x.action.a}: ${x.error || JSON.stringify(x.result)}`);
      alert('Test run complete:\n\n' + (lines.join('\n') || '(no actions)'));
    } catch (e) {
      alert('Test failed: ' + e.message);
    }
    setTesting(null);
    loadFull();
  };

  return (
    <div className="page slide-up">
      <div className="page-h">
        <div>
          <div className="page-eyebrow">{fullList.filter((a) => a.status === 'on').length} active · {fullList.reduce((s, a) => s + (a.runs || 0), 0)} total runs</div>
          <h1 className="page-title">Workflow <em>automations</em></h1>
          <div className="page-sub">Hooks fire on real CRM events: new contact, inbound message, deal stage change, no-reply timers. Each runs an action chain (send template, create task, AI draft, etc.).</div>
        </div>
        <div className="page-actions">
          <button className="btn primary" onClick={() => setEditing({ name: '', trigger: meta.triggers[0]?.id || 'contact_created', actions: [{ a: 'notify', kind: 'info', text: '' }], status: 'on' })}>
            <Icon name="plus" size={12} />New automation
          </button>
        </div>
      </div>

      {editing && (
        <AutomationEditor
          automation={editing}
          meta={meta}
          onCancel={() => setEditing(null)}
          onSaved={() => { setEditing(null); loadFull(); refreshStore(); }}
        />
      )}

      {fullList.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
          No automations yet. Click <strong>New automation</strong> above, or pick a template below.
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 24 }}>
          <table className="table">
            <thead><tr><th></th><th>Name</th><th>Trigger</th><th>Actions</th><th>Status</th><th className="num">Runs</th><th>Last run</th><th></th></tr></thead>
            <tbody>
              {fullList.map((a) => {
                const triggerLabel = (meta.triggers.find((t) => t.id === a.trigger) || {}).label || a.trigger;
                const actionCount = Array.isArray(a.actions) ? a.actions.length : 0;
                return (
                  <tr key={a.id}>
                    <td style={{ width: 36 }}>
                      <div style={{ width: 28, height: 28, borderRadius: 6, background: a.status === 'on' ? 'var(--accent-soft)' : 'var(--paper-2)', color: a.status === 'on' ? 'var(--accent-ink)' : 'var(--muted)', display: 'grid', placeItems: 'center' }}>
                        <Icon name="bolt" size={14} />
                      </div>
                    </td>
                    <td><strong style={{ fontSize: 13 }}>{a.name}</strong></td>
                    <td><span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{triggerLabel}</span></td>
                    <td>
                      <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                        {(a.actions || []).slice(0, 4).map((ac, i) => (
                          <span key={i} className="chip" style={{ fontSize: 10 }}>{ac.a}</span>
                        ))}
                        {actionCount > 4 && <span style={{ fontSize: 11, color: 'var(--muted)' }}>+{actionCount - 4}</span>}
                      </div>
                    </td>
                    <td>
                      <div onClick={() => toggle(a)} style={{ position: 'relative', width: 32, height: 18, background: a.status === 'on' ? 'var(--sage)' : 'var(--paper-2)', borderRadius: 99, cursor: 'pointer' }}>
                        <div style={{ position: 'absolute', top: 2, left: a.status === 'on' ? 16 : 2, width: 14, height: 14, background: 'white', borderRadius: '50%', transition: 'left .2s', boxShadow: '0 1px 2px rgba(0,0,0,0.2)' }} />
                      </div>
                    </td>
                    <td className="num">{a.runs || 0}</td>
                    <td style={{ fontSize: 12, color: 'var(--muted)' }}>{a.last_run_at ? humanAge(a.last_run_at) + ' ago' : 'never'}</td>
                    <td>
                      <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                        <button className="btn sm" onClick={() => testRun(a)} disabled={testing === a.id}>{testing === a.id ? '…' : 'Test run'}</button>
                        <button className="btn sm ghost" onClick={() => setEditing(a)}><Icon name="note" size={12} /></button>
                        <button className="icon-btn" onClick={async () => {
                          if (!confirm('Delete this automation?')) return;
                          await api(`/api/automations/${a.id}`, { method: 'DELETE' });
                          loadFull(); refreshStore();
                        }}><Icon name="trash" size={12} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="card-title" style={{ margin: '0 0 12px', fontSize: 16 }}>Quick-start templates</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
        {[
          { name: 'Welcome new contact', trigger: 'contact_created', actions: [{ a: 'notify', kind: 'info', text: 'New contact added — review and add tags' }] },
          { name: 'AI-draft replies for inbound', trigger: 'message_received', actions: [{ a: 'ai_draft_reply' }] },
          { name: 'Auto-tag lead score 85+', trigger: 'lead_score_changed', actions: [{ a: 'add_tag', tag: 'hot-lead' }, { a: 'notify', kind: 'ai', text: 'Hot lead spotted' }] },
          { name: 'Won deal celebration', trigger: 'deal_stage_changed', actions: [{ a: 'notify', kind: 'deal', text: 'Deal closed-won 🎉' }] },
          { name: 'Follow-up after 24h silence', trigger: 'no_reply_24h', actions: [{ a: 'create_task', title: 'Follow up: vendor went quiet', priority: 'med', due_in_h: 4 }] },
          { name: 'Daily morning briefing', trigger: 'daily_morning', actions: [{ a: 'notify', kind: 'ai', text: 'Daily briefing ready' }] },
        ].map((tpl, i) => (
          <div key={i} className="card" style={{ padding: 14, cursor: 'pointer' }} onClick={() => setEditing({ name: tpl.name, trigger: tpl.trigger, actions: tpl.actions, status: 'on' })}>
            <Icon name="bolt" size={16} style={{ color: 'var(--accent)' }} />
            <div style={{ fontWeight: 600, fontSize: 13, marginTop: 6 }}>{tpl.name}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{(meta.triggers.find((t) => t.id === tpl.trigger) || {}).label || tpl.trigger}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

const AutomationEditor = ({ automation, meta, onCancel, onSaved }) => {
  const isNew = !automation.id;
  const [name, setName] = React.useState(automation.name || '');
  const [trigger, setTrigger] = React.useState(automation.trigger || 'contact_created');
  const [status, setStatus] = React.useState(automation.status || 'on');
  const [actions, setActions] = React.useState(Array.isArray(automation.actions) ? automation.actions : []);
  const [saving, setSaving] = React.useState(false);

  const updateAction = (i, patch) => setActions(actions.map((a, idx) => idx === i ? { ...a, ...patch } : a));
  const removeAction = (i) => setActions(actions.filter((_, idx) => idx !== i));
  const addAction = () => setActions([...actions, { a: meta.actions[0]?.id || 'notify' }]);

  const save = async () => {
    if (!name.trim()) { alert('Name required'); return; }
    setSaving(true);
    try {
      if (isNew) {
        await api('/api/automations', { method: 'POST', body: { name, trigger, actions, status } });
      } else {
        await api(`/api/automations/${automation.id}`, { method: 'PUT', body: { name, trigger, actions, status } });
      }
      onSaved();
    } catch (e) {
      alert('Save failed: ' + e.message);
    }
    setSaving(false);
  };

  const templates = window.api ? null : null; // fallback
  const [tplList, setTplList] = React.useState([]);
  React.useEffect(() => { api('/api/templates').then(setTplList).catch(() => setTplList([])); }, []);

  return (
    <div className="card" style={{ padding: 16, marginBottom: 16, background: 'var(--paper-2)' }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <div className="card-title">{isNew ? 'New automation' : 'Edit automation'}</div>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : (isNew ? 'Create' : 'Save')}</button>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 100px', gap: 12, marginBottom: 12 }}>
        <Field label="Name *"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Auto-greet new contacts" /></Field>
        <Field label="Trigger">
          <select value={trigger} onChange={(e) => setTrigger(e.target.value)}>
            {meta.triggers.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="on">On</option><option value="off">Off</option>
          </select>
        </Field>
      </div>

      <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--muted)' }}>Action chain ({actions.length})</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {actions.map((a, i) => {
          const def = meta.actions.find((m) => m.id === a.a) || { params: [] };
          return (
            <div key={i} className="card" style={{ padding: 10, background: 'var(--card)' }}>
              <div className="row" style={{ gap: 8, marginBottom: 8 }}>
                <span className="chip accent" style={{ fontSize: 11, fontWeight: 700 }}>{i + 1}</span>
                <select value={a.a} onChange={(e) => updateAction(i, { a: e.target.value })} style={{ flex: 1 }}>
                  {meta.actions.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
                <button className="btn sm ghost" onClick={() => removeAction(i)}><Icon name="x" size={12} /></button>
              </div>
              {def.params.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
                  {def.params.map((p) => (
                    <Field key={p} label={p}>
                      {p === 'template_id' ? (
                        <select value={a[p] || ''} onChange={(e) => updateAction(i, { [p]: Number(e.target.value) || null })}>
                          <option value="">— pick template —</option>
                          {tplList.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      ) : p === 'priority' ? (
                        <select value={a[p] || 'med'} onChange={(e) => updateAction(i, { [p]: e.target.value })}>
                          <option>low</option><option>med</option><option>high</option>
                        </select>
                      ) : p === 'kind' ? (
                        <select value={a[p] || 'info'} onChange={(e) => updateAction(i, { [p]: e.target.value })}>
                          <option>info</option><option>ai</option><option>deal</option><option>email</option><option>task</option>
                        </select>
                      ) : (
                        <input
                          type={p === 'due_in_h' ? 'number' : 'text'}
                          value={a[p] || ''}
                          onChange={(e) => updateAction(i, { [p]: p === 'due_in_h' ? Number(e.target.value) || 0 : e.target.value })}
                          placeholder={p}
                        />
                      )}
                    </Field>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={addAction}><Icon name="plus" size={12} />Add action</button>
    </div>
  );
};

const Team = () => {
  const { ready } = useStore();
  if (!ready) return null;
  const team = window.TEAM || [];
  return (
    <div className="page slide-up">
      <div className="page-h">
        <div>
          <div className="page-eyebrow">{team.length} members · {new Set(team.map((u) => u.role)).size} roles</div>
          <h1 className="page-title">Your <em>team</em></h1>
        </div>
        <div className="page-actions">
          <button className="btn"><Icon name="link" size={12} />Invite link</button>
          <button className="btn primary" onClick={async () => {
            const name = prompt('Member name:');
            if (!name) return;
            const role = prompt('Role:') || 'AE';
            await api('/api/team', { method: 'POST', body: { name, role } });
            await refreshStore();
          }}><Icon name="plus" size={12} />Invite member</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {team.map((u) => {
          const pct = u.quota ? (u.attained / u.quota) * 100 : 0;
          return (
            <div key={u.id} className="card" style={{ padding: 16 }}>
              <div className="row" style={{ gap: 12, marginBottom: 12 }}>
                <Avatar name={u.avatar} color={u.color} size="lg" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{u.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{u.role}</div>
                </div>
              </div>
              {u.quota > 0 && (
                <>
                  <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>Quota attainment</span>
                    <span className="mono" style={{ fontSize: 12 }}>{pct.toFixed(0)}%</span>
                  </div>
                  <div style={{ height: 6, background: 'var(--paper-2)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: u.color }} />
                  </div>
                  <div className="row" style={{ justifyContent: 'space-between', marginTop: 8, fontSize: 11, color: 'var(--muted)' }}>
                    <span>{fmtMoney(u.attained)}</span>
                    <span>of {fmtMoney(u.quota)}</span>
                  </div>
                </>
              )}
              <div className="row" style={{ gap: 6, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--rule-2)' }}>
                <button className="btn sm" style={{ flex: 1 }}>Message</button>
                <button className="btn sm">View</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const Settings = () => {
  const [data, setData] = React.useState(null);
  const [edits, setEdits] = React.useState({});

  React.useEffect(() => {
    api('/api/settings').then(setData);
  }, []);

  const save = async () => {
    if (!Object.keys(edits).length) return;
    await api('/api/settings', { method: 'PUT', body: edits });
    const fresh = await api('/api/settings');
    setData(fresh);
    setEdits({});
  };

  if (!data) return <div style={{ padding: 40, color: 'var(--muted)' }}>Loading settings…</div>;

  const sections = [
    { t: 'AI agent', keys: ['anthropic_api_key', 'ai_model', 'ai_auto_draft_inbound', 'ai_business_profile'] },
    { t: 'WhatsApp pacing', keys: ['wa_min_delay_ms', 'wa_max_delay_ms', 'wa_daily_cap', 'wa_max_attempts'] },
    { t: 'Email pacing', keys: ['email_daily_cap', 'email_max_attempts'] },
    { t: 'Quiet hours & region', keys: ['quiet_start', 'quiet_end', 'default_country_code', 'default_region'] },
    { t: 'Webhooks & secrets', keys: ['resend_webhook_secret', 'mailgun_signing_key', 'webhook_signature_required', 'test_number'] },
  ];
  const SECRET = new Set(['resend_webhook_secret', 'mailgun_signing_key', 'anthropic_api_key']);
  const LONG = new Set(['ai_business_profile']);

  return (
    <div className="page slide-up">
      <div className="page-h">
        <div>
          <div className="page-eyebrow">Account · workspace · integrations</div>
          <h1 className="page-title">Settings</h1>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => window.location.href = '/api/settings/export'}><Icon name="doc" size={12} />Export config</button>
          <button className="btn primary" onClick={save} disabled={!Object.keys(edits).length}><Icon name="check" size={12} />Save changes</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
        {sections.map((s) => (
          <div key={s.t} className="card">
            <div className="card-h"><div className="card-title">{s.t}</div></div>
            <div className="card-b" style={{ padding: 0 }}>
              {s.keys.map((k, i) => {
                const current = edits[k] !== undefined ? edits[k] : (data.values[k] || '');
                const isSecret = SECRET.has(k);
                const isLong = LONG.has(k);
                return (
                  <div key={k} style={{ padding: '12px 16px', borderBottom: i < s.keys.length - 1 ? '1px solid var(--rule-2)' : 'none' }}>
                    <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{k}</span>
                      <span style={{ fontSize: 10, color: 'var(--muted-2)' }}>default {String(data.defaults[k] || '').slice(0, 40)}</span>
                    </div>
                    {isLong ? (
                      <textarea
                        value={current}
                        rows={4}
                        onChange={(e) => setEdits({ ...edits, [k]: e.target.value })}
                        style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--rule)', borderRadius: 4, fontSize: 13, background: 'var(--paper)', outline: 'none', resize: 'vertical', fontFamily: 'inherit' }}
                      />
                    ) : (
                      <input
                        value={current}
                        type={isSecret ? 'password' : 'text'}
                        onChange={(e) => setEdits({ ...edits, [k]: e.target.value })}
                        placeholder={isSecret && !current ? '— not set —' : ''}
                        style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--rule)', borderRadius: 4, fontSize: 13, background: 'var(--paper)', outline: 'none' }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        <div className="card">
          <div className="card-h"><div className="card-title">WhatsApp link</div></div>
          <div className="card-b">
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
              Status: <strong style={{ color: window.WA_STATUS && window.WA_STATUS.ready ? 'var(--sage)' : 'var(--ochre)' }}>
                {window.WA_STATUS && window.WA_STATUS.ready ? 'Linked' : (window.WA_STATUS && window.WA_STATUS.hasQr ? 'Awaiting QR scan' : 'Offline')}
              </strong>
            </div>
            {window.WA_STATUS && window.WA_STATUS.info && (
              <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>WID: {window.WA_STATUS.info.wid}</div>
            )}
            <button className="btn" style={{ marginTop: 12 }} onClick={() => window.openWaQr && window.openWaQr()}>Show QR</button>
          </div>
        </div>

        <div className="card">
          <div className="card-h"><div className="card-title">Profile</div></div>
          <div className="card-b">
            {(window.TEAM || []).filter((u) => u.name && u.name.startsWith('You')).map((u) => (
              <div key={u.id}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{u.name.replace(/^You \(|\)$/g, '')}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{u.role}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// =============================================================
// Call logs — full call history with filters and inline edit.
// =============================================================
const CallLogs = () => {
  const [rows, setRows] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [disposition, setDisposition] = React.useState('all');
  const [outcome, setOutcome] = React.useState('all');
  const [direction, setDirection] = React.useState('all');
  const [range, setRange] = React.useState('all'); // all | today | week | month
  const [q, setQ] = React.useState('');

  const reload = React.useCallback(() => {
    setLoading(true);
    api('/api/calls?limit=500').then((data) => { setRows(data); setLoading(false); }).catch(() => { setRows([]); setLoading(false); });
  }, []);
  React.useEffect(() => { reload(); }, [reload]);

  const startOf = (kind) => {
    const d = new Date();
    if (kind === 'today') { d.setHours(0,0,0,0); return d.getTime(); }
    if (kind === 'week')  { d.setDate(d.getDate() - d.getDay()); d.setHours(0,0,0,0); return d.getTime(); }
    if (kind === 'month') { d.setDate(1); d.setHours(0,0,0,0); return d.getTime(); }
    return 0;
  };
  const since = startOf(range);

  // Treat legacy 'answered' rows as 'connected' so old data keeps showing under the new filter.
  const normDisp = (d) => d === 'answered' ? 'connected' : d;

  const filtered = React.useMemo(() => rows.filter((r) => {
    if (disposition !== 'all' && normDisp(r.disposition) !== disposition) return false;
    if (outcome !== 'all' && r.outcome !== outcome) return false;
    if (direction !== 'all' && r.direction !== direction) return false;
    if (since && r.created_at < since) return false;
    if (q && !((r.vendor_name || '') + ' ' + (r.vendor_phone || '') + ' ' + (r.notes || '') + ' ' + (r.caller || '')).toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [rows, disposition, outcome, direction, since, q]);

  // KPIs over the filtered rows.
  const totalDur = filtered.reduce((s, r) => s + (r.duration_sec || 0), 0);
  const connected = filtered.filter((r) => normDisp(r.disposition) === 'connected').length;
  const interested = filtered.filter((r) => r.outcome === 'interested').length;
  const callbacks = filtered.filter((r) => r.disposition === 'callback_request').length;

  const fmtTalk = (sec) => { const s = Math.max(0, Math.floor(sec || 0)); const m = Math.floor(s / 60); const ss = s % 60; return m + ':' + String(ss).padStart(2, '0'); };
  const fmtWhen = (ms) => ms ? new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

  const DISPS = [
    { v: 'connected', label: 'Connected',     color: '#588157' },
    { v: 'busy', label: 'Busy',                color: '#D4A373' },
    { v: 'no_answer', label: 'Not answered',   color: '#9A9690' },
    { v: 'callback_request', label: 'Callback', color: '#3D5A80' },
    { v: 'voicemail', label: 'Voicemail',      color: '#6B4E71' },
    { v: 'wrong_number', label: 'Wrong number',color: '#C9184A' },
  ];
  const OUTS = ['interested', 'maybe', 'not_interested', 'follow_up', 'won', 'lost'];

  const updateField = async (id, field, value) => {
    await api('/api/calls/' + id, { method: 'PUT', body: { [field]: value } });
    setRows((rs) => rs.map((r) => r.id === id ? { ...r, [field]: value } : r));
  };

  const exportCsv = () => {
    const headers = ['When', 'Lead', 'Phone', 'Direction', 'Disposition', 'Outcome', 'Duration (sec)', 'Notes', 'By'];
    const lines = [headers.join(',')];
    filtered.forEach((r) => {
      const row = [
        new Date(r.created_at).toISOString(),
        '"' + (r.vendor_name || '').replace(/"/g, '""') + '"',
        r.vendor_phone || '',
        r.direction || '',
        r.disposition || '',
        r.outcome || '',
        r.duration_sec || 0,
        '"' + (r.notes || '').replace(/"/g, '""').replace(/\n/g, ' ') + '"',
        r.caller || '',
      ];
      lines.push(row.join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'call-logs-' + new Date().toISOString().slice(0, 10) + '.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page slide-up">
      <div className="page-h">
        <div>
          <div className="page-eyebrow">{rows.length} total calls · {filtered.length} matching</div>
          <h1 className="page-title">Call <em>logs</em></h1>
          <div className="page-sub">Every call you've made — searchable, filterable, exportable.</div>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={reload}><Icon name="bolt" size={12} />Refresh</button>
          <button className="btn" onClick={exportCsv}><Icon name="doc" size={12} />Export CSV</button>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 12 }}>
        {[
          { l: 'Total calls',    v: filtered.length,                    accent: '#E07A5F' },
          { l: 'Connected',      v: connected,                          accent: '#588157' },
          { l: 'Total talk time',v: fmtTalk(totalDur),                  accent: '#3D5A80' },
          { l: 'Callbacks due',  v: callbacks + ' · ' + interested + ' interested', accent: '#D4A373' },
        ].map((k, i) => (
          <div key={i} className="card" style={{ padding: 14, borderTop: '2px solid ' + k.accent }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{k.l}</div>
            <div className="serif" style={{ fontSize: 26, marginTop: 4 }}>{k.v}</div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="card" style={{ padding: 12, marginBottom: 12 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <div className="row" style={{ background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 6, padding: '4px 10px', gap: 6, flex: 1, maxWidth: 320 }}>
            <Icon name="search" size={14} style={{ color: 'var(--muted)' }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search lead, phone, notes, caller…" style={{ border: 0, background: 'transparent', flex: 1, padding: '4px 0', outline: 'none' }} />
          </div>
          <div className="row" style={{ gap: 4 }}>
            {[['all','All time'],['today','Today'],['week','This week'],['month','This month']].map(([v, l]) => (
              <button key={v} className={'chip ' + (range === v ? 'accent' : '')} onClick={() => setRange(v)}>{l}</button>
            ))}
          </div>
          <div className="row" style={{ gap: 4 }}>
            {[['all','All dirs'],['out','Outgoing'],['in','Incoming']].map(([v, l]) => (
              <button key={v} className={'chip ' + (direction === v ? 'accent' : '')} onClick={() => setDirection(v)}>{l}</button>
            ))}
          </div>
        </div>

        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
          <span style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', alignSelf: 'center', marginRight: 4 }}>Disposition</span>
          <button className={'chip ' + (disposition === 'all' ? 'accent' : '')} onClick={() => setDisposition('all')}>All</button>
          {DISPS.map((d) => (
            <button key={d.v} className={'chip ' + (disposition === d.v ? 'accent' : '')} onClick={() => setDisposition(d.v)} style={disposition === d.v ? {} : { borderLeft: '3px solid ' + d.color, paddingLeft: 8 }}>
              {d.label} <span style={{ marginLeft: 4, color: 'var(--muted)' }}>{rows.filter((r) => normDisp(r.disposition) === d.v).length}</span>
            </button>
          ))}
        </div>

        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', alignSelf: 'center', marginRight: 4 }}>Outcome</span>
          <button className={'chip ' + (outcome === 'all' ? 'accent' : '')} onClick={() => setOutcome('all')}>All</button>
          {OUTS.map((o) => (
            <button key={o} className={'chip ' + (outcome === o ? 'accent' : '')} onClick={() => setOutcome(o)}>
              {o.replace('_', ' ')} <span style={{ marginLeft: 4, color: 'var(--muted)' }}>{rows.filter((r) => r.outcome === o).length}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ maxHeight: 'calc(100vh - 420px)', overflow: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 48, textAlign: 'right' }}>S.No</th>
                <th>When</th>
                <th>Lead</th>
                <th>Phone</th>
                <th>Dir</th>
                <th>Disposition</th>
                <th>Outcome</th>
                <th className="num">Duration</th>
                <th>Notes</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={10} style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>Loading…</td></tr>}
              {!loading && filtered.length === 0 && <tr><td colSpan={10} style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>No calls match these filters.</td></tr>}
              {filtered.map((r, i) => {
                const disp = DISPS.find((d) => d.v === normDisp(r.disposition));
                return (
                  <tr key={r.id}>
                    <td className="mono" style={{ textAlign: 'right', color: 'var(--muted)', fontSize: 11 }}>{i + 1}</td>
                    <td className="mono" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{fmtWhen(r.created_at)}</td>
                    <td><div style={{ fontWeight: 600, fontSize: 12 }} className="trunc">{r.vendor_name || '—'}</div></td>
                    <td className="mono" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                      {r.vendor_phone ? '+' + String(r.vendor_phone).replace(/\D/g,'') : '—'}
                      {r.vendor_phone && (
                        <a href={'tel:+' + String(r.vendor_phone).replace(/\D/g,'')} title="Call again" style={{ marginLeft: 6, color: 'var(--ink-2)' }} onClick={(e) => e.stopPropagation()}>
                          <Icon name="phone" size={11} />
                        </a>
                      )}
                    </td>
                    <td><span className="chip" style={{ fontSize: 10 }}>{r.direction === 'in' ? '← In' : '→ Out'}</span></td>
                    <td>
                      <select
                        value={normDisp(r.disposition) || ''}
                        onChange={(e) => updateField(r.id, 'disposition', e.target.value || null)}
                        style={{ fontSize: 11, padding: '2px 4px', border: '1px solid var(--rule-2)', borderRadius: 4, background: 'var(--paper)', borderLeft: disp ? '3px solid ' + disp.color : '1px solid var(--rule-2)' }}
                      >
                        <option value="">—</option>
                        {DISPS.map((d) => <option key={d.v} value={d.v}>{d.label}</option>)}
                      </select>
                    </td>
                    <td>
                      <select
                        value={r.outcome || ''}
                        onChange={(e) => updateField(r.id, 'outcome', e.target.value || null)}
                        style={{ fontSize: 11, padding: '2px 4px', border: '1px solid var(--rule-2)', borderRadius: 4, background: 'var(--paper)' }}
                      >
                        <option value="">—</option>
                        {OUTS.map((o) => <option key={o} value={o}>{o.replace('_', ' ')}</option>)}
                      </select>
                    </td>
                    <td className="num mono" style={{ fontSize: 11 }}>{fmtTalk(r.duration_sec)}</td>
                    <td>
                      <input
                        type="text"
                        defaultValue={r.notes || ''}
                        placeholder="—"
                        onBlur={(e) => { if (e.target.value !== (r.notes || '')) updateField(r.id, 'notes', e.target.value || null); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                        style={{ width: '100%', minWidth: 220, fontSize: 11, padding: '4px 6px', border: '1px solid transparent', background: 'transparent', borderRadius: 4, outline: 'none', color: 'var(--ink-3)' }}
                        onFocus={(e) => { e.target.style.border = '1px solid var(--rule)'; e.target.style.background = 'var(--paper)'; }}
                        onMouseLeave={(e) => { if (document.activeElement !== e.target) { e.target.style.border = '1px solid transparent'; e.target.style.background = 'transparent'; } }}
                      />
                    </td>
                    <td><span style={{ fontSize: 11 }}>{r.caller || '—'}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// =============================================================
// Follow-ups — "what to do now" view aggregating pending tasks
// + calls that asked for a callback. Quick actions inline.
// =============================================================
const FollowUps = () => {
  const { ready } = useStore();
  const [calls, setCalls] = React.useState([]);
  const [bucket, setBucket] = React.useState('all');

  React.useEffect(() => {
    api('/api/calls?limit=300').then(setCalls).catch(() => setCalls([]));
  }, []);

  if (!ready) return null;

  const tasks = (window.TASKS || []).filter((t) => !t.done);
  const contacts = window.CONTACTS || [];
  const findContact = (vendorId) => contacts.find((c) => c.raw_id === vendorId) || null;

  // Pull "callback request" calls that don't yet have a follow-up task — surface them as
  // virtual follow-up items so they don't get lost.
  const callbackCalls = calls.filter((c) => c.disposition === 'callback_request');
  const taskVendorIds = new Set(tasks.map((t) => t.raw_vendor_id).filter(Boolean));
  const orphanCallbacks = callbackCalls.filter((c) => !taskVendorIds.has(c.vendor_id));

  // Unify both into a single "items" list.
  const dayMs = 86_400_000;
  const startOfToday = (() => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); })();
  const tomorrowStart = startOfToday + dayMs;
  const weekEnd = startOfToday + 7 * dayMs;

  const items = [
    ...tasks.map((t) => {
      const due = t.due ? new Date(t.due).getTime() : null;
      const c = findContact(t.raw_vendor_id);
      return {
        kind: 'task',
        id: 't' + t.raw_id,
        rawId: t.raw_id,
        title: t.title,
        contact: c,
        contactName: c ? c.name : (t.raw_vendor_id ? '—' : ''),
        due,
        priority: t.priority,
        type: t.type || 'task',
        owner: t.owner,
      };
    }),
    ...orphanCallbacks.map((cb) => {
      const c = findContact(cb.vendor_id);
      return {
        kind: 'callback',
        id: 'cb' + cb.id,
        callId: cb.id,
        title: 'Callback requested',
        contact: c,
        contactName: c ? c.name : (cb.vendor_name || '—'),
        due: cb.created_at + dayMs, // soft-due 1 day after the request
        priority: 'high',
        type: 'call',
        owner: cb.caller || '—',
        notes: cb.notes,
      };
    }),
  ];

  const itemBucket = (it) => {
    if (!it.due) return 'undated';
    if (it.due < startOfToday) return 'overdue';
    if (it.due < tomorrowStart) return 'today';
    if (it.due < tomorrowStart + dayMs) return 'tomorrow';
    if (it.due < weekEnd) return 'week';
    return 'later';
  };
  const buckets = {
    overdue:  items.filter((i) => itemBucket(i) === 'overdue').sort((a, b) => (a.due || 0) - (b.due || 0)),
    today:    items.filter((i) => itemBucket(i) === 'today').sort((a, b) => (a.due || 0) - (b.due || 0)),
    tomorrow: items.filter((i) => itemBucket(i) === 'tomorrow').sort((a, b) => (a.due || 0) - (b.due || 0)),
    week:     items.filter((i) => itemBucket(i) === 'week').sort((a, b) => (a.due || 0) - (b.due || 0)),
    later:    items.filter((i) => itemBucket(i) === 'later').sort((a, b) => (a.due || 0) - (b.due || 0)),
    undated:  items.filter((i) => itemBucket(i) === 'undated'),
  };

  const totalActionable = buckets.overdue.length + buckets.today.length;

  const markDone = async (it) => {
    if (it.kind === 'task') {
      await api('/api/tasks/' + it.rawId, { method: 'PUT', body: { completed: true } });
    } else if (it.kind === 'callback') {
      // Resolve a callback by clearing the disposition's callback flag (mark as connected w/ note).
      await api('/api/calls/' + it.callId, { method: 'PUT', body: { disposition: 'connected', notes: (it.notes || '') + ' [resolved]' } });
      const next = await api('/api/calls?limit=300'); setCalls(next);
    }
    await refreshStore();
  };

  const snooze = async (it, days) => {
    const newDue = (it.due || Date.now()) + days * dayMs;
    if (it.kind === 'task') {
      await api('/api/tasks/' + it.rawId, { method: 'PUT', body: { due_at: newDue } });
      await refreshStore();
    } else if (it.kind === 'callback') {
      // Promote the callback to a real task so it can be tracked & snoozed.
      await api('/api/tasks', { method: 'POST', body: {
        vendor_id: it.contact ? it.contact.raw_id : null,
        title: 'Callback: ' + (it.contactName || ''),
        due_at: newDue, priority: 'high', type: 'call',
      } });
      await refreshStore();
    }
  };

  const callNow = (it) => {
    if (it.contact && window.openCallLog) window.openCallLog(it.contact);
  };

  const fmtDue = (ms) => {
    if (!ms) return 'no due date';
    const d = new Date(ms);
    const sameDay = (a, b) => a.toDateString() === b.toDateString();
    if (sameDay(d, new Date())) return 'today · ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (sameDay(d, new Date(Date.now() + dayMs))) return 'tomorrow · ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const Section = ({ title, list, accent, badge }) => (
    list.length === 0 ? null : (
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-h">
          <div className="row" style={{ gap: 8 }}>
            <div className="card-title">{title}</div>
            <span className="chip" style={{ background: (accent || '#7A7670') + '22', color: accent || '#7A7670', fontSize: 10 }}>{list.length}</span>
            {badge && <span className="chip" style={{ fontSize: 10 }}>{badge}</span>}
          </div>
        </div>
        <div className="card-b" style={{ padding: 0 }}>
          {list.map((it, i) => (
            <div key={it.id} className="row" style={{ padding: '12px 16px', borderBottom: i < list.length - 1 ? '1px solid var(--rule-2)' : 'none', gap: 12, alignItems: 'center' }}>
              <input type="checkbox" onChange={() => markDone(it)} title="Mark done" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row" style={{ gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }} className="trunc">{it.title}</span>
                  {it.kind === 'callback' && <span className="chip" style={{ fontSize: 9, background: '#3D5A8022', color: '#3D5A80' }}>Callback</span>}
                  <span className={'chip ' + (it.priority === 'high' ? 'accent' : it.priority === 'med' ? 'ochre' : 'gray')} style={{ fontSize: 9 }}>{it.priority || 'med'}</span>
                  <span className="chip" style={{ fontSize: 9 }}>{it.type}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                  {it.contactName && <>{it.contactName} · </>}
                  <span style={{ color: itemBucket(it) === 'overdue' ? '#C9184A' : 'var(--muted)' }}>{fmtDue(it.due)}</span>
                  {it.owner && <> · by {it.owner}</>}
                </div>
                {it.notes && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4, fontStyle: 'italic' }} className="trunc">"{it.notes}"</div>}
              </div>
              <div className="row" style={{ gap: 4, flexShrink: 0 }}>
                {it.contact && (
                  <button className="btn sm" onClick={() => callNow(it)} title="Call now & log">
                    <Icon name="phone" size={12} />Call
                  </button>
                )}
                <button className="btn sm ghost" onClick={() => snooze(it, 1)} title="Snooze 1 day">+1d</button>
                <button className="btn sm ghost" onClick={() => snooze(it, 7)} title="Snooze 1 week">+1w</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  );

  const visibleBuckets = bucket === 'all' ? ['overdue','today','tomorrow','week','later','undated']
    : bucket === 'now' ? ['overdue','today']
    : [bucket];

  return (
    <div className="page slide-up">
      <div className="page-h">
        <div>
          <div className="page-eyebrow">{items.length} pending · {totalActionable} need action now</div>
          <h1 className="page-title">Follow-<em>ups</em></h1>
          <div className="page-sub">Everything you need to do — overdue tasks, today's calls, callback requests.</div>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => window.openNewTask && window.openNewTask()}><Icon name="plus" size={12} />New task</button>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 12 }}>
        {[
          { l: 'Action now', v: totalActionable, accent: '#C9184A', filter: 'now' },
          { l: 'Overdue', v: buckets.overdue.length, accent: '#C9184A', filter: 'overdue' },
          { l: 'Today', v: buckets.today.length, accent: '#E07A5F', filter: 'today' },
          { l: 'Tomorrow', v: buckets.tomorrow.length, accent: '#D4A373', filter: 'tomorrow' },
          { l: 'This week', v: buckets.week.length, accent: '#3D5A80', filter: 'week' },
        ].map((k) => (
          <div key={k.l} className="card" style={{ padding: 14, borderTop: '2px solid ' + k.accent, cursor: 'pointer', outline: bucket === k.filter ? '2px solid ' + k.accent : 'none' }} onClick={() => setBucket(bucket === k.filter ? 'all' : k.filter)}>
            <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{k.l}</div>
            <div className="serif" style={{ fontSize: 28, marginTop: 4 }}>{k.v}</div>
          </div>
        ))}
      </div>

      <div className="row" style={{ gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {[['all','All'],['now','Action now'],['overdue','Overdue'],['today','Today'],['tomorrow','Tomorrow'],['week','This week'],['later','Later'],['undated','No due date']].map(([v, l]) => (
          <button key={v} className={'chip ' + (bucket === v ? 'accent' : '')} onClick={() => setBucket(v)}>{l}</button>
        ))}
      </div>

      {visibleBuckets.includes('overdue')  && <Section title="Overdue"        list={buckets.overdue}  accent="#C9184A" />}
      {visibleBuckets.includes('today')    && <Section title="Today"          list={buckets.today}    accent="#E07A5F" />}
      {visibleBuckets.includes('tomorrow') && <Section title="Tomorrow"       list={buckets.tomorrow} accent="#D4A373" />}
      {visibleBuckets.includes('week')     && <Section title="This week"      list={buckets.week}     accent="#3D5A80" />}
      {visibleBuckets.includes('later')    && <Section title="Later"          list={buckets.later}    accent="#6B4E71" />}
      {visibleBuckets.includes('undated')  && <Section title="No due date"    list={buckets.undated}  accent="#7A7670" />}

      {items.length === 0 && (
        <div className="card" style={{ padding: 48, textAlign: 'center', color: 'var(--muted)' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🎉</div>
          <div className="serif" style={{ fontSize: 20, marginBottom: 4 }}>You're all caught up.</div>
          <div style={{ fontSize: 13 }}>Schedule follow-ups when you log a call, or create a new task above.</div>
        </div>
      )}
    </div>
  );
};

// =============================================================
// Leads — scrape pet shops / vets from Google Maps + Justdial,
// review the results, promote them to vendors.
// =============================================================
const Leads = () => {
  const [list, setList] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [scraping, setScraping] = React.useState(false);
  const [filter, setFilter] = React.useState('not_imported');
  const [selected, setSelected] = React.useState(new Set());
  const [form, setForm] = React.useState({ source: 'google_maps', query: 'pet shop', city: 'Hisar', max: 20 });

  const load = React.useCallback(() => {
    setLoading(true);
    api(`/api/leads${filter === 'not_imported' ? '?imported=0' : filter === 'imported' ? '?imported=1' : ''}`)
      .then(setList).catch(() => setList([])).finally(() => setLoading(false));
  }, [filter]);
  React.useEffect(load, [load]);

  const scrape = async () => {
    setScraping(true);
    try {
      const r = await api('/api/leads/scrape', { method: 'POST', body: form });
      if (r.error) {
        alert('Scrape returned: ' + r.error + (r.inserted ? `\n${r.inserted} still imported.` : ''));
      } else {
        alert(`Found ${r.total} listings → ${r.inserted} new leads added (${r.skipped} duplicates skipped).`);
      }
      load();
    } catch (e) {
      alert('Scrape failed: ' + e.message);
    }
    setScraping(false);
  };

  const promoteOne = async (lead) => {
    const r = await api(`/api/leads/${lead.id}/promote`, { method: 'POST' });
    alert(r.was_new ? 'Added as new vendor.' : 'Phone already exists — linked to existing vendor.');
    load(); refreshStore();
  };

  const promoteSelected = async () => {
    if (!selected.size) return alert('Select some leads first');
    if (!confirm(`Promote ${selected.size} leads to vendors?`)) return;
    const r = await api('/api/leads/promote-bulk', { method: 'POST', body: { ids: Array.from(selected) } });
    alert(`${r.promoted} promoted, ${r.skipped} skipped (no phone or already exists).`);
    setSelected(new Set());
    load(); refreshStore();
  };

  const toggleSelect = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  return (
    <div className="page slide-up">
      <div className="page-h">
        <div>
          <div className="page-eyebrow">{list.length} leads · {list.filter((l) => !l.imported).length} not imported yet</div>
          <h1 className="page-title">Find new <em>leads</em></h1>
          <div className="page-sub">Scrape Google Maps or Justdial for pet shops, vets, groomers in any city, then promote the good ones to your CRM.</div>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={load}><Icon name="bolt" size={12} />Refresh</button>
          {selected.size > 0 && <button className="btn primary" onClick={promoteSelected}><Icon name="check" size={12} />Promote {selected.size}</button>}
        </div>
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div className="card-title" style={{ fontSize: 14, marginBottom: 12 }}>New scrape</div>
        <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 1fr 100px auto', gap: 10, alignItems: 'end' }}>
          <Field label="Source">
            <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
              <option value="google_maps">Google Maps</option>
              <option value="justdial">Justdial</option>
            </select>
          </Field>
          <Field label="Query">
            <input value={form.query} onChange={(e) => setForm({ ...form, query: e.target.value })} placeholder="e.g. pet shop, veterinary clinic, dog trainer" />
          </Field>
          <Field label="City">
            <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="e.g. Hisar, Chandigarh" />
          </Field>
          <Field label="Max">
            <input type="number" min={5} max={100} value={form.max} onChange={(e) => setForm({ ...form, max: Number(e.target.value) })} />
          </Field>
          <button className="btn primary" disabled={scraping || !form.query} onClick={scrape}>
            <Icon name="search" size={12} />{scraping ? 'Scraping…' : 'Run scrape'}
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
          Heads-up: scraping is best-effort. Google may show a captcha after a few runs — wait a bit and retry. Justdial requires a city.
        </div>
      </div>

      <div className="row" style={{ gap: 4, marginBottom: 12 }}>
        {[['not_imported', 'Not imported'], ['imported', 'Imported'], ['all', 'All']].map(([k, l]) => (
          <button key={k} className={'chip ' + (filter === k ? 'accent' : '')} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading && <div style={{ padding: 16, color: 'var(--muted)', fontSize: 12 }}>Loading…</div>}
        {!loading && list.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
            No leads {filter === 'not_imported' ? 'pending' : 'yet'}. Run a scrape above to find some.
          </div>
        )}
        {list.length > 0 && (
          <table className="table">
            <thead><tr>
              <th style={{ width: 36 }}></th>
              <th>Name</th><th>Phone</th><th>City</th><th>Address</th><th>Source</th><th></th>
            </tr></thead>
            <tbody>
              {list.map((l) => (
                <tr key={l.id} style={{ opacity: l.imported ? 0.5 : 1 }}>
                  <td><input type="checkbox" disabled={!!l.imported} checked={selected.has(l.id)} onChange={() => toggleSelect(l.id)} /></td>
                  <td><strong style={{ fontSize: 13 }}>{l.name}</strong></td>
                  <td className="mono" style={{ fontSize: 12 }}>{l.phone ? '+' + l.phone : <span style={{ color: 'var(--muted)' }}>no phone</span>}</td>
                  <td style={{ fontSize: 12 }}>{l.city || '—'}</td>
                  <td className="trunc" style={{ maxWidth: 320, fontSize: 11, color: 'var(--ink-3)' }}>{l.address || '—'}</td>
                  <td><span className="chip" style={{ fontSize: 10 }}>{l.source}</span></td>
                  <td>
                    <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                      {!l.imported && l.phone && <button className="btn sm primary" onClick={() => promoteOne(l)}>Promote</button>}
                      {l.imported && <span className="chip sage" style={{ fontSize: 10 }}>Imported</span>}
                      <button className="btn sm ghost" onClick={async () => {
                        if (!confirm('Delete this lead?')) return;
                        await api(`/api/leads/${l.id}`, { method: 'DELETE' });
                        load();
                      }}><Icon name="trash" size={12} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

Object.assign(window, { Reports, Campaigns, Tickets, Automations, Team, Settings, CallLogs, FollowUps, Leads });
