// =============================================================
// Three CRM — main app shell
// =============================================================

const App = () => {
  const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
    "accent": "#E07A5F",
    "density": "balanced",
    "theme": "light",
    "serif": "Fraunces"
  }/*EDITMODE-END*/;

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
    // recompute soft variants
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
    window.parent.postMessage({type: '__edit_mode_available'}, '*');
    return () => window.removeEventListener('message', handler);
  }, []);

  const crumbsMap = {
    dashboard: ['Sloane & Co.', 'Dashboard'],
    contacts: ['Sloane & Co.', 'Contacts'],
    companies: ['Sloane & Co.', 'Companies'],
    deals: ['Sloane & Co.', 'Pipeline'],
    tasks: ['Sloane & Co.', 'Tasks'],
    calendar: ['Sloane & Co.', 'Calendar'],
    inbox: ['Sloane & Co.', 'Inbox'],
    reports: ['Sloane & Co.', 'Reports'],
    campaigns: ['Sloane & Co.', 'Campaigns'],
    tickets: ['Sloane & Co.', 'Tickets'],
    automations: ['Sloane & Co.', 'Automations'],
    team: ['Sloane & Co.', 'Team'],
    settings: ['Sloane & Co.', 'Settings'],
  };

  const View = {
    dashboard: <Dashboard openAI={()=>setAI(true)}/>,
    contacts: <Contacts/>,
    companies: <Companies/>,
    deals: <Deals/>,
    tasks: <Tasks/>,
    calendar: <Calendar/>,
    inbox: <Inbox/>,
    reports: <Reports/>,
    campaigns: <Campaigns/>,
    tickets: <Tickets/>,
    automations: <Automations/>,
    team: <Team/>,
    settings: <Settings/>,
  }[route];

  const TweaksPanel = window.TweaksPanel;
  const TweakSection = window.TweakSection;
  const TweakColor = window.TweakColor;
  const TweakRadio = window.TweakRadio;
  const TweakSelect = window.TweakSelect;

  return (
    <div className="app" data-screen-label={'Three CRM · ' + route}>
      <Sidebar route={route} setRoute={setRoute} openCmd={()=>setCmd(true)}/>
      <Topbar
        crumbs={crumbsMap[route] || ['Three']}
        openCmd={()=>setCmd(true)}
        theme={theme} setTheme={setTheme}
        openAI={()=>setAI(true)}
        openNotif={()=>setNotif(true)}
      />
      <main className="workspace">
        {View}
      </main>

      <CommandPalette open={cmd} onClose={()=>setCmd(false)} setRoute={setRoute}/>
      <AIAssistant open={ai} onClose={()=>setAI(false)}/>
      <NotifPanel open={notif} onClose={()=>setNotif(false)}/>

      {tweaksOn && TweaksPanel && (
        <TweaksPanel title="Tweaks" onClose={()=>{ setTweaksOn(false); window.parent.postMessage({type:'__edit_mode_dismissed'}, '*'); }}>
          <TweakSection title="Brand">
            <TweakColor t={t} k="accent" label="Accent color" options={['#E07A5F','#3D5A80','#588157','#6B4E71','#C9184A']}/>
          </TweakSection>
          <TweakSection title="Layout">
            <TweakRadio t={t} k="density" label="Density" options={[{label:'Cozy', value:'cozy'},{label:'Balanced', value:'balanced'},{label:'Dense', value:'dense'}]}/>
          </TweakSection>
          <TweakSection title="Theme">
            <TweakRadio t={t} k="theme" label="Mode" options={[{label:'Light', value:'light'},{label:'Dark', value:'dark'}]} onChange={v => setTheme(v)}/>
          </TweakSection>
        </TweaksPanel>
      )}
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
