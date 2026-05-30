// =============================================================
// Modal shell + creation forms (contact, deal, task, company,
// ticket, automation, event, campaign) + WhatsApp QR modal.
// Each "open*" function is exposed on window so any view can
// trigger the relevant modal.
// =============================================================

const Modal = ({ open, onClose, title, children, footer, width = 520 }) => {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: width }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <div className="card-title" style={{ fontSize: 18 }}>{title}</div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
};

const Field = ({ label, children }) => (
  <div className="field">
    <label>{label}</label>
    {children}
  </div>
);

// ---- New Contact -------------------------------------------------------
const NewContactModal = ({ open, onClose }) => {
  const blank = { name: '', phone: '', title: '', address: '', city: '', category: '', hours: '', email: '', tags: '' };
  const [form, setForm] = React.useState(blank);
  React.useEffect(() => { if (open) setForm(blank); }, [open]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    if (!form.name || !form.phone) { alert('Store name and phone are required'); return; }
    const body = {
      name: form.name,
      company: form.name, // store name doubles as company in the list view
      phone: form.phone,
      title: form.title || null,
      address: form.address || null,
      city: form.city || null,
      category: form.category || null,
      hours: form.hours || null,
      email: form.email || null,
      tags: form.tags || null,
    };
    try {
      await api('/api/contacts', { method: 'POST', body });
    } catch (e) {
      alert('Create failed: ' + (e && e.message ? e.message : e));
      return;
    }
    await refreshStore();
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="New contact" footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save}>Create</button>
      </>
    }>
      <Field label="Store name *"><input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Petvet24 Veterinary Clinic" /></Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Phone *"><input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+91 98765 43210" /></Field>
        <Field label="Person"><input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Who you spoke with" /></Field>
      </div>
      <Field label="Address"><input value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="Shop / sector / locality" /></Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="City"><input value={form.city} onChange={(e) => set('city', e.target.value)} placeholder="e.g. Chandigarh" /></Field>
        <Field label="Type"><input value={form.category} onChange={(e) => set('category', e.target.value)} placeholder="e.g. Veterinary Clinic" /></Field>
      </div>
      <Field label="Hours"><input value={form.hours} onChange={(e) => set('hours', e.target.value)} placeholder="e.g. 9:00 AM - 9:00 PM, or Open 24 hours" /></Field>
      <details style={{ marginTop: 6 }}>
        <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--muted)' }}>Optional · email & tags</summary>
        <div style={{ marginTop: 8 }}>
          <Field label="Email"><input value={form.email} onChange={(e) => set('email', e.target.value)} /></Field>
          <Field label="Tags (comma-separated)"><input value={form.tags} onChange={(e) => set('tags', e.target.value)} /></Field>
        </div>
      </details>
    </Modal>
  );
};

// ---- New Company -------------------------------------------------------
const NewCompanyModal = ({ open, onClose }) => {
  const [form, setForm] = React.useState({ name: '', domain: '', industry: '', size: '', city: '', tier: 'Starter', mrr: 0, color: '#7A7670' });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    if (!form.name) { alert('Name required'); return; }
    await api('/api/companies', { method: 'POST', body: form });
    await refreshStore();
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="New company" footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save}>Create</button>
      </>
    }>
      <Field label="Name"><input value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Domain"><input value={form.domain} onChange={(e) => set('domain', e.target.value)} /></Field>
        <Field label="City"><input value={form.city} onChange={(e) => set('city', e.target.value)} /></Field>
        <Field label="Industry"><input value={form.industry} onChange={(e) => set('industry', e.target.value)} /></Field>
        <Field label="Headcount"><input value={form.size} onChange={(e) => set('size', e.target.value)} placeholder="50-120" /></Field>
        <Field label="Tier">
          <select value={form.tier} onChange={(e) => set('tier', e.target.value)}>
            <option>Starter</option><option>Growth</option><option>Enterprise</option>
          </select>
        </Field>
        <Field label="MRR (USD)"><input type="number" value={form.mrr} onChange={(e) => set('mrr', Number(e.target.value))} /></Field>
      </div>
      <Field label="Brand color"><input type="color" value={form.color} onChange={(e) => set('color', e.target.value)} style={{ height: 36, width: 64, padding: 0 }} /></Field>
    </Modal>
  );
};

