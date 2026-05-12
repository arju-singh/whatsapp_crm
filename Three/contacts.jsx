// =============================================================
// Contacts & Companies — searchable, filterable tables
// =============================================================

const ContactRow = ({ c, onOpen }) => {
  const co = getCompany(c.companyId);
  return (
    <tr onClick={() => onOpen(c)} style={{cursor:'pointer'}}>
      <td style={{width: 36}}><input type="checkbox" onClick={e=>e.stopPropagation()}/></td>
      <td>
        <div className="row" style={{gap: 10}}>
          <Avatar name={c.avatar} color={co?.color || '#7A7670'}/>
          <div>
            <div style={{fontWeight: 600, fontSize: 13}}>{c.name}</div>
            <div style={{fontSize: 11, color:'var(--muted)'}}>{c.title}</div>
          </div>
        </div>
      </td>
      <td>
        <div className="row" style={{gap: 6}}>
          <span style={{width: 16, height: 16, borderRadius: 3, background: co.color, color:'white', fontSize: 8, display:'grid', placeItems:'center', fontWeight: 700}}>{co.logo}</span>
          <span style={{fontSize: 12}}>{co.name}</span>
        </div>
      </td>
      <td><div className="mono" style={{fontSize: 11, color:'var(--ink-3)'}}>{c.email}</div></td>
      <td>
        <div className="row" style={{gap: 4, flexWrap:'wrap'}}>
          {c.tags.map(t => <span key={t} className="chip" style={{fontSize: 10}}>{t}</span>)}
        </div>
      </td>
      <td>
        <div className="row" style={{gap: 8}}>
          <div style={{flex: 1, height: 4, background:'var(--paper-2)', borderRadius: 2, overflow:'hidden'}}>
            <div style={{width: `${c.score}%`, height:'100%', background: c.score >= 80 ? 'var(--sage)' : c.score >= 60 ? 'var(--ochre)' : 'var(--muted)'}}></div>
          </div>
          <span className="mono" style={{fontSize: 11, width: 24, textAlign:'right'}}>{c.score}</span>
        </div>
      </td>
      <td><span style={{fontSize: 11, color:'var(--muted)'}}>{c.lastTouch}</span></td>
      <td><span style={{fontSize: 11}}>{c.owner}</span></td>
    </tr>
  );
};

