/* ============================================================
   FinDash — Categories screen (donut + drill-down)
   ============================================================ */

function CategoriesScreen({ data, goTo }) {
  const cats = data.categories;
  const total = cats.reduce((a, c) => a + c.total, 0);
  const [hover, setHover] = useState(null);
  const [selected, setSelected] = useState(0);
  const maxCat = cats[0].total;

  const focus = hover != null ? hover : selected;
  const fc = cats[focus];

  // vendors belonging to focused category
  const catVendors = data.vendors.filter(v => v.cat === fc.name).sort((a,b)=>b.total-a.total);

  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <SectionHead index="" sub="CATEGORY BREAKDOWN" title="Spending by category"
        right={<div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          {cats.length} CATEGORIES · {fmtMoney(total)} TOTAL</div>} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.1fr', gap: 16 }} className="split-grid">
        {/* DONUT */}
        <div className="panel hud" style={{ padding: 26, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <Donut data={cats} size={252} thickness={28} active={hover}
            onHover={setHover}
            centerTop={hover != null ? 'HOVERING' : 'TOTAL SPEND'}
            centerMain={hover != null ? fmtMoney(cats[hover].total) : fmtMoney(total)}
            centerSub={hover != null ? cats[hover].name : `${data.metrics.fullMonths + 1} months`} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 26, justifyContent: 'center' }}>
            {cats.map((c, i) => (
              <button key={c.name} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
                onClick={() => setSelected(i)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 9px', borderRadius: 7,
                  background: 'var(--panel-2)', cursor: 'pointer', transition: 'all .15s',
                  border: `1px solid ${(hover === i || selected === i) ? c.color + '66' : 'var(--line)'}`,
                  opacity: hover != null && hover !== i ? 0.5 : 1 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: c.color, boxShadow: `0 0 6px ${c.color}` }} />
                <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>{c.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* RANKED LIST */}
        <div className="panel" style={{ padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <Kicker>RANKED · TAP TO INSPECT</Kicker>
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-faint)' }}>SHARE OF SPEND</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            {cats.map((c, i) => {
              const active = selected === i;
              return (
                <button key={c.name} onClick={() => setSelected(i)} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
                  style={{ background: active ? 'var(--panel-2)' : 'transparent', border: `1px solid ${active ? c.color + '44' : 'transparent'}`,
                    borderRadius: 10, padding: '9px 11px', cursor: 'pointer', textAlign: 'left', transition: 'all .15s' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <CatChip name={c.name} color={c.color} icon={c.icon} size="sm" />
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
                      <span className="mono" style={{ fontSize: 14, fontWeight: 600 }}>{fmtMoney(c.total)}</span>
                      <span className="mono" style={{ fontSize: 11, color: c.color, width: 36, textAlign: 'right' }}>{(c.pct*100).toFixed(0)}%</span>
                    </div>
                  </div>
                  <Bar value={c.total} max={maxCat} color={c.color} height={5} delay={i * 50} />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* DRILL-DOWN DETAIL */}
      <div className="panel" style={{ padding: 24, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: 2, background: `linear-gradient(90deg, ${fc.color}, transparent)` }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ width: 48, height: 48, borderRadius: 12, display: 'grid', placeItems: 'center',
              background: fc.color + '1c', border: `1px solid ${fc.color}44`, color: fc.color }}>
              <Icon name={fc.icon} size={22} />
            </span>
            <div>
              <div style={{ fontSize: 19, fontWeight: 600 }}>{fc.name}</div>
              <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
                {(fc.pct*100).toFixed(1)}% OF SPEND · {fmtMoney(fc.avg)}/MO AVG
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 26 }}>
            <Stat label="Total" value={fmtMoney(fc.total)} color={fc.color} />
            <Stat label="Monthly avg" value={fmtMoney(fc.avg)} />
            <Stat label="Peak month" value={data.MONTHS[fc.series.indexOf(Math.max(...fc.series))]} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 24 }} className="split-grid">
          <div>
            <Kicker style={{ marginBottom: 12 }}>MONTHLY TREND</Kicker>
            <TrendChart key={fc.name} data={data.MONTHS.map((mo, i) => ({ label: mo, spent: fc.series[i] }))}
              mode="bar" height={200} color={fc.color} color2={fc.color} />
          </div>
          <div>
            <Kicker style={{ marginBottom: 14 }}>TOP VENDORS</Kicker>
            {catVendors.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {catVendors.map(v => (
                  <div key={v.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '11px 13px', background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 10 }}>
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: 500 }}>{v.name}</div>
                      <div className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>{v.n} CHARGES</div>
                    </div>
                    <span className="mono" style={{ fontSize: 14, fontWeight: 600, color: fc.color }}>{fmtMoney(v.total)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="panel-inset" style={{ padding: 18, fontSize: 12.5, color: 'var(--text-faint)' }}>
                No standout vendors — spread across many merchants.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div>
      <div className="kicker" style={{ marginBottom: 6 }}>{label}</div>
      <div className="mono" style={{ fontSize: 17, fontWeight: 600, color: color || 'var(--text)' }}>{value}</div>
    </div>
  );
}

Object.assign(window, { CategoriesScreen, Stat });
