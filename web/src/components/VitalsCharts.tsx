/**
 * VitalsCharts — pure inline-SVG charts for the Biomonitor trends grid.
 * No chart lib. Crisp pixel rendering via a measured width (ResizeObserver),
 * richer than the old sparkline: optional healthy-range band, hover scrub
 * (updates the shown value + date), direction-aware delta pill, and a
 * dual-line blood-pressure plot with the pulse-pressure gap shaded.
 *
 * Series arrive already windowed (the history endpoint returns exactly the
 * selected window), so these components plot the points as-given.
 */
import { useRef, useState, useLayoutEffect, useMemo } from 'react';
import { Icon } from './Icon';

export interface SeriesPoint { date: Date; value: number }

export type ChartStyle = 'area' | 'line' | 'bars';

/** Measure an element's pixel width so charts render crisp (not stretched). */
export function useWidth(initial = 360): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(initial);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(entries => {
      const cw = entries[0].contentRect.width;
      if (cw > 0) setW(cw);
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

interface Stats { min: number; max: number; avg: number; first: number; last: number; delta: number; n: number }
function stats(points: SeriesPoint[]): Stats | null {
  if (!points.length) return null;
  const vals = points.map(p => p.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const first = vals[0], last = vals[vals.length - 1];
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return { min, max, avg, first, last, delta: last - first, n: points.length };
}

const fmtNum = (v: number, unit?: string | null): string => {
  const s = v >= 1000 ? Math.round(v).toLocaleString() : (Number.isInteger(v) ? String(v) : v.toFixed(1));
  return unit ? `${s} ${unit}` : s;
};

function dayLabel(d: Date): string {
  const mo = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][d.getMonth()];
  return `${mo} ${String(d.getDate()).padStart(2, '0')}`;
}

/** Delta pill — respects whether up or down is the "good" direction. */
function DeltaPill({ delta, good, unit }: { delta: number | null; good: 'up' | 'down' | null; unit?: string | null }) {
  if (delta == null || Math.abs(delta) < 1e-6) {
    return <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-faint)', letterSpacing: '0.04em' }}>FLAT</span>;
  }
  const up = delta > 0;
  const positive = good == null ? up : (good === 'up' ? up : !up);
  const color = good == null ? 'var(--text-dim)' : positive ? 'var(--lime)' : 'var(--red)';
  const mag = Math.abs(delta);
  const txt = mag >= 1000 ? Math.round(mag).toLocaleString() : (Number.isInteger(mag) ? String(mag) : mag.toFixed(1));
  return (
    <span className="mono" style={{
      fontSize: 10.5, fontWeight: 700, letterSpacing: '0.03em', color,
      display: 'inline-flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap',
    }}>
      <Icon name={up ? 'arrowUp' : 'arrowDn'} size={11} style={{ color }} />
      {txt}{unit ? ' ' + unit : ''}
    </span>
  );
}

export function FootStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span className="ncx-serial">{label}</span>
      <span className="mono" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-dim)' }}>{value}</span>
    </div>
  );
}

export function ChartEmpty({ height }: { height: number }) {
  return (
    <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-ghost)', fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
      no readings in window
    </div>
  );
}

