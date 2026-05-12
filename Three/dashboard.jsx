// =============================================================
// Dashboard — overview with KPIs, charts, activity, AI insights
// =============================================================

const KpiCard = ({ label, value, delta, deltaKind = 'up', spark, color = '#E07A5F' }) => (
  <div className="card" style={{padding: 16}}>
    <div className="row" style={{justifyContent:'space-between'}}>
      <span style={{fontSize: 11, color: 'var(--muted)', textTransform:'uppercase', letterSpacing:'0.08em'}}>{label}</span>
      {delta && (
        <span className={'chip ' + (deltaKind === 'up' ? 'sage' : 'gray')} style={{fontSize: 10}}>
          <Icon name={deltaKind === 'up' ? 'arrow-up' : 'arrow-down'} size={10}/>{delta}
        </span>
      )}
    </div>
    <div className="serif" style={{fontSize: 32, marginTop: 6, letterSpacing:'-0.02em'}}>{value}</div>
    {spark && <div style={{color, marginTop: 8}}><Sparkline data={spark} w={200} h={32} stroke={color} fill={color}/></div>}
  </div>
);

const RevenueChart = () => {
  const data = REVENUE_BY_MONTH;
  const W = 720, H = 220, pad = 32;
  const max = Math.max(...data.map(d => Math.max(d.booked, d.target))) * 1.1;
  const bw = (W - pad*2) / data.length;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      {/* gridlines */}
      {[0, 0.25, 0.5, 0.75, 1].map((p, i) => (
        <g key={i}>
          <line x1={pad} x2={W-pad} y1={pad + (H-pad*2)*(1-p)} y2={pad + (H-pad*2)*(1-p)} stroke="rgba(26,26,26,0.06)"/>
          <text x={pad-6} y={pad + (H-pad*2)*(1-p)+3} fontSize="9" fill="var(--muted)" textAnchor="end">{Math.round(max*p/1000)}k</text>
        </g>
      ))}
      {data.map((d, i) => {
        const x = pad + bw*i + bw*0.2;
        const w = bw * 0.6;
        const bh = (d.booked / max) * (H - pad*2);
        const th = (d.target / max) * (H - pad*2);
        const isPartial = i === data.length - 1;
        return (
          <g key={i}>
            <line x1={x-2} x2={x+w+2} y1={H-pad-th} y2={H-pad-th} stroke="var(--ink-3)" strokeDasharray="3 3" strokeWidth="1"/>
            <rect x={x} y={H-pad-bh} width={w} height={bh} style={{fill: isPartial ? 'var(--accent-soft)' : 'var(--accent)'}} rx="2"/>
            <text x={x+w/2} y={H-pad+14} fontSize="10" fill="var(--muted)" textAnchor="middle">{d.m}</text>
          </g>
        );
      })}
      <text x={W-pad} y={pad-8} fontSize="10" fill="var(--muted)" textAnchor="end">— target</text>
    </svg>
  );
};

const FunnelChart = () => {
  const data = FUNNEL;
  const max = data[0].count;
  return (
    <div style={{display:'flex', flexDirection:'column', gap: 8}}>
      {data.map((d, i) => {
        const w = (d.count / max) * 100;
        const conv = i === 0 ? 100 : (d.count / data[i-1].count) * 100;
        return (
          <div key={i} className="row" style={{gap: 12}}>
            <div style={{width: 80, fontSize: 12, color: 'var(--ink-2)'}}>{d.stage}</div>
            <div style={{flex: 1, height: 28, background: 'var(--paper-2)', borderRadius: 4, position: 'relative', overflow:'hidden'}}>
              <div style={{
                width: `${w}%`, height: '100%',
                background: `linear-gradient(90deg, var(--accent), ${i===0?'var(--accent)':'var(--blue)'})`,
                opacity: 0.85 - i*0.1,
                display: 'flex', alignItems: 'center', paddingLeft: 10,
                fontSize: 12, color: 'white', fontWeight: 600
              }}>{d.count.toLocaleString()}</div>
            </div>
            <div className="mono" style={{width: 56, fontSize: 11, color: 'var(--muted)', textAlign: 'right'}}>{conv.toFixed(0)}%</div>
          </div>
        );
      })}
    </div>
  );
};

