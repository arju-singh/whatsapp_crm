// =============================================================
// Reports, Campaigns, Tickets, Automations, Team, Settings
// =============================================================

const Reports = () => {
  return (
    <div className="page slide-up">
      <div className="page-h">
        <div>
          <div className="page-eyebrow">Q2 2026 · Updated 2 min ago</div>
          <h1 className="page-title">Reports &amp; <em>analytics</em></h1>
          <div className="page-sub">Custom dashboards, conversion analysis, and team performance.</div>
        </div>
        <div className="page-actions">
          <button className="btn"><Icon name="filter" size={12}/>Last 90 days</button>
          <button className="btn"><Icon name="doc" size={12}/>Export PDF</button>
          <button className="btn primary"><Icon name="plus" size={12}/>New report</button>
        </div>
      </div>

      <div style={{display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap: 12, marginBottom: 16}}>
        {[
          {l:'Avg deal size', v:'$87.4k', d:'+12%'},
          {l:'Sales cycle', v:'47 days', d:'-8d'},
          {l:'Win rate', v:'34%', d:'+4pt'},
          {l:'Activities/deal', v:'18.2', d:'+1.6'},
        ].map((k, i) => (
          <div key={i} className="card" style={{padding: 16}}>
            <div style={{fontSize: 11, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.08em'}}>{k.l}</div>
            <div className="serif" style={{fontSize: 28, marginTop: 4}}>{k.v}</div>
            <div className="row" style={{gap: 4, marginTop: 4}}>
              <Icon name="arrow-up" size={10} style={{color:'var(--sage)'}}/>
              <span style={{fontSize: 11, color:'var(--sage)'}}>{k.d}</span>
              <span style={{fontSize: 11, color:'var(--muted)'}}>vs prev period</span>
            </div>
          </div>
        ))}
      </div>

      <div style={{display:'grid', gridTemplateColumns:'2fr 1fr', gap: 12, marginBottom: 16}}>
        <div className="card">
          <div className="card-h">
            <div>
              <div className="card-title">Activity heatmap</div>
              <div className="card-sub">When prospects respond to outreach</div>
            </div>
            <span className="chip">PT timezone</span>
          </div>
          <div className="card-b">
            <div style={{display:'grid', gridTemplateColumns:'40px repeat(24, 1fr)', gap: 2, fontSize: 9}}>
              <div></div>
              {Array.from({length: 24}, (_, i) => <div key={i} style={{textAlign:'center', color:'var(--muted)', fontSize: 9}}>{i % 4 === 0 ? i : ''}</div>)}
              {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((d, di) => (
                <React.Fragment key={d}>
                  <div style={{fontSize: 10, color:'var(--muted)', alignSelf:'center'}}>{d}</div>
                  {HEATMAP[di].map((v, hi) => (
                    <div key={hi} style={{
                      aspectRatio: '1', borderRadius: 2,
                      background: `rgba(224,122,95,${v.toFixed(2)})`,
                      border: v > 0.05 ? '0' : '1px solid var(--rule-2)'
                    }} title={`${d} ${hi}:00 — ${(v*100).toFixed(0)}%`}/>
                  ))}
                </React.Fragment>
              ))}
            </div>
            <div className="row" style={{marginTop: 12, justifyContent:'flex-end', gap: 4, fontSize: 10, color:'var(--muted)'}}>
              <span>Less</span>
              {[0.1, 0.3, 0.5, 0.7, 0.9].map(v => <div key={v} style={{width: 12, height: 12, background:`rgba(224,122,95,${v})`, borderRadius: 2}}></div>)}
              <span>More</span>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-h">
            <div className="card-title">Stage conversion</div>
          </div>
          <div className="card-b">
            <FunnelChart/>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <div className="card-title">Rep leaderboard</div>
          <button className="btn ghost sm"><Icon name="dot-3"/></button>
        </div>
        <div className="card-b" style={{padding: 0}}>
          <table className="table">
            <thead><tr><th>Rep</th><th>Quota</th><th>Attained</th><th>%</th><th>Open pipe</th><th>Activities</th><th>Trend</th></tr></thead>
            <tbody>
              {TEAM.filter(u => u.quota > 100).map(u => {
                const pct = (u.attained / u.quota) * 100;
                return (
                  <tr key={u.id}>
                    <td>
                      <div className="row" style={{gap: 10}}>
                        <Avatar name={u.avatar} color={u.color}/>
                        <div>
                          <div style={{fontWeight: 600, fontSize: 13}}>{u.name}</div>
                          <div style={{fontSize: 11, color:'var(--muted)'}}>{u.role}</div>
                        </div>
                      </div>
                    </td>
                    <td className="num">{fmtMoney(u.quota)}</td>
                    <td className="num">{fmtMoney(u.attained)}</td>
                    <td>
                      <div className="row" style={{gap: 8}}>
                        <div style={{flex: 1, height: 6, background:'var(--paper-2)', borderRadius: 3, overflow:'hidden', minWidth: 80}}>
                          <div style={{width: `${Math.min(100,pct)}%`, height:'100%', background: pct >= 90 ? 'var(--sage)' : pct >= 70 ? 'var(--ochre)' : 'var(--accent)'}}/>
                        </div>
                        <span className="mono" style={{fontSize: 11}}>{pct.toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className="num">{fmtMoney(Math.round(u.quota * 0.6))}</td>
                    <td className="num">{Math.round(80 + Math.random()*120)}</td>
                    <td><div style={{color: u.color}}><Sparkline data={Array.from({length: 8}, (_, i) => Math.random()*40+20+i*4)} stroke={u.color} fill={u.color} w={80} h={24}/></div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const Campaigns = () => {
  const statusColor = { live:'sage', paused:'ochre', draft:'gray' };
  return (
    <div className="page slide-up">
      <div className="page-h">
        <div>
          <div className="page-eyebrow">5 campaigns · 2,044 contacts reached this month</div>
          <h1 className="page-title">Marketing <em>campaigns</em></h1>
        </div>
        <div className="page-actions">
          <button className="btn"><Icon name="doc" size={12}/>Templates</button>
          <button className="btn primary"><Icon name="plus" size={12}/>New campaign</button>
        </div>
      </div>

      <div style={{display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap: 12}}>
        {CAMPAIGNS.map(c => {
          const openRate = c.sent ? (c.opened/c.sent*100) : 0;
          const replyRate = c.sent ? (c.replied/c.sent*100) : 0;
          return (
            <div key={c.id} className="card" style={{padding: 16}}>
              <div className="row" style={{justifyContent:'space-between', marginBottom: 8}}>
                <div>
                  <div className="row" style={{gap: 8, marginBottom: 4}}>
                    <span className={'chip ' + statusColor[c.status]}>{c.status}</span>
                    <span className="chip">{c.channel}</span>
                  </div>
                  <div className="serif" style={{fontSize: 18}}>{c.name}</div>
                  <div style={{fontSize: 11, color:'var(--muted)'}}>by {c.owner}</div>
                </div>
                <button className="icon-btn"><Icon name="dot-3"/></button>
              </div>
              <div style={{display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap: 8, marginTop: 16, paddingTop: 12, borderTop:'1px solid var(--rule-2)'}}>
                {[
                  {l:'Sent', v: c.sent.toLocaleString()},
                  {l:'Open', v: c.channel === 'LinkedIn' ? '—' : `${openRate.toFixed(0)}%`},
                  {l:'Reply', v: `${replyRate.toFixed(0)}%`},
                  {l:'Booked', v: c.booked},
                ].map(s => (
                  <div key={s.l}>
                    <div style={{fontSize: 9, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.08em'}}>{s.l}</div>
                    <div className="serif" style={{fontSize: 18, marginTop: 2}}>{s.v}</div>
                  </div>
                ))}
              </div>
              {c.sent > 0 && (
                <div style={{marginTop: 12, height: 4, background:'var(--paper-2)', borderRadius: 2, display:'flex', overflow:'hidden'}}>
                  <div style={{width: `${(c.opened/c.sent*100)}%`, background:'var(--blue)'}}/>
                  <div style={{width: `${(c.replied/c.sent*100)}%`, background:'var(--accent)'}}/>
                  <div style={{width: `${(c.booked/c.sent*100)}%`, background:'var(--sage)'}}/>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const Tickets = () => {
  const priColor = { urgent:'#C9184A', high:'#E07A5F', med:'#D4A373', low:'#7A7670' };
  const statusColor = { open: 'accent', pending: 'ochre', solved: 'sage' };
  const grouped = { open: TICKETS.filter(t => t.status === 'open'), pending: TICKETS.filter(t => t.status === 'pending'), solved: TICKETS.filter(t => t.status === 'solved') };
  return (
    <div className="page slide-up">
      <div className="page-h">
        <div>
          <div className="page-eyebrow">{TICKETS.filter(t=>t.status==='open').length} open · 2 urgent · avg first response 14m</div>
          <h1 className="page-title">Customer <em>tickets</em></h1>
        </div>
        <div className="page-actions">
          <button className="btn"><Icon name="filter" size={12}/>Mine</button>
          <button className="btn primary"><Icon name="plus" size={12}/>New ticket</button>
        </div>
      </div>

      <div style={{display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap: 12}}>
        {Object.entries(grouped).map(([status, items]) => (
          <div key={status}>
            <div className="row" style={{gap: 8, marginBottom: 8}}>
              <strong style={{fontSize: 14, textTransform:'capitalize'}}>{status}</strong>
              <span className={'chip ' + statusColor[status]}>{items.length}</span>
            </div>
            <div style={{display:'flex', flexDirection:'column', gap: 8}}>
              {items.map(t => {
                const co = getCompany(t.companyId);
                const ct = getContact(t.requester);
                return (
                  <div key={t.id} className="card" style={{padding: 12, borderLeft:`3px solid ${priColor[t.priority]}`}}>
                    <div className="row" style={{justifyContent:'space-between', marginBottom: 6}}>
                      <span className="mono" style={{fontSize: 10, color:'var(--muted)'}}>#{t.id.toUpperCase()}</span>
                      <span className="chip" style={{fontSize: 10, color: priColor[t.priority]}}>{t.priority}</span>
                    </div>
                    <div style={{fontSize: 13, fontWeight: 500, marginBottom: 6}}>{t.subject}</div>
                    <div className="row" style={{gap: 6, marginBottom: 8}}>
                      <div style={{width: 14, height: 14, borderRadius: 2, background: co.color, color:'white', fontSize: 7, display:'grid', placeItems:'center', fontWeight: 700}}>{co.logo}</div>
                      <span style={{fontSize: 11}}>{co.name}</span>
                      <span style={{fontSize: 11, color:'var(--muted)'}}>· {ct?.name}</span>
                    </div>
                    <div className="row" style={{justifyContent:'space-between', fontSize: 11, color:'var(--muted)', borderTop:'1px solid var(--rule-2)', paddingTop: 8}}>
                      <span>SLA: {t.sla} · {t.age} ago</span>
                      <span>{t.assignee}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const Automations = () => {
  return (
    <div className="page slide-up">
      <div className="page-h">
        <div>
          <div className="page-eyebrow">{AUTOMATIONS.filter(a=>a.status==='on').length} active · 514 runs this month</div>
          <h1 className="page-title">Workflow <em>automations</em></h1>
          <div className="page-sub">Triggers and actions that run when conditions are met. No-code.</div>
        </div>
        <div className="page-actions">
          <button className="btn"><Icon name="doc" size={12}/>Templates</button>
          <button className="btn primary"><Icon name="plus" size={12}/>New automation</button>
        </div>
      </div>

      <div className="card" style={{padding: 0, overflow:'hidden'}}>
        <table className="table">
          <thead><tr><th></th><th>Name</th><th>Trigger</th><th>Actions</th><th>Status</th><th className="num">Runs</th><th>Last run</th><th></th></tr></thead>
          <tbody>
            {AUTOMATIONS.map(a => (
              <tr key={a.id}>
                <td style={{width: 36}}>
                  <div style={{width: 28, height: 28, borderRadius: 6, background: a.status === 'on' ? 'var(--accent-soft)' : 'var(--paper-2)', color: a.status === 'on' ? 'var(--accent-ink)' : 'var(--muted)', display:'grid', placeItems:'center'}}>
                    <Icon name="bolt" size={14}/>
                  </div>
                </td>
                <td><strong style={{fontSize: 13}}>{a.name}</strong></td>
                <td><span className="mono" style={{fontSize: 11, color:'var(--muted)'}}>{a.trigger}</span></td>
                <td>
                  <div className="row" style={{gap: 4}}>
                    {Array.from({length: Math.min(a.actions, 4)}, (_, i) => (
                      <div key={i} style={{width: 16, height: 16, borderRadius: 3, background:'var(--blue-soft)', color:'var(--blue)', fontSize: 9, display:'grid', placeItems:'center', fontWeight: 700}}>{i+1}</div>
                    ))}
                    {a.actions > 4 && <span style={{fontSize: 11, color:'var(--muted)'}}>+{a.actions-4}</span>}
                  </div>
                </td>
                <td>
                  <div style={{position:'relative', width: 32, height: 18, background: a.status === 'on' ? 'var(--sage)' : 'var(--paper-2)', borderRadius: 99, cursor:'pointer'}}>
                    <div style={{position:'absolute', top: 2, left: a.status === 'on' ? 16 : 2, width: 14, height: 14, background:'white', borderRadius:'50%', transition:'left .2s', boxShadow:'0 1px 2px rgba(0,0,0,0.2)'}}/>
                  </div>
                </td>
                <td className="num">{a.runs}</td>
                <td style={{fontSize: 12, color:'var(--muted)'}}>{a.last}</td>
                <td><button className="icon-btn"><Icon name="dot-3"/></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Template ideas */}
      <div className="card-title" style={{margin:'24px 0 12px', fontSize: 16}}>Suggested templates</div>
      <div style={{display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap: 12}}>
        {[
          {t:'Re-engage cold leads', d:'Trigger when contact hasn\'t been touched in 30 days'},
          {t:'Round-robin assignment', d:'Distribute new leads across the team automatically'},
          {t:'NPS survey on Closed Won', d:'Send post-purchase survey 14 days after close'},
        ].map((tpl, i) => (
          <div key={i} className="card" style={{padding: 14, cursor:'pointer'}}>
            <Icon name="bolt" size={16} style={{color:'var(--accent)'}}/>
            <div style={{fontWeight: 600, fontSize: 13, marginTop: 6}}>{tpl.t}</div>
            <div style={{fontSize: 12, color:'var(--muted)', marginTop: 2}}>{tpl.d}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

const Team = () => {
  return (
    <div className="page slide-up">
      <div className="page-h">
        <div>
          <div className="page-eyebrow">{TEAM.length} members · 3 roles</div>
          <h1 className="page-title">Your <em>team</em></h1>
        </div>
        <div className="page-actions">
          <button className="btn"><Icon name="link" size={12}/>Invite link</button>
          <button className="btn primary"><Icon name="plus" size={12}/>Invite member</button>
        </div>
      </div>

      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap: 12}}>
        {TEAM.map(u => {
          const pct = u.quota ? (u.attained / u.quota) * 100 : 0;
          return (
            <div key={u.id} className="card" style={{padding: 16}}>
              <div className="row" style={{gap: 12, marginBottom: 12}}>
                <Avatar name={u.avatar} color={u.color} size="lg"/>
                <div style={{flex: 1, minWidth: 0}}>
                  <div style={{fontWeight: 600, fontSize: 14}}>{u.name}</div>
                  <div style={{fontSize: 12, color:'var(--muted)'}}>{u.role}</div>
                </div>
              </div>
              {u.quota > 0 && (
                <>
                  <div className="row" style={{justifyContent:'space-between', marginBottom: 6}}>
                    <span style={{fontSize: 11, color:'var(--muted)'}}>Quota attainment</span>
                    <span className="mono" style={{fontSize: 12}}>{pct.toFixed(0)}%</span>
                  </div>
                  <div style={{height: 6, background:'var(--paper-2)', borderRadius: 3, overflow:'hidden'}}>
                    <div style={{width: `${Math.min(100,pct)}%`, height:'100%', background: u.color}}/>
                  </div>
                  <div className="row" style={{justifyContent:'space-between', marginTop: 8, fontSize: 11, color:'var(--muted)'}}>
                    <span>{fmtMoney(u.attained)}</span>
                    <span>of {fmtMoney(u.quota)}</span>
                  </div>
                </>
              )}
              <div className="row" style={{gap: 6, marginTop: 12, paddingTop: 12, borderTop:'1px solid var(--rule-2)'}}>
                <button className="btn sm" style={{flex: 1}}>Message</button>
                <button className="btn sm">View</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const Settings = () => {
  const sections = [
    { t:'Profile', items:[{l:'Name', v:'Aria Sloane'},{l:'Email', v:'aria@sloane.co'},{l:'Time zone', v:'America/Los_Angeles'},{l:'Language', v:'English (US)'}]},
    { t:'Workspace', items:[{l:'Workspace name', v:'Sloane & Co.'},{l:'Plan', v:'Pro · 8 seats'},{l:'Currency', v:'USD'},{l:'Fiscal year', v:'Jan – Dec'}]},
    { t:'Pipelines', items:[{l:'Default pipeline', v:'Sales'},{l:'Stages', v:'6 stages'},{l:'Probability mapping', v:'Custom'}]},
    { t:'Integrations', items:[{l:'Gmail', v:'Connected · aria@sloane.co'},{l:'Slack', v:'Connected · #sales'},{l:'Stripe', v:'Connected'},{l:'HubSpot', v:'Disconnected'}]},
    { t:'Security', items:[{l:'2FA', v:'Enabled · authenticator'},{l:'SSO', v:'Pro feature'},{l:'API tokens', v:'2 active'},{l:'Session timeout', v:'30 days'}]},
    { t:'Billing', items:[{l:'Plan', v:'Pro · $79/seat/mo'},{l:'Next invoice', v:'Jun 1, 2026 · $632'},{l:'Payment', v:'Visa •••• 4242'}]},
  ];
  return (
    <div className="page slide-up">
      <div className="page-h">
        <div>
          <div className="page-eyebrow">Account · workspace · integrations</div>
          <h1 className="page-title">Settings</h1>
        </div>
      </div>
      <div style={{display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap: 12}}>
        {sections.map(s => (
          <div key={s.t} className="card">
            <div className="card-h"><div className="card-title">{s.t}</div></div>
            <div className="card-b" style={{padding: 0}}>
              {s.items.map((it, i) => (
                <div key={it.l} className="row" style={{padding:'12px 16px', borderBottom: i < s.items.length-1 ? '1px solid var(--rule-2)' : 'none', justifyContent:'space-between'}}>
                  <span style={{fontSize: 12, color:'var(--muted)'}}>{it.l}</span>
                  <span style={{fontSize: 13, fontWeight: 500}}>{it.v}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

Object.assign(window, { Reports, Campaigns, Tickets, Automations, Team, Settings });