/* ---- single-metric chart ---- */
export function TrendChart({
  series, color, unit, good, band, chartStyle, showBand,
}: {
  series: SeriesPoint[];
  color: string;
  unit: string | null;
  good: 'up' | 'down' | null;
  band?: [number, number];
  chartStyle: ChartStyle;
  showBand: boolean;
}) {
  const [ref, W] = useWidth();
  const H = 92, PAD_T = 10, PAD_B = 6;
  const [hover, setHover] = useState<number | null>(null);

  const points = series;
  const st = stats(points);
  const n = points.length;

  const activeBand = showBand ? band : undefined;
  let lo = st ? st.min : 0, hi = st ? st.max : 1;
  if (activeBand) { lo = Math.min(lo, activeBand[0]); hi = Math.max(hi, activeBand[1]); }
  const padv = (hi - lo) * 0.12 || 1;
  lo -= padv; hi += padv;

  const x = (i: number) => n <= 1 ? W / 2 : (i / (n - 1)) * W;
  const y = (v: number) => PAD_T + (1 - (v - lo) / (hi - lo)) * (H - PAD_T - PAD_B);

  const linePts = points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const areaPts = n > 1 ? `0,${H} ${linePts} ${W},${H}` : '';
  const gid = `vc-${color.replace(/[^a-z]/gi, '')}-${n}`;

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!n) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.max(0, Math.min(n - 1, Math.round(((e.clientX - rect.left) / rect.width) * (n - 1))));
    setHover(i);
  };
  const onLeave = () => setHover(null);

  const shown = hover != null ? points[hover] : (st ? { value: st.last, date: points[n - 1].date } : null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      {/* header: latest (or scrubbed) value + delta */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span className="ncx-val" style={{ fontSize: 25, color, lineHeight: 1 }}>
            {shown ? fmtNum(shown.value) : '—'}
          </span>
          {unit && <span className="mono" style={{ fontSize: 11, color: 'var(--text-faint)' }}>{unit}</span>}
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <DeltaPill delta={st ? st.delta : null} good={good} unit={unit} />
          <div className="ncx-serial" style={{ marginTop: 3 }}>{hover != null && shown ? dayLabel(shown.date) : 'VS WINDOW START'}</div>
        </div>
      </div>

      {/* chart */}
      {n === 0 ? <ChartEmpty height={H} /> : (
        <div ref={ref} style={{ position: 'relative', height: H }} onMouseMove={onMove} onMouseLeave={onLeave}>
          <svg width={W} height={H} style={{ display: 'block', overflow: 'visible' }}>
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.26} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>

            {activeBand && (
              <rect x="0" y={y(activeBand[1])} width={W} height={Math.max(0, y(activeBand[0]) - y(activeBand[1]))}
                fill="rgba(67,255,166,0.06)" stroke="rgba(67,255,166,0.18)" strokeWidth="1" strokeDasharray="2 4" />
            )}

            {n > 1 && chartStyle === 'bars' && points.map((p, i) => {
              const bw = Math.max(1, (W / n) * 0.62);
              return <rect key={i} x={x(i) - bw / 2} y={y(p.value)} width={bw} height={H - PAD_B - y(p.value)}
                fill={color} opacity={hover === i ? 0.95 : 0.5} />;
            })}

            {n > 1 && chartStyle === 'area' && <polygon points={areaPts} fill={`url(#${gid})`} stroke="none" />}
            {n > 1 && chartStyle !== 'bars' && (
              <polyline points={linePts} fill="none" stroke={color} strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round"
                style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
            )}

            {hover != null && (
              <g>
                <line x1={x(hover)} y1={PAD_T - 6} x2={x(hover)} y2={H} stroke="var(--line-2)" strokeWidth="1" />
                <circle cx={x(hover)} cy={y(points[hover].value)} r="4" fill={color} style={{ filter: `drop-shadow(0 0 5px ${color})` }} />
              </g>
            )}
            {hover == null && st && n > 1 && (
              <circle cx={x(n - 1)} cy={y(st.last)} r="3.5" fill={color} style={{ filter: `drop-shadow(0 0 5px ${color})` }} />
            )}
          </svg>
        </div>
      )}

      {/* footer stats */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'baseline', borderTop: '1px solid var(--line)', paddingTop: 8 }}>
        <FootStat label="MIN" value={st ? fmtNum(st.min) : '—'} />
        <FootStat label="AVG" value={st ? fmtNum(Math.round(st.avg * 10) / 10) : '—'} />
        <FootStat label="MAX" value={st ? fmtNum(st.max) : '—'} />
        <span className="ncx-serial" style={{ marginLeft: 'auto' }}>{st ? st.n : 0} PTS</span>
      </div>
    </div>
  );
}

/* ---- combined blood-pressure plot: systolic + diastolic on shared axes,
        with the pulse-pressure gap shaded between them + per-line legend ---- */
