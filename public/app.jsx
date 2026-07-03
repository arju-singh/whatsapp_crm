// =============================================================
// WhatsApp CRM — main app shell
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
        <div className="serif" style={{ fontSize: 28 }}>WhatsApp CRM<span style={{ color: 'var(--accent)' }}>.</span></div>
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
    dashboard: ['WhatsApp CRM', 'Dashboard'],
    contacts: ['WhatsApp CRM', 'Leads / Clients'],
    companies: ['WhatsApp CRM', 'Companies'],
    deals: ['WhatsApp CRM', 'Pipeline'],
    properties: ['WhatsApp CRM', 'Properties'],
    dataStudio: ['WhatsApp CRM', 'Data Studio'],
    modules: ['WhatsApp CRM', 'Modules'],
    callLogs: ['WhatsApp CRM', 'Call logs'],
    followUps: ['WhatsApp CRM', 'Follow-ups'],
    tasks: ['WhatsApp CRM', 'Tasks'],
    calendar: ['WhatsApp CRM', 'Calendar'],
    inbox: ['WhatsApp CRM', 'Inbox'],
    reports: ['WhatsApp CRM', 'Reports'],
    templates: ['WhatsApp CRM', 'Templates'],
    messages: ['WhatsApp CRM', 'Outbox'],
    leads: ['WhatsApp CRM', 'Find leads'],
    campaigns: ['WhatsApp CRM', 'Campaigns'],
    tickets: ['WhatsApp CRM', 'Tickets'],
    automations: ['WhatsApp CRM', 'Automations'],
    team: ['WhatsApp CRM', 'Team'],
    users: ['WhatsApp CRM', 'Users'],
    settings: ['WhatsApp CRM', 'Settings'],
  };

  // Route → module gate. If the active route belongs to a feature module that's
  // disabled for this org, fall back to the dashboard (the menu hides it too, but
  // this guards deep-links and live toggles).
  const ROUTE_MODULE = {
    companies: 'deals', deals: 'deals', reports: 'deals',
    properties: 'realestate', callLogs: 'calling', tickets: 'support', leads: 'leadfinder',
    dataStudio: 'metadata',
  };
  const enabledMods = window.MODULES_ENABLED;
  const routeMod = ROUTE_MODULE[route];
  const routeBlocked = routeMod && enabledMods && enabledMods.size > 0 && !enabledMods.has(routeMod);
  const activeRoute = routeBlocked ? 'dashboard' : route;

  const View = {
    dashboard: <Dashboard openAI={() => setAI(true)} setRoute={setRoute} />,
    contacts: <Contacts />,
    companies: <Companies />,
    deals: <Deals />,
    properties: window.Properties ? <window.Properties /> : null,
    dataStudio: window.DataStudio ? <window.DataStudio /> : null,
    modules: window.ModulesAdmin ? <window.ModulesAdmin /> : null,
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
  }[activeRoute];

  const TweaksPanel = window.TweaksPanel;
  const TweakSection = window.TweakSection;
  const TweakColor = window.TweakColor;
  const TweakRadio = window.TweakRadio;

  return (
    <div className="app" data-screen-label={'WhatsApp CRM · ' + route}>
      <Sidebar route={route} setRoute={setRoute} openCmd={() => setCmd(true)} openWaQr={() => window.openWaQr && window.openWaQr()} />
      <Topbar
        crumbs={crumbsMap[activeRoute] || ['WhatsApp CRM']}
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
