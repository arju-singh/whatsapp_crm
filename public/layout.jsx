// =============================================================
// Shared layout: Sidebar, Topbar, Avatar, MiniBars, Sparkline, Donut.
// Sidebar badges read from the live store. Topbar shows WhatsApp link
// status and exposes a QR scan button.
// =============================================================

const Avatar = ({ name, color, size, src }) => {
  const cls = 'avatar' + (size ? ' ' + size : '');
  const bg = color || '#7A7670';
  const [broken, setBroken] = React.useState(false);
  if (src && !broken) {
    return (
      <div className={cls} style={{ background: bg, overflow: 'hidden', padding: 0 }}>
        <img
          src={src}
          alt={name || ''}
          onError={() => setBroken(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      </div>
    );
  }
  return <div className={cls} style={{ background: bg }}>{name}</div>;
};

const Sidebar = ({ route, setRoute, openCmd, openWaQr }) => {
  const dealCount = (window.DEALS || []).filter((d) => {
    const s = window.STAGES.find((x) => x.id === d.stage);
    return s && !s.isWon && !s.isLost;
  }).length;
  const openTasks = (window.TASKS || []).filter((t) => !t.done);
  const taskCount = openTasks.length;
  const ticketCount = (window.TICKETS || []).filter((t) => t.status !== 'solved').length;
  // Follow-ups badge: open tasks + orphan follow-up calls (no task on that vendor yet).
  const taskVendorIds = new Set(openTasks.map((t) => t.raw_vendor_id).filter(Boolean));
  const orphanFollowUpCalls = (window.CALLS || []).filter(
    (c) => (c.disposition === 'callback_request' || c.outcome === 'follow_up') && !taskVendorIds.has(c.vendor_id)
  ).length;
  const followUpCount = taskCount + orphanFollowUpCalls;
  const inboxBadge = window.NOTIFICATIONS_UNREAD || 0;
  const me = (window.TEAM || []).find((u) => u.name && u.name.startsWith('You'));

  // Module gating: items tagged with `mod` only show when that feature module is
  // enabled for the org; items tagged with `perm` only show when the role grants
  // it. Untagged items are core and always visible. If the platform state didn't
  // load, fall back to showing everything (never hide the whole app on a hiccup).
  const enabled = window.MODULES_ENABLED;
  const perms = window.PERMISSIONS;
  const hasMod = (m) => !m || !enabled || enabled.size === 0 || enabled.has(m);
  const hasPerm = (p) => !p || !perms || perms.size === 0 || perms.has(p);
  const visible = (arr) => arr.filter((it) => hasMod(it.mod) && hasPerm(it.perm));

  const items = [
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
    { id: 'inbox', label: 'Inbox', icon: 'inbox', badge: inboxBadge || null },
  ];
  const work = visible([
    { id: 'contacts', label: 'Leads / Clients', icon: 'people' },
    { id: 'companies', label: 'Companies', icon: 'building', mod: 'deals' },
    { id: 'deals', label: 'Pipeline', icon: 'pipeline', badge: dealCount || null, mod: 'deals' },
    { id: 'properties', label: 'Properties', icon: 'building', mod: 'realestate', perm: 'properties.read' },
    { id: 'callLogs', label: 'Call logs', icon: 'phone', mod: 'calling' },
    { id: 'followUps', label: 'Follow-ups', icon: 'bell', badge: followUpCount || null },
    { id: 'tasks', label: 'Tasks', icon: 'check-list', badge: taskCount || null },
    { id: 'calendar', label: 'Calendar', icon: 'calendar' },
  ]);
  const grow = visible([
    { id: 'reports', label: 'Reports', icon: 'chart', mod: 'deals' },
    { id: 'templates', label: 'Templates', icon: 'note' },
    { id: 'messages', label: 'Outbox', icon: 'send' },
    { id: 'leads', label: 'Find leads', icon: 'globe', mod: 'leadfinder' },
    { id: 'campaigns', label: 'Campaigns', icon: 'megaphone' },
    { id: 'tickets', label: 'Tickets', icon: 'ticket', badge: ticketCount || null, mod: 'support' },
    { id: 'automations', label: 'Automations', icon: 'flow' },
  ]);
  const authUser = window.CURRENT_USER;
  const canManageUsers = authUser && (authUser.role === 'admin' || authUser.role === 'super_admin');
  const sys = visible([
    { id: 'team', label: 'Team', icon: 'team' },
    ...(canManageUsers ? [{ id: 'users', label: 'Users & access', icon: 'people' }] : []),
    { id: 'dataStudio', label: 'Data Studio', icon: 'flow', mod: 'metadata', perm: 'objects.read' },
    { id: 'modules', label: 'Modules', icon: 'flow', perm: 'modules.manage' },
    { id: 'settings', label: 'Settings', icon: 'settings' },
  ]);

  const NavGroup = ({ title, items }) => (
    <>
      <div className="nav-section">{title}</div>
      {items.map((it) => (
        <div key={it.id} className={'nav-item' + (route === it.id ? ' active' : '')} onClick={() => setRoute(it.id)}>
          <Icon name={it.icon} className="icon" />
          <span className="label">{it.label}</span>
          {it.badge != null && it.badge > 0 && <span className="badge">{it.badge}</span>}
        </div>
      ))}
    </>
  );

  const wa = window.WA_STATUS || { ready: false, hasQr: false };
  const waColor = wa.ready ? '#588157' : (wa.hasQr ? '#D4A373' : '#9A9690');
  const waText = wa.ready ? 'WhatsApp linked' : (wa.hasQr ? 'Scan QR to link' : 'WhatsApp offline');

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">A</div>
        <div className="brand-name">WhatsApp CRM<span className="accent">.</span></div>
      </div>
      <div className="workspace-switcher">
        <div>
          <div className="ws-name">WhatsApp CRM</div>
          <div className="ws-meta">Sales · Pro plan</div>
        </div>
        <Icon name="caret-down" size={12} />
      </div>
      <nav className="nav">
        {items.map((it) => (
          <div key={it.id} className={'nav-item' + (route === it.id ? ' active' : '')} onClick={() => setRoute(it.id)}>
            <Icon name={it.icon} className="icon" />
            <span className="label">{it.label}</span>
            {it.badge != null && it.badge > 0 && <span className="badge">{it.badge}</span>}
          </div>
        ))}
        <NavGroup title="Workspace" items={work} />
        <NavGroup title="Grow" items={grow} />
        <NavGroup title="System" items={sys} />
      </nav>
      <div onClick={openWaQr} style={{ cursor: 'pointer', borderTop: '1px solid var(--rule)', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: waColor, flexShrink: 0 }}></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-2)', fontWeight: 500 }}>{waText}</div>
          <div style={{ fontSize: 10, color: 'var(--muted-2)' }}>{wa.queueDepth ? `${wa.queueDepth} in queue` : 'Bulk + thread sync'}</div>
        </div>
      </div>
      <div className="sidebar-footer" style={{ cursor: 'default' }}>
        {(() => {
          const u = window.CURRENT_USER;
          const initials = u && u.name ? u.name.split(/\s+/).map((w) => w[0]).join('').slice(0,2).toUpperCase() : 'AS';
          const roleLabel = u ? u.role.replace('_', ' ') : '—';
          return (
            <>
              <Avatar name={initials} color="#E07A5F" />
              <div className="user-meta">
                <div className="user-name trunc">{u ? u.name : 'Signed out'}</div>
                <div className="user-role trunc" style={{ textTransform: 'capitalize' }}>{roleLabel}</div>
              </div>
              <button
                onClick={async () => {
                  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
                  window.location.href = '/login';
                }}
                title="Sign out"
                style={{ background: 'transparent', border: 0, cursor: 'pointer', padding: 6, color: 'var(--muted)' }}
              >
                <span style={{ fontSize: 10, padding: '4px 8px', border: '1px solid var(--rule)', borderRadius: 4 }}>Sign out</span>
              </button>
            </>
          );
        })()}
      </div>
    </aside>
  );
};

