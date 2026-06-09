/* ============================================================
   FinDash — Custom SVG charts (neon, interactive)
   ============================================================ */

/* ---- helpers ---- */
function smoothPath(pts) {
  if (pts.length < 2) return '';
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i], p1 = pts[i + 1];
    const cx = (p0.x + p1.x) / 2;
    d += ` C ${cx} ${p0.y}, ${cx} ${p1.y}, ${p1.x} ${p1.y}`;
  }
  return d;
}

/* ============================================================
   Area / Line / Bar trend chart with hover crosshair
   ============================================================ */
function TrendChart({ data, mode = 'area', height = 280, color = 'var(--cyan)', color2 = 'var(--violet)',
                      valueKey = 'spent', labelKey = 'label', showIncome = false }) {
  const wrapRef = useRef(null);
  const [W, setW] = useState(720);
  const [hover, setHover] = useState(null);
  const gid = useRef('g' + Math.random().toString(36).slice(2, 7)).current;

  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el); setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const padL = 52, padR = 16, padT = 18, padB = 30;
  const innerW = Math.max(50, W - padL - padR);
  const innerH = height - padT - padB;

  const vals = data.map(d => d[valueKey]);
  const incVals = showIncome ? data.map(d => d.income) : [];
  const maxV = Math.max(...vals, ...incVals) * 1.12;
  const minV = 0;

  const x = (i) => padL + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v) => padT + innerH - ((v - minV) / (maxV - minV)) * innerH;

  const pts = data.map((d, i) => ({ x: x(i), y: y(d[valueKey]), v: d[valueKey], d }));
  const incPts = showIncome ? data.map((d, i) => ({ x: x(i), y: y(d.income), v: d.income, d })) : [];

  const linePath = smoothPath(pts);
  const areaPath = linePath + ` L ${pts[pts.length-1].x} ${padT+innerH} L ${pts[0].x} ${padT+innerH} Z`;

  // gridlines
  const gridN = 4;
  const grid = Array.from({ length: gridN + 1 }, (_, i) => {
    const v = minV + (i / gridN) * (maxV - minV);
    return { y: y(v), v };
  });

  function onMove(e) {
    const rect = wrapRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    let best = 0, bd = Infinity;
    pts.forEach((p, i) => { const dd = Math.abs(p.x - mx); if (dd < bd) { bd = dd; best = i; } });
    setHover(best);
  }

  const barW = Math.min(38, innerW / data.length * 0.5);

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%' }}
         onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg width={W} height={height} style={{ display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id={gid + 'fill'} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.34" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
          <linearGradient id={gid + 'stroke'} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={color} />
            <stop offset="100%" stopColor={color2} />
          </linearGradient>
        </defs>

        {/* gridlines */}
        {grid.map((g, i) => (
          <g key={i}>
            <line x1={padL} y1={g.y} x2={W - padR} y2={g.y} stroke="var(--line)" strokeWidth="1"
                  strokeDasharray={i === 0 ? '0' : '2 5'} />
            <text x={padL - 10} y={g.y + 4} textAnchor="end" fontSize="10.5"
                  fontFamily="var(--font-mono)" fill="var(--text-faint)">
              {g.v >= 1000 ? '$' + (g.v/1000).toFixed(g.v>=1000?1:0) + 'k' : '$' + Math.round(g.v)}
            </text>
          </g>
        ))}

        {/* income reference line */}
        {showIncome && (
          <path d={smoothPath(incPts)} fill="none" stroke="var(--text-ghost)" strokeWidth="1.5"
                strokeDasharray="4 5" />
        )}

        {mode === 'bar' ? (
          pts.map((p, i) => {
            const h = padT + innerH - p.y;
            const active = hover === i;
            return (
              <g key={i}>
                <rect x={p.x - barW/2} y={p.y} width={barW} height={Math.max(0, h)} rx="4"
                      fill={`url(#${gid}stroke)`} opacity={active ? 1 : 0.78}
                      style={{ filter: active ? `drop-shadow(0 0 8px ${color})` : 'none', transition: 'opacity .15s' }} />
              </g>
            );
          })
        ) : (
          <>
            {mode === 'area' && <path d={areaPath} fill={`url(#${gid}fill)`}
              style={{ animation: 'flicker-in .8s both' }} />}
            <path d={linePath} fill="none" stroke={`url(#${gid}stroke)`} strokeWidth="2.5"
                  strokeLinecap="round"
                  style={{ filter: `drop-shadow(0 0 6px ${color}aa)`,
                    strokeDasharray: 2000, strokeDashoffset: 2000, animation: 'draw-stroke 1.4s cubic-bezier(.22,.61,.36,1) forwards' }} />
            {pts.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={hover === i ? 5 : 3}
                      fill="var(--bg)" stroke={color} strokeWidth="2"
                      style={{ filter: hover === i ? `drop-shadow(0 0 6px ${color})` : 'none', transition: 'r .12s' }} />
            ))}
          </>
        )}

        {/* x labels */}
        {data.map((d, i) => (
          (data.length <= 8 || i % Math.ceil(data.length / 8) === 0) &&
          <text key={i} x={x(i)} y={height - 8} textAnchor="middle" fontSize="10.5"
                fontFamily="var(--font-mono)" fill={hover === i ? 'var(--cyan)' : 'var(--text-faint)'}>
            {d[labelKey].replace('Jun ', '')}
          </text>
        ))}

        {/* crosshair */}
        {hover !== null && (
          <line x1={pts[hover].x} y1={padT} x2={pts[hover].x} y2={padT + innerH}
                stroke="var(--cyan)" strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
        )}
      </svg>

      {hover !== null && (
        <FloatTip x={pts[hover].x} y={pts[hover].y} color={color}>
          <div className="kicker" style={{ marginBottom: 4 }}>{data[hover][labelKey]}</div>
          <div className="mono" style={{ fontSize: 15, color: 'var(--text)', fontWeight: 600 }}>
            {fmtMoney(data[hover][valueKey])}
          </div>
          {showIncome && (
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
              income {fmtMoney(data[hover].income)}
            </div>
          )}
        </FloatTip>
      )}
    </div>
  );
}