const SourcesPie = () => {
  const total = SOURCES.reduce((s, x) => s+x.value, 0);
  let acc = 0;
  const cx = 70, cy = 70, r = 55, ir = 36;
  return (
    <div className="row" style={{gap: 20, alignItems:'center'}}>
      <svg width="140" height="140">
        {SOURCES.map((s, i) => {
          const a0 = (acc / total) * Math.PI * 2 - Math.PI/2;
          acc += s.value;
          const a1 = (acc / total) * Math.PI * 2 - Math.PI/2;
          const x0 = cx + Math.cos(a0)*r, y0 = cy + Math.sin(a0)*r;
          const x1 = cx + Math.cos(a1)*r, y1 = cy + Math.sin(a1)*r;
          const xi0 = cx + Math.cos(a0)*ir, yi0 = cy + Math.sin(a0)*ir;
          const xi1 = cx + Math.cos(a1)*ir, yi1 = cy + Math.sin(a1)*ir;
          const large = (a1-a0) > Math.PI ? 1 : 0;
          const d = `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${xi1} ${yi1} A ${ir} ${ir} 0 ${large} 0 ${xi0} ${yi0} Z`;
          return <path key={i} d={d} fill={s.color}/>;
        })}
      </svg>
      <div style={{display:'flex', flexDirection:'column', gap: 6, flex: 1}}>
        {SOURCES.map((s, i) => (
          <div key={i} className="row" style={{justifyContent:'space-between'}}>
            <div className="row" style={{gap: 6}}>
              <span style={{width: 8, height: 8, borderRadius: 2, background: s.color}}></span>
              <span style={{fontSize: 12}}>{s.src}</span>
            </div>
            <span className="mono" style={{fontSize: 11, color: 'var(--muted)'}}>{s.value}%</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const ActivityFeed = ({ items }) => (
  <div style={{display:'flex', flexDirection:'column'}}>
    {items.map((a, i) => {
      const iconMap = { email:'mail', meeting:'meeting', note:'note', deal:'money', call:'phone', ai:'sparkle' };
      const colorMap = { email:'#3D5A80', meeting:'#6B4E71', note:'#7A7670', deal:'#588157', call:'#D4A373', ai:'#E07A5F' };
      return (
        <div key={i} className="row" style={{gap: 12, padding:'10px 0', borderBottom: i < items.length-1 ? '1px solid var(--rule-2)' : 'none', alignItems:'flex-start'}}>
          <div style={{width: 28, height: 28, borderRadius: 6, background: colorMap[a.kind]+'22', color: colorMap[a.kind], display:'grid', placeItems:'center', flexShrink: 0}}>
            <Icon name={iconMap[a.kind]} size={14}/>
          </div>
          <div style={{flex: 1, minWidth: 0}}>
            <div style={{fontSize: 12, fontWeight: 500}}>{a.title}</div>
            {a.body && <div style={{fontSize: 12, color: 'var(--muted)', marginTop: 2}}>{a.body}</div>}
          </div>
          <div style={{fontSize: 11, color: 'var(--muted-2)', whiteSpace:'nowrap'}}>{a.time}</div>
        </div>
      );
    })}
  </div>
);

const Dashboard = ({ openAI }) => {
  return (
    <div className="page slide-up">
      <div className="page-h">
        <div>
          <div className="page-eyebrow">Wednesday, May 7 · Q2 Week 5</div>
          <h1 className="page-title">Good morning, <em>Aria</em>.</h1>
          <div className="page-sub">You have <strong>3 high-priority tasks</strong>, <strong>$854k</strong> in active pipeline, and a demo with Aperture in 1 hour.</div>
        </div>
        <div className="page-actions">
          <button className="btn"><Icon name="filter" size={12}/>This week</button>
          <button className="btn"><Icon name="doc" size={12}/>Export</button>
          <button className="btn primary"><Icon name="plus" size={12}/>Log activity</button>
        </div>
      </div>

      {/* KPIs */}
      <div style={{display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap: 12, marginBottom: 16}}>
        <KpiCard label="Pipeline value" value="$854k" delta="+18%" spark={PIPELINE_TREND.map(d=>d.value)} color="#E07A5F"/>
        <KpiCard label="Booked MTD" value="$156k" delta="+22%" spark={[88,102,124,134,142,156]} color="#3D5A80"/>
        <KpiCard label="Win rate (90d)" value="34%" delta="+4pt" spark={[28,30,29,31,32,33,34]} color="#588157"/>
        <KpiCard label="Quota attainment" value="77%" delta="+12%" deltaKind="up" spark={[42,51,58,63,68,72,77]} color="#6B4E71"/>
      </div>

      {/* Charts row */}
      <div style={{display:'grid', gridTemplateColumns:'2fr 1fr', gap: 12, marginBottom: 16}}>
        <div className="card">
          <div className="card-h">
            <div>
              <div className="card-title">Revenue vs target</div>
              <div className="card-sub">Booked revenue against monthly quota — last 7 months</div>
            </div>
            <div className="row" style={{gap: 6}}>
              <span className="chip dot" style={{color:'var(--accent)'}}>Booked</span>
              <span className="chip" style={{borderStyle:'dashed'}}>Target</span>
            </div>
          </div>
          <div className="card-b"><RevenueChart/></div>
        </div>
        <div className="card">
          <div className="card-h">
            <div className="card-title">Pipeline sources</div>
            <Icon name="dot-3" size={14} className="muted"/>
          </div>
          <div className="card-b"><SourcesPie/></div>
        </div>
      </div>

      {/* AI Insights */}
      <div className="card ai-glow" style={{marginBottom: 16}}>
        <div className="card-h" style={{borderBottom:'none', paddingBottom: 0}}>
          <div className="row" style={{gap: 8}}>
            <span className="ai-mark"><Icon name="sparkle" size={10}/>AI Insights</span>
            <span style={{fontSize: 12, color: 'var(--muted)'}}>3 things to consider this morning</span>
          </div>
          <button className="btn ghost sm" onClick={openAI}>Ask follow-up<Icon name="arrow-right" size={12}/></button>
        </div>
        <div className="card-b" style={{display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap: 12}}>
          {[
            {t:'Northwind is heating up', b:'Marcus opened the proposal 4× yesterday and forwarded it to procurement. Suggest moving close to May 18.', deal:'d2', kind:'up'},
            {t:'Plumb churn risk', b:'Usage is down 38% MoM and renewal is in 38 days. Recommend a check-in call this week.', deal:'d4', kind:'risk'},
            {t:'Aperture expansion signal', b:'Devika asked about SSO + audit logs. Existing $36k deal could expand by ~$24k.', deal:'d12', kind:'up'},
          ].map((c, i) => (
            <div key={i} style={{padding: 12, background: 'var(--card)', borderRadius: 8, border: '1px solid var(--rule-2)'}}>
              <div className="row" style={{gap: 6, marginBottom: 6}}>
                <Icon name={c.kind === 'up' ? 'flame' : 'bell'} size={14} style={{color: c.kind==='up'?'var(--accent)':'var(--err)'}}/>
                <strong style={{fontSize: 13}}>{c.t}</strong>
              </div>
              <div style={{fontSize: 12, color:'var(--ink-3)', lineHeight: 1.5}}>{c.b}</div>
              <div className="row" style={{marginTop: 10, gap: 6}}>
                <button className="btn sm">Open deal</button>
                <button className="btn sm ghost">Dismiss</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Lower row */}
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap: 12}}>
        <div className="card">
          <div className="card-h">
            <div className="card-title">Funnel · last 90 days</div>
            <span className="chip">1,842 → 18</span>
          </div>
          <div className="card-b"><FunnelChart/></div>
        </div>
        <div className="card">
          <div className="card-h">
            <div className="card-title">Today &amp; tomorrow</div>
            <button className="btn ghost sm">View all<Icon name="arrow-right" size={12}/></button>
          </div>
          <div className="card-b" style={{padding: 0}}>
            {TASKS.filter(t=>!t.done).slice(0,5).map((t, i) => (
              <div key={t.id} className="row" style={{padding:'10px 16px', borderBottom: i < 4 ? '1px solid var(--rule-2)' : 'none', gap: 10}}>
                <input type="checkbox" />
                <div style={{flex: 1}}>
                  <div style={{fontSize: 12, fontWeight: 500}}>{t.title}</div>
                  <div style={{fontSize: 11, color:'var(--muted)'}}>{t.due} · {t.owner}</div>
                </div>
                <span className={'chip ' + (t.priority==='high'?'accent':t.priority==='med'?'ochre':'gray')} style={{fontSize:10}}>{t.priority}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card-h">
            <div className="card-title">Recent activity</div>
            <button className="btn ghost sm"><Icon name="filter" size={12}/></button>
          </div>
          <div className="card-b"><ActivityFeed items={ACTIVITIES.slice(0, 6)}/></div>
        </div>
      </div>
    </div>
  );
};

window.Dashboard = Dashboard;
