// =============================================================
// Contacts & Companies — live data, drawer with deals + activity.
// =============================================================

function fmtPhone(p) {
  if (!p) return '';
  const d = String(p).replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) return '+91 ' + d.slice(2, 7) + ' ' + d.slice(7);
  if (d.length === 11 && d.startsWith('1')) return '+1 ' + d.slice(1, 4) + ' ' + d.slice(4, 7) + ' ' + d.slice(7);
  return '+' + d;
}

const EDIT_INPUT_BASE = {
  flex: 1, minWidth: 0, width: '100%', fontSize: 12, padding: '4px 6px',
  border: '1px solid transparent', background: 'transparent',
  borderRadius: 4, outline: 'none', color: 'var(--ink-2)',
};

const EditableCell = ({ value, save, placeholder, mono, prefix, suffix, cellStyle, inputStyle, allowEmpty = true }) => {
  const initial = value == null ? '' : String(value);
  const [v, setV] = React.useState(initial);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => { setV(value == null ? '' : String(value)); }, [value]);

  const onBlur = async (e) => {
    const next = (v || '').trim();
    if (next === (initial || '').trim()) return;
    if (!allowEmpty && !next) { setV(initial); return; }
    setSaving(true);
    try {
      await save(next);
    } catch (err) {
      alert('Save failed: ' + (err && err.message ? err.message : err));
      setV(initial);
    }
    setSaving(false);
  };

  return (
    <td onClick={(e) => e.stopPropagation()} style={cellStyle}>
      <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'nowrap' }}>
        {prefix}
        <input
          type="text"
          value={v}
          onChange={(e) => setV(e.target.value)}
          onBlur={onBlur}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.target.blur();
            else if (e.key === 'Escape') { setV(initial); e.target.blur(); }
          }}
          placeholder={placeholder}
          className={mono ? 'mono' : ''}
          style={{ ...EDIT_INPUT_BASE, opacity: saving ? 0.6 : 1, ...(inputStyle || {}) }}
          onFocus={(e) => { e.target.style.border = '1px solid var(--rule)'; e.target.style.background = 'var(--paper)'; }}
          onMouseLeave={(e) => { if (document.activeElement !== e.target) { e.target.style.border = '1px solid transparent'; e.target.style.background = 'transparent'; } }}
        />
        {suffix}
      </div>
    </td>
  );
};

const TemplatePicker = () => {
  const [open, setOpen] = React.useState(false);
  const [templates, setTemplates] = React.useState(null);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (templates) return;
    api('/api/vendors/templates').then(setTemplates).catch(() => setTemplates([]));
  }, [templates]);
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const download = (key, ext) => {
    setOpen(false);
    window.location.href = `/api/vendors/template.${ext}?type=${encodeURIComponent(key)}`;
  };
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="btn" onClick={() => setOpen((v) => !v)} title="Pick a template format">
        <Icon name="doc" size={12} />Excel template <Icon name="caret-down" size={10} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 100,
          background: 'var(--card)', border: '1px solid var(--rule)',
          borderRadius: 8, padding: 6, minWidth: 320,
          boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
        }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '8px 10px 4px' }}>
            Choose a template format
          </div>
          {(templates || []).map((t) => (
            <div key={t.key} style={{ padding: '8px 10px', borderRadius: 6, cursor: 'pointer' }}
                 onMouseEnter={(e) => e.currentTarget.style.background = 'var(--hover)'}
                 onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{t.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.4 }}>{t.description}</div>
                  <div style={{ fontSize: 10, color: 'var(--ink-3)', marginTop: 4 }} className="mono">{t.columns.join(' · ')}</div>
                </div>
                <div className="row" style={{ gap: 4 }}>
                  <button className="btn sm" onClick={() => download(t.key, 'xlsx')} title="Download Excel">.xlsx</button>
                  <button className="btn sm" onClick={() => download(t.key, 'csv')} title="Download CSV">.csv</button>
                </div>
              </div>
            </div>
          ))}
          {templates && templates.length === 0 && (
            <div style={{ padding: 12, fontSize: 12, color: 'var(--muted)' }}>Loading templates…</div>
          )}
        </div>
      )}
    </div>
  );
};