const Topbar = ({ crumbs, openCmd, theme, setTheme, openAI, openNotif, openNew }) => {
  return (
    <header className="topbar">
      <div className="crumbs">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="sep"><Icon name="caret-right" size={12} /></span>}
            <span className={i === crumbs.length - 1 ? 'here' : ''}>{c}</span>
          </React.Fragment>
        ))}
      </div>
      <div className="search" onClick={openCmd}>
        <Icon name="search" className="icon" />
        <span className="placeholder">Search contacts, deals, tickets…</span>
        <span className="kbd">⌘K</span>
      </div>
      <div className="top-actions">
        <button className="btn ghost sm" onClick={openAI}>
          <span className="ai-mark"><Icon name="sparkle" size={10}/>AI</span>
          Ask
        </button>
        <button className="icon-btn" data-tip="Theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} className="icon" />
        </button>
        <button className="icon-btn" data-tip="Notifications" onClick={openNotif}>
          <Icon name="bell" className="icon" />
          {(window.NOTIFICATIONS_UNREAD || 0) > 0 && <span className="dot"></span>}
        </button>
        <button className="btn primary sm" onClick={openNew}><Icon name="plus" size={12}/>New</button>
      </div>
    </header>
  );
};

const Sparkline = ({ data, w = 120, h = 32, stroke = 'currentColor', fill }) => {
  if (!data || !data.length) return null;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const stepX = w / Math.max(1, data.length - 1);
  const pts = data.map((d, i) => [i * stepX, h - ((d - min) / range) * (h - 4) - 2]);
  const path = 'M' + pts.map((p) => p.join(',')).join(' L ');
  const area = path + ` L ${w},${h} L 0,${h} Z`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      {fill && <path d={area} fill={fill} opacity="0.15" />}
      <path d={path} stroke={stroke} fill="none" strokeWidth="1.5" />
    </svg>
  );
};

const MiniBars = ({ data, w = 120, h = 32, color = 'currentColor' }) => {
  const max = Math.max(...data, 1);
  const bw = w / data.length - 2;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      {data.map((d, i) => {
        const bh = (d / max) * (h - 2);
        return <rect key={i} x={i * (bw + 2)} y={h - bh} width={bw} height={bh} rx="1" fill={color} />;
      })}
    </svg>
  );
};

const Donut = ({ value, max = 100, size = 60, stroke = 6, color = '#E07A5F', label }) => {
  const r = size / 2 - stroke;
  const c = 2 * Math.PI * r;
  const pct = Math.min(1, value / max);
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(26,26,26,0.08)" strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      {label && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: size / 4.5, fontWeight: 600 }}>{label}</div>}
    </div>
  );
};

Object.assign(window, { Avatar, Sidebar, Topbar, Sparkline, MiniBars, Donut });
