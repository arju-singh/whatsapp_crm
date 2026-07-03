// =============================================================
// Properties — the Real Estate module's view. Talks to the module-owned API
// at /api/m/realestate/properties (only reachable when the realestate module
// is enabled for the org). Demonstrates a fully module-scoped feature screen.
// =============================================================

const Properties = () => {
  const [rows, setRows] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [form, setForm] = React.useState(null); // null = closed; {} = open create

  const load = async () => {
    setLoading(true);
    try {
      const r = await window.api('/api/m/realestate/properties');
      setRows(r.rows || []);
    } catch (e) { setRows([]); }
    finally { setLoading(false); }
  };
  React.useEffect(() => { load(); }, []);

  const fmtPrice = (p, c) => p == null ? '—' : (c || 'INR') + ' ' + Number(p).toLocaleString();
  const statusChip = { available: 'sage', sold: 'gray', reserved: 'accent' };

  const save = async () => {
    if (!form.title) { alert('Title is required'); return; }
    await window.api('/api/m/realestate/properties', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: form.title,
        type: form.type || null,
        status: form.status || 'available',
        price: form.price ? Number(form.price) : null,
        city: form.city || null,
        beds: form.beds ? Number(form.beds) : null,
        baths: form.baths ? Number(form.baths) : null,
        area_sqft: form.area_sqft ? Number(form.area_sqft) : null,
      }),
    });
    setForm(null);
    await load();
  };

  const del = async (id) => {
    if (!confirm('Delete this property?')) return;
    await window.api('/api/m/realestate/properties/' + id, { method: 'DELETE' });
    await load();
  };

  const field = (k, ph, type = 'text') => (
    <input
      className="input" type={type} placeholder={ph}
      value={form[k] || ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })}
      style={{ padding: '8px 10px', border: '1px solid var(--rule)', borderRadius: 6, background: 'var(--paper)', color: 'var(--ink)' }}
    />
  );

  return (
    <div className="page slide-up">
      <div className="page-h">
        <div>
          <div className="page-eyebrow">{rows.length} {rows.length === 1 ? 'listing' : 'listings'} · Real Estate module</div>
          <h1 className="page-title">Property <em>inventory</em></h1>
        </div>
        <div className="page-actions">
          <button className="btn primary" onClick={() => setForm({})}><Icon name="plus" size={12} />New property</button>
        </div>
      </div>

      {form && (
        <div className="card" style={{ padding: 16, marginBottom: 12 }}>
          <div className="serif" style={{ fontSize: 17, marginBottom: 10 }}>New property</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            {field('title', 'Title *')}
            {field('type', 'Type (apartment, villa…)')}
            {field('city', 'City')}
            {field('price', 'Price', 'number')}
            {field('beds', 'Beds', 'number')}
            {field('baths', 'Baths', 'number')}
            {field('area_sqft', 'Area (sqft)', 'number')}
            <select
              value={form.status || 'available'} onChange={(e) => setForm({ ...form, status: e.target.value })}
              style={{ padding: '8px 10px', border: '1px solid var(--rule)', borderRadius: 6, background: 'var(--paper)', color: 'var(--ink)' }}
            >
              <option value="available">available</option>
              <option value="reserved">reserved</option>
              <option value="sold">sold</option>
            </select>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <button className="btn primary sm" onClick={save}>Save property</button>
            <button className="btn ghost sm" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
          No properties yet. Add your first listing — this data lives in the Real Estate module.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {rows.map((p) => (
            <div key={p.id} className="card" style={{ padding: 16 }}>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                <span className={'chip ' + (statusChip[p.status] || 'gray')}>{p.status}</span>
                <button className="icon-btn" title="Delete" onClick={() => del(p.id)}><Icon name="trash" size={13} /></button>
              </div>
              <div className="serif" style={{ fontSize: 18 }}>{p.title}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
                {[p.type, p.city].filter(Boolean).join(' · ') || '—'}
              </div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{fmtPrice(p.price, p.currency)}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                {[p.beds && p.beds + ' bd', p.baths && p.baths + ' ba', p.area_sqft && p.area_sqft + ' sqft'].filter(Boolean).join(' · ')}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

window.Properties = Properties;