// ---- New Deal ----------------------------------------------------------
const NewDealModal = ({ open, onClose, prefill }) => {
  const [form, setForm] = React.useState(() => ({
    name: '', company_id: '', contact_id: '', stage_id: '', amount: 0,
    owner: 'You', close_date: '', source: 'Outbound', priority: 'med', forecast: 'pipeline',
  }));
  React.useEffect(() => {
    if (open && prefill) setForm((f) => ({ ...f, ...prefill }));
  }, [open]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    if (!form.name) { alert('Name required'); return; }
    const body = {
      ...form,
      company_id: form.company_id ? Number(form.company_id) : null,
      contact_id: form.contact_id ? Number(form.contact_id) : null,
      stage_id: form.stage_id ? Number(form.stage_id) : null,
      amount: Number(form.amount) || 0,
    };
    await api('/api/deals', { method: 'POST', body });
    await refreshStore();
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="New deal" width={620} footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save}>Create</button>
      </>
    }>
      <Field label="Deal name"><input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Acme — Annual Platform" /></Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Company">
          <select value={form.company_id} onChange={(e) => set('company_id', e.target.value)}>
            <option value="">—</option>
            {(window.COMPANIES || []).map((c) => <option key={c.id} value={c.raw_id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Primary contact">
          <select value={form.contact_id} onChange={(e) => set('contact_id', e.target.value)}>
            <option value="">—</option>
            {(window.CONTACTS || []).map((c) => <option key={c.id} value={c.raw_id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Stage">
          <select value={form.stage_id} onChange={(e) => set('stage_id', e.target.value)}>
            <option value="">first stage</option>
            {(window.STAGES || []).map((s) => <option key={s.id} value={s.raw_id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Amount (USD)"><input type="number" value={form.amount} onChange={(e) => set('amount', e.target.value)} /></Field>
        <Field label="Close date"><input type="date" value={form.close_date} onChange={(e) => set('close_date', e.target.value)} /></Field>
        <Field label="Source">
          <select value={form.source} onChange={(e) => set('source', e.target.value)}>
            {['Outbound', 'Inbound', 'Partner', 'Referral', 'Renewal', 'Expansion', 'Event'].map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Priority">
          <select value={form.priority} onChange={(e) => set('priority', e.target.value)}>
            <option value="low">low</option><option value="med">med</option><option value="high">high</option>
          </select>
        </Field>
        <Field label="Forecast">
          <select value={form.forecast} onChange={(e) => set('forecast', e.target.value)}>
            <option value="pipeline">pipeline</option><option value="best-case">best-case</option><option value="commit">commit</option>
          </select>
        </Field>
      </div>
    </Modal>
  );
};

// ---- New Task ----------------------------------------------------------
const NewTaskModal = ({ open, onClose }) => {
  const [form, setForm] = React.useState({ title: '', vendor_id: '', deal_id: '', due_at: '', priority: 'med', type: 'task', owner: 'You' });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    if (!form.title) return;
    const body = {
      ...form,
      vendor_id: form.vendor_id ? Number(form.vendor_id) : null,
      deal_id: form.deal_id ? Number(form.deal_id) : null,
      due_at: form.due_at ? new Date(form.due_at + 'T17:00:00').getTime() : null,
    };
    await api('/api/tasks', { method: 'POST', body });
    await refreshStore();
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="New task" footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save}>Create</button>
      </>
    }>
      <Field label="Title"><input value={form.title} onChange={(e) => set('title', e.target.value)} /></Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Type">
          <select value={form.type} onChange={(e) => set('type', e.target.value)}>
            <option>task</option><option>email</option><option>call</option><option>meeting</option>
          </select>
        </Field>
        <Field label="Priority">
          <select value={form.priority} onChange={(e) => set('priority', e.target.value)}>
            <option value="low">low</option><option value="med">med</option><option value="high">high</option>
          </select>
        </Field>
        <Field label="Due date"><input type="date" value={form.due_at} onChange={(e) => set('due_at', e.target.value)} /></Field>
        <Field label="Owner"><input value={form.owner} onChange={(e) => set('owner', e.target.value)} /></Field>
      </div>
      <Field label="Linked contact">
        <select value={form.vendor_id} onChange={(e) => set('vendor_id', e.target.value)}>
          <option value="">—</option>
          {(window.CONTACTS || []).map((c) => <option key={c.id} value={c.raw_id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="Linked deal">
        <select value={form.deal_id} onChange={(e) => set('deal_id', e.target.value)}>
          <option value="">—</option>
          {(window.DEALS || []).map((d) => <option key={d.id} value={d.raw_id}>{d.name}</option>)}
        </select>
      </Field>
    </Modal>
  );
};

// ---- New Ticket --------------------------------------------------------
const NewTicketModal = ({ open, onClose }) => {
  const [form, setForm] = React.useState({ subject: '', body: '', company_id: '', requester_id: '', priority: 'med', sla: '8h', assignee: 'You' });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    if (!form.subject) return;
    await api('/api/tickets', {
      method: 'POST',
      body: { ...form, company_id: form.company_id ? Number(form.company_id) : null, requester_id: form.requester_id ? Number(form.requester_id) : null },
    });
    await refreshStore();
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="New ticket" footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save}>Create</button>
      </>
    }>
      <Field label="Subject"><input value={form.subject} onChange={(e) => set('subject', e.target.value)} /></Field>
      <Field label="Description"><textarea rows={4} value={form.body} onChange={(e) => set('body', e.target.value)} /></Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Company">
          <select value={form.company_id} onChange={(e) => set('company_id', e.target.value)}>
            <option value="">—</option>
            {(window.COMPANIES || []).map((c) => <option key={c.id} value={c.raw_id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Requester">
          <select value={form.requester_id} onChange={(e) => set('requester_id', e.target.value)}>
            <option value="">—</option>
            {(window.CONTACTS || []).map((c) => <option key={c.id} value={c.raw_id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Priority">
          <select value={form.priority} onChange={(e) => set('priority', e.target.value)}>
            <option>low</option><option>med</option><option>high</option><option>urgent</option>
          </select>
        </Field>
        <Field label="SLA"><input value={form.sla} onChange={(e) => set('sla', e.target.value)} placeholder="e.g. 4h" /></Field>
        <Field label="Assignee"><input value={form.assignee} onChange={(e) => set('assignee', e.target.value)} /></Field>
      </div>
    </Modal>
  );
};

// ---- New Automation ----------------------------------------------------
const NewAutomationModal = ({ open, onClose }) => {
  const [form, setForm] = React.useState({ name: '', trigger: 'Contact created', actionsCount: 1 });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    if (!form.name) return;
    const actions = Array.from({ length: form.actionsCount }, () => ({ a: 'send_email' }));
    await api('/api/automations', { method: 'POST', body: { name: form.name, trigger: form.trigger, actions, status: 'on' } });
    await refreshStore();
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="New automation" footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save}>Create</button>
      </>
    }>
      <Field label="Name"><input value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
      <Field label="Trigger">
        <select value={form.trigger} onChange={(e) => set('trigger', e.target.value)}>
          <option>Contact created</option><option>Deal idle 14 days</option><option>Lead score &gt; 85</option><option>Deal → Closed Won</option><option>Deal → Closed Lost</option>
        </select>
      </Field>
      <Field label="Number of actions"><input type="number" min={1} max={8} value={form.actionsCount} onChange={(e) => set('actionsCount', Math.max(1, Math.min(8, Number(e.target.value))))} /></Field>
    </Modal>
  );
};

// ---- New Calendar Event ------------------------------------------------
const NewEventModal = ({ open, onClose }) => {
  const [form, setForm] = React.useState({ title: '', date: new Date().toISOString().slice(0, 10), start: '10:00', end: '11:00', color: '#3D5A80', deal_id: '', contact_id: '' });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    if (!form.title) return;
    const starts_at = new Date(`${form.date}T${form.start}:00`).getTime();
    const ends_at = new Date(`${form.date}T${form.end}:00`).getTime();
    await api('/api/calendar', {
      method: 'POST',
      body: {
        title: form.title, starts_at, ends_at, color: form.color,
        deal_id: form.deal_id ? Number(form.deal_id) : null,
        contact_id: form.contact_id ? Number(form.contact_id) : null,
      },
    });
    await refreshStore();
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="New event" footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save}>Create</button>
      </>
    }>
      <Field label="Title"><input value={form.title} onChange={(e) => set('title', e.target.value)} /></Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <Field label="Date"><input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} /></Field>
        <Field label="Start"><input type="time" value={form.start} onChange={(e) => set('start', e.target.value)} /></Field>
        <Field label="End"><input type="time" value={form.end} onChange={(e) => set('end', e.target.value)} /></Field>
      </div>
      <Field label="Linked deal">
        <select value={form.deal_id} onChange={(e) => set('deal_id', e.target.value)}>
          <option value="">—</option>
          {(window.DEALS || []).map((d) => <option key={d.id} value={d.raw_id}>{d.name}</option>)}
        </select>
      </Field>
      <Field label="Color"><input type="color" value={form.color} onChange={(e) => set('color', e.target.value)} style={{ height: 36, width: 64, padding: 0 }} /></Field>
    </Modal>
  );
};

// ---- New Campaign (uses existing /api/messages/bulk) -------------------
const NewCampaignModal = ({ open, onClose }) => {
  const [form, setForm] = React.useState({ name: '', body: '', vendor_ids: [] });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    if (!form.name || !form.body || form.vendor_ids.length === 0) {
      alert('Name, body, and at least one recipient required'); return;
    }
    await api('/api/messages/bulk', {
      method: 'POST',
      body: { campaign_name: form.name, body: form.body, vendor_ids: form.vendor_ids },
    });
    await refreshStore();
    onClose();
  };
  const toggleAll = (checked) => set('vendor_ids', checked ? (window.CONTACTS || []).map((c) => c.raw_id) : []);
  return (
    <Modal open={open} onClose={onClose} title="New WhatsApp campaign" width={640} footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save}>Queue {form.vendor_ids.length} message(s)</button>
      </>
    }>
      <Field label="Campaign name"><input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Q2 outbound" /></Field>
      <Field label="Message body (supports {{name}}, {{company}}, {{email}} variables)">
        <textarea rows={5} value={form.body} onChange={(e) => set('body', e.target.value)} />
      </Field>
      <Field label={`Recipients · ${form.vendor_ids.length} selected`}>
        <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--rule)', borderRadius: 6, padding: 8 }}>
          <label className="row" style={{ gap: 6, padding: 4 }}>
            <input type="checkbox" onChange={(e) => toggleAll(e.target.checked)} />
            <strong>Select all</strong>
          </label>
          {(window.CONTACTS || []).map((c) => (
            <label key={c.id} className="row" style={{ gap: 6, padding: 4 }}>
              <input
                type="checkbox"
                checked={form.vendor_ids.includes(c.raw_id)}
                onChange={(e) => {
                  set('vendor_ids', e.target.checked
                    ? [...form.vendor_ids, c.raw_id]
                    : form.vendor_ids.filter((x) => x !== c.raw_id));
                }}
              />
              <span style={{ fontSize: 12 }}>{c.name} · <span className="mono" style={{ color: 'var(--muted)' }}>{c.phone}</span></span>
            </label>
          ))}
        </div>
      </Field>
    </Modal>
  );
};

