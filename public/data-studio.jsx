// =============================================================
// Data Studio — the universal metadata engine's UI. Define custom objects and
// typed fields at runtime, then add/list records — all rendered dynamically
// from the tenant's own definitions. Talks to /api/m/metadata (gated by the
// 'metadata' module). This is the same engine for a Property, a Patient, or a
// Shipment — the form is built from FIELD_DEFINITIONs, never hardcoded.
// =============================================================

const M = '/api/m/metadata';
const FIELD_TYPES = ['text', 'textarea', 'number', 'boolean', 'date', 'email', 'phone', 'picklist'];

const DataStudio = () => {
  const [objects, setObjects] = React.useState([]);
  const [sel, setSel] = React.useState(null);          // {object, fields}
  const [records, setRecords] = React.useState([]);
  const [newObj, setNewObj] = React.useState(null);    // {} when open
  const [newField, setNewField] = React.useState(null);
  const [draft, setDraft] = React.useState({});        // new-record draft
  const [recVis, setRecVis] = React.useState('');      // new-record visibility ('' = object default)
  const [share, setShare] = React.useState(null);      // { recordId, shares, user_id, access }
  const [err, setErr] = React.useState(null);
  const me = window.CURRENT_USER ? window.CURRENT_USER.id : null;
  const ownerLabel = (id) => (id == null ? '—' : id === me ? 'you' : '#' + id);

  const loadObjects = async () => setObjects((await window.api(M + '/objects')).objects || []);
  React.useEffect(() => { loadObjects(); }, []);

  const open = async (api) => {
    const o = await window.api(`${M}/objects/${api}`);
    setSel(o); setDraft({}); setNewField(null); setErr(null); setRecVis(''); setShare(null);
    const r = await window.api(`${M}/objects/${api}/records`);
    setRecords(r.rows || []);
  };
  const reloadRecords = async () => setRecords((await window.api(`${M}/objects/${sel.object.api_name}/records`)).rows || []);

  const createObject = async () => {
    setErr(null);
    try {
      await window.api(M + '/objects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newObj) });
      setNewObj(null); await loadObjects(); open(newObj.api_name);
    } catch (e) { setErr('Create object failed: ' + e.message); }
  };

  const addField = async () => {
    setErr(null);
    const body = { ...newField };
    if (body.data_type === 'picklist') body.options = { values: (body._values || '').split(',').map((s) => s.trim()).filter(Boolean) };
    delete body._values;
    try {
      await window.api(`${M}/objects/${sel.object.api_name}/fields`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      setNewField(null); open(sel.object.api_name);
    } catch (e) { setErr('Add field failed: ' + e.message); }
  };

  const addRecord = async () => {
    setErr(null);
    const body = { ...draft };
    if (recVis) body.visibility = recVis;
    try {
      const res = await fetch(`${M}/objects/${sel.object.api_name}/records`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok) { setErr('Rejected (' + (j.error || res.status) + '): ' + JSON.stringify(j.fields || '')); return; }
      setDraft({}); reloadRecords();
    } catch (e) { setErr('Add record failed: ' + e.message); }
  };

  const delRecord = async (id) => { await window.api(`${M}/objects/${sel.object.api_name}/records/${id}`, { method: 'DELETE' }); reloadRecords(); };

  // --- record sharing (layer 2) ---
  const openShare = async (id) => {
    setErr(null);
    try {
      const r = await window.api(`${M}/objects/${sel.object.api_name}/records/${id}/shares`);
      setShare({ recordId: id, shares: r.shares || [], user_id: '', access: 'read' });
    } catch (e) { setErr('Cannot load shares: ' + e.message); }
  };
  const addShare = async () => {
    try {
      await window.api(`${M}/objects/${sel.object.api_name}/records/${share.recordId}/share`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: Number(share.user_id), access: share.access }) });
      openShare(share.recordId); reloadRecords();
    } catch (e) { setErr('Share failed: ' + e.message); }
  };
  const removeShare = async (uid) => {
    await window.api(`${M}/objects/${sel.object.api_name}/records/${share.recordId}/share/${uid}`, { method: 'DELETE' });
    openShare(share.recordId); reloadRecords();
  };

  const inputFor = (f) => {
    const set = (v) => setDraft({ ...draft, [f.api_name]: v });
    const val = draft[f.api_name] != null ? draft[f.api_name] : '';
    const style = { padding: '6px 8px', border: '1px solid var(--rule)', borderRadius: 6, background: 'var(--paper)', color: 'var(--ink)', width: 140 };
    if (f.data_type === 'boolean') return <input type="checkbox" checked={!!draft[f.api_name]} onChange={(e) => set(e.target.checked)} />;
    if (f.data_type === 'picklist') {
      const opts = (f.options ? JSON.parse(f.options).values : []) || [];
      return <select style={style} value={val} onChange={(e) => set(e.target.value)}><option value="">—</option>{opts.map((o) => <option key={o} value={o}>{o}</option>)}</select>;
    }
    return <input style={style} type={f.data_type === 'number' ? 'number' : f.data_type === 'date' ? 'date' : 'text'} placeholder={f.label + (f.required ? ' *' : '')} value={val} onChange={(e) => set(e.target.value)} />;
  };

  return (
    <div className="page slide-up">
      <div className="page-h">
        <div>
          <div className="page-eyebrow">{objects.length} custom objects · runtime schema</div>
          <h1 className="page-title">Data <em>Studio</em></h1>
          <div className="page-sub">Define your own objects and fields — no code, no deploy. The engine validates and stores every record.</div>
        </div>
        <div className="page-actions">
          <button className="btn primary" onClick={() => setNewObj({ api_name: '', label: '', record_visibility: 'public' })}><Icon name="plus" size={12} />New object</button>
        </div>
      </div>

      {err && <div className="card" style={{ padding: 10, marginBottom: 10, color: 'var(--err)', fontSize: 12 }}>{err}</div>}

      {newObj && (
        <div className="card" style={{ padding: 14, marginBottom: 12 }}>
          <div className="serif" style={{ fontSize: 16, marginBottom: 8 }}>New object</div>
          <div className="row" style={{ gap: 8 }}>
            <input className="input" placeholder="api_name (e.g. property)" value={newObj.api_name} onChange={(e) => setNewObj({ ...newObj, api_name: e.target.value })} style={{ padding: '8px 10px', border: '1px solid var(--rule)', borderRadius: 6 }} />
            <input className="input" placeholder="Label (e.g. Property)" value={newObj.label} onChange={(e) => setNewObj({ ...newObj, label: e.target.value })} style={{ padding: '8px 10px', border: '1px solid var(--rule)', borderRadius: 6 }} />
            <select title="Default record visibility" value={newObj.record_visibility} onChange={(e) => setNewObj({ ...newObj, record_visibility: e.target.value })} style={{ padding: '8px 10px', border: '1px solid var(--rule)', borderRadius: 6 }}>
              <option value="public">public records</option>
              <option value="private">private records</option>
            </select>
            <button className="btn primary sm" onClick={createObject}>Create</button>
            <button className="btn ghost sm" onClick={() => setNewObj(null)}>Cancel</button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>Private = only the record's owner, people it's shared with, and managers (records.view_all) can see each record.</div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 14 }}>
        {/* Object list */}
        <div className="card" style={{ padding: 8 }}>
          {objects.length === 0 ? <div style={{ padding: 16, color: 'var(--muted)', fontSize: 12 }}>No custom objects yet.</div> :
            objects.map((o) => (
              <div key={o.id} onClick={() => open(o.api_name)} className={'nav-item' + (sel && sel.object.id === o.id ? ' active' : '')} style={{ cursor: 'pointer', borderRadius: 6 }}>
                <span className="label">{o.label}</span>
                <span className="badge">{o.record_count}</span>
              </div>
            ))}
        </div>

        {/* Selected object: fields + records */}
        <div>
          {!sel ? <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Select or create an object to define its fields and records.</div> : (
            <>
              <div className="card" style={{ padding: 14, marginBottom: 12 }}>
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                  <div className="serif" style={{ fontSize: 18 }}>{sel.object.label} <span style={{ fontSize: 12, color: 'var(--muted)' }}>· {sel.object.api_name}</span></div>
                  <button className="btn sm" onClick={() => setNewField({ api_name: '', label: '', data_type: 'text', required: false, is_unique: false })}><Icon name="plus" size={11} />Field</button>
                </div>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {sel.fields.map((f) => (
                    <span key={f.id} className="chip" title={(f.read_perm || f.write_perm) ? `gated — read:${f.read_perm || 'any'} write:${f.write_perm || 'any'}` : f.data_type}>{f.label} · {f.data_type}{f.required ? ' *' : ''}{f.is_unique ? ' ◆' : ''}{(f.read_perm || f.write_perm) ? ' 🔒' : ''}</span>
                  ))}
                  {sel.fields.length === 0 && <span style={{ fontSize: 12, color: 'var(--muted)' }}>No fields yet — add one.</span>}
                </div>

                {newField && (
                  <div className="row" style={{ gap: 6, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    <input placeholder="api_name" value={newField.api_name} onChange={(e) => setNewField({ ...newField, api_name: e.target.value })} style={{ padding: '6px 8px', border: '1px solid var(--rule)', borderRadius: 6, width: 110 }} />
                    <input placeholder="Label" value={newField.label} onChange={(e) => setNewField({ ...newField, label: e.target.value })} style={{ padding: '6px 8px', border: '1px solid var(--rule)', borderRadius: 6, width: 110 }} />
                    <select value={newField.data_type} onChange={(e) => setNewField({ ...newField, data_type: e.target.value })} style={{ padding: '6px 8px', border: '1px solid var(--rule)', borderRadius: 6 }}>{FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
                    {newField.data_type === 'picklist' && <input placeholder="a,b,c" value={newField._values || ''} onChange={(e) => setNewField({ ...newField, _values: e.target.value })} style={{ padding: '6px 8px', border: '1px solid var(--rule)', borderRadius: 6, width: 120 }} />}
                    <label style={{ fontSize: 12 }}><input type="checkbox" checked={!!newField.required} onChange={(e) => setNewField({ ...newField, required: e.target.checked })} /> req</label>
                    <label style={{ fontSize: 12 }}><input type="checkbox" checked={!!newField.is_unique} onChange={(e) => setNewField({ ...newField, is_unique: e.target.checked })} /> unique</label>
                    <input list="ds-perms" placeholder="read perm" title="Permission required to SEE this field (blank = anyone)" value={newField.read_perm || ''} onChange={(e) => setNewField({ ...newField, read_perm: e.target.value })} style={{ padding: '6px 8px', border: '1px solid var(--rule)', borderRadius: 6, width: 120 }} />
                    <input list="ds-perms" placeholder="write perm" title="Permission required to EDIT this field (blank = anyone)" value={newField.write_perm || ''} onChange={(e) => setNewField({ ...newField, write_perm: e.target.value })} style={{ padding: '6px 8px', border: '1px solid var(--rule)', borderRadius: 6, width: 120 }} />
                    <datalist id="ds-perms"><option value="records.view_all" /><option value="records.edit_all" /><option value="billing.manage" /></datalist>
                    <button className="btn primary sm" onClick={addField}>Add</button>
                    <button className="btn ghost sm" onClick={() => setNewField(null)}>×</button>
                  </div>
                )}
              </div>

              {/* Records */}
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {sel.fields.length > 0 && (
                  <div className="row" style={{ gap: 6, padding: 10, borderBottom: '1px solid var(--rule)', flexWrap: 'wrap', alignItems: 'center' }}>
                    {sel.fields.map((f) => <span key={f.id}>{inputFor(f)}</span>)}
                    <select title="Visibility of the new record" value={recVis} onChange={(e) => setRecVis(e.target.value)} style={{ padding: '6px 8px', border: '1px solid var(--rule)', borderRadius: 6 }}>
                      <option value="">default ({sel.object.record_visibility || 'public'})</option>
                      <option value="public">public</option>
                      <option value="private">private</option>
                    </select>
                    <button className="btn primary sm" onClick={addRecord}>Add record</button>
                  </div>
                )}
                <table className="table" style={{ width: '100%' }}>
                  <thead><tr>
                    {sel.fields.map((f) => <th key={f.id} style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11, color: 'var(--muted)' }}>{f.label}</th>)}
                    <th style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11, color: 'var(--muted)' }}>Owner</th>
                    <th style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11, color: 'var(--muted)' }}>Visibility</th>
                    <th></th>
                  </tr></thead>
                  <tbody>
                    {records.map((r) => (
                      <tr key={r.id} style={{ borderTop: '1px solid var(--rule)' }}>
                        {sel.fields.map((f) => <td key={f.id} style={{ padding: '8px 10px', fontSize: 13 }}>{f.data_type === 'boolean' ? (r[f.api_name] ? '✓' : '') : (Object.prototype.hasOwnProperty.call(r, f.api_name) ? String(r[f.api_name] != null ? r[f.api_name] : '') : <span style={{ color: 'var(--muted-2)' }} title="hidden by field-level access">🔒</span>)}</td>)}
                        <td style={{ padding: '8px 10px', fontSize: 12, color: 'var(--muted)' }}>{ownerLabel(r.owner_id)}</td>
                        <td style={{ padding: '8px 10px' }}><span className={'chip ' + ((r.visibility || sel.object.record_visibility) === 'private' ? 'accent' : 'sage')}>{r.visibility || sel.object.record_visibility || 'public'}</span></td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button className="icon-btn" title="Share" onClick={() => openShare(r.id)}><Icon name="people" size={13} /></button>
                          <button className="icon-btn" title="Delete" onClick={() => delRecord(r.id)}><Icon name="trash" size={12} /></button>
                        </td>
                      </tr>
                    ))}
                    {records.length === 0 && <tr><td colSpan={sel.fields.length + 3} style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>No records yet.</td></tr>}
                  </tbody>
                </table>
              </div>

              {share && (
                <div className="card" style={{ padding: 14, marginTop: 12 }}>
                  <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                    <div className="serif" style={{ fontSize: 16 }}>Share record #{share.recordId}</div>
                    <button className="btn ghost sm" onClick={() => setShare(null)}>Close</button>
                  </div>
                  <div className="row" style={{ gap: 6, marginBottom: 10, alignItems: 'center' }}>
                    <input type="number" placeholder="user id" value={share.user_id} onChange={(e) => setShare({ ...share, user_id: e.target.value })} style={{ padding: '6px 8px', border: '1px solid var(--rule)', borderRadius: 6, width: 90 }} />
                    <select value={share.access} onChange={(e) => setShare({ ...share, access: e.target.value })} style={{ padding: '6px 8px', border: '1px solid var(--rule)', borderRadius: 6 }}><option value="read">read</option><option value="write">write</option></select>
                    <button className="btn primary sm" onClick={addShare} disabled={!share.user_id}>Grant</button>
                  </div>
                  {share.shares.length === 0 ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>Not shared with anyone yet.</div> :
                    share.shares.map((s) => (
                      <div key={s.user_id} className="row" style={{ gap: 8, padding: '4px 0' }}>
                        <span style={{ fontSize: 13 }}>{ownerLabel(s.user_id)}</span>
                        <span className="chip">{s.access}</span>
                        <button className="btn ghost sm" onClick={() => removeShare(s.user_id)}>Revoke</button>
                      </div>
                    ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

window.DataStudio = DataStudio;
