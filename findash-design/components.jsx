/* ============================================================
   FinDash — Shared UI primitives
   ============================================================ */
const { useState, useEffect, useRef, useMemo } = React;

/* ---- formatting ---- */
const fmtMoney = (n, dp = 0) =>
  (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const fmtMoneyC = (n) => fmtMoney(n, 2);
const fmtPct = (n, dp = 1) => (n > 0 ? '+' : '') + n.toFixed(dp) + '%';
const fmtNum = (n) => n.toLocaleString('en-US');

/* ---- Kicker label ---- */
function Kicker({ children, style }) {
  return <div className="kicker" style={style}>{children}</div>;
}

/* ---- Section header ---- */
function SectionHead({ index, title, sub, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 18 }}>
      <div>
        <Kicker style={{ marginBottom: 9, display: 'flex', alignItems: 'center', gap: 8 }}>
          {index && <span style={{ color: 'var(--cyan)' }}>{index}</span>}
          <span style={{ width: 22, height: 1, background: 'var(--line-2)' }} />
          {sub}
        </Kicker>
        <h2 style={{ fontSize: 23, letterSpacing: '-0.02em' }}>{title}</h2>
      </div>
      {right}
    </div>
  );
}

/* ---- Trend pill ---- */
function Trend({ value, invertGood = false, size = 'md' }) {
  const up = value >= 0;
  const good = invertGood ? !up : up;
  const color = good ? 'var(--lime)' : 'var(--red)';
  const sm = size === 'sm';
  return (
    <span className="mono" style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      color, fontSize: sm ? 11 : 12.5, fontWeight: 600,
      padding: sm ? '2px 6px' : '3px 8px', borderRadius: 6,
      background: good ? 'rgba(67,255,166,0.10)' : 'rgba(255,77,109,0.10)',
      border: `1px solid ${good ? 'rgba(67,255,166,0.22)' : 'rgba(255,77,109,0.22)'}`,
    }}>
      <Icon name={up ? 'arrowUp' : 'arrowDn'} size={sm ? 11 : 12} stroke={2.4} />
      {fmtPct(Math.abs(value) === value ? value : value)}
    </span>
  );
}

/* ---- Category chip ---- */
function CatChip({ name, color, icon, size = 'md' }) {
  const sm = size === 'sm';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span style={{
        width: sm ? 22 : 28, height: sm ? 22 : 28, borderRadius: 7,
        display: 'grid', placeItems: 'center', flexShrink: 0,
        background: color + '1f', border: `1px solid ${color}44`, color,
      }}>
        <Icon name={icon} size={sm ? 12 : 15} />
      </span>
      <span style={{ fontSize: sm ? 13 : 14, color: 'var(--text)' }}>{name}</span>
    </span>
  );
}

/* ---- Progress ring (SVG) ---- */
function Ring({ value, max = 100, size = 64, stroke = 6, color = 'var(--cyan)', track = 'var(--panel-3)', children, glow = true }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value / max));
  const [draw, setDraw] = useState(0);
  useEffect(() => { const t = setTimeout(() => setDraw(pct), 60); return () => clearTimeout(t); }, [pct]);
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - draw)}
          style={{ transition: 'stroke-dashoffset 1s cubic-bezier(.22,.61,.36,1)', filter: glow ? `drop-shadow(0 0 5px ${color})` : 'none' }} />
      </svg>
      {children && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>{children}</div>}
    </div>
  );
}

/* ---- Linear progress bar ---- */
function Bar({ value, max = 100, color = 'var(--cyan)', height = 8, track = 'var(--panel-3)', glow = false, delay = 0 }) {
  const pct = Math.max(0, Math.min(1, value / max));
  const [w, setW] = useState(0);
  useEffect(() => { const t = setTimeout(() => setW(pct), 80 + delay); return () => clearTimeout(t); }, [pct, delay]);
  return (
    <div style={{ height, borderRadius: 20, background: track, overflow: 'hidden', position: 'relative' }}>
      <div style={{
        height: '100%', width: (w * 100) + '%', borderRadius: 20,
        background: `linear-gradient(90deg, ${color}aa, ${color})`,
        boxShadow: glow ? `0 0 10px ${color}88` : 'none',
        transition: 'width 1s cubic-bezier(.22,.61,.36,1)',
      }} />
    </div>
  );
}

/* ---- Badge ---- */
function Badge({ children, color = 'var(--text-dim)', solid = false, style }) {
  return (
    <span className="mono" style={{
      fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase',
      padding: '3px 8px', borderRadius: 5, lineHeight: 1.4,
      color: solid ? '#06060c' : color,
      background: solid ? color : `color-mix(in srgb, ${color} 15%, transparent)`,
      border: `1px solid ${solid ? 'transparent' : `color-mix(in srgb, ${color} 45%, transparent)`}`,
      ...style,
    }}>{children}</span>
  );
}

/* ---- Count-up number ---- */
function CountUp({ value, format = (n) => Math.round(n).toString(), dur = 900 }) {
  const [n, setN] = useState(value);
  const ref = useRef();
  useEffect(() => {
    let start, done = false;
    const from = 0, to = value;
    setN(0);
    const tick = (t) => {
      if (!start) start = t;
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(from + (to - from) * eased);
      if (p < 1) ref.current = requestAnimationFrame(tick); else done = true;
    };
    ref.current = requestAnimationFrame(tick);
    // Fallback: guarantee final value even if rAF is throttled (background/offscreen/capture)
    const fb = setTimeout(() => { if (!done) setN(to); }, dur + 150);
    return () => { cancelAnimationFrame(ref.current); clearTimeout(fb); };
  }, [value]);
  return <span className="mono tnum">{format(n)}</span>;
}

/* ---- Tooltip-ish floating value (used by charts) ---- */
function FloatTip({ x, y, children, color = 'var(--cyan)' }) {
  return (
    <div style={{
      position: 'absolute', left: x, top: y, transform: 'translate(-50%, -115%)',
      pointerEvents: 'none', zIndex: 20,
      background: 'rgba(8,9,16,0.95)', border: `1px solid ${color}66`,
      borderRadius: 8, padding: '8px 10px', whiteSpace: 'nowrap',
      boxShadow: `0 8px 26px -10px ${color}, 0 0 0 1px rgba(0,0,0,0.4)`,
      backdropFilter: 'blur(6px)',
    }}>{children}</div>
  );
}

Object.assign(window, {
  fmtMoney, fmtMoneyC, fmtPct, fmtNum,
  Kicker, SectionHead, Trend, CatChip, Ring, Bar, Badge, CountUp, FloatTip,
});