const ContactRow = ({ c, onOpen, sno, isSelected, onSelectChange }) => {
  const linked = getCompany(c.companyId);
  const co = linked || {
    color: '#7A7670',
    logo: (c.company || c.name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase(),
    name: c.company || c.name || '—',
  };

  const saveField = (apiField) => async (val) => {
    const body = { [apiField]: val || null };
    if (apiField === 'name') body.company = val || null; // keep company in sync with store name
    await api(`/api/vendors/${c.raw_id}`, { method: 'PUT', body });
    if (apiField === 'name') { c.name = val; c.company = val; }
    else if (apiField === 'category') c.businessType = val;
    else c[apiField] = val;
  };

  const savePhone = async (input) => {
    await api(`/api/vendors/${c.raw_id}`, { method: 'PUT', body: { phone: input } });
    let d = String(input).replace(/\D/g, '').replace(/^0+/, '');
    if (d.length === 10) d = '91' + d;
    c.phone = d;
  };

  const isPlaceholderPhone = !c.phone || String(c.phone).startsWith('na-');
  const callIcon = !isPlaceholderPhone ? (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); window.openCallLog && window.openCallLog(c); }}
      title={'Call ' + fmtPhone(c.phone) + ' & log it'}
      style={{ flex: '0 0 auto', display: 'grid', placeItems: 'center', width: 26, height: 26, borderRadius: 6, border: '1px solid var(--rule)', background: 'var(--paper)', cursor: 'pointer', color: 'var(--ink-2)' }}
    >
      <Icon name="phone" size={12} />
    </button>
  ) : null;

  const avatarPrefix = (
    <div
      onClick={(e) => { e.stopPropagation(); onOpen(c); }}
      style={{ flex: '0 0 auto', cursor: 'pointer', position: 'relative' }}
      title="Open details"
    >
      <Avatar name={c.avatar} color={co.color} src={c.profilePicUrl} />
      {c.isBusiness && (
        <span title="WhatsApp Business" style={{
          position: 'absolute', bottom: -2, right: -2, width: 12, height: 12,
          borderRadius: '50%', background: '#25D366', border: '2px solid var(--paper)',
          boxShadow: '0 0 0 1px var(--rule)',
        }} />
      )}
    </div>
  );

  return (
    <tr>
      <td style={{ width: 36 }}>
        <input
          type="checkbox"
          checked={!!isSelected}
          onChange={(e) => onSelectChange && onSelectChange(c.raw_id, e.target.checked)}
          onClick={(e) => e.stopPropagation()}
        />
      </td>
      <td
        style={{ width: 48, textAlign: 'right', color: 'var(--muted)', fontSize: 11, cursor: 'pointer' }}
        className="mono"
        onClick={() => onOpen(c)}
        title="Open details"
      >{sno}</td>

      <EditableCell
        value={c.name}
        save={saveField('name')}
        placeholder="Store name"
        prefix={avatarPrefix}
        allowEmpty={false}
        inputStyle={{ fontWeight: 600, fontSize: 13 }}
      />

      <EditableCell
        value={isPlaceholderPhone ? '' : fmtPhone(c.phone)}
        save={savePhone}
        placeholder="Phone"
        mono
        suffix={callIcon}
        cellStyle={{ whiteSpace: 'nowrap' }}
      />

      <EditableCell
        value={c.address}
        save={saveField('address')}
        placeholder="Address"
        cellStyle={{ maxWidth: 280 }}
        inputStyle={{ fontSize: 11, color: 'var(--ink-3)' }}
      />

      <EditableCell
        value={c.city}
        save={saveField('city')}
        placeholder="City"
      />

      <EditableCell
        value={c.businessType}
        save={saveField('category')}
        placeholder="Type"
        inputStyle={{ color: 'var(--ink-3)' }}
      />

      <CalledToggle contact={c} />

    </tr>
  );
};