/* ============================================================
   Donut chart with hover + center readout
   ============================================================ */
function Donut({ data, size = 230, thickness = 26, active, onHover, centerTop, centerMain, centerSub }) {
  const r = (size - thickness) / 2;
  const cx = size / 2, cy = size / 2;
  const c = 2 * Math.PI * r;
  const total = data.reduce((a, d) => a + d.total, 0);
  let acc = 0;
  const gap = 0.012;

  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        {data.map((d, i) => {
          const frac = d.total / total;
          const len = Math.max(0, (frac - gap) * c);
          const off = -acc * c;
          acc += frac;
          const isActive = active === i;
          return (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none"
              stroke={d.color} strokeWidth={isActive ? thickness + 5 : thickness}
              strokeDasharray={`${len} ${c - len}`} strokeDashoffset={off}
              onMouseEnter={() => onHover && onHover(i)}
              onMouseLeave={() => onHover && onHover(null)}
              style={{
                cursor: 'pointer', transition: 'stroke-width .15s, opacity .15s',
                opacity: active == null || isActive ? 1 : 0.32,
                filter: isActive ? `drop-shadow(0 0 8px ${d.color})` : 'none',
              }} />
          );
        })}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        <div>
          <div className="kicker" style={{ marginBottom: 5 }}>{centerTop}</div>
          <div className="mono" style={{ fontSize: 27, fontWeight: 600, letterSpacing: '-0.02em' }}>{centerMain}</div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 3 }}>{centerSub}</div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Mini sparkline (for cards)
   ============================================================ */
function Spark({ data, w = 96, h = 30, color = 'var(--cyan)', fill = true }) {
  const max = Math.max(...data) * 1.05, min = Math.min(...data) * 0.95;
  const x = (i) => (i / (data.length - 1)) * w;
  const y = (v) => h - ((v - min) / (max - min || 1)) * h;
  const pts = data.map((v, i) => ({ x: x(i), y: y(v) }));
  const line = smoothPath(pts);
  const gid = useRef('s' + Math.random().toString(36).slice(2, 7)).current;
  return (
    <svg width={w} height={h} style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.30" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={line + ` L ${w} ${h} L 0 ${h} Z`} fill={`url(#${gid})`} />}
      <path d={line} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 3px ${color}aa)` }} />
      <circle cx={pts[pts.length-1].x} cy={pts[pts.length-1].y} r="2.4" fill={color}
              style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
    </svg>
  );
}

/* ============================================================
   Horizontal bar (category / vendor lists)
   ============================================================ */
function HBars({ rows, max, delay = 0 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {rows.map((r, i) => (
        <div key={i}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
            <CatChip name={r.name} color={r.color} icon={r.icon} size="sm" />
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span className="mono" style={{ fontSize: 13.5, fontWeight: 600 }}>{fmtMoney(r.total)}</span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', width: 38, textAlign: 'right' }}>
                {(r.pct * 100).toFixed(0)}%
              </span>
            </div>
          </div>
          <Bar value={r.total} max={max} color={r.color} height={6} delay={delay + i * 70} />
        </div>
      ))}
    </div>
  );
}

Object.assign(window, { TrendChart, Donut, Spark, HBars, smoothPath });
