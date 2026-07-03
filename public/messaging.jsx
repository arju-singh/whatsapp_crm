// =============================================================
// Messaging — WhatsApp templates UI + Send/Bulk modal.
//
// This is the customer-facing layer over an already-complete backend:
//   - /api/templates (CRUD + media upload at /:id/media)
//   - /api/messages/bulk  → creates a campaign & queues N messages
//   - /api/messages/test  → send a single test message
//   - /api/messages/preview  → render a template against a vendor
//   - whatsapp.js worker drains the queue (handles rate limits, quiet hours, retry)
// =============================================================

const TEMPLATE_VARS = ['{{name}}', '{{company}}', '{{phone}}', '{{email}}'];

const fmtMsgWhen = (ms) => {
  if (!ms) return '—';
  const d = Math.floor((Date.now() - ms) / 60000);
  if (d < 1) return 'just now';
  if (d < 60) return d + 'm ago';
  if (d < 60 * 24) return Math.floor(d / 60) + 'h ago';
  return new Date(ms).toLocaleDateString();
};

// ── Template editor (used inline by the Templates page) ──────────────────
const TemplateEditor = ({ template, onSaved, onCancel }) => {
  const isNew = !template || !template.id;
  const [name, setName] = React.useState(template?.name || '');
  const [body, setBody] = React.useState(template?.body || '');
  const [category, setCategory] = React.useState(template?.category || '');
  const [mediaPath, setMediaPath] = React.useState(template?.media_path || null);
  const [mediaPreview, setMediaPreview] = React.useState(null); // local blob URL when file selected but not uploaded
  const [pendingFile, setPendingFile] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const bodyRef = React.useRef(null);

  React.useEffect(() => {
    setName(template?.name || '');
    setBody(template?.body || '');
    setCategory(template?.category || '');
    setMediaPath(template?.media_path || null);
    setPendingFile(null);
    setMediaPreview(null);
  }, [template?.id]);

  const insertAtCursor = (text) => {
    const ta = bodyRef.current;
    if (!ta) { setBody(body + text); return; }
    const start = ta.selectionStart || 0;
    const end = ta.selectionEnd || 0;
    const next = body.slice(0, start) + text + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(start + text.length, start + text.length); });
  };
  const insertVar = (v) => insertAtCursor(v);
  const insertLink = () => {
    const url = prompt('Website / link URL (e.g. https://petscare.club):', 'https://');
    if (!url || !/^https?:\/\//i.test(url)) {
      if (url) alert('URL must start with http:// or https://');
      return;
    }
    const label = prompt('Optional label for the link (press OK to skip):', '');
    // WhatsApp doesn't support markdown-style links — it just auto-detects URLs.
    // So we insert "<Label>: <URL>" or just the bare URL on its own line.
    const snippet = label ? `${label}: ${url}` : url;
    insertAtCursor((body && !body.endsWith('\n') ? '\n' : '') + snippet);
  };

  const handleFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setPendingFile(file);
    setMediaPreview(URL.createObjectURL(file));
  };

  const save = async () => {
    if (!name.trim() || !body.trim()) { alert('Name and body are required.'); return; }
    setSaving(true);
    try {
      let id = template?.id;
      if (isNew) {
        const r = await api('/api/templates', { method: 'POST', body: { name: name.trim(), body, category: category || null } });
        id = r.id;
      } else {
        await api(`/api/templates/${id}`, { method: 'PUT', body: { name: name.trim(), body, category: category || null } });
      }
      if (pendingFile) {
        const fd = new FormData();
        fd.append('file', pendingFile);
        const res = await fetch(`/api/templates/${id}/media`, { method: 'POST', body: fd });
        if (!res.ok) throw new Error('Media upload failed');
      }
      onSaved && onSaved(id);
    } catch (e) {
      alert('Save failed: ' + (e?.message || e));
    }
    setSaving(false);
  };

  const removeMedia = async () => {
    if (!template?.id) { setPendingFile(null); setMediaPreview(null); return; }
    if (!confirm('Remove the attached image?')) return;
    await api(`/api/templates/${template.id}/media`, { method: 'DELETE' });
    setMediaPath(null);
    setPendingFile(null);
    setMediaPreview(null);
    onSaved && onSaved(template.id);
  };

  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <div className="card-title">{isNew ? 'New template' : 'Edit template'}</div>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn sm" onClick={onCancel}>Cancel</button>
          <button className="btn sm primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : (isNew ? 'Create' : 'Save')}</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <Field label="Template name *">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Intro · Pet Stores" />
        </Field>
        <Field label="Category">
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. outreach, follow-up, promo" list="tpl-categories" />
        </Field>
      </div>

      <Field label="Message body *">
        <div className="row" style={{ gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', alignSelf: 'center', marginRight: 4 }}>Insert</span>
          {TEMPLATE_VARS.map((v) => (
            <button key={v} type="button" className="chip" onClick={() => insertVar(v)} style={{ fontFamily: 'monospace', fontSize: 11 }}>{v}</button>
          ))}
          <button type="button" className="chip" onClick={insertLink} title="Insert a website / WhatsApp / booking URL — auto-links on the recipient's phone" style={{ fontSize: 11 }}>
            <Icon name="attach" size={11} /> Link
          </button>
        </div>
        <textarea
          ref={bodyRef}
          rows={7}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={'Hi {{name}},\n\nThis is Arju from … We help pet stores like {{company}} with …\n\nLink: https://example.com'}
          style={{ width: '100%', padding: 10, border: '1px solid var(--rule)', borderRadius: 6, background: 'var(--paper)', fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }}
        />
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, lineHeight: 1.6 }}>
          Variables in curly braces (<code>{`{{name}}`}</code>) are filled per recipient.<br />
          Formatting: <strong>*bold*</strong>, <em>_italic_</em>, <code>~strike~</code>.<br />
          🔗 <strong>Links:</strong> just paste any <code>https://…</code> URL — WhatsApp auto-detects and makes it tappable. Use the <strong>Link</strong> chip above to insert one with a label.
        </div>
      </Field>

      <Field label="Image / media (optional)">
        {(mediaPreview || mediaPath) ? (
          <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
            <img
              src={mediaPreview || (`/api/templates/${template?.id}/media-preview`)}
              alt="attachment"
              style={{ maxWidth: 160, maxHeight: 120, borderRadius: 6, border: '1px solid var(--rule)' }}
              onError={(e) => { e.target.style.display = 'none'; }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12 }}>{pendingFile ? pendingFile.name + ' (will upload on save)' : 'Image attached'}</div>
              <button className="btn sm" style={{ marginTop: 6 }} onClick={removeMedia}>Remove</button>
            </div>
          </div>
        ) : (
          <input type="file" accept="image/*,video/*,application/pdf" onChange={handleFile} />
        )}
      </Field>
    </div>
  );
};