// Inline toggle in the Leads table. Visual state derived from vendor.status —
// 'new' = not-called (outlined), anything else = called (filled). Click flips
// between 'new' and 'contacted'; preserves 'replied'/'won'/'lost' if those are set.
const CalledToggle = ({ contact }) => {
  const [busy, setBusy] = React.useState(false);
  const isCalled = contact.status && contact.status !== 'new';
  const toggle = async (e) => {
    e.stopPropagation();
    setBusy(true);
    try {
      const nextStatus = isCalled ? 'new' : 'contacted';
      await api(`/api/vendors/${contact.raw_id}`, { method: 'PUT', body: { status: nextStatus } });
      contact.status = nextStatus;
      window.dispatchEvent(new CustomEvent('store:change'));
    } catch (err) {
      alert('Failed: ' + (err.message || err));
    }
    setBusy(false);
  };
  return (
    <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        title={isCalled ? 'Marked as called — click to mark not called' : 'Not called yet — click to mark called'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '4px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600,
          border: '1.5px solid ' + (isCalled ? '#2A6F4B' : 'var(--rule)'),
          background: isCalled ? '#2A6F4B' : 'transparent',
          color: isCalled ? 'white' : 'var(--muted)',
          cursor: 'pointer', opacity: busy ? 0.5 : 1, transition: 'all 0.12s',
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: isCalled ? 'white' : 'var(--rule)' }}></span>
        {isCalled ? 'Called' : 'Not called'}
      </button>
    </td>
  );
};

