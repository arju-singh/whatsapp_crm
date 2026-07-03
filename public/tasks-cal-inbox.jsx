// =============================================================
// Tasks, Calendar, Inbox — all live from the API.
// =============================================================

const Tasks = () => {
  const { ready } = useStore();
  const [filter, setFilter] = React.useState('all');
  const sel = useMultiSelect();
  if (!ready) return null;

  const tasks = window.TASKS || [];
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const weekEnd = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10);

  const groups = { Overdue: [], Today: [], Tomorrow: [], 'This week': [], Later: [] };
  tasks.forEach((t) => {
    if (filter === 'mine' && t.owner !== 'You') return;
    if (filter === 'done' && !t.done) return;
    if (filter === 'open' && t.done) return;
    if (!t.due) { groups.Later.push(t); return; }
    if (t.due < today && !t.done) groups.Overdue.push(t);
    else if (t.due === today) groups.Today.push(t);
    else if (t.due === tomorrow) groups.Tomorrow.push(t);
    else if (t.due <= weekEnd) groups['This week'].push(t);
    else groups.Later.push(t);
  });

  const typeIcon = { email: 'mail', call: 'phone', meeting: 'meeting', task: 'check-list' };

  const toggle = async (t) => {
    await api(`/api/tasks/${t.raw_id}`, { method: 'PUT', body: { completed: !t.done } });
    await refreshStore();
  };

  const visible = Object.values(groups).flat();
  const ids = visible.map((t) => t.raw_id);
  const completeSelected = async () => {
    const sids = [...sel.selected];
    const r = await window.bulkRun({ url: '/api/tasks/complete-bulk', ids: sids, confirmMsg: `Mark ${sids.length} task${sids.length > 1 ? 's' : ''} complete?` });
    if (!r) return;
    alert(`${r.updated} completed.`);
    sel.clear();
    await refreshStore();
  };
  const deleteSelected = async () => {
    const sids = [...sel.selected];
    const r = await window.bulkRun({ url: '/api/tasks/delete-bulk', ids: sids, confirmMsg: `Delete ${sids.length} task${sids.length > 1 ? 's' : ''}?` });
    if (!r) return;
    alert(`${r.deleted} deleted.`);
    sel.clear();
    await refreshStore();
  };

  return (
    <div className="page slide-up">
      <div className="page-h">
        <div>
          <div className="page-eyebrow">{tasks.filter((t) => !t.done).length} open · {tasks.filter((t) => t.done).length} done</div>
          <h1 className="page-title">Things to <em>do</em></h1>
        </div>
        <div className="page-actions">
          <div className="row" style={{ background: 'var(--card)', border: '1px solid var(--rule)', borderRadius: 6, padding: 2 }}>
            {['all', 'mine', 'open', 'done'].map((k) => <button key={k} className={'btn sm ' + (filter === k ? 'primary' : 'ghost')} onClick={() => setFilter(k)}>{k}</button>)}
          </div>
          {visible.length > 0 && <button className="btn" onClick={() => sel.toggleAll(ids)}><Icon name="check" size={12} />{sel.allSelected(ids) ? 'Unselect all' : 'Select all'}</button>}
          <button className="btn primary" onClick={() => window.openNewTask && window.openNewTask()}><Icon name="plus" size={12} />New task</button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {Object.entries(groups).filter(([, v]) => v.length > 0).map(([title, items]) => (
          <div key={title}>
            <div className="row" style={{ gap: 8, marginBottom: 8 }}>
              <div className="serif" style={{ fontSize: 18 }}>{title}</div>
              <span className="chip">{items.length}</span>
              {title === 'Overdue' && <span className="chip accent">needs attention</span>}
            </div>
            <div className="card" style={{ padding: 0 }}>
              {items.map((t, i) => (
                <div key={t.id} className="row" style={{ padding: '12px 16px', borderBottom: i < items.length - 1 ? '1px solid var(--rule-2)' : 'none', gap: 12, background: sel.selected.has(t.raw_id) ? 'var(--hover)' : 'transparent' }}>
                  <input type="checkbox" checked={sel.selected.has(t.raw_id)} onChange={() => sel.toggle(t.raw_id)} title="Select" style={{ accentColor: 'var(--accent)' }} />
                  <input type="checkbox" checked={t.done} onChange={() => toggle(t)} title="Mark done" />
                  <Icon name={typeIcon[t.type] || 'check-list'} size={14} style={{ color: 'var(--muted)' }} />
                  <div style={{ flex: 1, textDecoration: t.done ? 'line-through' : 'none', opacity: t.done ? 0.5 : 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{t.title}</div>
                    {t.dealId && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{(window.DEALS || []).find((d) => d.id === t.dealId)?.name}</div>}
                  </div>
                  <span className={'chip ' + (t.priority === 'high' ? 'accent' : t.priority === 'med' ? 'ochre' : 'gray')} style={{ fontSize: 10 }}>{t.priority}</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)', minWidth: 90 }}>{t.due || '—'}</span>
                  <Avatar
                    name={t.owner === 'You' ? 'AS' : (t.owner || '').split(' ').map((s) => s[0]).join('')}
                    color={t.owner === 'You' ? '#E07A5F' : '#3D5A80'} size="sm" />
                  <button className="icon-btn" onClick={async () => {
                    if (!confirm('Delete task?')) return;
                    await api(`/api/tasks/${t.raw_id}`, { method: 'DELETE' });
                    refreshStore();
                  }}><Icon name="x" size={12} /></button>
                </div>
              ))}
            </div>
          </div>
        ))}
        {Object.values(groups).every((v) => v.length === 0) && (
          <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>No tasks match.</div>
        )}
      </div>
      <BulkBar
        count={sel.selected.size}
        onClear={sel.clear}
        actions={[
          { label: 'Complete', icon: 'check', variant: 'primary', onClick: completeSelected },
          { label: 'Delete', icon: 'trash', variant: 'danger', onClick: deleteSelected },
        ]}
      />
    </div>
  );
};