export function BpChart({
  sys: sysRaw, dia: diaRaw, bands, chartStyle, showBand,
}: {
  sys: SeriesPoint[];
  dia: SeriesPoint[];
  bands: { sys: [number, number]; dia: [number, number] };
  chartStyle: ChartStyle;
  showBand: boolean;
}) {
  const [ref, W] = useWidth();
  const H = 150, PAD_T = 14, PAD_B = 8;
  const [hover, setHover] = useState<number | null>(null);

  // Systolic & diastolic arrive as INDEPENDENT date-ordered series and can have
  // readings on different days. BP is a paired measurement, so join by date and
  // keep only days that have BOTH — otherwise index-zipping pairs a systolic
  // reading with an unrelated day's diastolic (wrong lines, wrong pulse). The
  // downstream render is unchanged: `sys`/`dia` are now index-aligned by date.
  const sys = useMemo(() => {
    const diaByDate = new Map(diaRaw.map(p => [p.date, p.value]));
    return sysRaw.filter(p => diaByDate.has(p.date));
  }, [sysRaw, diaRaw]);
  const dia = useMemo(() => {
    const diaByDate = new Map(diaRaw.map(p => [p.date, p.value]));
    return sysRaw.filter(p => diaByDate.has(p.date)).map(p => ({ date: p.date, value: diaByDate.get(p.date)! }));
  }, [sysRaw, diaRaw]);

  const sSt = stats(sys), dSt = stats(dia);
  const n = Math.min(sys.length, dia.length);

  let lo = Math.min(dSt ? dSt.min : 60, showBand ? bands.dia[0] : 999);
  let hi = Math.max(sSt ? sSt.max : 120, showBand ? bands.sys[1] : 0);
  const padv = (hi - lo) * 0.1 || 1; lo -= padv; hi += padv;
  const x = (i: number) => n <= 1 ? W / 2 : (i / (n - 1)) * W;
  const y = (v: number) => PAD_T + (1 - (v - lo) / (hi - lo)) * (H - PAD_T - PAD_B);

  const sysPts = sys.slice(0, n).map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const diaPts = dia.slice(0, n).map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  // gap polygon = systolic line, then diastolic line reversed
  const gapPts = n > 1
    ? sys.slice(0, n).map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ') + ' ' +
      dia.slice(0, n).map((_, i) => `${x(n - 1 - i).toFixed(1)},${y(dia[n - 1 - i].value).toFixed(1)}`).join(' ')
    : '';

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!n) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.max(0, Math.min(n - 1, Math.round(((e.clientX - rect.left) / rect.width) * (n - 1))));
    setHover(i);
  };

  const showSys = hover != null ? sys[hover].value : (sSt ? sSt.last : 0);
  const showDia = hover != null ? dia[hover].value : (dSt ? dSt.last : 0);
  const SYS_C = 'var(--magenta)', DIA_C = 'var(--cyan)';
  void chartStyle; // BP is always dual-line regardless of the area/line/bars choice

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          <span className="ncx-val" style={{ fontSize: 30, color: SYS_C, lineHeight: 1 }}>{Math.round(showSys)}</span>
          <span className="ncx-val" style={{ fontSize: 20, color: 'var(--text-faint)', lineHeight: 1 }}>/</span>
          <span className="ncx-val" style={{ fontSize: 30, color: DIA_C, lineHeight: 1 }}>{Math.round(showDia)}</span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 4 }}>mmHg</span>
        </div>
        <div style={{ display: 'flex', gap: 18, marginLeft: 'auto' }}>
          <LegendItem c={SYS_C} label="SYSTOLIC" delta={sSt ? sSt.delta : null} />
          <LegendItem c={DIA_C} label="DIASTOLIC" delta={dSt ? dSt.delta : null} />
        </div>
      </div>

      {n === 0 ? <ChartEmpty height={H} /> : (
        <div ref={ref} style={{ position: 'relative', height: H }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          <svg width={W} height={H} style={{ display: 'block', overflow: 'visible' }}>
            {showBand && (
              <g>
                <rect x="0" y={y(bands.sys[1])} width={W} height={Math.max(0, y(bands.sys[0]) - y(bands.sys[1]))}
                  fill="rgba(255,46,154,0.05)" stroke="rgba(255,46,154,0.16)" strokeWidth="1" strokeDasharray="2 4" />
                <rect x="0" y={y(bands.dia[1])} width={W} height={Math.max(0, y(bands.dia[0]) - y(bands.dia[1]))}
                  fill="rgba(28,226,255,0.05)" stroke="rgba(28,226,255,0.16)" strokeWidth="1" strokeDasharray="2 4" />
              </g>
            )}
            {n > 1 && <polygon points={gapPts} fill="rgba(157,107,255,0.08)" stroke="none" />}
            {n > 1 && <polyline points={sysPts} fill="none" stroke={SYS_C} strokeWidth="1.8" strokeLinejoin="round" style={{ filter: `drop-shadow(0 0 4px ${SYS_C})` }} />}
            {n > 1 && <polyline points={diaPts} fill="none" stroke={DIA_C} strokeWidth="1.8" strokeLinejoin="round" style={{ filter: `drop-shadow(0 0 4px ${DIA_C})` }} />}
            {hover != null && (
              <g>
                <line x1={x(hover)} y1={0} x2={x(hover)} y2={H} stroke="var(--line-2)" strokeWidth="1" />
                <circle cx={x(hover)} cy={y(sys[hover].value)} r="4" fill={SYS_C} style={{ filter: `drop-shadow(0 0 5px ${SYS_C})` }} />
                <circle cx={x(hover)} cy={y(dia[hover].value)} r="4" fill={DIA_C} style={{ filter: `drop-shadow(0 0 5px ${DIA_C})` }} />
              </g>
            )}
            {hover == null && n > 1 && sSt && dSt && (
              <g>
                <circle cx={x(n - 1)} cy={y(sSt.last)} r="3.5" fill={SYS_C} style={{ filter: `drop-shadow(0 0 5px ${SYS_C})` }} />
                <circle cx={x(n - 1)} cy={y(dSt.last)} r="3.5" fill={DIA_C} style={{ filter: `drop-shadow(0 0 5px ${DIA_C})` }} />
              </g>
            )}
          </svg>
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, alignItems: 'baseline', borderTop: '1px solid var(--line)', paddingTop: 8 }}>
        <FootStat label="SYS AVG" value={sSt ? Math.round(sSt.avg) : '—'} />
        <FootStat label="DIA AVG" value={dSt ? Math.round(dSt.avg) : '—'} />
        <FootStat label="PULSE" value={sSt && dSt ? Math.round(sSt.last - dSt.last) : '—'} />
        <span className="ncx-serial" style={{ marginLeft: 'auto' }}>
          {hover != null ? dayLabel(sys[hover].date) : `${n} PTS`}
        </span>
      </div>
    </div>
  );
}

function LegendItem({ c, label, delta }: { c: string; label: string; delta: number | null }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
      <span className="mono" style={{ fontSize: 9, letterSpacing: '0.18em', color: 'var(--text-faint)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 14, height: 2, background: c, boxShadow: `0 0 5px ${c}`, display: 'inline-block' }} />
        {label}
      </span>
      <DeltaPill delta={delta} good="down" unit="" />
    </div>
  );
}