const ContactDrawer = ({ contact, onClose }) => {
  if (!contact) return null;
  const co = getCompany(contact.companyId);
  const deals = DEALS.filter(d => d.contactId === contact.id);
  const acts = ACTIVITIES.filter(a => deals.some(d => d.id === a.dealId));
  return (
    <>
      <div className="drawer-overlay" onClick={onClose}/>
      <div className="drawer">
        <div style={{padding:'18px 24px', borderBottom:'1px solid var(--rule-2)', display:'flex', justifyContent:'space-between', alignItems:'flex-start'}}>
          <div className="row" style={{gap: 14}}>
            <Avatar name={contact.avatar} color={co.color} size="xl"/>
            <div>
              <div className="serif" style={{fontSize: 24, letterSpacing:'-0.02em'}}>{contact.name}</div>
              <div style={{color:'var(--muted)', fontSize: 13}}>{contact.title} at <strong style={{color:'var(--ink-2)'}}>{co.name}</strong></div>
              <div className="row" style={{gap: 4, marginTop: 8}}>
                {contact.tags.map(t => <span key={t} className="chip">{t}</span>)}
              </div>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x"/></button>
        </div>
        <div style={{padding:'12px 24px', borderBottom:'1px solid var(--rule-2)', display:'flex', gap: 6}}>
          <button className="btn sm"><Icon name="mail" size={12}/>Email</button>
          <button className="btn sm"><Icon name="phone" size={12}/>Call</button>
          <button className="btn sm"><Icon name="meeting" size={12}/>Meet</button>
          <button className="btn sm"><Icon name="note" size={12}/>Note</button>
          <button className="btn sm"><Icon name="check-list" size={12}/>Task</button>
          <div className="spacer"/>
          <button className="btn sm ghost"><Icon name="dot-3" size={14}/></button>
        </div>
        <div style={{flex: 1, overflowY:'auto'}}>
          <div className="ai-glow" style={{margin: 24, padding: 14, borderRadius: 8}}>
            <div className="row" style={{gap: 6, marginBottom: 6}}>
              <span className="ai-mark"><Icon name="sparkle" size={10}/>AI</span>
              <strong style={{fontSize: 13}}>Lead score {contact.score}</strong>
            </div>
            <div style={{fontSize: 12, color:'var(--ink-3)'}}>{contact.ai}</div>
          </div>

          <div style={{padding:'0 24px 24px'}}>
            <div className="card-title" style={{marginBottom: 12, fontSize: 14}}>Details</div>
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap: 12}}>
              <div><div style={{fontSize: 10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.08em'}}>Email</div><div className="mono" style={{fontSize: 12}}>{contact.email}</div></div>
              <div><div style={{fontSize: 10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.08em'}}>Phone</div><div className="mono" style={{fontSize: 12}}>{contact.phone}</div></div>
              <div><div style={{fontSize: 10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.08em'}}>Owner</div><div style={{fontSize: 12}}>{contact.owner}</div></div>
              <div><div style={{fontSize: 10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.08em'}}>Last touch</div><div style={{fontSize: 12}}>{contact.lastTouch}</div></div>
            </div>

            <div className="card-title" style={{margin:'24px 0 12px', fontSize: 14}}>Open deals · {deals.length}</div>
            <div style={{display:'flex', flexDirection:'column', gap: 8}}>
              {deals.map(d => {
                const st = getStage(d.stage);
                return (
                  <div key={d.id} className="row" style={{padding: 12, border:'1px solid var(--rule-2)', borderRadius: 6, gap: 10}}>
                    <div style={{flex: 1}}>
                      <div style={{fontWeight: 600, fontSize: 13}}>{d.name}</div>
                      <div style={{fontSize: 11, color:'var(--muted)'}}>{st.name} · {fmtMoney(d.amount)} · close {d.close}</div>
                    </div>
                    <span className="chip dot" style={{color: st.color}}>{d.forecast}</span>
                  </div>
                );
              })}
            </div>

            <div className="card-title" style={{margin:'24px 0 12px', fontSize: 14}}>Timeline</div>
            <ActivityFeed items={acts.length ? acts : ACTIVITIES.slice(0,4)}/>
          </div>
        </div>
      </div>
    </>
  );
};

const Contacts = () => {
  const [q, setQ] = React.useState('');
  const [tag, setTag] = React.useState('all');
  const [open, setOpen] = React.useState(null);
  const allTags = Array.from(new Set(CONTACTS.flatMap(c => c.tags)));
  const filtered = CONTACTS.filter(c => {
    if (q && !(c.name + c.email + c.title).toLowerCase().includes(q.toLowerCase())) return false;
    if (tag !== 'all' && !c.tags.includes(tag)) return false;
    return true;
  });
  return (
    <div className="page slide-up">
      <div className="page-h">
        <div>
          <div className="page-eyebrow">12 contacts · 3 added this week</div>
          <h1 className="page-title">People in your <em>orbit</em></h1>
          <div className="page-sub">Champions, decision-makers, evaluators — everyone moving deals forward.</div>
        </div>
        <div className="page-actions">
          <button className="btn"><Icon name="link" size={12}/>Import</button>
          <button className="btn"><Icon name="merge" size={12}/>Merge dupes</button>
          <button className="btn primary"><Icon name="plus" size={12}/>New contact</button>
        </div>
      </div>

      <div className="row" style={{gap: 8, marginBottom: 12, flexWrap:'wrap'}}>
        <div className="row" style={{background:'var(--card)', border:'1px solid var(--rule)', borderRadius: 6, padding:'4px 10px', gap: 6, flex: 1, maxWidth: 320}}>
          <Icon name="search" size={14} style={{color:'var(--muted)'}}/>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search by name, email, title…" style={{border: 0, background:'transparent', flex: 1, padding: '4px 0', outline: 'none'}}/>
        </div>
        <div className="row" style={{gap: 4}}>
          <button className={'chip ' + (tag==='all'?'accent':'')} onClick={()=>setTag('all')}>All</button>
          {allTags.map(t => <button key={t} className={'chip ' + (tag===t?'accent':'')} onClick={()=>setTag(t)}>{t}</button>)}
        </div>
        <div className="spacer"/>
        <button className="btn sm"><Icon name="filter" size={12}/>Filters</button>
        <button className="btn sm"><Icon name="sort" size={12}/>Sort</button>
        <button className="btn sm"><Icon name="doc" size={12}/>Export</button>
      </div>

      <div className="card" style={{padding: 0, overflow:'hidden'}}>
        <div style={{maxHeight: 'calc(100vh - 320px)', overflow: 'auto'}}>
          <table className="table">
            <thead>
              <tr>
                <th></th><th>Name</th><th>Company</th><th>Email</th><th>Tags</th><th style={{width: 140}}>Score</th><th>Last touch</th><th>Owner</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => <ContactRow key={c.id} c={c} onOpen={setOpen}/>)}
            </tbody>
          </table>
        </div>
      </div>
      {open && <ContactDrawer contact={open} onClose={()=>setOpen(null)}/>}
    </div>
  );
};

const Companies = () => {
  return (
    <div className="page slide-up">
      <div className="page-h">
        <div>
          <div className="page-eyebrow">10 active accounts · $327.8k MRR</div>
          <h1 className="page-title">Companies you <em>care about</em></h1>
        </div>
        <div className="page-actions">
          <button className="btn"><Icon name="filter" size={12}/>Tier: All</button>
          <button className="btn primary"><Icon name="plus" size={12}/>New company</button>
        </div>
      </div>
      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap: 12}}>
        {COMPANIES.map(co => {
          const contactsCount = CONTACTS.filter(c => c.companyId === co.id).length;
          const dealValue = DEALS.filter(d => d.companyId === co.id && d.stage !== 's5' && d.stage !== 's6').reduce((s,d)=>s+d.amount, 0);
          return (
            <div key={co.id} className="card" style={{padding: 16, cursor:'pointer', transition:'all .15s'}}>
              <div className="row" style={{gap: 10, marginBottom: 12}}>
                <div style={{width: 40, height: 40, borderRadius: 8, background: co.color, color:'white', display:'grid', placeItems:'center', fontWeight: 700, fontSize: 14}}>{co.logo}</div>
                <div style={{flex: 1, minWidth: 0}}>
                  <div style={{fontWeight: 600, fontSize: 14}} className="trunc">{co.name}</div>
                  <div className="mono" style={{fontSize: 11, color:'var(--muted)'}}>{co.domain}</div>
                </div>
                <span className={'chip ' + (co.tier === 'Enterprise' ? 'plum' : co.tier === 'Growth' ? 'blue' : 'gray')}>{co.tier}</span>
              </div>
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap: 8, marginBottom: 12}}>
                <div>
                  <div style={{fontSize: 10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.08em'}}>MRR</div>
                  <div className="serif" style={{fontSize: 18}}>{fmtMoney(co.mrr)}</div>
                </div>
                <div>
                  <div style={{fontSize: 10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.08em'}}>Open pipe</div>
                  <div className="serif" style={{fontSize: 18, color: dealValue ? 'var(--accent-ink)' : 'var(--muted)'}}>{dealValue ? fmtMoney(dealValue) : '—'}</div>
                </div>
              </div>
              <div className="row" style={{justifyContent:'space-between', fontSize: 11, color:'var(--muted)', borderTop:'1px solid var(--rule-2)', paddingTop: 10}}>
                <span>{co.industry} · {co.size}</span>
                <span>{contactsCount} contacts</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

Object.assign(window, { Contacts, Companies, ContactDrawer });
