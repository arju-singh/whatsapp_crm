// =============================================================
// Modules manager — the platform's "App Store". Toggle feature modules
// on/off for the current org; the sidebar, routes, and API surface update
// live (a disabled module hides its menu and 403s its API). Core modules
// are always on and locked.
// =============================================================

const ModulesAdmin = () => {
  window.useStore();              // re-render when the store (and PLATFORM) refresh
  const [busy, setBusy] = React.useState(null);
  const platform = window.PLATFORM || { modules: [], org: null };
  const mods = platform.modules || [];

  const toggle = async (m) => {
    if (m.core) return;
    setBusy(m.key);
    const action = m.enabled ? 'disable' : 'enable';
    try {
      await window.api(`/api/platform/modules/${m.key}/${action}`, { method: 'POST' });
      await window.refreshStore();   // refreshes PLATFORM + MODULES_ENABLED, re-renders sidebar
    } catch (e) {
      alert('Could not update module: ' + e.message);
    } finally {
      setBusy(null);
    }
  };

  const core = mods.filter((m) => m.core);
  const features = mods.filter((m) => !m.core);

  const Row = ({ m }) => (
    <div className="card" style={{ padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <div style={{ minWidth: 0 }}>
        <div className="row" style={{ gap: 8, marginBottom: 2 }}>
          <span className="serif" style={{ fontSize: 17 }}>{m.name}</span>
          {m.core && <span className="chip">core</span>}
          {m.industry && <span className="chip accent">industry</span>}
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{m.description || m.key}</div>
      </div>
      <button
        className={'btn sm' + (m.enabled ? ' primary' : '')}
        disabled={m.core || busy === m.key}
        onClick={() => toggle(m)}
        title={m.core ? 'Core module — always on' : (m.enabled ? 'Disable' : 'Enable')}
        style={{ minWidth: 92, opacity: m.core ? 0.55 : 1 }}
      >
        {busy === m.key ? '…' : (m.enabled ? 'Enabled' : 'Disabled')}
      </button>
    </div>
  );

  return (
    <div className="page slide-up">
      <div className="page-h">
        <div>
          <div className="page-eyebrow">
            {features.filter((m) => m.enabled).length} of {features.length} feature modules on
            {platform.org ? ` · ${platform.org.name}` : ''}
          </div>
          <h1 className="page-title">Platform <em>modules</em></h1>
          <div className="page-sub">Enable only what this workspace needs. Turning a module off hides its menu and disables its API.</div>
        </div>
      </div>

      <div className="card-sub" style={{ margin: '8px 0 6px', fontWeight: 600 }}>Feature modules</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
        {features.map((m) => <Row key={m.key} m={m} />)}
      </div>

      <div className="card-sub" style={{ margin: '20px 0 6px', fontWeight: 600 }}>Core (always on)</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
        {core.map((m) => <Row key={m.key} m={m} />)}
      </div>
    </div>
  );
};

window.ModulesAdmin = ModulesAdmin;
