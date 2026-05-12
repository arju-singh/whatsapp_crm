// =============================================================
// Tasks, Calendar, Inbox views
// =============================================================

const Tasks = () => {
  const [tasks, setTasks] = React.useState(TASKS);
  const [filter, setFilter] = React.useState('all');
  const toggle = (id) => setTasks(tasks.map(t => t.id === id ? {...t, done: !t.done} : t));
  const groups = { Overdue: [], Today: [], Tomorrow: [], 'This week': [], Later: [] };
  const today = '2026-05-07';
  tasks.forEach(t => {
    if (filter === 'mine' && t.owner !== 'You') return;
    if (filter === 'done' && !t.done) return;
    if (filter === 'open' && t.done) return;
    if (t.due < today) groups.Overdue.push(t);
    else if (t.due === today) groups.Today.push(t);
    else if (t.due === '2026-05-08') groups.Tomorrow.push(t);
    else if (t.due <= '2026-05-13') groups['This week'].push(t);
    else groups.Later.push(t);
  });
  const typeIcon = { email:'mail', call:'phone', meeting:'meeting', task:'check-list' };
  return (
    <div className="page slide-up">
      <div className="page-h">
        <div>
          <div className="page-eyebrow">{tasks.filter(t=>!t.done).length} open · {tasks.filter(t=>t.done).length} done</div>
          <h1 className="page-title">Things to <em>do</em></h1>
        </div>
        <div className="page-actions">
          <div className="row" style={{background:'var(--card)', border:'1px solid var(--rule)', borderRadius: 6, padding: 2}}>
            {['all','mine','open','done'].map(k => <button key={k} className={'btn sm ' + (filter===k?'primary':'ghost')} onClick={()=>setFilter(k)}>{k}</button>)}
          </div>
          <button className="btn primary"><Icon name="plus" size={12}/>New task</button>
        </div>
      </div>

      <div style={{display:'flex', flexDirection:'column', gap: 24}}>
        {Object.entries(groups).filter(([,v]) => v.length > 0).map(([title, items]) => (
          <div key={title}>
            <div className="row" style={{gap: 8, marginBottom: 8}}>
              <div className="serif" style={{fontSize: 18}}>{title}</div>
              <span className="chip">{items.length}</span>
              {title === 'Overdue' && <span className="chip accent">needs attention</span>}
            </div>
            <div className="card" style={{padding: 0}}>
              {items.map((t, i) => (
                <div key={t.id} className="row" style={{padding:'12px 16px', borderBottom: i < items.length-1 ? '1px solid var(--rule-2)' : 'none', gap: 12}}>
                  <input type="checkbox" checked={t.done} onChange={()=>toggle(t.id)}/>
                  <Icon name={typeIcon[t.type]} size={14} style={{color:'var(--muted)'}}/>
                  <div style={{flex: 1, textDecoration: t.done ? 'line-through' : 'none', opacity: t.done ? 0.5 : 1}}>
                    <div style={{fontSize: 13, fontWeight: 500}}>{t.title}</div>
                    {t.dealId && <div style={{fontSize: 11, color:'var(--muted)'}}>{DEALS.find(d=>d.id===t.dealId)?.name}</div>}
                  </div>
                  <span className={'chip ' + (t.priority==='high'?'accent':t.priority==='med'?'ochre':'gray')} style={{fontSize: 10}}>{t.priority}</span>
                  <span style={{fontSize: 11, color:'var(--muted)', minWidth: 90}}>{t.due}</span>
                  <Avatar name={t.owner === 'You' ? 'AS' : t.owner.split(' ').map(s=>s[0]).join('')} color={t.owner === 'You' ? '#E07A5F' : '#3D5A80'} size="sm"/>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const Calendar = () => {
  const days = ['Mon','Tue','Wed','Thu','Fri'];
  const hours = Array.from({length: 11}, (_, i) => 8 + i); // 8 AM - 6 PM
  const events = [
    { day: 0, start: 9, end: 10, title: 'Standup', color: '#7A7670' },
    { day: 0, start: 10, end: 11, title: 'Northwind procurement', color: '#3D5A80', deal: 'Northwind Multi-site' },
    { day: 0, start: 14, end: 15.5, title: 'Pipeline review', color: '#6B4E71' },
    { day: 1, start: 9, end: 10, title: 'Casita onboarding', color: '#588157' },
    { day: 1, start: 10, end: 11, title: 'Aperture eng demo', color: '#E07A5F', deal: 'Aperture Enterprise' },
    { day: 1, start: 13, end: 14, title: '1:1 — Yara', color: '#7A7670' },
    { day: 1, start: 16, end: 17, title: 'Helia close call', color: '#E07A5F' },
    { day: 2, start: 11, end: 12, title: 'Mercer redlines', color: '#D4A373' },
    { day: 2, start: 14, end: 15, title: 'Forecast prep', color: '#3D5A80' },
    { day: 3, start: 9, end: 10.5, title: 'Tessera contract', color: '#E07A5F' },
    { day: 3, start: 11, end: 12, title: 'Plumb check-in', color: '#588157' },
    { day: 3, start: 15, end: 16, title: 'Stellaris pilot kickoff', color: '#6B4E71' },
    { day: 4, start: 10, end: 11, title: 'Q2 board prep', color: '#7A7670' },
    { day: 4, start: 14, end: 15, title: 'Team sync', color: '#3D5A80' },
  ];
  return (
    <div className="page slide-up" style={{maxWidth: 1400}}>
      <div className="page-h">
        <div>
          <div className="page-eyebrow">May 4 – May 8 · Week 19</div>
          <h1 className="page-title">Your <em>week</em></h1>
        </div>
        <div className="page-actions">
          <button className="btn"><Icon name="chevron-l" size={12}/></button>
          <button className="btn">Today</button>
          <button className="btn"><Icon name="chevron-r" size={12}/></button>
          <button className="btn primary"><Icon name="plus" size={12}/>New event</button>
        </div>
      </div>

      <div className="card" style={{overflow:'hidden'}}>
        <div style={{display:'grid', gridTemplateColumns:'56px repeat(5, 1fr)', borderBottom:'1px solid var(--rule)'}}>
          <div></div>
          {days.map((d, i) => (
            <div key={d} style={{padding:'12px 16px', borderLeft:'1px solid var(--rule-2)', textAlign:'center'}}>
              <div style={{fontSize: 11, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.08em'}}>{d}</div>
              <div className="serif" style={{fontSize: 22, color: i === 2 ? 'var(--accent)' : 'var(--ink)'}}>{4+i}</div>
            </div>
          ))}
        </div>
        <div style={{display:'grid', gridTemplateColumns:'56px repeat(5, 1fr)', position:'relative', minHeight: 540}}>
          <div>
            {hours.map(h => (
              <div key={h} style={{height: 56, padding:'2px 8px', fontSize: 10, color:'var(--muted)', textAlign:'right', borderBottom:'1px solid var(--rule-2)'}}>
                {h % 12 || 12}{h < 12 ? 'a' : 'p'}
              </div>
            ))}
          </div>
          {days.map((d, di) => (
            <div key={d} style={{borderLeft:'1px solid var(--rule-2)', position:'relative'}}>
              {hours.map(h => <div key={h} style={{height: 56, borderBottom:'1px solid var(--rule-2)'}}></div>)}
              {events.filter(e => e.day === di).map((e, i) => {
                const top = (e.start - 8) * 56;
                const height = (e.end - e.start) * 56 - 4;
                return (
                  <div key={i} style={{
                    position:'absolute', top: top+2, left: 4, right: 4, height,
                    background: e.color + '22', borderLeft: `3px solid ${e.color}`,
                    borderRadius: 4, padding:'4px 8px', fontSize: 11, overflow:'hidden', cursor:'pointer'
                  }}>
                    <div style={{fontWeight: 600}}>{e.title}</div>
                    {e.deal && <div style={{fontSize: 10, color:'var(--muted)'}}>{e.deal}</div>}
                    <div className="mono" style={{fontSize: 10, color: e.color, marginTop: 2}}>{e.start % 12 || 12}:{(e.start*60)%60===0?'00':'30'} – {Math.floor(e.end) % 12 || 12}:{(e.end*60)%60===0?'00':'30'}</div>
                  </div>
                );
              })}
              {di === 2 && <div style={{position:'absolute', top: (10.5-8)*56, left: 0, right: 0, height: 2, background: 'var(--accent)', zIndex: 2}}><div style={{width: 8, height: 8, borderRadius: '50%', background:'var(--accent)', marginLeft: -4, marginTop: -3}}></div></div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const Inbox = () => {
  const messages = [
    { id: 'm1', from: 'Sana Mehrotra', avatar:'SM', color:'#E07A5F', subject:'Re: Revised proposal — Helia', preview:'Looks great — one ask: can we move payment terms to NET-45?', time:'2 min', unread: true, deal:'Helia Annual'},
    { id: 'm2', from: 'Devika Rao', avatar:'DR', color:'#2B59C3', subject:'POC pushed to staging', preview:'Wanted to share the early results from the integration test...', time:'38 min', unread: true, deal:'Aperture Enterprise'},
    { id: 'm3', from: 'Itzel Bautista', avatar:'IB', color:'#81B29A', subject:'Re: Send case study', preview:'Great — looking forward to reviewing it with the team Thursday.', time:'1 h', unread: true},
    { id: 'm4', from: 'Marcus Thackeray', avatar:'MT', color:'#3D5A80', subject:'Procurement timeline', preview:'Just heard back from procurement — they want to review three vendors before...', time:'3 h', unread: false, deal:'Northwind'},
    { id: 'm5', from: 'Edward Mercer', avatar:'EM', color:'#1B1B1E', subject:'NDA + redlines', preview:'I’ve attached the redlined version of the NDA. Our standard terms include...', time:'Yesterday', unread: false},
    { id: 'm6', from: 'Halle Korr', avatar:'HK', color:'#A47148', subject:'Expansion conversation', preview:'I think we’re ready to talk about the expansion package we discussed.', time:'Yesterday', unread: false},
    { id: 'm7', from: 'Bao Tran', avatar:'BT', color:'#414535', subject:'Two more intros', preview:'Hi Aria — I’d like to introduce you to two founders in our portfolio who...', time:'2 d', unread: false},
    { id: 'm8', from: 'Dr. Asher Levin', avatar:'AL', color:'#C9184A', subject:'Compliance review passed', preview:'Good news — our security and compliance team approved the integration.', time:'2 d', unread: false, deal:'Tessera Compliance'},
  ];
  const [selected, setSelected] = React.useState(messages[0]);
  return (
    <div className="page slide-up" style={{maxWidth: 1500, padding: '20px 24px'}}>
      <div className="page-h" style={{paddingBottom: 12}}>
        <div>
          <div className="page-eyebrow">3 unread · 5 awaiting reply</div>
          <h1 className="page-title">Your <em>inbox</em></h1>
        </div>
        <div className="page-actions">
          <button className="btn"><Icon name="filter" size={12}/>All</button>
          <button className="btn"><Icon name="archive" size={12}/></button>
          <button className="btn primary"><Icon name="edit" size={12}/>Compose</button>
        </div>
      </div>
      <div style={{display:'grid', gridTemplateColumns:'380px 1fr', gap: 12, height: 'calc(100vh - 220px)'}}>
        <div className="card" style={{padding: 0, overflow:'hidden', display:'flex', flexDirection:'column'}}>
          <div style={{padding: 8, borderBottom:'1px solid var(--rule-2)'}}>
            <div className="row" style={{background:'var(--paper-2)', borderRadius: 6, padding:'4px 10px'}}>
              <Icon name="search" size={14} style={{color:'var(--muted)'}}/>
              <input placeholder="Search mail" style={{border: 0, background:'transparent', flex: 1, padding:'4px 0', outline:'none'}}/>
            </div>
          </div>
          <div style={{flex: 1, overflowY:'auto'}}>
            {messages.map(m => (
              <div key={m.id} onClick={()=>setSelected(m)} style={{padding:'12px 14px', borderBottom:'1px solid var(--rule-2)', cursor:'pointer', background: selected.id === m.id ? 'var(--accent-soft)' : (m.unread ? 'var(--paper)' : 'transparent')}}>
                <div className="row" style={{gap: 10}}>
                  <Avatar name={m.avatar} color={m.color}/>
                  <div style={{flex: 1, minWidth: 0}}>
                    <div className="row" style={{justifyContent:'space-between'}}>
                      <span style={{fontWeight: m.unread ? 700 : 500, fontSize: 13}}>{m.from}</span>
                      <span style={{fontSize: 11, color:'var(--muted)'}}>{m.time}</span>
                    </div>
                    <div style={{fontSize: 12, fontWeight: m.unread ? 600 : 400}} className="trunc">{m.subject}</div>
                    <div style={{fontSize: 11, color:'var(--muted)', marginTop: 2}} className="trunc">{m.preview}</div>
                    {m.deal && <span className="chip" style={{fontSize: 10, marginTop: 4}}>{m.deal}</span>}
                  </div>
                  {m.unread && <span style={{width: 8, height: 8, background:'var(--accent)', borderRadius:'50%', flexShrink: 0}}></span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{display:'flex', flexDirection:'column', overflow:'hidden'}}>
          <div className="card-h">
            <div>
              <div className="card-title">{selected.subject}</div>
              <div className="card-sub">From <strong>{selected.from}</strong> · {selected.time} ago</div>
            </div>
            <div className="row" style={{gap: 4}}>
              <button className="icon-btn"><Icon name="archive" size={14}/></button>
              <button className="icon-btn"><Icon name="trash" size={14}/></button>
            </div>
          </div>
          <div style={{padding: 24, flex: 1, overflowY:'auto', fontSize: 14, lineHeight: 1.7, color:'var(--ink-2)'}}>
            <p>Hi Aria,</p>
            <p>{selected.preview}</p>
            <p>We had a chance to review the proposal yesterday with the team. Overall the approach looks really strong — the implementation timeline aligns with what our ops team had in mind, and the pricing came in within range.</p>
            <p>One ask: would you be open to NET-45 payment terms? Our standard is NET-30 but given the size of the engagement, our finance team would prefer the longer cycle. Happy to discuss on a call.</p>
            <p>Best,<br/>{selected.from}</p>
            <div className="ai-glow" style={{marginTop: 24, padding: 14, borderRadius: 8}}>
              <div className="row" style={{gap: 6, marginBottom: 8}}>
                <span className="ai-mark"><Icon name="sparkle" size={10}/>Smart reply</span>
                <strong style={{fontSize: 13}}>3 suggested responses</strong>
              </div>
              <div style={{display:'flex', gap: 6, flexWrap:'wrap'}}>
                <button className="btn sm">Accept NET-45</button>
                <button className="btn sm">Counter at NET-30 with 2% discount</button>
                <button className="btn sm">Loop in finance</button>
              </div>
            </div>
          </div>
          <div style={{padding: 16, borderTop:'1px solid var(--rule-2)'}}>
            <textarea placeholder="Reply..." style={{width:'100%', minHeight: 80, padding: 10, border:'1px solid var(--rule)', borderRadius: 6, background:'var(--paper)', resize:'vertical', outline:'none'}}/>
            <div className="row" style={{marginTop: 8, gap: 6}}>
              <button className="btn primary"><Icon name="send" size={12}/>Send</button>
              <button className="btn"><Icon name="attach" size={12}/></button>
              <div className="spacer"/>
              <button className="btn ghost"><span className="ai-mark"><Icon name="sparkle" size={10}/>AI</span>Draft</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { Tasks, Calendar, Inbox });
