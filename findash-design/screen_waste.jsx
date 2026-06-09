/* ============================================================
   FinDash — Savings Missions (gamified wasteful spending)
   ============================================================ */

function WasteScreen({ data, goTo }) {
  const { patterns, game } = data;
  const [active, setActive] = useState({}); // id -> true
  const [celebrate, setCelebrate] = useState(null);

  const committed = patterns.filter(p => active[p.id]).reduce((a, p) => a + p.reclaim, 0);
  const totalPotential = patterns.reduce((a, p) => a + p.reclaim, 0);
  const annual = committed * 12;

  function toggle(p) {
    setActive(a => {
      const next = { ...a, [p.id]: !a[p.id] };
      if (!a[p.id]) { setCelebrate(p.id); setTimeout(() => setCelebrate(null), 1400); }
      return next;
    });
  }

  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {/* HEADER + PROJECTION */}
      <div className="panel hud" style={{ padding: 0, overflow: 'hidden', position: 'relative' }}>
        <div style={{ position: 'absolute', inset: 0, background:
          'radial-gradient(560px 280px at 85% 130%, rgba(67,255,166,0.13), transparent 60%), radial-gradient(440px 240px at 8% -20%, rgba(157,107,255,0.10), transparent 60%)' }} />
        <div style={{ position: 'relative', padding: '28px 30px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <Badge color="var(--lime)">SAVINGS MISSIONS</Badge>
            <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>
              NO JUDGMENT — JUST OPPORTUNITIES
            </span>
          </div>
          <h2 style={{ fontSize: 24, letterSpacing: '-0.02em', marginBottom: 6 }}>
            Four patterns. <span style={{ color: 'var(--lime)' }}>{fmtMoney(totalPotential)}/mo</span> waiting to be reclaimed.
          </h2>
          <p style={{ fontSize: 14, color: 'var(--text-dim)', maxWidth: 560, lineHeight: 1.6 }}>
            These aren't mistakes — they're the easiest dollars to win back. Accept a mission to commit, and watch your projected savings grow.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, auto)', gap: 0, marginTop: 24, maxWidth: 640 }} className="proj-grid">
            <ProjStat label="MISSIONS ACCEPTED" value={`${Object.values(active).filter(Boolean).length} / ${patterns.length}`} />
            <ProjStat label="COMMITTED / MONTH" value={fmtMoney(committed)} color="var(--lime)" border />
            <ProjStat label="PROJECTED / YEAR" value={fmtMoney(annual)} color="var(--cyan)" border big />
          </div>

          <div style={{ marginTop: 22, maxWidth: 640 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>RECLAIM PROGRESS</span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--lime)' }}>{fmtMoney(committed)} / {fmtMoney(totalPotential)}</span>
            </div>
            <Bar value={committed} max={totalPotential} color="var(--lime)" height={10} glow />
          </div>
        </div>
      </div>

      {/* MISSION CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }} className="split-grid">
        {patterns.map(p => (
          <MissionCard key={p.id} p={p} active={!!active[p.id]} celebrate={celebrate === p.id} onToggle={() => toggle(p)} />
        ))}
      </div>

      {/* GOALS + BADGES */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16 }} className="split-grid">
        <div className="panel" style={{ padding: 24 }}>
          <SectionHead index="" sub="ACTIVE GOALS" title="Targets in progress" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {game.goals.map((g, i) => {
              const pct = g.invert ? Math.max(0, Math.min(1, g.target / g.cur)) : Math.max(0, Math.min(1, g.cur / g.target));
              const hit = g.invert ? g.cur <= g.target : g.cur >= g.target;
              const fmt = (v) => g.unit === '$' ? fmtMoney(v) : v + g.unit;
              return (
                <div key={i}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: hit ? 'var(--lime)' : 'var(--amber)',
                        boxShadow: `0 0 6px ${hit ? 'var(--lime)' : 'var(--amber)'}` }} />
                      <span style={{ fontSize: 13.5 }}>{g.name}</span>
                    </div>
                    <span className="mono" style={{ fontSize: 12.5, color: hit ? 'var(--lime)' : 'var(--text-dim)' }}>
                      {fmt(g.cur)} <span style={{ color: 'var(--text-faint)' }}>/ {fmt(g.target)}</span>
                    </span>
                  </div>
                  <Bar value={pct * 100} max={100} color={hit ? 'var(--lime)' : 'var(--amber)'} height={7} delay={i * 80} />
                </div>
              );
            })}
          </div>
        </div>

        <div className="panel" style={{ padding: 24 }}>
          <SectionHead index="" sub="ACHIEVEMENTS" title="Badges" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {game.badges.map(b => (
              <div key={b.name} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9, textAlign: 'center',
                padding: '18px 10px', borderRadius: 12,
                background: b.got ? 'linear-gradient(180deg, rgba(157,107,255,0.12), transparent)' : 'var(--bg-2)',
                border: `1px solid ${b.got ? 'rgba(157,107,255,0.35)' : 'var(--line)'}` }}>
                <span style={{ width: 42, height: 42, borderRadius: 11, display: 'grid', placeItems: 'center',
                  background: b.got ? 'rgba(157,107,255,0.18)' : 'var(--panel-2)',
                  color: b.got ? 'var(--violet)' : 'var(--text-ghost)',
                  boxShadow: b.got ? '0 0 16px -4px var(--violet)' : 'none' }}>
                  <Icon name="trophy" size={20} fill={b.got} />
                </span>
                <span style={{ fontSize: 12, color: b.got ? 'var(--text)' : 'var(--text-ghost)' }}>{b.name}</span>
                {!b.got && <span className="mono" style={{ fontSize: 9.5, color: 'var(--text-ghost)', letterSpacing: '0.1em' }}>LOCKED</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProjStat({ label, value, color, border, big }) {
  return (
    <div style={{ padding: '4px 22px', borderLeft: border ? '1px solid var(--line)' : 'none' }}>
      <div className="kicker" style={{ marginBottom: 8 }}>{label}</div>
      <div className="mono" style={{ fontSize: big ? 30 : 24, fontWeight: 600, letterSpacing: '-0.02em',
        color: color || 'var(--text)', textShadow: color ? `0 0 18px ${color}55` : 'none' }}>{value}</div>
    </div>
  );
}

function MissionCard({ p, active, celebrate, onToggle }) {
  const [open, setOpen] = useState(false);
  const annual = p.reclaim * 12;
  return (
    <div className="panel" style={{ padding: 0, overflow: 'hidden', position: 'relative',
      borderColor: active ? p.color + '55' : 'var(--line)', transition: 'border-color .2s' }}>
      {celebrate && <Celebrate color={p.color} />}
      <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: 2,
        background: `linear-gradient(90deg, ${p.color}, transparent)`, opacity: active ? 1 : 0.5 }} />
      <div style={{ padding: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 13 }}>
            <span style={{ width: 44, height: 44, borderRadius: 11, display: 'grid', placeItems: 'center', flexShrink: 0,
              background: p.color + '1c', border: `1px solid ${p.color}44`, color: p.color }}>
              <Icon name={p.icon} size={21} />
            </span>
            <div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{p.title}</div>
              <Badge color={p.color} style={{ marginTop: 5 }}>{p.tag}</Badge>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="mono" style={{ fontSize: 22, fontWeight: 600, color: p.color }}>{fmtMoney(p.reclaim)}</div>
            <div className="kicker" style={{ marginTop: 3 }}>/MO BACK</div>
          </div>
        </div>

        <p style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6, margin: '0 0 16px' }}>{p.detail}</p>

        {/* before/after projection */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 15px', borderRadius: 10,
          background: 'var(--bg-2)', border: '1px solid var(--line)', marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <div className="kicker" style={{ marginBottom: 5 }}>BLEEDING NOW</div>
            <div className="mono" style={{ fontSize: 15, color: 'var(--text-dim)' }}>{fmtMoney(p.monthly)}<span style={{ fontSize: 10 }}>/mo</span></div>
          </div>
          <Icon name="chevR" size={18} style={{ color: p.color }} />
          <div style={{ flex: 1 }}>
            <div className="kicker" style={{ marginBottom: 5 }}>AFTER MISSION</div>
            <div className="mono" style={{ fontSize: 15, color: 'var(--lime)' }}>{fmtMoney(p.monthly - p.reclaim)}<span style={{ fontSize: 10 }}>/mo</span></div>
          </div>
          <div style={{ flex: 1, textAlign: 'right', borderLeft: '1px solid var(--line)', paddingLeft: 12 }}>
            <div className="kicker" style={{ marginBottom: 5 }}>YEAR 1</div>
            <div className="mono" style={{ fontSize: 15, color: 'var(--cyan)' }}>+{fmtMoney(annual)}</div>
          </div>
        </div>

        {open && (
          <div className="fade-up" style={{ marginBottom: 16 }}>
            <div className="kicker" style={{ marginBottom: 10 }}>WHAT'S DRIVING IT</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {p.examples.map(ex => (
                <div key={ex.who} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '9px 12px', background: 'var(--bg-2)', borderRadius: 8, border: '1px solid var(--line)' }}>
                  <span style={{ fontSize: 13 }}>{ex.who}</span>
                  <span className="mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                    {ex.n}× · {fmtMoneyC(ex.amt)}<span style={{ color: 'var(--text-faint)' }}> avg</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button className={active ? 'btn' : 'btn btn-primary'} style={{ flex: 1, justifyContent: 'center',
            ...(active ? { borderColor: p.color + '66', color: p.color, background: p.color + '14' } : {}) }}
            onClick={onToggle}>
            {active ? <><Icon name="check" size={15} /> Mission accepted</> : <><Icon name="target" size={15} /> {p.action}</>}
          </button>
          <button className="btn btn-ghost" onClick={() => setOpen(o => !o)} style={{ padding: '10px 13px' }}>
            <Icon name={open ? 'chevD' : 'eye'} size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

function Celebrate({ color }) {
  const bits = Array.from({ length: 14 });
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 5 }}>
      {bits.map((_, i) => {
        const left = (i / bits.length) * 100 + (Math.random() * 6 - 3);
        const delay = Math.random() * 0.2;
        const cols = [color, 'var(--lime)', 'var(--cyan)', 'var(--violet)'];
        return (
          <span key={i} style={{ position: 'absolute', top: '40%', left: left + '%',
            width: 6, height: 6, borderRadius: 1, background: cols[i % cols.length],
            animation: `confetti .9s ${delay}s ease-out forwards`, opacity: 0 }} />
        );
      })}
    </div>
  );
}

Object.assign(window, { WasteScreen, MissionCard, ProjStat, Celebrate });
