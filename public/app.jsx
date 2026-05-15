// =============================================================
// Arju_CRM — main app shell
// =============================================================

const App = () => {
  const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
    "accent": "#E07A5F",
    "density": "balanced",
    "theme": "light",
    "serif": "Fraunces"
  }/*EDITMODE-END*/;

  const { ready, error } = useStore();

  const [route, setRoute] = React.useState('dashboard');
  const [cmd, setCmd] = React.useState(false);
  const [ai, setAI] = React.useState(false);
  const [notif, setNotif] = React.useState(false);
  const [theme, setTheme] = React.useState('light');
  const [tweaksOn, setTweaksOn] = React.useState(false);
  const t = window.useTweaks ? window.useTweaks(TWEAK_DEFAULTS) : { values: TWEAK_DEFAULTS, setTweak: () => {} };

  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  React.useEffect(() => {
    document.documentElement.style.setProperty('--accent', t.values.accent);
    const soft = {
      '#E07A5F': '#F4D6CC', '#3D5A80': '#D6E0EE', '#588157': '#D7E4D4', '#6B4E71': '#E6DCEA', '#C9184A': '#F5D2DC',
    }[t.values.accent] || '#F4D6CC';
    document.documentElement.style.setProperty('--accent-soft', soft);
  }, [t.values.accent]);

  React.useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setCmd(true); }
      if (e.key === 'Escape') { setCmd(false); setAI(false); setNotif(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Tweaks panel host integration
  React.useEffect(() => {
    const handler = (ev) => {
      if (!ev.data || typeof ev.data !== 'object') return;
      if (ev.data.type === '__activate_edit_mode') setTweaksOn(true);
      if (ev.data.type === '__deactivate_edit_mode') setTweaksOn(false);
    };
    window.addEventListener('message', handler);
    try { window.parent.postMessage({ type: '__edit_mode_available' }, '*'); } catch (_) {}
    return () => window.removeEventListener('message', handler);
  }, []);

  // Periodically refresh WA status + notifications without a full reload.
  React.useEffect(() => {
    const t = setInterval(() => {
      fetch('/api/wa/status').then((r) => r.json()).then((s) => {
        const prev = JSON.stringify(window.WA_STATUS || {});
        if (JSON.stringify(s) !== prev) {
          window.WA_STATUS = s;
          window.dispatchEvent(new CustomEvent('store:change'));
        }
      }).catch(() => {});
    }, 8000);
    return () => clearInterval(t);
  }, []);

  if (!ready) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh', color: 'var(--muted)', background: 'var(--paper)' }}>
        <div className="serif" style={{ fontSize: 28 }}>Arju_CRM<span style={{ color: 'var(--accent)' }}>.</span></div>
        <div style={{ marginTop: 8, fontSize: 12 }}>Loading workspace…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 40, color: 'var(--err)', maxWidth: 600, margin: '60px auto', fontFamily: 'var(--font-body)' }}>
        <div className="serif" style={{ fontSize: 28, marginBottom: 12 }}>Couldn't load.</div>
        <div style={{ fontSize: 13 }}>{error}</div>
        <button className="btn primary" style={{ marginTop: 16 }} onClick={() => window.refreshStore()}>Retry</button>
      </div>
    );
  }

  const crumbsMap = {
    dashboard: ['Arju_CRM', 'Dashboard'],
    contacts: ['Arju_CRM', 'Leads / Clients'],
    companies: ['Arju_CRM', 'Companies'],
    deals: ['Arju_CRM', 'Pipeline'],
    callLogs: ['Arju_CRM', 'Call logs'],
    followUps: ['Arju_CRM', 'Follow-ups'],
    tasks: ['Arju_CRM', 'Tasks'],
    calendar: ['Arju_CRM', 'Calendar'],
    inbox: ['Arju_CRM', 'Inbox'],
    reports: ['Arju_CRM', 'Reports'],
    templates: ['Arju_CRM', 'Templates'],
    messages: ['Arju_CRM', 'Outbox'],
    leads: ['Arju_CRM', 'Find leads'],
    campaigns: ['Arju_CRM', 'Campaigns'],
    tickets: ['Arju_CRM', 'Tickets'],
    automations: ['Arju_CRM', 'Automations'],
    team: ['Arju_CRM', 'Team'],
    users: ['Arju_CRM', 'Users'],
    settings: ['Arju_CRM', 'Settings'],
  };

  const View = {
    dashboard: <Dashboard openAI={() => setAI(true)} setRoute={setRoute} />,
    contacts: <Contacts />,
    companies: <Companies />,
    deals: <Deals />,
    callLogs: <CallLogs />,
    followUps: <FollowUps />,
    tasks: <Tasks />,
    calendar: <Calendar />,
    inbox: <Inbox />,
    reports: <Reports />,
    templates: <Templates />,
    messages: <Messages />,
    leads: <Leads />,
    campaigns: <Campaigns />,
    tickets: <Tickets />,
    automations: <Automations />,
    team: <Team />,
    users: <Users />,
    settings: <Settings />,
  }[route];

  const TweaksPanel = window.TweaksPanel;
  const TweakSection = window.TweakSection;
  const TweakColor = window.TweakColor;
  const TweakRadio = window.TweakRadio;

  return (
    <div className="app" data-screen-label={'Arju_CRM · ' + route}>
      <Sidebar route={route} setRoute={setRoute} openCmd={() => setCmd(true)} openWaQr={() => window.openWaQr && window.openWaQr()} />
      <Topbar
        crumbs={crumbsMap[route] || ['Arju_CRM']}
        openCmd={() => setCmd(true)}
        theme={theme} setTheme={setTheme}
        openAI={() => setAI(true)}
        openNotif={() => setNotif(true)}
        openNew={() => window.openNewPicker && window.openNewPicker()}
      />
      <main className="workspace">
        {View}
      </main>

      <CommandPalette open={cmd} onClose={() => setCmd(false)} setRoute={setRoute} />
      <AIAssistant open={ai} onClose={() => setAI(false)} />
      <NotifPanel open={notif} onClose={() => setNotif(false)} />

      <ModalsHost />

      {tweaksOn && TweaksPanel && (
        <TweaksPanel title="Tweaks" onClose={() => { setTweaksOn(false); try { window.parent.postMessage({ type: '__edit_mode_dismissed' }, '*'); } catch (_) {} }}>
          <TweakSection title="Brand">
            <TweakColor t={t} k="accent" label="Accent color" options={['#E07A5F', '#3D5A80', '#588157', '#6B4E71', '#C9184A']} />
          </TweakSection>
          <TweakSection title="Layout">
            <TweakRadio t={t} k="density" label="Density" options={[{ label: 'Cozy', value: 'cozy' }, { label: 'Balanced', value: 'balanced' }, { label: 'Dense', value: 'dense' }]} />
          </TweakSection>
          <TweakSection title="Theme">
            <TweakRadio t={t} k="theme" label="Mode" options={[{ label: 'Light', value: 'light' }, { label: 'Dark', value: 'dark' }]} onChange={(v) => setTheme(v)} />
          </TweakSection>
        </TweaksPanel>
      )}
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