// ── Templates page ──────────────────────────────────────────────────────
const Templates = () => {
  const [list, setList] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [editing, setEditing] = React.useState(null);
  const [stats, setStats] = React.useState([]);
  const [q, setQ] = React.useState('');
  const [cat, setCat] = React.useState('all');
  const sel = useMultiSelect();

  const load = React.useCallback(() => {
    setLoading(true);
    Promise.all([
      api('/api/templates').then(setList).catch(() => setList([])),
      api('/api/messages/stats/by-template').then(setStats).catch(() => setStats([])),
    ]).finally(() => setLoading(false));
  }, []);
  React.useEffect(load, [load]);

  const cats = Array.from(new Set(list.map((t) => t.category).filter(Boolean)));
  const filtered = list.filter((t) => {
    if (cat !== 'all' && t.category !== cat) return false;
    if (q && !((t.name || '') + ' ' + (t.body || '') + ' ' + (t.category || '')).toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const findStat = (id) => stats.find((s) => s.template_id === id) || {};

  const remove = async (t) => {
    if (!confirm(`Delete template "${t.name}"? This won't undo any campaigns already sent.`)) return;
    await api(`/api/templates/${t.id}`, { method: 'DELETE' });
    load();
  };

  const filteredIds = filtered.map((t) => t.id);
  const deleteSelected = async () => {
    const ids = [...sel.selected];
    const r = await window.bulkRun({ url: '/api/templates/delete-bulk', ids, confirmMsg: `Delete ${ids.length} template${ids.length > 1 ? 's' : ''}?` });
    if (!r) return;
    alert(`${r.deleted} deleted.`);
    sel.clear();
    load();
  };

  return (
    <div className="page slide-up">
      <div className="page-h">
        <div>
          <div className="page-eyebrow">{list.length} templates</div>
          <h1 className="page-title">Message <em>templates</em></h1>
          <div className="page-sub">Re-usable WhatsApp messages with variables, links, and media. Use them when sending to one lead or in bulk.</div>
        </div>
        <div className="page-actions">
          {filtered.length > 0 && <button className="btn" onClick={() => sel.toggleAll(filteredIds)}><Icon name="check" size={12} />{sel.allSelected(filteredIds) ? 'Unselect all' : 'Select all'}</button>}
          <button className="btn" onClick={load}><Icon name="bolt" size={12} />Refresh</button>
          <button className="btn primary" onClick={() => setEditing({ new: true })}><Icon name="plus" size={12} />New template</button>
        </div>
      </div>

      {editing && (
        <div style={{ marginBottom: 16 }}>
          <TemplateEditor
            template={editing.new ? null : editing}
            onCancel={() => setEditing(null)}
            onSaved={() => { setEditing(null); load(); }}
          />
        </div>
      )}

      <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <div className="row" style={{ background: 'var(--card)', border: '1px solid var(--rule)', borderRadius: 6, padding: '4px 10px', gap: 6, flex: 1, maxWidth: 320 }}>
          <Icon name="search" size={14} style={{ color: 'var(--muted)' }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search templates…" style={{ border: 0, background: 'transparent', flex: 1, padding: '4px 0', outline: 'none' }} />
        </div>
        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          <button className={'chip ' + (cat === 'all' ? 'accent' : '')} onClick={() => setCat('all')}>All</button>
          {cats.map((c) => <button key={c} className={'chip ' + (cat === c ? 'accent' : '')} onClick={() => setCat(c)}>{c}</button>)}
        </div>
      </div>

      {loading && <div style={{ padding: 24, color: 'var(--muted)', fontSize: 12 }}>Loading…</div>}
      {!loading && filtered.length === 0 && (
        <div className="card" style={{ padding: 48, textAlign: 'center', color: 'var(--muted)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📩</div>
          <div className="serif" style={{ fontSize: 18, marginBottom: 4 }}>No templates yet.</div>
          <div style={{ fontSize: 13, marginBottom: 12 }}>Create your first one to start sending consistent WhatsApp messages.</div>
          <button className="btn primary" onClick={() => setEditing({ new: true })}><Icon name="plus" size={12} />New template</button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
        {filtered.map((t) => {
          const s = findStat(t.id);
          return (
            <div key={t.id} className={'card' + (sel.selected.has(t.id) ? ' is-selected' : '')} style={{ padding: 14, display: 'flex', flexDirection: 'column' }}>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6, gap: 8 }}>
                <input type="checkbox" checked={sel.selected.has(t.id)} onChange={() => sel.toggle(t.id)} title="Select" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }} className="trunc">{t.name}</div>
                  {t.category && <span className="chip" style={{ fontSize: 10 }}>{t.category}</span>}
                </div>
                <div className="row" style={{ gap: 4 }}>
                  <button className="btn sm ghost" title="Edit" onClick={() => setEditing(t)}><Icon name="note" size={12} /></button>
                  <button className="btn sm ghost" title="Delete" onClick={() => remove(t)}><Icon name="x" size={12} /></button>
                </div>
              </div>
              {t.media_path && (
                <div style={{ marginBottom: 6, fontSize: 11, color: 'var(--muted)' }}>
                  <Icon name="attach" size={11} /> Image attached
                </div>
              )}
              <div style={{
                fontSize: 12, color: 'var(--ink-3)', whiteSpace: 'pre-wrap',
                background: 'var(--paper-2)', padding: 10, borderRadius: 6, flex: 1, marginBottom: 8,
                maxHeight: 140, overflow: 'hidden', position: 'relative',
              }}>{t.body}</div>
              <div className="row" style={{ gap: 8, fontSize: 11, color: 'var(--muted)', justifyContent: 'space-between', borderTop: '1px solid var(--rule-2)', paddingTop: 8 }}>
                <span>Sent {s.sent || 0} · Delivered {s.delivered_or_better || 0} · Read {s.read_count || 0}</span>
                <button className="btn sm" onClick={() => window.openSendMessage && window.openSendMessage({ template_id: t.id })}>
                  <Icon name="send" size={11} />Send
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <datalist id="tpl-categories">
        {cats.map((c) => <option key={c} value={c} />)}
      </datalist>
      <BulkBar count={sel.selected.size} onClear={sel.clear} actions={[{ label: 'Delete', icon: 'trash', variant: 'danger', onClick: deleteSelected }]} />
    </div>
  );
};

// ── SendMessageModal ────────────────────────────────────────────────────
// Replaces the old ComposeModal. Handles single or bulk send, template picker,
// live preview against the first recipient's data, and image attachment.
const SendMessageModal = ({ open, prefill, onClose }) => {
  const [templates, setTemplates] = React.useState([]);
  const [templateId, setTemplateId] = React.useState('');
  const [body, setBody] = React.useState('');
  const [vendorIds, setVendorIds] = React.useState([]);
  const [recipientFilter, setRecipientFilter] = React.useState('');
  const [cityFilter, setCityFilter] = React.useState('all');
  const [campaignName, setCampaignName] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [waStatus, setWaStatus] = React.useState(null);
  const [savedAsTpl, setSavedAsTpl] = React.useState(false);
  const [savingTpl, setSavingTpl] = React.useState(false);
  const [scheduleEnabled, setScheduleEnabled] = React.useState(false);
  const [scheduleAt, setScheduleAt] = React.useState('');

  // Initialize from prefill (e.g. opened from a contact row, a template card, etc.)
  React.useEffect(() => {
    if (!open) return;
    setSavedAsTpl(false);
    setSending(false);
    setCampaignName('');
    setScheduleEnabled(false);
    setScheduleAt('');
    setCityFilter('all');
    api('/api/templates').then(setTemplates).catch(() => setTemplates([]));
    setWaStatus(window.WA_STATUS || null);
    if (prefill?.vendor_id) setVendorIds([prefill.vendor_id]);
    else if (prefill?.vendor_ids) setVendorIds(prefill.vendor_ids);
    else setVendorIds([]);
    if (prefill?.template_id) setTemplateId(String(prefill.template_id));
    else setTemplateId('');
    if (prefill?.body) setBody(prefill.body);
    else setBody('');
  }, [open, prefill?.vendor_id, prefill?.template_id]);

  // When template changes, auto-populate body so users see what they're sending.
  React.useEffect(() => {
    if (!templateId) return;
    const tpl = templates.find((t) => String(t.id) === String(templateId));
    if (tpl) setBody(tpl.body);
  }, [templateId, templates]);

  // Live preview: render the body against the first recipient's data via the API,
  // so the placeholder logic matches what gets sent.
  const [preview, setPreview] = React.useState('');
  React.useEffect(() => {
    if (!body) { setPreview(''); return; }
    const vid = vendorIds[0] || null;
    api('/api/messages/preview', { method: 'POST', body: { vendor_id: vid, body } })
      .then((r) => setPreview(r.rendered || ''))
      .catch(() => setPreview(body));
  }, [body, vendorIds[0]]);

  const contacts = window.CONTACTS || [];
  const allCities = React.useMemo(() => {
    const m = new Map();
    contacts.forEach((c) => { if (c.city) m.set(c.city, (m.get(c.city) || 0) + 1); });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [contacts]);
  const filteredContacts = contacts.filter((c) => {
    if (cityFilter !== 'all' && (c.city || '') !== cityFilter) return false;
    if (!recipientFilter) return true;
    const q = recipientFilter.toLowerCase();
    return ((c.name || '') + ' ' + (c.phone || '') + ' ' + (c.city || '')).toLowerCase().includes(q);
  });

  const toggleVendor = (id) => setVendorIds((vs) => vs.includes(id) ? vs.filter((x) => x !== id) : [...vs, id]);
  const selectAllVisible = () => setVendorIds(Array.from(new Set([...vendorIds, ...filteredContacts.map((c) => c.raw_id)])));
  const clearAll = () => setVendorIds([]);

  const tpl = templates.find((t) => String(t.id) === String(templateId)) || null;

  const send = async () => {
    if (!body.trim()) { alert('Message body required.'); return; }
    if (vendorIds.length === 0) { alert('Pick at least one recipient.'); return; }

    let scheduledAtMs = null;
    if (scheduleEnabled) {
      if (!scheduleAt) { alert('Pick a date & time to schedule.'); return; }
      scheduledAtMs = new Date(scheduleAt).getTime();
      if (!scheduledAtMs || scheduledAtMs < Date.now() + 30_000) {
        alert('Scheduled time must be at least 30 seconds in the future.'); return;
      }
    } else if (!waStatus?.ready) {
      if (!confirm('WhatsApp is not currently linked. Messages will be queued and send once you link via the QR code. Continue?')) return;
    }

    setSending(true);
    try {
      if (vendorIds.length === 1) {
        await api('/api/messages/send', {
          method: 'POST',
          body: { vendor_id: vendorIds[0], body, template_id: templateId || null, scheduled_at: scheduledAtMs },
        });
      } else {
        await api('/api/messages/bulk', {
          method: 'POST',
          body: {
            vendor_ids: vendorIds,
            body,
            template_id: templateId || null,
            campaign_name: campaignName || (tpl ? `${tpl.name} · ${new Date().toLocaleDateString()}` : `Bulk · ${new Date().toLocaleDateString()}`),
            scheduled_at: scheduledAtMs,
          },
        });
      }
      await refreshStore();
      onClose();
      const label = scheduledAtMs ? `Scheduled ${vendorIds.length} message${vendorIds.length === 1 ? '' : 's'} for ${new Date(scheduledAtMs).toLocaleString()}.` : `Queued ${vendorIds.length} message${vendorIds.length === 1 ? '' : 's'}.`;
      alert(label);
    } catch (e) {
      alert('Send failed: ' + (e?.message || e));
    }
    setSending(false);
  };

  const saveAsTemplate = async () => {
    const name = prompt('Save as template — name?');
    if (!name) return;
    setSavingTpl(true);
    try {
      const r = await api('/api/templates', { method: 'POST', body: { name, body } });
      setTemplateId(String(r.id));
      const list = await api('/api/templates'); setTemplates(list);
      setSavedAsTpl(true);
    } catch (e) {
      alert('Save failed: ' + (e?.message || e));
    }
    setSavingTpl(false);
  };

  const sendTest = async () => {
    if (!body.trim()) { alert('Body required.'); return; }
    const to = prompt('Send test to which phone? (with country code, e.g. +91…)');
    if (!to) return;
    try {
      await api('/api/messages/test', { method: 'POST', body: { to_phone: to, body } });
      alert('Test queued. It will send within a few seconds.');
    } catch (e) {
      alert('Test failed: ' + (e?.message || e));
    }
  };

  if (!open) return null;
  const isBulk = vendorIds.length > 1;

  return (
    <Modal open={open} onClose={onClose} title="Send WhatsApp message" width={780} footer={
      <>
        <div className="row" style={{ gap: 6, fontSize: 11, color: waStatus?.ready ? 'var(--sage)' : 'var(--muted)' }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: waStatus?.ready ? '#588157' : '#9A9690' }}></span>
          <span>{waStatus?.ready ? 'WhatsApp linked' : 'WhatsApp offline — messages will queue'}</span>
        </div>
        <div className="spacer" />
        <button className="btn sm" onClick={sendTest}>Send test to my phone</button>
        <button className="btn sm" onClick={saveAsTemplate} disabled={savingTpl || savedAsTpl || !body.trim()}>{savedAsTpl ? 'Saved ✓' : (savingTpl ? 'Saving…' : 'Save as template')}</button>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={send} disabled={sending || vendorIds.length === 0 || !body.trim()}>
          <Icon name={scheduleEnabled ? 'calendar' : 'send'} size={12} />
          {sending ? (scheduleEnabled ? 'Scheduling…' : 'Queueing…') : `${scheduleEnabled ? 'Schedule' : 'Send'} to ${vendorIds.length || 0}`}
        </button>
      </>
    }>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16 }}>
        {/* LEFT — compose */}
        <div style={{ minWidth: 0 }}>
          <Field label="Template (optional)">
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">— write your own —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}{t.category ? ` · ${t.category}` : ''}</option>
              ))}
            </select>
          </Field>
          <Field label="Message body *">
            <div className="row" style={{ gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
              {TEMPLATE_VARS.map((v) => (
                <button key={v} type="button" className="chip" style={{ fontFamily: 'monospace', fontSize: 11 }} onClick={() => setBody((b) => b + v)}>{v}</button>
              ))}
              <button
                type="button"
                className="chip"
                style={{ fontSize: 11 }}
                onClick={() => {
                  const url = prompt('Website / link URL (e.g. https://petscare.club):', 'https://');
                  if (!url || !/^https?:\/\//i.test(url)) { if (url) alert('URL must start with http:// or https://'); return; }
                  const label = prompt('Optional label (press OK to skip):', '');
                  const snippet = label ? `${label}: ${url}` : url;
                  setBody((b) => (b && !b.endsWith('\n') ? b + '\n' : b) + snippet);
                }}
                title="Insert a clickable URL"
              >
                <Icon name="attach" size={11} /> Link
              </button>
            </div>
            <textarea
              rows={9}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={'Hi {{name}},\n\nThis is Arju from … We help pet stores like {{company}} with …\n\nLink: https://example.com'}
              style={{ width: '100%', padding: 10, border: '1px solid var(--rule)', borderRadius: 6, background: 'var(--paper)', fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }}
            />
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
              <strong>*bold*</strong>, _italic_, ~strike~. URLs become tappable. Use the chips to insert variables.
            </div>
          </Field>
          {tpl && tpl.media_path && (
            <div className="card" style={{ padding: 8, fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>
              <Icon name="attach" size={11} /> This template has an attached image — it will be sent automatically.
            </div>
          )}
          {isBulk && (
            <Field label="Campaign name (saved for tracking)">
              <input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} placeholder={tpl ? `${tpl.name} · ${new Date().toLocaleDateString()}` : 'My campaign'} />
            </Field>
          )}
          <Field label="Send timing">
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <button type="button" className={'chip ' + (!scheduleEnabled ? 'accent' : '')} onClick={() => setScheduleEnabled(false)}>Send now</button>
              <button type="button" className={'chip ' + (scheduleEnabled ? 'accent' : '')} onClick={() => setScheduleEnabled(true)}>Schedule for later</button>
            </div>
            {scheduleEnabled && (
              <input
                type="datetime-local"
                value={scheduleAt}
                onChange={(e) => setScheduleAt(e.target.value)}
                style={{ marginTop: 8, width: '100%' }}
                min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
              />
            )}
          </Field>
        </div>

        {/* RIGHT — preview + recipients */}
        <div style={{ minWidth: 0 }}>
          <Field label={`Preview ${vendorIds[0] ? '· using ' + (contacts.find((c) => c.raw_id === vendorIds[0])?.name || 'first recipient') : '· sample data'}`}>
            <div style={{
              background: '#dcf8c6', color: '#111', padding: '10px 12px', borderRadius: '8px 8px 8px 2px',
              fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap', minHeight: 80, border: '1px solid var(--rule-2)',
              wordBreak: 'break-word', overflowWrap: 'anywhere', maxWidth: '100%',
            }} dangerouslySetInnerHTML={{
              __html: (preview || body || '<span style="color:#888">Type a message or pick a template…</span>')
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
                .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
                .replace(/_([^_\n]+)_/g, '<i>$1</i>')
                .replace(/~([^~\n]+)~/g, '<s>$1</s>')
                // URL chars are already entity-escaped above (no raw <>"'), so the
                // captured URL cannot break out of the href attribute it's placed in.
                .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:#075e54">$1</a>'),
            }} />
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
              {body.length} chars · {vendorIds.length} recipient{vendorIds.length === 1 ? '' : 's'}
            </div>
          </Field>

          <Field label={`Recipients · ${vendorIds.length} selected`}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
              <select value={cityFilter} onChange={(e) => setCityFilter(e.target.value)} style={{ flex: '0 0 auto', fontSize: 12 }} title="Filter by city">
                <option value="all">All cities ({contacts.length})</option>
                {allCities.map(([city, count]) => <option key={city} value={city}>{city} ({count})</option>)}
              </select>
              <input
                value={recipientFilter}
                onChange={(e) => setRecipientFilter(e.target.value)}
                placeholder="Filter…"
                style={{ flex: '1 1 100px', minWidth: 0, padding: '4px 8px', border: '1px solid var(--rule)', borderRadius: 4, fontSize: 12, background: 'var(--paper)' }}
              />
              <button className="btn sm ghost" onClick={selectAllVisible} title="Add all currently visible to selection">+ visible ({filteredContacts.length})</button>
              <button className="btn sm ghost" onClick={clearAll}>Clear</button>
            </div>
            <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--rule)', borderRadius: 6, padding: 4 }}>
              {filteredContacts.slice(0, 200).map((c) => {
                const placeholder = !c.phone || String(c.phone).startsWith('na-');
                return (
                  <label
                    key={c.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'auto minmax(0, 1fr) auto',
                      gap: 6, padding: '4px 6px', alignItems: 'center',
                      opacity: placeholder ? 0.5 : 1,
                      cursor: placeholder ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      disabled={placeholder}
                      checked={vendorIds.includes(c.raw_id)}
                      onChange={() => toggleVendor(c.raw_id)}
                    />
                    <span style={{ fontSize: 12, minWidth: 0 }} className="trunc" title={c.name}>
                      {c.name}{c.city && <span style={{ color: 'var(--muted)' }}> · {c.city}</span>}
                    </span>
                    <span className="mono" style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{placeholder ? 'no phone' : ('+' + String(c.phone).replace(/\D/g, ''))}</span>
                  </label>
                );
              })}
              {filteredContacts.length > 200 && <div style={{ padding: 6, fontSize: 11, color: 'var(--muted)' }}>+{filteredContacts.length - 200} more · narrow the filter</div>}
              {filteredContacts.length === 0 && <div style={{ padding: 6, fontSize: 11, color: 'var(--muted)' }}>No matches.</div>}
            </div>
          </Field>
        </div>
      </div>
    </Modal>
  );
};

// =============================================================
// Messages / Outbox — every WhatsApp message: sent, delivered, read, replied,
// queued, scheduled, failed. Filterable + searchable + click-to-open thread.
// =============================================================
const STATUS_META = {
  queued:    { label: 'Queued',    color: '#9A9690' },
  scheduled: { label: 'Scheduled', color: '#3D5A80' },
  sending:   { label: 'Sending',   color: '#D4A373' },
  sent:      { label: 'Sent',      color: '#A8A29E' },
  delivered: { label: 'Delivered', color: '#588157' },
  read:      { label: 'Read',      color: '#075e54' },
  failed:    { label: 'Failed',    color: '#C9184A' },
  cancelled: { label: 'Cancelled', color: '#5C5C5C' },
};

const Messages = () => {
  const [rows, setRows] = React.useState([]);
  const [summary, setSummary] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [direction, setDirection] = React.useState('all');
  const [status, setStatus] = React.useState('all');
  const [range, setRange] = React.useState('all');
  const [campaign, setCampaign] = React.useState('all');
  const [q, setQ] = React.useState('');
  const [campaigns, setCampaigns] = React.useState([]);
  const sel = useMultiSelect();

  const reload = React.useCallback(() => {
    setLoading(true);
    Promise.all([
      api('/api/messages?limit=500').then(setRows).catch(() => setRows([])),
      api('/api/messages/stats/summary').then(setSummary).catch(() => setSummary(null)),
      api('/api/campaigns').then(setCampaigns).catch(() => setCampaigns([])),
    ]).finally(() => setLoading(false));
  }, []);
  React.useEffect(() => {
    reload();
    const t = setInterval(reload, 15000); // gentle auto-refresh so status changes flow in
    return () => clearInterval(t);
  }, [reload]);

  const startOf = (kind) => {
    const d = new Date();
    if (kind === 'today') { d.setHours(0,0,0,0); return d.getTime(); }
    if (kind === 'week')  { d.setDate(d.getDate() - d.getDay()); d.setHours(0,0,0,0); return d.getTime(); }
    if (kind === 'month') { d.setDate(1); d.setHours(0,0,0,0); return d.getTime(); }
    return 0;
  };
  const since = startOf(range);

  const filtered = rows.filter((r) => {
    if (direction !== 'all' && r.direction !== direction) return false;
    if (status !== 'all' && r.status !== status) return false;
    if (campaign !== 'all' && String(r.campaign_id || '') !== String(campaign)) return false;
    if (since && r.created_at < since) return false;
    if (q && !((r.vendor_name || '') + ' ' + (r.vendor_phone || '') + ' ' + (r.body || '')).toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  // Per-vendor reply counts so user can see "who replied".
  const replyCountByVendor = React.useMemo(() => {
    const m = new Map();
    rows.forEach((r) => { if (r.direction === 'in') m.set(r.vendor_id, (m.get(r.vendor_id) || 0) + 1); });
    return m;
  }, [rows]);

  const sentCountByVendor = React.useMemo(() => {
    const m = new Map();
    rows.forEach((r) => { if (r.direction === 'out') m.set(r.vendor_id, (m.get(r.vendor_id) || 0) + 1); });
    return m;
  }, [rows]);

  const cancelMsg = async (id) => {
    if (!confirm('Cancel this message? It won\'t be delivered.')) return;
    // The DB allows direct UPDATE since we don't have a dedicated route — use the inbox/reply or write a small route.
    // For now just delete. Backend deletes are guarded.
    await fetch(`/api/messages/${id}`, { method: 'DELETE' }).catch(() => {});
    reload();
  };

  // Only queued/scheduled messages can be cancelled — selection is limited to those.
  const cancellable = filtered.filter((r) => r.status === 'queued' || r.status === 'scheduled');
  const cancellableIds = cancellable.map((r) => r.id);
  const cancelSelected = async () => {
    const ids = [...sel.selected];
    const r = await window.bulkRun({ url: '/api/messages/delete-bulk', ids, confirmMsg: `Cancel ${ids.length} message${ids.length > 1 ? 's' : ''}? They won't be delivered.` });
    if (!r) return;
    alert(`${r.deleted} cancelled${r.skipped ? `, ${r.skipped} skipped (already sent)` : ''}.`);
    sel.clear();
    reload();
  };

  return (
    <div className="page slide-up">
      <div className="page-h">
        <div>
          <div className="page-eyebrow">{rows.length} total · {filtered.length} matching</div>
          <h1 className="page-title">Messages &amp; <em>outbox</em></h1>
          <div className="page-sub">Every WhatsApp message sent or received — status, replies, scheduled deliveries.</div>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={reload}><Icon name="bolt" size={12} />Refresh</button>
          <button className="btn primary" onClick={() => window.openSendMessage && window.openSendMessage({})}><Icon name="send" size={12} />Send WhatsApp</button>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginBottom: 12 }}>
        {[
          { l: 'Sent today',  v: summary?.sent_today || 0,  accent: '#E07A5F', filter: () => { setStatus('all'); setDirection('out'); setRange('today'); } },
          { l: 'Sent total',  v: summary?.sent_total || 0,  accent: '#3D5A80', filter: () => { setStatus('all'); setDirection('out'); setRange('all'); } },
          { l: 'Delivered',   v: summary?.delivered || 0,   accent: '#588157', filter: () => { setStatus('delivered'); setDirection('out'); setRange('all'); } },
          { l: 'Read',        v: summary?.read_count || 0,  accent: '#075e54', filter: () => { setStatus('read'); setDirection('out'); setRange('all'); } },
          { l: 'Replies',     v: summary?.replies || 0,     accent: '#6B4E71', filter: () => { setStatus('all'); setDirection('in'); setRange('all'); } },
          { l: 'Failed',      v: summary?.failed || 0,      accent: '#C9184A', filter: () => { setStatus('failed'); setDirection('out'); setRange('all'); } },
        ].map((k, i) => (
          <div key={i} className="card" style={{ padding: 12, borderTop: '2px solid ' + k.accent, cursor: 'pointer' }} onClick={k.filter}>
            <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{k.l}</div>
            <div className="serif" style={{ fontSize: 24, marginTop: 4 }}>{k.v}</div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="card" style={{ padding: 12, marginBottom: 12 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="row" style={{ background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 6, padding: '4px 10px', gap: 6, flex: 1, maxWidth: 320 }}>
            <Icon name="search" size={14} style={{ color: 'var(--muted)' }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search lead, phone, body…" style={{ border: 0, background: 'transparent', flex: 1, padding: '4px 0', outline: 'none' }} />
          </div>
          <div className="row" style={{ gap: 4 }}>
            {[['all','All'],['out','Outgoing'],['in','Replies']].map(([v, l]) => (
              <button key={v} className={'chip ' + (direction === v ? 'accent' : '')} onClick={() => setDirection(v)}>{l}</button>
            ))}
          </div>
          <div className="row" style={{ gap: 4 }}>
            {[['all','All time'],['today','Today'],['week','This week'],['month','This month']].map(([v, l]) => (
              <button key={v} className={'chip ' + (range === v ? 'accent' : '')} onClick={() => setRange(v)}>{l}</button>
            ))}
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ fontSize: 12 }}>
            <option value="all">All statuses</option>
            {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select value={campaign} onChange={(e) => setCampaign(e.target.value)} style={{ fontSize: 12 }}>
            <option value="all">All campaigns</option>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ maxHeight: 'calc(100vh - 380px)', overflow: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 32 }}><input type="checkbox" checked={cancellableIds.length > 0 && cancellableIds.every((id) => sel.selected.has(id))} onChange={() => sel.toggleAll(cancellableIds)} title="Select cancellable messages" /></th>
                <th style={{ width: 48, textAlign: 'right' }}>S.No</th>
                <th>When</th>
                <th>Lead</th>
                <th>Dir</th>
                <th>Status</th>
                <th>Body</th>
                <th className="num" title="Total messages sent to this lead">Sent</th>
                <th className="num" title="Total replies from this lead">Replies</th>
                <th>Campaign</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={11} style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>Loading…</td></tr>}
              {!loading && filtered.length === 0 && <tr><td colSpan={11} style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>No messages match these filters.</td></tr>}
              {filtered.map((r, i) => {
                const m = STATUS_META[r.status] || { label: r.status || '?', color: '#7A7670' };
                const camp = campaigns.find((c) => c.id === r.campaign_id);
                const isReply = r.direction === 'in';
                const canCancel = r.status === 'queued' || r.status === 'scheduled';
                const sched = r.status === 'scheduled' && r.scheduled_at ? new Date(r.scheduled_at).toLocaleString() : null;
                return (
                  <tr key={r.id} className={sel.selected.has(r.id) ? 'is-selected' : ''}>
                    <td>{canCancel && <input type="checkbox" checked={sel.selected.has(r.id)} onChange={() => sel.toggle(r.id)} />}</td>
                    <td className="mono" style={{ textAlign: 'right', color: 'var(--muted)', fontSize: 11 }}>{i + 1}</td>
                    <td className="mono" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                      {fmtMsgWhen(r.created_at)}
                      {sched && <div style={{ color: '#3D5A80', fontSize: 10 }}>→ {sched}</div>}
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 12 }} className="trunc">{r.vendor_name || '—'}</div>
                      <div className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>+{String(r.vendor_phone || '').replace(/\D/g, '')}</div>
                    </td>
                    <td>{isReply ? <span className="chip" style={{ fontSize: 10, color: '#6B4E71' }}>← reply</span> : <span className="chip" style={{ fontSize: 10 }}>→ out</span>}</td>
                    <td>
                      <span className="chip" style={{ fontSize: 10, borderLeft: '3px solid ' + m.color, paddingLeft: 8 }}>
                        {m.label}
                        {r.status === 'read' && <Icon name="check" size={10} style={{ marginLeft: 4 }} />}
                      </span>
                      {r.error && <div style={{ fontSize: 10, color: '#C9184A', marginTop: 2 }} title={r.error} className="trunc">{r.error}</div>}
                    </td>
                    <td><div style={{ fontSize: 11, color: 'var(--ink-3)', maxWidth: 280, whiteSpace: 'pre-wrap', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{r.body || '—'}</div></td>
                    <td className="num" style={{ fontSize: 11 }}>{sentCountByVendor.get(r.vendor_id) || 0}</td>
                    <td className="num" style={{ fontSize: 11, color: replyCountByVendor.get(r.vendor_id) ? '#6B4E71' : 'var(--muted)' }}>{replyCountByVendor.get(r.vendor_id) || 0}</td>
                    <td><span className="chip" style={{ fontSize: 10 }}>{camp ? camp.name : '—'}</span></td>
                    <td>
                      {(r.status === 'queued' || r.status === 'scheduled') && (
                        <button className="btn sm ghost" title="Cancel before send" onClick={() => cancelMsg(r.id)}><Icon name="x" size={11} /></button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <BulkBar count={sel.selected.size} onClear={sel.clear} actions={[{ label: 'Cancel', icon: 'x', variant: 'danger', onClick: cancelSelected }]} />
    </div>
  );
};

window.Templates = Templates;
window.Messages = Messages;
window.SendMessageModal = SendMessageModal;