const Calendar = () => {
  const { ready } = useStore();
  if (!ready) return null;

  const events = window.CALENDAR || [];
  // Build a Mon-Fri week starting at the most recent Monday
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const weekStart = monday.getTime();
  const weekEnd = weekStart + 5 * 86400000;
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const hours = Array.from({ length: 11 }, (_, i) => 8 + i);

  const eventsByDay = days.map((_, i) => {
    const dayStart = weekStart + i * 86400000;
    const dayEnd = dayStart + 86400000;
    return events
      .filter((e) => e.starts_at >= dayStart && e.starts_at < dayEnd && e.starts_at < weekEnd)
      .map((e) => {
        const startD = new Date(e.starts_at);
        const endD = new Date(e.ends_at);
        return {
          ...e,
          start: startD.getHours() + startD.getMinutes() / 60,
          end: endD.getHours() + endD.getMinutes() / 60,
        };
      });
  });
  const todayDayIdx = (today.getDay() + 6) % 7;
  const nowFraction = (new Date().getHours()) + (new Date().getMinutes()) / 60;

  return (
    <div className="page slide-up" style={{ maxWidth: 1400 }}>
      <div className="page-h">
        <div>
          <div className="page-eyebrow">
            {monday.toLocaleString('en', { month: 'short', day: 'numeric' })} – {new Date(weekStart + 4 * 86400000).toLocaleString('en', { month: 'short', day: 'numeric' })} · Week {Math.ceil((monday.getTime() - new Date(monday.getFullYear(), 0, 1).getTime()) / (7 * 86400000))}
          </div>
          <h1 className="page-title">Your <em>week</em></h1>
        </div>
        <div className="page-actions">
          <button className="btn"><Icon name="chevron-l" size={12} /></button>
          <button className="btn">Today</button>
          <button className="btn"><Icon name="chevron-r" size={12} /></button>
          <button className="btn primary" onClick={() => window.openNewEvent && window.openNewEvent()}><Icon name="plus" size={12} />New event</button>
        </div>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '56px repeat(5, 1fr)', borderBottom: '1px solid var(--rule)' }}>
          <div></div>
          {days.map((d, i) => {
            const dayDate = new Date(weekStart + i * 86400000);
            return (
              <div key={d} style={{ padding: '12px 16px', borderLeft: '1px solid var(--rule-2)', textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{d}</div>
                <div className="serif" style={{ fontSize: 22, color: i === todayDayIdx ? 'var(--accent)' : 'var(--ink)' }}>{dayDate.getDate()}</div>
              </div>
            );
          })}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '56px repeat(5, 1fr)', position: 'relative', minHeight: 540 }}>
          <div>
            {hours.map((h) => (
              <div key={h} style={{ height: 56, padding: '2px 8px', fontSize: 10, color: 'var(--muted)', textAlign: 'right', borderBottom: '1px solid var(--rule-2)' }}>
                {h % 12 || 12}{h < 12 ? 'a' : 'p'}
              </div>
            ))}
          </div>
          {days.map((d, di) => (
            <div key={d} style={{ borderLeft: '1px solid var(--rule-2)', position: 'relative' }}>
              {hours.map((h) => <div key={h} style={{ height: 56, borderBottom: '1px solid var(--rule-2)' }}></div>)}
              {eventsByDay[di].map((e) => {
                const top = (e.start - 8) * 56;
                const height = Math.max(20, (e.end - e.start) * 56 - 4);
                return (
                  <div key={e.id} style={{
                    position: 'absolute', top: top + 2, left: 4, right: 4, height,
                    background: e.color + '22', borderLeft: `3px solid ${e.color}`,
                    borderRadius: 4, padding: '4px 8px', fontSize: 11, overflow: 'hidden', cursor: 'pointer',
                  }}>
                    <div style={{ fontWeight: 600 }}>{e.title}</div>
                    {e.deal && <div style={{ fontSize: 10, color: 'var(--muted)' }}>{e.deal}</div>}
                    {e.contact && !e.deal && <div style={{ fontSize: 10, color: 'var(--muted)' }}>{e.contact}</div>}
                    <div className="mono" style={{ fontSize: 10, color: e.color, marginTop: 2 }}>
                      {Math.floor(e.start) % 12 || 12}:{String(Math.round((e.start * 60) % 60)).padStart(2, '0')} – {Math.floor(e.end) % 12 || 12}:{String(Math.round((e.end * 60) % 60)).padStart(2, '0')}
                    </div>
                  </div>
                );
              })}
              {di === todayDayIdx && nowFraction >= 8 && nowFraction <= 19 && (
                <div style={{ position: 'absolute', top: (nowFraction - 8) * 56, left: 0, right: 0, height: 2, background: 'var(--accent)', zIndex: 2 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', marginLeft: -4, marginTop: -3 }}></div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// Tabular messaging report shown inside the Inbox under the "Report" tab.
const ReportView = ({
  list, rows, cities,
  repliedTotal, unansweredTotal, replyRatePct, totalSentAll, totalRepliesAll, scheduledTotal,
  search, setSearch, cityFilter, setCityFilter, reportFilter, setReportFilter,
  selected, setSelected, sendToSelection, fmtMs, openThread,
}) => {
  const allVisibleSelected = rows.length > 0 && rows.every((r) => selected.has(r.vendor_id));
  const toggle = (vid, checked) => {
    const next = new Set(selected);
    if (checked) next.add(vid); else next.delete(vid);
    setSelected(next);
  };
  return (
    <>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginBottom: 12 }}>
        {[
          { l: 'Threads',    v: list.length,        accent: '#E07A5F' },
          { l: 'Total sent', v: totalSentAll,       accent: '#3D5A80' },
          { l: 'Replies',    v: totalRepliesAll,    accent: '#588157' },
          { l: 'Replied',    v: repliedTotal + ' / ' + list.length, sub: replyRatePct + '% reply rate', accent: '#075e54' },
          { l: 'Unanswered', v: unansweredTotal,    accent: '#9A9690' },
          { l: 'Scheduled',  v: scheduledTotal,     accent: '#6B4E71' },
        ].map((k, i) => (
          <div key={i} className="card" style={{ padding: 12, borderTop: '2px solid ' + k.accent }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{k.l}</div>
            <div className="serif" style={{ fontSize: 22, marginTop: 4 }}>{k.v}</div>
            {k.sub && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{k.sub}</div>}
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="card" style={{ padding: 12, marginBottom: 12 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="row" style={{ background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 6, padding: '4px 10px', gap: 6, flex: 1, maxWidth: 320 }}>
            <Icon name="search" size={14} style={{ color: 'var(--muted)' }} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search lead, phone, last reply…" style={{ border: 0, background: 'transparent', flex: 1, padding: '4px 0', outline: 'none' }} />
          </div>
          <select value={cityFilter} onChange={(e) => setCityFilter(e.target.value)} style={{ fontSize: 12 }} title="Filter by city">
            <option value="all">All cities ({list.length})</option>
            {cities.map(([c, n]) => <option key={c} value={c}>{c} ({n})</option>)}
          </select>
          <div className="row" style={{ gap: 4 }}>
            {[['all','All'],['replied','Replied'],['unanswered','Unanswered'],['scheduled','Scheduled'],['failed','Failed']].map(([v, l]) => (
              <button key={v} className={'chip ' + (reportFilter === v ? 'accent' : '')} onClick={() => setReportFilter(v)}>{l}</button>
            ))}
          </div>
          <div className="spacer" />
          {selected.size > 0 && (
            <button className="btn primary" onClick={sendToSelection}>
              <Icon name="send" size={12} />Send WhatsApp ({selected.size})
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ maxHeight: 'calc(100vh - 380px)', overflow: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) rows.forEach((r) => next.add(r.vendor_id));
                      else rows.forEach((r) => next.delete(r.vendor_id));
                      setSelected(next);
                    }}
                  />
                </th>
                <th style={{ width: 48, textAlign: 'right' }}>S.No</th>
                <th>Lead</th>
                <th>Phone</th>
                <th>City</th>
                <th className="num" title="Total messages sent to this lead">Sent</th>
                <th className="num" title="Total replies received from this lead">Replies</th>
                <th>Last sent</th>
                <th>Last reply</th>
                <th>Their last response</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={12} style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>No conversations match these filters.</td></tr>}
              {rows.map((r, i) => {
                const replied = r.reply_count > 0;
                const lastResponseStyle = replied
                  ? { color: 'var(--ink-3)', fontStyle: 'normal' }
                  : { color: 'var(--muted)', fontStyle: 'italic' };
                return (
                  <tr key={r.vendor_id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(r.vendor_id)}
                        onChange={(e) => toggle(r.vendor_id, e.target.checked)}
                      />
                    </td>
                    <td className="mono" style={{ textAlign: 'right', color: 'var(--muted)', fontSize: 11 }}>{i + 1}</td>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 12 }} className="trunc">{r.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>{r.company || '—'}</div>
                    </td>
                    <td className="mono" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                      +{String(r.phone || '').replace(/\D/g, '')}
                      <a href={'tel:+' + String(r.phone || '').replace(/\D/g, '')} title="Call" style={{ marginLeft: 4, color: 'var(--ink-2)' }} onClick={(e) => e.stopPropagation()}>
                        <Icon name="phone" size={11} />
                      </a>
                    </td>
                    <td><span style={{ fontSize: 12 }}>{r.city || '—'}</span></td>
                    <td className="num" style={{ fontSize: 11 }}>{r.sent_count}</td>
                    <td className="num" style={{ fontSize: 11, color: replied ? '#075e54' : 'var(--muted)', fontWeight: replied ? 600 : 400 }}>{r.reply_count}</td>
                    <td className="mono" style={{ fontSize: 10, whiteSpace: 'nowrap' }}>{fmtMs(r.last_at)}</td>
                    <td className="mono" style={{ fontSize: 10, whiteSpace: 'nowrap' }}>{fmtMs(r.last_reply_at)}</td>
                    <td>
                      <div style={{ fontSize: 11, maxWidth: 280, ...lastResponseStyle, whiteSpace: 'pre-wrap', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }} title={r.last_reply_body || ''}>
                        {replied ? (r.last_reply_body || '—') : 'no reply yet'}
                      </div>
                    </td>
                    <td>
                      {r.scheduled_count > 0 && <div><span className="chip" style={{ fontSize: 9, background: '#3D5A8022', color: '#3D5A80' }}>{r.scheduled_count} scheduled</span></div>}
                      {r.failed_count    > 0 && <div><span className="chip" style={{ fontSize: 9, background: '#C9184A22', color: '#C9184A' }}>{r.failed_count} failed</span></div>}
                      {!r.scheduled_count && !r.failed_count && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{r.status || '—'}</span>}
                    </td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        <button
                          className="btn sm primary"
                          title="Send WhatsApp message (template + schedule)"
                          onClick={() => window.openSendMessage && window.openSendMessage({ vendor_id: r.vendor_id })}
                        ><Icon name="send" size={11} /></button>
                        <button
                          className="btn sm ghost"
                          title="Open thread"
                          onClick={() => openThread(r.vendor_id)}
                        ><Icon name="caret-right" size={11} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
};

const Inbox = () => {
  const [list, setList] = React.useState([]);
  const [selectedId, setSelectedId] = React.useState(null);
  const [thread, setThread] = React.useState(null);
  const [reply, setReply] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [view, setView] = React.useState('threads'); // 'threads' or 'report'
  const [reportSelected, setReportSelected] = React.useState(new Set());
  const [reportFilter, setReportFilter] = React.useState('all'); // all | replied | unanswered | scheduled | failed
  const [cityFilter, setCityFilter] = React.useState('all');

  const reload = React.useCallback(() => api('/api/inbox?limit=200').then(setList).catch(() => setList([])), []);

  React.useEffect(() => {
    reload();
    const t = setInterval(reload, 15000);
    return () => clearInterval(t);
  }, [reload]);

  const [draft, setDraft] = React.useState(null);
  const [draftLoading, setDraftLoading] = React.useState(false);
  const [aiHealth, setAiHealth] = React.useState({ api_key_set: false, model: '', auto_draft_inbound: false });

  React.useEffect(() => {
    api('/api/ai/health').then(setAiHealth).catch(() => {});
  }, []);

  const loadDraft = React.useCallback((vid) => {
    if (!vid) { setDraft(null); return; }
    api(`/api/ai/drafts?vendor_id=${vid}&status=pending`)
      .then((rows) => setDraft(rows[0] || null))
      .catch(() => setDraft(null));
  }, []);

  React.useEffect(() => {
    if (!selectedId) { setThread(null); setDraft(null); return; }
    api(`/api/inbox/${selectedId}`).then(setThread).catch(() => setThread(null));
    loadDraft(selectedId);
  }, [selectedId, loadDraft]);

  const requestAiDraft = async () => {
    if (!selectedId) return;
    setDraftLoading(true);
    try {
      const r = await api('/api/ai/draft-reply', { method: 'POST', body: { vendor_id: selectedId } });
      if (r.skipped) loadDraft(selectedId);
      else setDraft({ id: r.draft_id, body: r.body, rationale: r.rationale, vendor_id: selectedId, status: 'pending' });
    } catch (e) {
      const msg = e.message || '';
      if (msg.includes('anthropic_api_key_not_set')) {
        alert('Anthropic API key not set. Add one in Settings → "anthropic_api_key" to enable AI drafts.');
      } else {
        alert('AI draft failed: ' + msg);
      }
    }
    setDraftLoading(false);
  };

  const sendDraft = async () => {
    if (!draft) return;
    await api(`/api/ai/drafts/${draft.id}/approve`, { method: 'POST' });
    setDraft(null);
    await reload();
    const t = await api(`/api/inbox/${selectedId}`);
    setThread(t);
  };

  const editDraft = async () => {
    if (!draft) return;
    setReply(draft.body);
    await api(`/api/ai/drafts/${draft.id}/dismiss`, { method: 'POST' });
    setDraft(null);
  };

  const dismissDraft = async () => {
    if (!draft) return;
    await api(`/api/ai/drafts/${draft.id}/dismiss`, { method: 'POST' });
    setDraft(null);
  };

  const filtered = list.filter((m) => !search || (m.name + (m.last_body || '')).toLowerCase().includes(search.toLowerCase()));
  React.useEffect(() => {
    if (!selectedId && filtered.length) setSelectedId(filtered[0].vendor_id);
  }, [filtered, selectedId]);

  const send = async () => {
    if (!reply.trim() || !selectedId) return;
    await api(`/api/inbox/${selectedId}/reply`, { method: 'POST', body: { body: reply } });
    setReply('');
    await reload();
    const t = await api(`/api/inbox/${selectedId}`);
    setThread(t);
  };

  const selected = list.find((m) => m.vendor_id === selectedId);
  const unread = list.filter((m) => m.unread > 0).length;

  // Report-tab derivations
  const reportRows = list.filter((r) => {
    if (cityFilter !== 'all' && (r.city || '') !== cityFilter) return false;
    if (reportFilter === 'replied'    && !(r.reply_count > 0)) return false;
    if (reportFilter === 'unanswered' && (r.reply_count > 0 || !(r.sent_count > 0))) return false;
    if (reportFilter === 'scheduled'  && !(r.scheduled_count > 0)) return false;
    if (reportFilter === 'failed'     && !(r.failed_count > 0)) return false;
    if (search && !((r.name || '') + ' ' + (r.phone || '') + ' ' + (r.last_reply_body || '')).toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  const reportCities = React.useMemo(() => {
    const m = new Map();
    list.forEach((r) => { if (r.city) m.set(r.city, (m.get(r.city) || 0) + 1); });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [list]);
  const repliedTotal = list.filter((r) => r.reply_count > 0).length;
  const unansweredTotal = list.filter((r) => r.sent_count > 0 && !(r.reply_count > 0)).length;
  const replyRatePct = list.length ? Math.round((repliedTotal / list.length) * 100) : 0;
  const totalSentAll = list.reduce((s, r) => s + (r.sent_count || 0), 0);
  const totalRepliesAll = list.reduce((s, r) => s + (r.reply_count || 0), 0);
  const scheduledTotal = list.reduce((s, r) => s + (r.scheduled_count || 0), 0);

  const sendToSelection = () => {
    if (reportSelected.size === 0) { alert('Pick at least one lead.'); return; }
    window.openSendMessage && window.openSendMessage({ vendor_ids: [...reportSelected] });
  };

  const fmtMs = (ms) => ms ? new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

  return (
    <div className="page slide-up" style={{ maxWidth: 1500, padding: '20px 24px' }}>
      <div className="page-h" style={{ paddingBottom: 12 }}>
        <div>
          <div className="page-eyebrow">{unread} unread · {list.length} threads · {totalSentAll} sent · {totalRepliesAll} replies</div>
          <h1 className="page-title">Your <em>inbox</em></h1>
        </div>
        <div className="page-actions">
          <div className="row" style={{ gap: 4, marginRight: 8 }}>
            <button className={'chip ' + (view === 'threads' ? 'accent' : '')} onClick={() => setView('threads')}>Threads</button>
            <button className={'chip ' + (view === 'report'  ? 'accent' : '')} onClick={() => setView('report')}>Report</button>
          </div>
          <button className="btn" onClick={reload}><Icon name="archive" size={12} />Refresh</button>
          <button className="btn primary" onClick={() => window.openSendMessage && window.openSendMessage({})}><Icon name="send" size={12} />Send WhatsApp</button>
        </div>
      </div>

      {view === 'report' && (
        <ReportView
          list={list}
          rows={reportRows}
          cities={reportCities}
          repliedTotal={repliedTotal}
          unansweredTotal={unansweredTotal}
          replyRatePct={replyRatePct}
          totalSentAll={totalSentAll}
          totalRepliesAll={totalRepliesAll}
          scheduledTotal={scheduledTotal}
          search={search} setSearch={setSearch}
          cityFilter={cityFilter} setCityFilter={setCityFilter}
          reportFilter={reportFilter} setReportFilter={setReportFilter}
          selected={reportSelected} setSelected={setReportSelected}
          sendToSelection={sendToSelection}
          fmtMs={fmtMs}
          openThread={(vid) => { setSelectedId(vid); setView('threads'); }}
        />
      )}
      {view === 'threads' && (
      <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 12, height: 'calc(100vh - 220px)' }}>
        <div className="card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: 8, borderBottom: '1px solid var(--rule-2)' }}>
            <div className="row" style={{ background: 'var(--paper-2)', borderRadius: 6, padding: '4px 10px' }}>
              <Icon name="search" size={14} style={{ color: 'var(--muted)' }} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search inbox" style={{ border: 0, background: 'transparent', flex: 1, padding: '4px 0', outline: 'none' }} />
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {filtered.map((m) => {
              const initials = (m.name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2);
              return (
                <div key={m.vendor_id} onClick={() => setSelectedId(m.vendor_id)} style={{
                  padding: '12px 14px', borderBottom: '1px solid var(--rule-2)', cursor: 'pointer',
                  background: selectedId === m.vendor_id ? 'var(--accent-soft)' : (m.unread ? 'var(--paper)' : 'transparent'),
                }}>
                  <div className="row" style={{ gap: 10 }}>
                    <Avatar name={initials} color={m.unread ? '#E07A5F' : '#3D5A80'} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="row" style={{ justifyContent: 'space-between' }}>
                        <span style={{ fontWeight: m.unread ? 700 : 500, fontSize: 13 }}>{m.name}</span>
                        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{humanAge(m.last_at)}</span>
                      </div>
                      <div style={{ fontSize: 12, fontWeight: m.unread ? 600 : 400 }} className="trunc">{m.last_dir === 'in' ? '↘ ' : '↗ '}{m.phone}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }} className="trunc">{m.last_body || '(empty)'}</div>
                    </div>
                    {m.unread > 0 && <span style={{ width: 8, height: 8, background: 'var(--accent)', borderRadius: '50%', flexShrink: 0 }}></span>}
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && <div style={{ padding: 24, color: 'var(--muted)', fontSize: 12 }}>No threads yet.</div>}
          </div>
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {selected ? (
            <>
              <div className="card-h">
                <div>
                  <div className="card-title">{selected.name}</div>
                  <div className="card-sub">{selected.phone} · {selected.company || '—'}</div>
                </div>
                <div className="row" style={{ gap: 4 }}>
                  <button className="icon-btn"><Icon name="archive" size={14} /></button>
                </div>
              </div>
              <div style={{ padding: 24, flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {thread && [...(thread.messages || []), ...(thread.emails || [])]
                  .sort((a, b) => a.created_at - b.created_at).map((m, i) => (
                    <div key={i} style={{
                      alignSelf: m.direction === 'in' ? 'flex-start' : 'flex-end',
                      background: m.direction === 'in' ? 'var(--paper-2)' : 'var(--accent-soft)',
                      color: 'var(--ink-2)', padding: '10px 14px', borderRadius: 12,
                      maxWidth: '78%', fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap',
                    }}>
                      {m.body || m.body_text || m.subject}
                      <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 4 }}>{humanAge(m.created_at)} · {m.status || ''}</div>
                    </div>
                  ))}
              </div>
              {draft && (
                <div className="ai-glow" style={{ margin: '0 16px 12px', padding: 14, borderRadius: 8 }}>
                  <div className="row" style={{ gap: 6, marginBottom: 6 }}>
                    <span className="ai-mark"><Icon name="sparkle" size={10} />AI Draft</span>
                    <strong style={{ fontSize: 12 }}>Suggested reply</strong>
                    <span className="spacer" />
                    <span style={{ fontSize: 10, color: 'var(--muted)' }}>{draft.model || ''}</span>
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap', color: 'var(--ink-2)', marginBottom: 8 }}>{draft.body}</div>
                  {draft.rationale && <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, fontStyle: 'italic' }}>Why: {draft.rationale}</div>}
                  <div className="row" style={{ gap: 6 }}>
                    <button className="btn sm primary" onClick={sendDraft}><Icon name="send" size={11} />Send draft</button>
                    <button className="btn sm" onClick={editDraft}><Icon name="note" size={11} />Edit first</button>
                    <button className="btn sm ghost" onClick={dismissDraft}>Dismiss</button>
                  </div>
                </div>
              )}
              <div style={{ padding: 16, borderTop: '1px solid var(--rule-2)' }}>
                <textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Type a WhatsApp reply…" style={{ width: '100%', minHeight: 80, padding: 10, border: '1px solid var(--rule)', borderRadius: 6, background: 'var(--paper)', resize: 'vertical', outline: 'none' }} />
                <div className="row" style={{ marginTop: 8, gap: 6 }}>
                  <button className="btn primary" onClick={send}><Icon name="send" size={12} />Send</button>
                  <button
                    className="btn"
                    disabled={draftLoading || !aiHealth.api_key_set}
                    onClick={requestAiDraft}
                    title={aiHealth.api_key_set
                      ? `AI-draft a reply (${aiHealth.model})`
                      : 'AI draft is disabled — set an Anthropic API key in Settings → "anthropic_api_key" to enable.'}
                    style={!aiHealth.api_key_set ? { opacity: 0.55, cursor: 'not-allowed' } : {}}
                  >
                    <span className="ai-mark"><Icon name="sparkle" size={10} />AI</span>
                    {!aiHealth.api_key_set ? 'AI draft (key needed)' : (draftLoading ? 'Drafting…' : 'AI draft')}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Select a conversation to read.</div>
          )}
        </div>
      </div>
      )}
    </div>
  );
};

Object.assign(window, { Tasks, Calendar, Inbox });
