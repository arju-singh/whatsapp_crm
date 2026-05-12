// =============================================================
// Deals — Kanban pipeline + table view + deal detail drawer
// =============================================================

const DealCard = ({ deal, onOpen, onDragStart }) => {
  const co = getCompany(deal.companyId);
  const ct = getContact(deal.contactId);
  const st = getStage(deal.stage);
  const priColor = deal.priority === 'high' ? 'var(--accent)' : deal.priority === 'med' ? 'var(--ochre)' : 'var(--muted-2)';
  return (
    <div
      className="card"
      draggable
      onDragStart={(e)=>onDragStart(e, deal)}
      onClick={()=>onOpen(deal)}
      style={{padding: 12, marginBottom: 8, cursor:'grab', background:'var(--card)', borderLeft: `3px solid ${priColor}`, transition:'all .12s'}}
    >
      <div className="row" style={{gap: 8, marginBottom: 8}}>
        <div style={{width: 22, height: 22, borderRadius: 4, background: co.color, color:'white', fontSize: 9, display:'grid', placeItems:'center', fontWeight: 700, flexShrink: 0}}>{co.logo}</div>
        <div style={{flex: 1, minWidth: 0}}>
          <div style={{fontSize: 12, fontWeight: 600}} className="trunc">{deal.name}</div>
          <div style={{fontSize: 11, color:'var(--muted)'}} className="trunc">{co.name}</div>
        </div>
      </div>
      <div className="row" style={{justifyContent:'space-between', marginBottom: 8}}>
        <div className="serif" style={{fontSize: 18, letterSpacing:'-0.01em'}}>{fmtMoney(deal.amount)}</div>
        <div className="row" style={{gap: 4}}>
          {deal.score >= 85 && <Icon name="flame" size={12} style={{color:'var(--accent)'}}/>}
          <span className="mono" style={{fontSize: 10, color:'var(--muted)'}}>{deal.score}</span>
        </div>
      </div>
      <div className="row" style={{justifyContent:'space-between'}}>
        <div className="row" style={{gap: 4}}>
          <Avatar name={ct?.avatar || '?'} color={co.color} size="sm"/>
          <span style={{fontSize: 11, color:'var(--muted)'}}>{deal.close}</span>
        </div>
        <span className={'chip ' + (deal.forecast === 'commit' ? 'sage' : deal.forecast === 'best-case' ? 'blue' : 'gray')} style={{fontSize: 9}}>{deal.forecast}</span>
      </div>
    </div>
  );
};

const PipelineKanban = ({ onOpen, deals, setDeals }) => {
  const [drag, setDrag] = React.useState(null);
  const [over, setOver] = React.useState(null);
  const onDragStart = (e, d) => { setDrag(d); e.dataTransfer.effectAllowed='move'; };
  const onDrop = (e, stageId) => {
    e.preventDefault();
    if (drag && drag.stage !== stageId) {
      setDeals(deals.map(d => d.id === drag.id ? {...d, stage: stageId} : d));
    }
    setDrag(null); setOver(null);
  };
  return (
    <div style={{display:'grid', gridTemplateColumns:`repeat(${STAGES.length}, minmax(240px, 1fr))`, gap: 10, overflowX:'auto', paddingBottom: 12}}>
      {STAGES.map(st => {
        const stageDeals = deals.filter(d => d.stage === st.id);
        const total = stageDeals.reduce((s,d) => s+d.amount, 0);
        return (
          <div
            key={st.id}
            onDragOver={(e)=>{e.preventDefault(); setOver(st.id);}}
            onDragLeave={()=>setOver(null)}
            onDrop={(e)=>onDrop(e, st.id)}
            style={{background: over === st.id ? 'var(--accent-soft)' : 'var(--paper-2)', borderRadius: 8, padding: 10, minHeight: 480, transition:'background .15s'}}
          >
            <div className="row" style={{justifyContent:'space-between', marginBottom: 8, paddingBottom: 8, borderBottom:'1px solid var(--rule-2)'}}>
              <div className="row" style={{gap: 6}}>
                <span style={{width: 8, height: 8, borderRadius: 2, background: st.color}}></span>
                <strong style={{fontSize: 12}}>{st.name}</strong>
                <span className="chip" style={{fontSize: 10}}>{stageDeals.length}</span>
              </div>
              <span className="serif" style={{fontSize: 14}}>{fmtMoney(total)}</span>
            </div>
            {stageDeals.map(d => <DealCard key={d.id} deal={d} onOpen={onOpen} onDragStart={onDragStart}/>)}
            <button className="btn ghost sm" style={{width:'100%', justifyContent:'center', marginTop: 4}}><Icon name="plus" size={12}/>Add deal</button>
          </div>
        );
      })}
    </div>
  );
};