// ---- WhatsApp QR -------------------------------------------------------
const WaQrModal = ({ open, onClose }) => {
  const [qr, setQr] = React.useState(null);
  const [status, setStatus] = React.useState(null);
  const [reconnecting, setReconnecting] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    let active = true;
    const tick = async () => {
      try {
        const s = await api('/api/wa/status');
        if (!active) return;
        setStatus(s);
        window.WA_STATUS = s;
        if (s.hasQr) {
          const q = await api('/api/wa/qr');
          if (active) setQr(q.dataUrl);
        } else if (s.ready) {
          setQr(null);
        }
      } catch (_) {}
    };
    tick();
    const t = setInterval(tick, 4000);
    return () => { active = false; clearInterval(t); };
  }, [open]);

  const reconnect = async () => {
    setReconnecting(true);
    setQr(null);
    try {
      await api('/api/wa/reinit', { method: 'POST' });
    } catch (_) {}
    setTimeout(() => setReconnecting(false), 4000);
  };

  const relinkFromScratch = async () => {
    if (!window.confirm('This will unlink WhatsApp and require you to scan a new QR code. Continue?')) return;
    setReconnecting(true);
    setQr(null);
    try {
      await api('/api/wa/logout', { method: 'POST' });
    } catch (_) {}
    setTimeout(() => setReconnecting(false), 6000);
  };

  if (!open) return null;
  const stuck = status && !status.ready && !status.hasQr;
  return (
    <Modal open={open} onClose={onClose} title="Link WhatsApp">
      <div style={{ textAlign: 'center', padding: 8 }}>
        {status && status.ready ? (
          <div>
            <div className="serif" style={{ fontSize: 22, color: 'var(--sage)' }}>WhatsApp linked.</div>
            {status.info && <div className="mono" style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>{status.info.wid}</div>}
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 12 }}>You can send messages and the inbox will sync inbound replies automatically.</div>
            <div className="row" style={{ gap: 8, justifyContent: 'center', marginTop: 16 }}>
              <button className="btn sm" onClick={reconnect} disabled={reconnecting}>
                {reconnecting ? 'Reconnecting…' : 'Force reconnect'}
              </button>
              <button className="btn sm" onClick={relinkFromScratch} disabled={reconnecting}>
                Unlink &amp; re-scan
              </button>
            </div>
          </div>
        ) : qr ? (
          <>
            <img src={qr} style={{ width: 280, height: 280 }} />
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>WhatsApp → Settings → Linked Devices → Link a device</div>
          </>
        ) : (
          <div style={{ padding: 24, color: 'var(--muted)' }}>
            <div>{reconnecting ? 'Reconnecting WhatsApp…' : 'Waiting for QR code…'}</div>
            {stuck && !reconnecting && (
              <>
                <div style={{ fontSize: 11, marginTop: 8 }}>The client is stuck between authenticated and ready. Reconnect restarts the session; if that keeps failing, unlink &amp; re-scan wipes the saved login and forces a fresh QR.</div>
                <div className="row" style={{ gap: 8, justifyContent: 'center', marginTop: 12 }}>
                  <button className="btn primary sm" onClick={reconnect}>Reconnect WhatsApp</button>
                  <button className="btn sm" onClick={relinkFromScratch}>Unlink &amp; re-scan</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};

// ---- Compose (free-form WhatsApp message) ------------------------------
const ComposeModal = ({ open, onClose }) => {
  const [vendorId, setVendorId] = React.useState('');
  const [body, setBody] = React.useState('');
  const send = async () => {
    if (!vendorId || !body) return;
    await api('/api/inbox/' + vendorId + '/reply', { method: 'POST', body: { body } });
    await refreshStore();
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Compose WhatsApp message" footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={send}><Icon name="send" size={12} />Queue send</button>
      </>
    }>
      <Field label="Recipient">
        <select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
          <option value="">—</option>
          {(window.CONTACTS || []).map((c) => <option key={c.id} value={c.raw_id}>{c.name} ({c.phone})</option>)}
        </select>
      </Field>
      <Field label="Message"><textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
    </Modal>
  );
};

// ---- Generic "New" picker ---------------------------------------------
const NewPickerModal = ({ open, onClose, onPick }) => {
  if (!open) return null;
  const items = [
    { label: 'Deal', icon: 'pipeline', a: 'deal' },
    { label: 'Contact', icon: 'people', a: 'contact' },
    { label: 'Company', icon: 'building', a: 'company' },
    { label: 'Task', icon: 'check-list', a: 'task' },
    { label: 'Event', icon: 'calendar', a: 'event' },
    { label: 'Ticket', icon: 'ticket', a: 'ticket' },
    { label: 'Campaign', icon: 'megaphone', a: 'campaign' },
    { label: 'Automation', icon: 'flow', a: 'automation' },
  ];
  return (
    <Modal open={open} onClose={onClose} title="What would you like to create?">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
        {items.map((it) => (
          <button key={it.a} className="btn" style={{ justifyContent: 'flex-start', padding: 12, gap: 10 }} onClick={() => { onClose(); onPick(it.a); }}>
            <Icon name={it.icon} size={16} />
            <span>{it.label}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
};

// ---- Call Log -----------------------------------------------------------
// Pops when the user clicks the phone-icon on a contact row. Fires `tel:` to
// invoke the system dialer, runs a live stopwatch the user can pause/edit,
// and posts a row to `/api/calls` with disposition + outcome + notes so the
// vendor's status auto-advances.
const DISPOSITIONS = [
  { v: 'connected',         label: '✓ Connected'     },
  { v: 'no_answer',         label: 'No answer'        },
  { v: 'busy',              label: 'Busy'             },
  { v: 'wrong_number',      label: 'Wrong number'     },
];
// Lookup: backend value → friendly label (handles legacy 'answered' rows too).
const DISPOSITION_LABEL = {
  connected: 'Connected', answered: 'Connected',
  busy: 'Busy', no_answer: 'Not answered', callback_request: 'Callback request',
  voicemail: 'Voicemail', wrong_number: 'Wrong number',
};
window.DISPOSITION_LABEL = DISPOSITION_LABEL;
const OUTCOMES = [
  { v: 'interested',     label: 'Interested',     tone: 'sage'  },
  { v: 'maybe',          label: 'Maybe',          tone: 'ochre' },
  { v: 'not_interested', label: 'Not interested', tone: 'gray'  },
  { v: 'follow_up',      label: 'Follow-up',      tone: 'blue'  },
  { v: 'won',            label: 'Won',            tone: 'sage'  },
  { v: 'lost',           label: 'Lost',           tone: 'gray'  },
];

function pad2(n) { return String(n).padStart(2, '0'); }
function fmtDur(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(ss)}` : `${pad2(m)}:${pad2(ss)}`;
}
function relTime(ms) {
  if (!ms) return '—';
  const d = Date.now() - ms;
  if (d < 60_000) return 'just now';
  if (d < 3_600_000) return Math.floor(d / 60_000) + 'm ago';
  if (d < 86_400_000) return Math.floor(d / 3_600_000) + 'h ago';
  return Math.floor(d / 86_400_000) + 'd ago';
}

const CallLogModal = ({ open, contact, onClose }) => {
  const [running, setRunning] = React.useState(false);
  const [seconds, setSeconds] = React.useState(0);
  const [disposition, setDisposition] = React.useState('answered');
  const [outcome, setOutcome] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [followUp, setFollowUp] = React.useState('');
  const [history, setHistory] = React.useState([]);
  const [saving, setSaving] = React.useState(false);
  const startRef = React.useRef(0);

  // Reset + auto-start the timer + fire tel: on open.
  React.useEffect(() => {
    if (!open || !contact) return;
    setRunning(true);
    setSeconds(0);
    setDisposition('connected');
    setOutcome('');
    setNotes('');
    setFollowUp('');
    startRef.current = Date.now();
    const phoneDigits = String(contact.phone || '').replace(/\D/g, '');
    if (phoneDigits) {
      // Open the system dialer in a new tab — works on macOS (FaceTime), iOS, Android.
      const a = document.createElement('a');
      a.href = 'tel:+' + phoneDigits;
      a.click();
    }
    api(`/api/calls?vendor_id=${contact.raw_id}&limit=20`).then(setHistory).catch(() => setHistory([]));
  }, [open, contact && contact.id]);

  // Tick the stopwatch.
  React.useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setSeconds(Math.floor((Date.now() - startRef.current) / 1000));
    }, 250);
    return () => clearInterval(id);
  }, [running]);

  const stop  = () => { setRunning(false); };
  const start = () => { startRef.current = Date.now() - seconds * 1000; setRunning(true); };
  const reset = () => { setRunning(false); setSeconds(0); startRef.current = Date.now(); };

  // Save the current call. If `promote` is true, also open the New Deal modal
  // pre-filled from this contact so the user can promote it into the pipeline.
  const save = async ({ promote = false } = {}) => {
    if (!contact) return;
    setSaving(true);
    try {
      // Stamp who placed the call. Defaults to the current team member, falls back to "You".
      const me = (window.TEAM || []).find((u) => u.name && u.name.startsWith('You'));
      const caller = me ? me.name.replace(/^You \(|\)$/g, '') : 'You';
      await api('/api/calls', {
        method: 'POST',
        body: {
          vendor_id: contact.raw_id,
          direction: 'out',
          disposition,
          outcome: outcome || null,
          duration_sec: seconds,
          notes: notes || null,
          caller,
        },
      });
      // Optional follow-up task.
      if (followUp) {
        await api('/api/tasks', {
          method: 'POST',
          body: {
            vendor_id: contact.raw_id,
            title: `Follow-up: ${contact.name}`,
            due_at: new Date(followUp).getTime(),
            priority: outcome === 'interested' ? 'high' : 'med',
            type: 'call',
          },
        });
      }
      await refreshStore();
      onClose();
      if (promote && window.openNewDeal) {
        // Pre-fill the New Deal modal with this contact in Discovery stage.
        const stages = window.STAGES || [];
        const discovery = stages.find((s) => /discovery/i.test(s.name)) || stages[0];
        const todayPlus30 = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
        window.openNewDeal({
          name: `${contact.name} — Opportunity`,
          contact_id: contact.raw_id,
          stage_id: discovery ? discovery.raw_id : null,
          source: 'Outbound',
          priority: outcome === 'interested' ? 'high' : 'med',
          forecast: outcome === 'won' ? 'commit' : 'best-case',
          close_date: todayPlus30,
        });
      }
    } catch (e) {
      alert('Save failed: ' + (e && e.message ? e.message : e));
    }
    setSaving(false);
  };

  // Show the "Promote to deal" button only when the outcome is positive.
  const promotable = ['interested', 'maybe', 'follow_up', 'won'].includes(outcome);

  if (!contact) return null;

  return (
    <Modal open={open} onClose={onClose} width={520} title={`Call · ${contact.name}`}>
      {/* Compact timer + phone strip */}
      <div className="row" style={{ gap: 12, alignItems: 'center', padding: '4px 0 14px', borderBottom: '1px solid var(--rule-2)', marginBottom: 14 }}>
        <div className="mono" style={{ fontSize: 20, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmtDur(seconds)}</div>
        <div className="mono" style={{ fontSize: 13, color: 'var(--ink-3)', flex: 1 }}>{contact.phone ? '+' + String(contact.phone).replace(/\D/g, '') : '—'}</div>
        {running ? (
          <button className="btn sm" onClick={stop} title="Pause timer">Stop</button>
        ) : (
          <button className="btn sm" onClick={start} title="Resume timer">Start</button>
        )}
        <button className="btn sm ghost" onClick={reset} title="Reset">↻</button>
      </div>

      {/* How did it go */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>How did the call go?</div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {DISPOSITIONS.map((d) => {
            const sel = disposition === d.v;
            return (
              <button
                key={d.v} type="button"
                onClick={() => setDisposition(d.v)}
                style={{
                  padding: '6px 12px', borderRadius: 99, fontSize: 12, fontWeight: 600,
                  border: '1.5px solid ' + (sel ? 'var(--ink)' : 'var(--rule)'),
                  background: sel ? 'var(--ink)' : 'var(--paper-2)',
                  color: sel ? 'var(--paper)' : 'var(--ink-3)',
                  cursor: 'pointer', transition: 'all 0.12s',
                }}
              >{d.label}</button>
            );
          })}
        </div>
      </div>

      {/* What's next */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>What's next?</div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {OUTCOMES.map((o) => {
            const sel = outcome === o.v;
            return (
              <button
                key={o.v} type="button"
                onClick={() => setOutcome(o.v === outcome ? '' : o.v)}
                style={{
                  padding: '6px 12px', borderRadius: 99, fontSize: 12, fontWeight: 600,
                  border: '1.5px solid ' + (sel ? 'var(--ink)' : 'var(--rule)'),
                  background: sel ? 'var(--ink)' : 'var(--paper-2)',
                  color: sel ? 'var(--paper)' : 'var(--ink-3)',
                  cursor: 'pointer', transition: 'all 0.12s',
                }}
              >{o.label}</button>
            );
          })}
        </div>
      </div>

      {/* Notes */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Notes</div>
        <textarea
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What did they say?"
          style={{ width: '100%', resize: 'vertical', minHeight: 60, padding: 10, border: '1px solid var(--rule)', borderRadius: 6, background: 'var(--paper)', fontSize: 13, fontFamily: 'inherit' }}
        />
      </div>

      {/* Footer: follow-up date + actions */}
      <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap', paddingTop: 4 }}>
        <div style={{ flex: '1 1 200px', minWidth: 180 }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>Follow-up (optional)</div>
          <input type="datetime-local" value={followUp} onChange={(e) => setFollowUp(e.target.value)} style={{ width: '100%' }} />
        </div>
        <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={saving} onClick={() => save()}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>

      {history && history.length > 0 && (
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--rule-2)' }}>
          <div className="card-title" style={{ fontSize: 12, marginBottom: 8 }}>Past calls · {history.length}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflowY: 'auto' }}>
            {history.map((h) => (
              <div key={h.id} className="row" style={{ gap: 8, fontSize: 11, padding: '6px 8px', border: '1px solid var(--rule-2)', borderRadius: 6 }}>
                <span className="mono" style={{ color: 'var(--muted)', minWidth: 70 }}>{relTime(h.created_at)}</span>
                <span style={{ minWidth: 90 }}>{DISPOSITION_LABEL[h.disposition] || h.disposition || '—'}</span>
                <span className="chip" style={{ fontSize: 10 }}>{(h.outcome || '—').replace('_', ' ')}</span>
                <span className="mono" style={{ color: 'var(--muted)' }}>{fmtDur(h.duration_sec)}</span>
                <span className="trunc" style={{ flex: 1, color: 'var(--ink-3)' }} title={h.notes || ''}>{h.notes || ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
};

// Provide a single modal host with imperative-ish openers.
const ModalsHost = () => {
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [waOpen, setWaOpen] = React.useState(false);
  const [composeOpen, setComposeOpen] = React.useState(false);
  const [sendMsg, setSendMsg] = React.useState(null); // null = closed, object = prefill
  const [contact, setContact] = React.useState(false);
  const [company, setCompany] = React.useState(false);
  const [deal, setDeal] = React.useState(false);
  const [dealPrefill, setDealPrefill] = React.useState(null);
  const [task, setTask] = React.useState(false);
  const [ticket, setTicket] = React.useState(false);
  const [auto, setAuto] = React.useState(false);
  const [event, setEvent] = React.useState(false);
  const [campaign, setCampaign] = React.useState(false);
  const [callContact, setCallContact] = React.useState(null);

  React.useEffect(() => {
    window.openNewPicker = () => setPickerOpen(true);
    window.openWaQr = () => setWaOpen(true);
    window.openCompose = () => setComposeOpen(true);
    window.openSendMessage = (prefill) => setSendMsg(prefill || {});
    window.openNewContact = () => setContact(true);
    window.openNewCompany = () => setCompany(true);
    window.openNewDeal = (prefill) => { setDealPrefill(prefill); setDeal(true); };
    window.openNewTask = () => setTask(true);
    window.openNewTicket = () => setTicket(true);
    window.openNewAutomation = () => setAuto(true);
    window.openNewEvent = () => setEvent(true);
    window.openNewCampaign = () => setSendMsg({});
    window.openCallLog = (contact) => setCallContact(contact);
  }, []);

  return (
    <>
      <NewPickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={(a) => {
        ({ deal: () => setDeal(true), contact: () => setContact(true), company: () => setCompany(true),
          task: () => setTask(true), event: () => setEvent(true), ticket: () => setTicket(true),
          campaign: () => setSendMsg({}), automation: () => setAuto(true) })[a]();
      }} />
      <WaQrModal open={waOpen} onClose={() => setWaOpen(false)} />
      <ComposeModal open={composeOpen} onClose={() => setComposeOpen(false)} />
      <NewContactModal open={contact} onClose={() => setContact(false)} />
      <NewCompanyModal open={company} onClose={() => setCompany(false)} />
      <NewDealModal open={deal} onClose={() => { setDeal(false); setDealPrefill(null); }} prefill={dealPrefill} />
      <NewTaskModal open={task} onClose={() => setTask(false)} />
      <NewTicketModal open={ticket} onClose={() => setTicket(false)} />
      <NewAutomationModal open={auto} onClose={() => setAuto(false)} />
      <NewEventModal open={event} onClose={() => setEvent(false)} />
      <NewCampaignModal open={campaign} onClose={() => setCampaign(false)} />
      <CallLogModal open={!!callContact} contact={callContact} onClose={() => setCallContact(null)} />
      <SendMessageModal open={!!sendMsg} prefill={sendMsg || {}} onClose={() => setSendMsg(null)} />
    </>
  );
};

window.ModalsHost = ModalsHost;
