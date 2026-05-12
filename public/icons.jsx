// =============================================================
// Icons — minimal stroke icons, no emoji.
// =============================================================
const Icon = ({ name, size = 16, ...rest }) => {
  const props = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', ...rest };
  switch (name) {
    case 'home':       return <svg {...props}><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>;
    case 'dashboard':  return <svg {...props}><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>;
    case 'people':     return <svg {...props}><circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.5 3-6 7-6s7 2.5 7 6"/><circle cx="17" cy="6" r="2.5"/><path d="M22 17c0-2.5-2-4-4.5-4"/></svg>;
    case 'building':   return <svg {...props}><rect x="4" y="3" width="16" height="18"/><path d="M9 21V12h6v9"/><path d="M8 7h2M8 10h2M14 7h2M14 10h2"/></svg>;
    case 'pipeline':   return <svg {...props}><rect x="2" y="4" width="6" height="16"/><rect x="9" y="4" width="6" height="11"/><rect x="16" y="4" width="6" height="7"/></svg>;
    case 'check-list': return <svg {...props}><path d="M9 6h12M9 12h12M9 18h12"/><path d="m3 6 1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17"/></svg>;
    case 'calendar':   return <svg {...props}><rect x="3" y="5" width="18" height="16" rx="1"/><path d="M3 9h18M8 3v4M16 3v4"/></svg>;
    case 'mail':       return <svg {...props}><rect x="3" y="5" width="18" height="14" rx="1"/><path d="m3 7 9 6 9-6"/></svg>;
    case 'chart':      return <svg {...props}><path d="M3 3v18h18"/><path d="m7 14 3-3 3 4 5-7"/></svg>;
    case 'megaphone':  return <svg {...props}><path d="M3 11v2a3 3 0 0 0 3 3h1l5 4V4L7 8H6a3 3 0 0 0-3 3z"/><path d="M16 8a4 4 0 0 1 0 8"/></svg>;
    case 'ticket':     return <svg {...props}><path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"/><path d="M9 6v12"/></svg>;
    case 'flow':       return <svg {...props}><circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="12" r="2"/><path d="M8 6h6a2 2 0 0 1 2 2v2"/><path d="M8 18h6a2 2 0 0 0 2-2v-2"/></svg>;
    case 'bolt':       return <svg {...props}><path d="m13 2-9 12h6l-1 8 9-12h-6z"/></svg>;
    case 'settings':   return <svg {...props}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>;
    case 'team':       return <svg {...props}><circle cx="12" cy="8" r="3"/><circle cx="5" cy="10" r="2.5"/><circle cx="19" cy="10" r="2.5"/><path d="M3 18c0-2.5 2-4 4.5-4M21 18c0-2.5-2-4-4.5-4M7 20c0-3 2.5-5 5-5s5 2 5 5"/></svg>;
    case 'plus':       return <svg {...props}><path d="M12 5v14M5 12h14"/></svg>;
    case 'search':     return <svg {...props}><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>;
    case 'filter':     return <svg {...props}><path d="M3 5h18l-7 9v6l-4-2v-4z"/></svg>;
    case 'sort':       return <svg {...props}><path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4"/></svg>;
    case 'arrow-up':   return <svg {...props}><path d="M12 19V5M5 12l7-7 7 7"/></svg>;
    case 'arrow-down': return <svg {...props}><path d="M12 5v14M5 12l7 7 7-7"/></svg>;
    case 'arrow-right':return <svg {...props}><path d="M5 12h14M12 5l7 7-7 7"/></svg>;
    case 'caret-down': return <svg {...props}><path d="m6 9 6 6 6-6"/></svg>;
    case 'caret-right':return <svg {...props}><path d="m9 6 6 6-6 6"/></svg>;
    case 'x':          return <svg {...props}><path d="M18 6 6 18M6 6l12 12"/></svg>;
    case 'check':      return <svg {...props}><path d="m5 12 5 5 9-11"/></svg>;
    case 'dot-3':      return <svg {...props}><circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="19" cy="12" r="1.2" fill="currentColor"/></svg>;
    case 'phone':      return <svg {...props}><path d="M5 4h4l2 5-3 2a12 12 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>;
    case 'note':       return <svg {...props}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M9 13h6M9 17h6"/></svg>;
    case 'meeting':    return <svg {...props}><rect x="2" y="6" width="14" height="12" rx="2"/><path d="m16 10 6-3v10l-6-3z"/></svg>;
    case 'tag':        return <svg {...props}><path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="8" cy="8" r="1.5"/></svg>;
    case 'star':       return <svg {...props}><path d="m12 2 3 7 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/></svg>;
    case 'flame':      return <svg {...props}><path d="M12 2c2 5 6 6 6 11a6 6 0 1 1-12 0c0-3 2-4 3-7 0 2 1 3 2 3 0-2 0-4 1-7z"/></svg>;
    case 'sparkle':    return <svg {...props}><path d="M12 3v6M12 15v6M3 12h6M15 12h6M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3"/></svg>;
    case 'play':       return <svg {...props}><path d="m6 4 14 8-14 8z"/></svg>;
    case 'pause':      return <svg {...props}><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>;
    case 'bell':       return <svg {...props}><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8z"/><path d="M10 21a2 2 0 0 0 4 0"/></svg>;
    case 'inbox':      return <svg {...props}><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5 4h14l3 8v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/></svg>;
    case 'attach':     return <svg {...props}><path d="m21 12-9 9a5 5 0 0 1-7-7l9-9a3 3 0 1 1 4 4l-9 9a1 1 0 1 1-1-1l8-8"/></svg>;
    case 'send':       return <svg {...props}><path d="m22 2-7 20-4-9-9-4z"/></svg>;
    case 'globe':      return <svg {...props}><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>;
    case 'link':       return <svg {...props}><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>;
    case 'doc':        return <svg {...props}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>;
    case 'money':      return <svg {...props}><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M5 9v.01M19 15v.01"/></svg>;
    case 'pin':        return <svg {...props}><path d="M12 22s7-7 7-12a7 7 0 1 0-14 0c0 5 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>;
    case 'github':     return <svg {...props}><path d="M9 19c-4 1-4-2-6-2m12 5v-3.5a3 3 0 0 0-1-2.3c3.4-.4 7-1.7 7-7.5 0-1.5-.5-3-1.6-4 .5-1.4.5-3 0-4.5 0 0-1.3 0-3 1.7a13 13 0 0 0-7 0C7.7-1 6.4-1 6.4-1c-.6 1.5-.6 3 0 4.5C5.3 4.5 4.7 6 4.8 7.5c0 5.7 3.5 7 7 7.5a3 3 0 0 0-1 2.3V21"/></svg>;
    case 'slack':      return <svg {...props}><rect x="13" y="2" width="3" height="9" rx="1.5"/><rect x="2" y="13" width="9" height="3" rx="1.5"/><rect x="13" y="13" width="9" height="3" rx="1.5"/><rect x="8" y="2" width="3" height="9" rx="1.5"/></svg>;
    case 'lightning':  return <svg {...props}><path d="m13 2-9 12h6l-1 8 9-12h-6z"/></svg>;
    case 'chevron-l':  return <svg {...props}><path d="m15 6-6 6 6 6"/></svg>;
    case 'chevron-r':  return <svg {...props}><path d="m9 6 6 6-6 6"/></svg>;
    case 'expand':     return <svg {...props}><path d="M4 4h6M4 4v6M20 4h-6M20 4v6M4 20h6M4 20v-6M20 20h-6M20 20v-6"/></svg>;
    case 'eye':        return <svg {...props}><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>;
    case 'edit':       return <svg {...props}><path d="M12 20h9"/><path d="M16.5 3.5 20.5 7.5 7 21H3v-4z"/></svg>;
    case 'trash':      return <svg {...props}><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M5 6l1 14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-14"/></svg>;
    case 'archive':    return <svg {...props}><rect x="2" y="3" width="20" height="5"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M9 12h6"/></svg>;
    case 'merge':      return <svg {...props}><circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="12" r="2"/><path d="M8 6c0 6 4 6 8 6M8 18c0-6 4-6 8-6"/></svg>;
    case 'grip':       return <svg {...props}><circle cx="9" cy="6" r="1" fill="currentColor"/><circle cx="9" cy="12" r="1" fill="currentColor"/><circle cx="9" cy="18" r="1" fill="currentColor"/><circle cx="15" cy="6" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/><circle cx="15" cy="18" r="1" fill="currentColor"/></svg>;
    case 'sun':        return <svg {...props}><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/></svg>;
    case 'moon':       return <svg {...props}><path d="M21 13a9 9 0 1 1-10-10 7 7 0 0 0 10 10z"/></svg>;
    default: return <svg {...props}><circle cx="12" cy="12" r="9"/></svg>;
  }
};

window.Icon = Icon;