const PipelineTable = ({ deals, onOpen }) => (
  <div className="card" style={{padding: 0, overflow:'hidden'}}>
    <div style={{maxHeight: 'calc(100vh - 320px)', overflow: 'auto'}}>
      <table className="table">
        <thead>
          <tr>
            <th></th><th>Deal</th><th>Stage</th><th className="num">Amount</th><th>Close</th><th>Owner</th><th>Source</th><th className="num">Score</th>
          </tr>
        </thead>
        <tbody>
          {deals.map(d => {
            const co = getCompany(d.companyId);
            const st = getStage(d.stage);
            return (
              <tr key={d.id} onClick={()=>onOpen(d)} style={{cursor:'pointer'}}>
                <td><input type="checkbox" onClick={e=>e.stopPropagation()}/></td>
                <td>
                  <div className="row" style={{gap: 10}}>
                    <div style={{width: 22, height: 22, borderRadius: 4, background: co.color, color:'white', fontSize: 9, display:'grid', placeItems:'center', fontWeight: 700}}>{co.logo}</div>
                    <div>
                      <div style={{fontWeight: 600, fontSize: 13}}>{d.name}</div>
                      <div style={{fontSize: 11, color:'var(--muted)'}}>{co.name}</div>
                    </div>
                  </div>
                </td>
                <td><span className="chip dot" style={{color: st.color}}>{st.name}</span></td>
                <td className="num"><strong>{fmtMoney(d.amount)}</strong></td>
                <td style={{fontSize: 12}}>{d.close}</td>
                <td style={{fontSize: 12}}>{d.owner}</td>
                <td><span className="chip" style={{fontSize: 10}}>{d.source}</span></td>
                <td className="num">{d.score}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  </div>
);

const DealDrawer = ({ deal, onClose }) => {
  if (!deal) return null;
  const co = getCompany(deal.companyId);
  const ct = getContact(deal.contactId);
  const st = getStage(deal.stage);
  const acts = ACTIVITIES.filter(a => a.dealId === deal.id);
  return (
    <>
      <div className="drawer-overlay" onClick={onClose}/>
      <div className="drawer">
        <div style={{padding:'18px 24px', borderBottom:'1px solid var(--rule-2)'}}>
          <div className="row" style={{justifyContent:'space-between', alignItems:'flex-start', marginBottom: 10}}>
            <div style={{flex: 1}}>
              <div className="row" style={{gap: 8, marginBottom: 4}}>
                <div style={{width: 20, height: 20, borderRadius: 4, background: co.color, color:'white', fontSize: 9, display:'grid', placeItems:'center', fontWeight: 700}}>{co.logo}</div>
                <span style={{fontSize: 12, color:'var(--muted)'}}>{co.name}</span>
              </div>
              <div className="serif" style={{fontSize: 24, letterSpacing:'-0.02em'}}>{deal.name}</div>
            </div>
            <button className="icon-btn" onClick={onClose}><Icon name="x"/></button>
          </div>
          <div className="row" style={{gap: 16, marginTop: 12}}>
            <div>
              <div style={{fontSize: 10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.08em'}}>Amount</div>
              <div className="serif" style={{fontSize: 22}}>{fmtMoney(deal.amount)}</div>
            </div>
            <div>
              <div style={{fontSize: 10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.08em'}}>Close</div>
              <div className="serif" style={{fontSize: 22}}>{deal.close}</div>
            </div>
            <div>
              <div style={{fontSize: 10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.08em'}}>Probability</div>
              <div className="serif" style={{fontSize: 22}}>{st.probability}%</div>
            </div>
          </div>
        </div>

        {/* Stage stepper */}
        <div style={{padding:'14px 24px', borderBottom:'1px solid var(--rule-2)'}}>
          <div className="row" style={{gap: 4}}>
            {STAGES.filter(s => s.id !== 's6').map((s, i) => {
              const idx = STAGES.findIndex(x => x.id === deal.stage);
              const myIdx = STAGES.findIndex(x => x.id === s.id);
              const active = myIdx <= idx && deal.stage !== 's6';
              return (
                <div key={s.id} style={{flex: 1, height: 6, background: active ? s.color : 'var(--paper-2)', borderRadius: 2, transition:'all .2s'}} title={s.name}/>
              );
            })}
          </div>
          <div className="row" style={{justifyContent:'space-between', marginTop: 6, fontSize: 11, color:'var(--muted)'}}>
            {STAGES.filter(s => s.id !== 's6').map(s => <span key={s.id}>{s.name}</span>)}
          </div>
        </div>

        <div style={{flex: 1, overflowY:'auto'}}>
          <div className="ai-glow" style={{margin: 24, padding: 14, borderRadius: 8}}>
            <div className="row" style={{gap: 6, marginBottom: 6}}>
              <span className="ai-mark"><Icon name="sparkle" size={10}/>AI</span>
              <strong style={{fontSize: 13}}>Win probability: {deal.score}%</strong>
            </div>
            <div style={{fontSize: 12, color:'var(--ink-3)', lineHeight: 1.5}}>
              {deal.score >= 85 ? 'Strong signals: high engagement, decision-maker engaged, fits ICP closely. Recommend pushing for close this week.' :
               deal.score >= 70 ? 'Healthy momentum but procurement risk. Suggest aligning on timeline with the economic buyer.' :
               'Needs more discovery. Consider a value review session with the champion.'}
            </div>
          </div>

          <div style={{padding:'0 24px 24px'}}>
            <div className="card-title" style={{marginBottom: 12, fontSize: 14}}>Key contacts</div>
            <div style={{display:'flex', gap: 8, flexWrap:'wrap'}}>
              {ct && (
                <div className="card" style={{padding: 12, flex: 1, minWidth: 200}}>
                  <div className="row" style={{gap: 8}}>
                    <Avatar name={ct.avatar} color={co.color} size="lg"/>
                    <div>
                      <div style={{fontSize: 13, fontWeight: 600}}>{ct.name}</div>
                      <div style={{fontSize: 11, color:'var(--muted)'}}>{ct.title}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="card-title" style={{margin:'24px 0 12px', fontSize: 14}}>Activity</div>
            <ActivityFeed items={acts.length ? acts : ACTIVITIES.slice(0,3)}/>
          </div>
        </div>

        <div style={{padding:'12px 24px', borderTop:'1px solid var(--rule-2)', display:'flex', gap: 6}}>
          <button className="btn primary"><Icon name="check" size={12}/>Mark Won</button>
          <button className="btn">Move stage</button>
          <div className="spacer"/>
          <button className="btn ghost"><Icon name="archive" size={12}/></button>
        </div>
      </div>
    </>
  );
};

const Deals = () => {
  const [view, setView] = React.useState('kanban');
  const [open, setOpen] = React.useState(null);
  const [deals, setDeals] = React.useState(DEALS);
  const totalPipe = deals.filter(d => d.stage !== 's5' && d.stage !== 's6').reduce((s,d)=>s+d.amount, 0);
  const won = deals.filter(d => d.stage === 's5').reduce((s,d)=>s+d.amount, 0);
  return (
    <div className="page slide-up">
      <div className="page-h">
        <div>
          <div className="page-eyebrow">{deals.length} deals · {fmtMoney(totalPipe)} open · {fmtMoney(won)} closed-won</div>
          <h1 className="page-title">The <em>pipeline</em></h1>
        </div>
        <div className="page-actions">
          <div className="row" style={{background:'var(--card)', border:'1px solid var(--rule)', borderRadius: 6, padding: 2, gap: 0}}>
            <button className={'btn sm ' + (view==='kanban'?'primary':'ghost')} onClick={()=>setView('kanban')}>Kanban</button>
            <button className={'btn sm ' + (view==='table'?'primary':'ghost')} onClick={()=>setView('table')}>Table</button>
            <button className={'btn sm ' + (view==='forecast'?'primary':'ghost')} onClick={()=>setView('forecast')}>Forecast</button>
          </div>
          <button className="btn"><Icon name="filter" size={12}/>Owner: All</button>
          <button className="btn primary"><Icon name="plus" size={12}/>New deal</button>
        </div>
      </div>

      {view === 'kanban' && <PipelineKanban deals={deals} setDeals={setDeals} onOpen={setOpen}/>}
      {view === 'table' && <PipelineTable deals={deals} onOpen={setOpen}/>}
      {view === 'forecast' && (
        <div style={{display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap: 12}}>
          {[
            {k:'commit', label:'Commit', desc:'Highest confidence — will close this period.', color:'var(--sage)'},
            {k:'best-case', label:'Best case', desc:'Likely to close if execution stays on track.', color:'var(--blue)'},
            {k:'pipeline', label:'Pipeline', desc:'Open opportunities, lower confidence.', color:'var(--muted)'},
          ].map(b => {
            const ds = deals.filter(d => d.forecast === b.k);
            const tot = ds.reduce((s,d)=>s+d.amount,0);
            return (
              <div key={b.k} className="card">
                <div className="card-h">
                  <div>
                    <div className="card-title">{b.label}</div>
                    <div className="card-sub">{b.desc}</div>
                  </div>
                </div>
                <div className="card-b">
                  <div className="serif" style={{fontSize: 32, color: b.color}}>{fmtMoney(tot)}</div>
                  <div style={{fontSize: 12, color:'var(--muted)', marginBottom: 12}}>{ds.length} deals</div>
                  {ds.map(d => (
                    <div key={d.id} className="row" style={{padding:'8px 0', borderTop:'1px solid var(--rule-2)', justifyContent:'space-between', cursor:'pointer'}} onClick={()=>setOpen(d)}>
                      <div style={{fontSize: 12, fontWeight: 500}} className="trunc">{d.name}</div>
                      <span className="mono" style={{fontSize: 12}}>{fmtMoney(d.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {open && <DealDrawer deal={open} onClose={()=>setOpen(null)}/>}
    </div>
  );
};

window.Deals = Deals;
