// =============================================================
// AI Assistant drawer, Command Palette, Notifications popover.
// AI replies come from /api/ai/ask. Cmd palette searches the
// loaded store. Notifications hit /api/notifications.
// =============================================================

const AIAssistant = ({ open, onClose }) => {
  const [messages, setMessages] = React.useState([]);
  const [input, setInput] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open || messages.length) return;
    const summary = window.DASH_SUMMARY || {};
    const me = (window.TEAM || []).find((u) => (u.name || '').startsWith('You'));
    const myName = me ? me.name.replace(/^You \(|\)$/g, '').split(' ')[0] : 'there';
    setMessages([{
      role: 'ai',
      text: `Hi ${myName} — I have ${fmtMoney(summary.pipeline_value || 0)} in active pipeline visible. ${(window.AI_INSIGHTS || []).length} AI insights waiting. What can I help with?`,
    }]);
  }, [open]);

  const suggestions = [
    'Summarize my pipeline',
    'Which deals are at risk this week?',
    'Draft a follow-up to my top contact',
    "Who haven't I touched in 14 days?",
  ];

  const send = async (t) => {
    const text = (t || input).trim();
    if (!text || busy) return;
    setMessages((m) => [...m, { role: 'user', text }]);
    setInput('');
    setBusy(true);
    try {
      const r = await api('/api/ai/ask', { method: 'POST', body: { query: text } });
      setMessages((m) => [...m, { role: 'ai', text: r.reply }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'ai', text: 'Sorry — I had trouble answering that. ' + e.message }]);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer" style={{ width: 480 }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--rule-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="row" style={{ gap: 8 }}>
            <span className="ai-mark"><Icon name="sparkle" size={10} />AI</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Three Assistant</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>Knows your pipeline · always-on</div>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {messages.map((m, i) => (
            <div key={i} style={{
              alignSelf: m.role === 'ai' ? 'flex-start' : 'flex-end',
              background: m.role === 'ai' ? 'var(--paper-2)' : 'var(--ink)',
              color: m.role === 'ai' ? 'var(--ink-2)' : 'var(--paper)',
              padding: '10px 14px', borderRadius: 12,
              maxWidth: '85%', fontSize: 13, lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
            }}>
              {m.text}
            </div>
          ))}
          {busy && <div style={{ alignSelf: 'flex-start', fontSize: 12, color: 'var(--muted)' }}>thinking…</div>}
        </div>
        <div style={{ padding: 12, borderTop: '1px solid var(--rule-2)' }}>
          <div className="row" style={{ gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
            {suggestions.map((s) => <button key={s} className="chip" style={{ cursor: 'pointer' }} onClick={() => send(s)}>{s}</button>)}
          </div>
          <div className="row" style={{ gap: 6, background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 8, padding: '6px 10px' }}>
            <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="Ask about deals, draft replies, get a summary…" style={{ border: 0, background: 'transparent', flex: 1, padding: '4px 0', outline: 'none' }} />
            <button className="btn sm primary" onClick={() => send()}><Icon name="send" size={12} /></button>
          </div>
        </div>
      </div>
    </>
  );
};

const CommandPalette = ({ open, onClose, setRoute }) => {
  const [q, setQ] = React.useState('');
  if (!open) return null;
  const items = [
    {
      sec: 'Navigate', list: [
        { l: 'Dashboard', icon: 'dashboard', a: () => setRoute('dashboard') },
        { l: 'Pipeline', icon: 'pipeline', a: () => setRoute('deals') },
        { l: 'Leads / Clients', icon: 'people', a: () => setRoute('contacts') },
        { l: 'Companies', icon: 'building', a: () => setRoute('companies') },
        { l: 'Tasks', icon: 'check-list', a: () => setRoute('tasks') },
        { l: 'Calendar', icon: 'calendar', a: () => setRoute('calendar') },
        { l: 'Inbox', icon: 'mail', a: () => setRoute('inbox') },
        { l: 'Reports', icon: 'chart', a: () => setRoute('reports') },
        { l: 'Campaigns', icon: 'megaphone', a: () => setRoute('campaigns') },
        { l: 'Tickets', icon: 'ticket', a: () => setRoute('tickets') },
        { l: 'Automations', icon: 'flow', a: () => setRoute('automations') },
        { l: 'Team', icon: 'team', a: () => setRoute('team') },
        { l: 'Settings', icon: 'settings', a: () => setRoute('settings') },
      ],
    },
    {
      sec: 'Create', list: [
        { l: 'New deal', icon: 'plus', a: () => window.openNewDeal && window.openNewDeal() },
        { l: 'New contact', icon: 'plus', a: () => window.openNewContact && window.openNewContact() },
        { l: 'New task', icon: 'plus', a: () => window.openNewTask && window.openNewTask() },
        { l: 'New automation', icon: 'bolt', a: () => window.openNewAutomation && window.openNewAutomation() },
        { l: 'New campaign', icon: 'megaphone', a: () => window.openNewCampaign && window.openNewCampaign() },
        { l: 'Link WhatsApp', icon: 'phone', a: () => window.openWaQr && window.openWaQr() },
      ],
    },
    {
      sec: 'People', list: (window.CONTACTS || []).slice(0, 20).map((c) => ({
        l: c.name, sub: c.title || c.email, icon: 'people', a: () => setRoute('contacts'),
      })),
    },
    {
      sec: 'Deals', list: (window.DEALS || []).slice(0, 20).map((d) => ({
        l: d.name, sub: fmtMoney(d.amount), icon: 'money', a: () => setRoute('deals'),
      })),
    },
  ];
  const filtered = items.map((s) => ({
    ...s,
    list: s.list.filter((i) => !q || (i.l + (i.sub || '')).toLowerCase().includes(q.toLowerCase())).slice(0, 8),
  })).filter((s) => s.list.length > 0);

  return (
    <div className="cmd-overlay" onClick={onClose}>
      <div className="cmd" onClick={(e) => e.stopPropagation()}>
        <input className="cmd-input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a command, search deals, contacts, tickets…" />
        <div className="cmd-list">
          {filtered.map((s) => (
            <div key={s.sec}>
              <div className="cmd-section">{s.sec}</div>
              {s.list.map((it, i) => (
                <div key={i} className="cmd-item" onClick={() => { it.a && it.a(); onClose(); }}>
                  <Icon name={it.icon} className="icon" />
                  <span style={{ flex: 1, fontSize: 13 }}>{it.l}</span>
                  {it.sub && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{it.sub}</span>}
                </div>
              ))}
            </div>
          ))}
          {filtered.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>No results</div>}
        </div>
        <div style={{ borderTop: '1px solid var(--rule-2)', padding: '8px 16px', fontSize: 11, color: 'var(--muted)', display: 'flex', gap: 16, justifyContent: 'space-between' }}>
          <div className="row" style={{ gap: 12 }}>
            <span><span className="kbd">↵</span> select</span>
            <span><span className="kbd">↑↓</span> navigate</span>
            <span><span className="kbd">esc</span> close</span>
          </div>
          <span>Powered by Three Search</span>
        </div>
      </div>
    </div>
  );
};

const NotifPanel = ({ open, onClose }) => {
  if (!open) return null;
  const iconMap = { email: 'mail', meeting: 'meeting', task: 'check-list', deal: 'money', ai: 'sparkle', info: 'bell' };
  const colorMap = { email: '#3D5A80', meeting: '#6B4E71', task: '#7A7670', deal: '#588157', ai: '#E07A5F', info: '#7A7670' };
  const list = window.NOTIFICATIONS || [];

  const markAll = async () => {
    await api('/api/notifications/read-all', { method: 'PUT' });
    await refreshStore();
  };
  const markOne = async (n) => {
    if (!n.unread) return;
    await api(`/api/notifications/${n.raw_id}/read`, { method: 'PUT' });
    await refreshStore();
  };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 998 }} />
      <div className="card" style={{ position: 'fixed', top: 60, right: 16, width: 380, zIndex: 999, boxShadow: 'var(--shadow-lg)', maxHeight: 'calc(100vh - 80px)', overflow: 'hidden', display: 'flex', flexDirection: 'column', animation: 'slideUp .2s ease' }}>
        <div className="card-h">
          <div className="card-title">Notifications</div>
          <button className="btn ghost sm" onClick={markAll}>Mark all read</button>
        </div>
        <div style={{ overflowY: 'auto' }}>
          {list.map((n) => (
            <div key={n.id} onClick={() => markOne(n)} className="row" style={{ padding: '12px 16px', borderBottom: '1px solid var(--rule-2)', gap: 10, background: n.unread ? 'var(--paper)' : 'transparent', cursor: 'pointer' }}>
              <div style={{ width: 28, height: 28, borderRadius: 6, background: (colorMap[n.kind] || '#7A7670') + '22', color: colorMap[n.kind] || '#7A7670', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                <Icon name={iconMap[n.kind] || 'bell'} size={14} />
              </div>
              <div style={{ flex: 1, fontSize: 12 }}>{n.text}</div>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{n.time}</span>
              {n.unread && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }} />}
            </div>
          ))}
          {list.length === 0 && <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>You're all caught up.</div>}
        </div>
      </div>
    </>
  );
};

Object.assign(window, { AIAssistant, CommandPalette, NotifPanel });
