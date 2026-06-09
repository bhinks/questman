/* ============================================================
   FinDash — Overview dashboard
   ============================================================ */

function MetricCard({ label, value, trend, invertGood, color, spark, sub }) {
  return (
    <div className="panel" style={{ padding: 20, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: 2,
        background: `linear-gradient(90deg, ${color}, transparent)` }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div className="kicker">{label}</div>
        {trend != null && <Trend value={trend} invertGood={invertGood} size="sm" />}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10, marginTop: 14 }}>
        <div>
          <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1 }}>
            <CountUp value={value} format={(n) => fmtMoney(n)} />
          </div>
          {sub && <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 7 }}>{sub}</div>}
        </div>
        {spark && <Spark data={spark} color={color} w={84} h={34} />}
      </div>
    </div>
  );
}

function OverviewScreen({ data, goTo }) {
  const m = data.metrics, g = data.game;
  const topCats = data.categories.slice(0, 5);
  const maxCat = topCats[0].total;
  const spendSeries = data.monthlySpend.map(x => x.spent);
  const incomeSeries = data.monthlySpend.map(x => x.income);
  const netSeries = data.monthlySpend.map(x => x.net);
  const [chartMode, setChartMode] = useState('area');

  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>

      {/* GAMIFIED RECLAIM HERO */}
      <div className="panel hud" style={{ padding: 0, overflow: 'hidden', position: 'relative' }}>
        <div style={{ position: 'absolute', inset: 0, background:
          'radial-gradient(600px 300px at 88% 120%, rgba(67,255,166,0.12), transparent 60%), radial-gradient(500px 260px at 10% -20%, rgba(28,226,255,0.10), transparent 60%)' }} />
        <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 0 }} className="hero-grid">
          <div style={{ padding: '26px 30px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <Badge color="var(--lime)">SAVINGS MISSION</Badge>
              <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>
                LVL {g.level} · {g.levelName.toUpperCase()}
              </span>
            </div>
            <div style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 6 }}>Money you could reclaim every month</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 46, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1,
                color: 'var(--lime)', textShadow: '0 0 24px rgba(67,255,166,0.45)' }}>
                <CountUp value={m.reclaimTotal} format={(n) => fmtMoney(n)} />
              </div>
              <span className="mono" style={{ fontSize: 13, color: 'var(--text-dim)' }}>/ month</span>
            </div>
            <div style={{ marginTop: 18, maxWidth: 380 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
                <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>RECLAIMED THIS MONTH</span>
                <span className="mono" style={{ fontSize: 11.5, color: 'var(--lime)' }}>
                  {fmtMoney(g.reclaimedThisMonth)} / {fmtMoney(g.reclaimTarget)}
                </span>
              </div>
              <Bar value={g.reclaimedThisMonth} max={g.reclaimTarget} color="var(--lime)" height={9} glow />
            </div>
            <button className="btn btn-primary" style={{ marginTop: 22 }} onClick={() => goTo('waste')}>
              <Icon name="target" size={15} /> View savings missions
            </button>
          </div>

          {/* streak + xp */}
          <div style={{ padding: '26px 30px', borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 18, justifyContent: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ width: 56, height: 56, borderRadius: 14, display: 'grid', placeItems: 'center', flexShrink: 0,
                background: 'rgba(255,194,75,0.12)', border: '1px solid rgba(255,194,75,0.35)', color: 'var(--amber)',
                boxShadow: '0 0 22px -8px var(--amber)' }}>
                <Icon name="flame" size={26} fill />
              </div>
              <div>
                <div style={{ fontSize: 26, fontWeight: 600, lineHeight: 1 }}>
                  {g.streakWeeks}<span style={{ fontSize: 14, color: 'var(--text-dim)', marginLeft: 4 }}>weeks</span>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginTop: 4 }}>{g.streakLabel}</div>
              </div>
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
                <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>XP {fmtNum(g.xp)}</span>
                <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>NEXT {fmtNum(g.xpNext)}</span>
              </div>
              <Bar value={g.xp} max={g.xpNext} color="var(--violet)" height={7} glow />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {g.badges.map(b => (
                <span key={b.name} title={b.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
                  fontSize: 11, padding: '5px 9px', borderRadius: 7,
                  background: b.got ? 'rgba(157,107,255,0.12)' : 'var(--panel-2)',
                  border: `1px solid ${b.got ? 'rgba(157,107,255,0.35)' : 'var(--line)'}`,
                  color: b.got ? 'var(--text)' : 'var(--text-ghost)' }}>
                  <Icon name="trophy" size={12} style={{ color: b.got ? 'var(--violet)' : 'var(--text-ghost)' }} />
                  {b.name}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* METRIC CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }} className="metric-grid">
        <MetricCard label="Total Spent" value={m.totalSpent} trend={m.spentTrend} invertGood color="var(--magenta)"
          spark={spendSeries} sub={`across ${data.metrics.fullMonths + 1} months`} />
        <MetricCard label="Income" value={m.totalIncome} trend={m.incomeTrend} color="var(--cyan)"
          spark={incomeSeries} sub="all sources" />
        <MetricCard label="Net Saved" value={m.net} trend={m.netTrend} color="var(--lime)"
          spark={netSeries} sub={`${(m.savingsRate * 100).toFixed(0)}% savings rate`} />
        <MetricCard label="Avg / Month" value={m.avgMonthly} trend={m.avgTrend} invertGood color="var(--violet)"
          spark={spendSeries.slice(0, 6)} sub="spend rate" />
      </div>

      {/* TREND + CATEGORIES */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.55fr 1fr', gap: 16 }} className="split-grid">
        <div className="panel" style={{ padding: 22 }}>
          <SectionHead index="01" sub="CASH FLOW" title="Spending vs income"
            right={
              <div style={{ display: 'flex', gap: 4, background: 'var(--bg-2)', padding: 4, borderRadius: 9, border: '1px solid var(--line)' }}>
                {['area', 'line', 'bar'].map(mode => (
                  <button key={mode} onClick={() => setChartMode(mode)} className="mono"
                    style={{ fontSize: 11, padding: '5px 11px', borderRadius: 6, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.06em',
                      border: 'none', transition: 'all .15s',
                      background: chartMode === mode ? 'var(--panel-hi)' : 'transparent',
                      color: chartMode === mode ? 'var(--cyan)' : 'var(--text-faint)' }}>
                    {mode}
                  </button>
                ))}
              </div>
            } />
          <TrendChart data={data.monthlySpend} mode={chartMode} height={264} showIncome valueKey="spent" />
          <div style={{ display: 'flex', gap: 20, marginTop: 12, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
            <Legend color="var(--cyan)" label="Spending" />
            <Legend color="var(--text-ghost)" label="Income" dash />
          </div>
        </div>

        <div className="panel" style={{ padding: 22 }}>
          <SectionHead index="02" sub="TOP CATEGORIES" title="Where it goes"
            right={<button className="btn btn-ghost" style={{ padding: '6px 10px', fontSize: 11 }} onClick={() => goTo('cats')}>
              ALL <Icon name="chevR" size={13} /></button>} />
          <HBars rows={topCats} max={maxCat} />
        </div>
      </div>

      {/* QUICK WINS */}
      <div>
        <SectionHead index="03" sub="QUICK WINS" title="Three moves, biggest impact" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }} className="metric-grid">
          {data.patterns.slice(0, 3).map(p => (
            <button key={p.id} onClick={() => goTo('waste')} className="panel" style={{
              padding: 20, textAlign: 'left', cursor: 'pointer', transition: 'all .16s', position: 'relative', overflow: 'hidden',
              borderColor: 'var(--line)',
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = p.color + '66'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.transform = 'none'; }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <span style={{ width: 38, height: 38, borderRadius: 10, display: 'grid', placeItems: 'center',
                  background: p.color + '1c', border: `1px solid ${p.color}44`, color: p.color }}>
                  <Icon name={p.icon} size={18} />
                </span>
                <Badge color={p.color}>{p.tag}</Badge>
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 5, color: 'var(--text)' }}>{p.title}</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.5, minHeight: 38 }}>{p.blurb}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
                <span className="mono" style={{ fontSize: 20, fontWeight: 600, color: p.color }}>{fmtMoney(p.reclaim)}</span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--text-faint)' }}>/MO RECLAIMABLE</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Legend({ color, label, dash }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 16, height: dash ? 0 : 3, borderRadius: 2,
        borderTop: dash ? `2px dashed ${color}` : 'none',
        background: dash ? 'transparent' : color,
        boxShadow: dash ? 'none' : `0 0 6px ${color}` }} />
      <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>{label}</span>
    </div>
  );
}

Object.assign(window, { OverviewScreen, MetricCard, Legend });