const ContactDrawer = ({ contact, onClose }) => {
  const [thread, setThread] = React.useState(null);
  const [calls, setCalls] = React.useState([]);
  React.useEffect(() => {
    if (!contact) return;
    api(`/api/inbox/${contact.raw_id}`).then(setThread).catch(() => setThread({ messages: [], emails: [] }));
    api(`/api/calls?vendor_id=${contact.raw_id}&limit=50`).then(setCalls).catch(() => setCalls([]));
  }, [contact && contact.id]);

  if (!contact) return null;
  const linked = getCompany(contact.companyId);
  const co = linked || {
    color: '#7A7670',
    logo: (contact.company || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase(),
    name: contact.company || '—',
  };
  const deals = (window.DEALS || []).filter((d) => d.contactId === contact.id);
  const acts = (window.ACTIVITIES || []).filter((a) => deals.some((d) => d.id === a.dealId));

  const send = async (body) => {
    if (!body) return;
    await api(`/api/inbox/${contact.raw_id}/reply`, { method: 'POST', body: { body } });
    const t = await api(`/api/inbox/${contact.raw_id}`);
    setThread(t);
  };

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer">
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--rule-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div className="row" style={{ gap: 14 }}>
            <Avatar name={contact.avatar} color={co.color} size="xl" />
            <div>
              <div className="serif" style={{ fontSize: 24, letterSpacing: '-0.02em' }}>{contact.name}</div>
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>{contact.title || '—'} at <strong style={{ color: 'var(--ink-2)' }}>{co.name}</strong></div>
              <div className="row" style={{ gap: 4, marginTop: 8 }}>
                {contact.tags.map((t) => <span key={t} className="chip">{t}</span>)}
              </div>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div style={{ padding: '12px 24px', borderBottom: '1px solid var(--rule-2)', display: 'flex', gap: 6 }}>
          <button className="btn sm" onClick={() => {
            const body = prompt('Email body to ' + contact.name + ':');
            if (body) send(body);
          }}><Icon name="mail" size={12} />Email</button>
          <button className="btn sm" onClick={() => window.openCallLog && window.openCallLog(contact)}><Icon name="phone" size={12} />Call & log</button>
          <button className="btn sm" onClick={() => window.openSendMessage && window.openSendMessage({ vendor_id: contact.raw_id })}><Icon name="send" size={12} />WhatsApp</button>
          <button className="btn sm" onClick={async () => {
            const title = prompt('Task title:');
            if (!title) return;
            await api('/api/tasks', { method: 'POST', body: { vendor_id: contact.raw_id, title, priority: 'med' } });
            await refreshStore();
            alert('Task created.');
          }}><Icon name="check-list" size={12} />Task</button>
          <div className="spacer" />
          <button className="btn sm ghost"><Icon name="dot-3" size={14} /></button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {contact.ai && (
            <div className="ai-glow" style={{ margin: 24, padding: 14, borderRadius: 8 }}>
              <div className="row" style={{ gap: 6, marginBottom: 6 }}>
                <span className="ai-mark"><Icon name="sparkle" size={10} />AI</span>
                <strong style={{ fontSize: 13 }}>Lead score {contact.score}</strong>
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{contact.ai}</div>
            </div>
          )}

          <div style={{ padding: '0 24px 24px' }}>
            <div className="card-title" style={{ marginBottom: 12, fontSize: 14 }}>Details</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div><div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Email</div><div className="mono" style={{ fontSize: 12 }}>{contact.email || '—'}</div></div>
              <div><div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Phone</div><div className="mono" style={{ fontSize: 12 }}>{contact.phone || '—'}</div></div>
              <div><div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Owner</div><div style={{ fontSize: 12 }}>{contact.owner}</div></div>
              <div><div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Last touch</div><div style={{ fontSize: 12 }}>{contact.lastTouch || '—'}</div></div>
            </div>

            <div className="card-title" style={{ margin: '24px 0 12px', fontSize: 14 }}>Open deals · {deals.length}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {deals.map((d) => {
                const st = getStage(d.stage);
                return (
                  <div key={d.id} className="row" style={{ padding: 12, border: '1px solid var(--rule-2)', borderRadius: 6, gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{d.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{st ? st.name : '—'} · {fmtMoney(d.amount)} · close {d.close}</div>
                    </div>
                    {st && <span className="chip dot" style={{ color: st.color }}>{d.forecast}</span>}
                  </div>
                );
              })}
              {deals.length === 0 && <div style={{ fontSize: 12, color: 'var(--muted)' }}>No open deals.</div>}
            </div>

            <div className="card-title" style={{ margin: '24px 0 12px', fontSize: 14 }}>Call log · {calls.length}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {calls.length === 0 && <div style={{ fontSize: 12, color: 'var(--muted)' }}>No calls logged yet.</div>}
              {calls.map((h) => {
                const fmt = (s) => {
                  s = Math.max(0, Math.floor(s || 0));
                  const m = Math.floor(s / 60), ss = s % 60;
                  return String(m).padStart(2,'0') + ':' + String(ss).padStart(2,'0');
                };
                const when = h.created_at ? new Date(h.created_at).toLocaleString() : '—';
                return (
                  <div key={h.id} style={{ padding: 10, border: '1px solid var(--rule-2)', borderRadius: 6, fontSize: 12 }}>
                    <div className="row" style={{ gap: 8, marginBottom: 4 }}>
                      <span className="mono" style={{ color: 'var(--muted)' }}>{when}</span>
                      <span style={{ minWidth: 100 }}>{(window.DISPOSITION_LABEL && window.DISPOSITION_LABEL[h.disposition]) || h.disposition || '—'}</span>
                      {h.outcome && <span className="chip" style={{ fontSize: 10 }}>{h.outcome.replace('_', ' ')}</span>}
                      <div className="spacer" />
                      <span className="mono" style={{ color: 'var(--muted)' }}>{fmt(h.duration_sec)}</span>
                    </div>
                    {h.notes && <div style={{ color: 'var(--ink-3)', whiteSpace: 'pre-wrap' }}>{h.notes}</div>}
                  </div>
                );
              })}
            </div>

            <div className="card-title" style={{ margin: '24px 0 12px', fontSize: 14 }}>Conversation</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
              {thread && [...(thread.messages || []), ...(thread.emails || [])]
                .sort((a, b) => a.created_at - b.created_at)
                .slice(-20)
                .map((m, i) => (
                  <div key={i} style={{
                    alignSelf: m.direction === 'in' ? 'flex-start' : 'flex-end',
                    background: m.direction === 'in' ? 'var(--paper-2)' : 'var(--accent-soft)',
                    color: 'var(--ink-2)',
                    padding: '8px 12px', borderRadius: 10, maxWidth: '80%', fontSize: 12, lineHeight: 1.5,
                  }}>
                    {m.body || m.body_text || m.subject}
                    <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 4 }}>{humanAge(m.created_at)} ago · {m.status || ''}</div>
                  </div>
                ))}
              {thread && (thread.messages || []).length === 0 && (thread.emails || []).length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>No conversation yet.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

const Contacts = () => {
  const { ready } = useStore();
  const [q, setQ] = React.useState('');
  const [tag, setTag] = React.useState('all');
  const [bizOnly, setBizOnly] = React.useState(false);
  const [open, setOpen] = React.useState(null);
  const [selected, setSelected] = React.useState(new Set());
  const deleteSelected = async () => {
    const ids = [...selected];
    const r = await window.bulkRun({ url: '/api/vendors/delete-bulk', ids, confirmMsg: `Delete ${ids.length} lead${ids.length > 1 ? 's' : ''}? This cannot be undone.` });
    if (!r) return;
    alert(`${r.deleted} deleted.`);
    setSelected(new Set());
    await refreshStore();
  };
  if (!ready) return null;
  const all = window.CONTACTS || [];
  const bizCount = all.filter((c) => c.isBusiness).length;
  const allTags = Array.from(new Set(all.flatMap((c) => c.tags))).filter(Boolean).slice(0, 10);
  const filtered = all.filter((c) => {
    if (q && !(c.name + ' ' + c.email + ' ' + c.title + ' ' + c.phone + ' ' + c.address + ' ' + c.city + ' ' + c.businessType).toLowerCase().includes(q.toLowerCase())) return false;
    if (tag !== 'all' && !c.tags.includes(tag)) return false;
    if (bizOnly && !c.isBusiness) return false;
    return true;
  }).sort((a, b) => {
    // Group by city, then alphabetical by store name. Empty cities sort to the bottom.
    const ca = (a.city || '').toLowerCase();
    const cb = (b.city || '').toLowerCase();
    if (!ca && cb) return 1;
    if (ca && !cb) return -1;
    if (ca !== cb) return ca.localeCompare(cb);
    return (a.name || '').localeCompare(b.name || '');
  });
  return (
    <div className="page slide-up">
      <div className="page-h">
        <div>
          <div className="page-eyebrow">{all.length} leads / clients · {filtered.length} matching</div>
          <h1 className="page-title">Your <em>leads &amp; clients</em></h1>
          <div className="page-sub">Stores you've contacted, are calling, or have closed — sorted by city.</div>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => importFromWhatsApp()}><Icon name="phone" size={12} />Import from WhatsApp</button>
          <TemplatePicker />
          <button className="btn" onClick={() => importVendorsFlow()}><Icon name="link" size={12} />Import Excel/CSV</button>
          <button className="btn" onClick={() => window.location.href = '/api/vendors/export.xlsx'}><Icon name="doc" size={12} />Export</button>
          <button className="btn primary" onClick={() => window.openNewContact && window.openNewContact()}><Icon name="plus" size={12} />New lead</button>
        </div>
      </div>

      <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <div className="row" style={{ background: 'var(--card)', border: '1px solid var(--rule)', borderRadius: 6, padding: '4px 10px', gap: 6, flex: 1, maxWidth: 320 }}>
          <Icon name="search" size={14} style={{ color: 'var(--muted)' }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, email, title…" style={{ border: 0, background: 'transparent', flex: 1, padding: '4px 0', outline: 'none' }} />
        </div>
        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          <button className={'chip ' + (tag === 'all' ? 'accent' : '')} onClick={() => setTag('all')}>All</button>
          <button
            className={'chip ' + (bizOnly ? 'accent' : '')}
            onClick={() => setBizOnly((v) => !v)}
            title="Show only WhatsApp Business accounts"
          >Business {bizCount > 0 && <span style={{ opacity: 0.7 }}>({bizCount})</span>}</button>
          {allTags.map((t) => <button key={t} className={'chip ' + (tag === t ? 'accent' : '')} onClick={() => setTag(t)}>{t}</button>)}
        </div>
        <div className="spacer" />
        <button className="btn sm"><Icon name="filter" size={12} />Filters</button>
        <button className="btn sm"><Icon name="sort" size={12} />Sort</button>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ maxHeight: 'calc(100vh - 320px)', overflow: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && filtered.every((c) => selected.has(c.raw_id))}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) filtered.forEach((c) => next.add(c.raw_id));
                      else filtered.forEach((c) => next.delete(c.raw_id));
                      setSelected(next);
                    }}
                    title={selected.size ? `${selected.size} selected — toggle visible rows` : 'Select all visible'}
                  />
                </th>
                <th style={{ width: 48, textAlign: 'right' }}>S.No</th>
                <th>Store name</th>
                <th style={{ whiteSpace: 'nowrap' }}>Phone</th>
                <th>Address</th>
                <th>City</th>
                <th>Type</th>
                <th style={{ whiteSpace: 'nowrap' }}>Called</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => (
                <ContactRow
                  key={c.id}
                  c={c}
                  sno={i + 1}
                  onOpen={setOpen}
                  isSelected={selected.has(c.raw_id)}
                  onSelectChange={(id, checked) => {
                    const next = new Set(selected);
                    if (checked) next.add(id); else next.delete(id);
                    setSelected(next);
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {open && <ContactDrawer contact={open} onClose={() => setOpen(null)} />}
      <BulkBar
        count={selected.size}
        onClear={() => setSelected(new Set())}
        actions={[
          { label: 'Send WhatsApp', icon: 'send', variant: 'primary', onClick: () => window.openSendMessage && window.openSendMessage({ vendor_ids: [...selected] }) },
          { label: 'Delete', icon: 'trash', variant: 'danger', onClick: deleteSelected },
        ]}
      />
    </div>
  );
};

async function importFromWhatsApp() {
  const wa = window.WA_STATUS || {};
  if (!wa.ready) {
    alert('WhatsApp is not linked. Open Settings or click the status row in the sidebar to link.');
    return;
  }
  if (!confirm('Import all saved contacts from your linked WhatsApp account into the CRM as vendors? This may take 10–30 seconds for large contact lists.')) return;
  try {
    const r = await api('/api/wa/import-contacts', { method: 'POST', body: { onlySaved: true } });
    alert(`WhatsApp import complete:\n• ${r.inserted} new contacts\n• ${r.updated} existing updated\n• ${r.skipped} skipped (groups, broadcasts, unsaved)\n\nTotal scanned: ${r.total}`);
    await refreshStore();
  } catch (e) {
    alert('Import failed: ' + e.message);
  }
}

async function importVendorsFlow() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv,.xlsx,.xls';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/vendors/import', { method: 'POST', body: fd });
    const r = await res.json();
    if (!res.ok) {
      alert('Import failed: ' + (r.error || 'unknown') + (r.detail ? '\n' + r.detail : ''));
      return;
    }
    alert(`Imported: ${r.inserted} ok · ${r.invalid || 0} invalid · ${r.missing || 0} missing fields`);
    await refreshStore();
  };
  input.click();
}

const Companies = () => {
  const { ready } = useStore();
  const [open, setOpen] = React.useState(null);
  const sel = useMultiSelect();
  if (!ready) return null;
  const cos = window.COMPANIES || [];
  const ids = cos.map((c) => c.raw_id);
  const totalMrr = cos.reduce((s, c) => s + (c.mrr || 0), 0);
  const deleteSelected = async () => {
    const sids = [...sel.selected];
    const r = await window.bulkRun({ url: '/api/companies/delete-bulk', ids: sids, confirmMsg: `Delete ${sids.length} compan${sids.length > 1 ? 'ies' : 'y'}?` });
    if (!r) return;
    alert(`${r.deleted} deleted.`);
    sel.clear();
    await refreshStore();
  };
  return (
    <div className="page slide-up">
      <div className="page-h">
        <div>
          <div className="page-eyebrow">{cos.length} active accounts · {fmtMoney(totalMrr)} MRR</div>
          <h1 className="page-title">Companies you <em>care about</em></h1>
        </div>
        <div className="page-actions">
          {cos.length > 0 && <button className="btn" onClick={() => sel.toggleAll(ids)}><Icon name="check" size={12} />{sel.allSelected(ids) ? 'Unselect all' : 'Select all'}</button>}
          <button className="btn"><Icon name="filter" size={12} />Tier: All</button>
          <button className="btn primary" onClick={() => window.openNewCompany && window.openNewCompany()}><Icon name="plus" size={12} />New company</button>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {cos.map((co) => (
          <div key={co.id} className={'card' + (sel.selected.has(co.raw_id) ? ' is-selected' : '')} style={{ padding: 16, cursor: 'pointer', transition: 'all .15s' }} onClick={() => setOpen(co)}>
            <div className="row" style={{ gap: 10, marginBottom: 12 }}>
              <input type="checkbox" checked={sel.selected.has(co.raw_id)} onClick={(e) => e.stopPropagation()} onChange={() => sel.toggle(co.raw_id)} title="Select" />
              <div style={{ width: 40, height: 40, borderRadius: 8, background: co.color, color: 'white', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 14 }}>{co.logo}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }} className="trunc">{co.name}</div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{co.domain || '—'}</div>
              </div>
              <span className={'chip ' + (co.tier === 'Enterprise' ? 'plum' : co.tier === 'Growth' ? 'blue' : 'gray')}>{co.tier}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>MRR</div>
                <div className="serif" style={{ fontSize: 18 }}>{fmtMoney(co.mrr)}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Open pipe</div>
                <div className="serif" style={{ fontSize: 18, color: co.openPipe ? 'var(--accent-ink)' : 'var(--muted)' }}>{co.openPipe ? fmtMoney(co.openPipe) : '—'}</div>
              </div>
            </div>
            <div className="row" style={{ justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', borderTop: '1px solid var(--rule-2)', paddingTop: 10 }}>
              <span>{co.industry || '—'} · {co.size || '—'}</span>
              <span>{co.contactsCount} contacts</span>
            </div>
          </div>
        ))}
      </div>
      {open && <CompanyDrawer company={open} onClose={() => setOpen(null)} />}
      <BulkBar count={sel.selected.size} onClear={sel.clear} actions={[{ label: 'Delete', icon: 'trash', variant: 'danger', onClick: deleteSelected }]} />
    </div>
  );
};

const CompanyDrawer = ({ company, onClose }) => {
  const [detail, setDetail] = React.useState(null);
  React.useEffect(() => {
    api(`/api/companies/${company.raw_id}`).then(setDetail).catch(() => setDetail({ company, contacts: [], deals: [], tickets: [] }));
  }, [company.id]);
  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer">
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--rule-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div className="row" style={{ gap: 14 }}>
            <div style={{ width: 56, height: 56, borderRadius: 12, background: company.color, color: 'white', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 22 }}>{company.logo}</div>
            <div>
              <div className="serif" style={{ fontSize: 24, letterSpacing: '-0.02em' }}>{company.name}</div>
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>{company.domain} · {company.city || '—'}</div>
              <div className="row" style={{ gap: 4, marginTop: 8 }}>
                <span className={'chip ' + (company.tier === 'Enterprise' ? 'plum' : 'blue')}>{company.tier}</span>
                <span className="chip">{company.industry}</span>
                <span className="chip">{company.size}</span>
              </div>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          <div className="row" style={{ gap: 16, marginBottom: 24 }}>
            <div>
              <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase' }}>MRR</div>
              <div className="serif" style={{ fontSize: 28 }}>{fmtMoney(company.mrr)}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase' }}>Customer since</div>
              <div className="serif" style={{ fontSize: 28 }}>{company.since || '—'}</div>
            </div>
          </div>
          {detail && (
            <>
              <div className="card-title" style={{ marginBottom: 12 }}>Contacts ({detail.contacts.length})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 24 }}>
                {detail.contacts.map((c) => (
                  <div key={c.id} className="row" style={{ padding: 10, border: '1px solid var(--rule-2)', borderRadius: 6, gap: 10 }}>
                    <Avatar name={c.avatar || c.name.split(' ').map((w) => w[0]).join('').slice(0, 2)} color={company.color} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.title || c.email}</div>
                    </div>
                    <span className="chip">{c.score}</span>
                  </div>
                ))}
              </div>
              <div className="card-title" style={{ marginBottom: 12 }}>Deals ({detail.deals.length})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 24 }}>
                {detail.deals.map((d) => (
                  <div key={d.id} className="row" style={{ padding: 10, border: '1px solid var(--rule-2)', borderRadius: 6, gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{d.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{d.stage_name} · {fmtMoney(d.amount)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
};

Object.assign(window, { Contacts, Companies, ContactDrawer });
