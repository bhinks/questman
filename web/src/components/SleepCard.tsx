/**
 * SleepCard — the SLEEP SCHEDULE card for the Health page's trends grid.
 *
 * Rebuilt from the lost Recovery ("tonight focus") handoff: a bar chart of
 * the last 10 nights showing WHEN you went to bed, so bedtime drift is
 * visible at a glance — consistent nights read as bar tops lining up on a
 * level line. Each bar spans bedtime → wake (bedtime end emphasized), with
 * the window's average bedtime drawn as the alignment reference.
 *
 * Data: the 'sleepStart' uplink stream (signed hours vs the wake day's
 * local midnight; see healthSync.ts) paired with 'sleepHours' for the wake
 * end of each bar. Both are def-less streams — this card is their only UI.
 * The card hides itself entirely until at least one bedtime has synced.
 *
 * Chart conventions follow VitalsCharts: hand-rolled SVG, measured width,
 * hover scrub updating the header, MIN/AVG/MAX-style footer.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { metaFor } from '../lib/vitalsMeta';
import { useWidth, FootStat } from './VitalsCharts';
import { CARD, CardHead } from './VitalsParts';

const NIGHTS = 10;
const VIOLET = 'var(--violet)';

interface HistoryResponse {
  key: string;
  series: Array<{ date: string; value: number }>;
}

interface Night {
  date: Date;
  bedtime: number | null;   // signed hours vs this day's midnight
  hours: number | null;     // total sleep that night
}

/** Signed hours vs midnight → "11:24 PM". */
function clock(v: number): string {
  const h24 = ((v % 24) + 24) % 24;
  let h = Math.floor(h24);
  let m = Math.round((h24 - h) * 60);
  if (m === 60) { m = 0; h = (h + 1) % 24; }
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function nightLabel(d: Date): string {
  const mo = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][d.getMonth()];
  return `${mo} ${String(d.getDate()).padStart(2, '0')}`;
}

/** Drift pill — mean deviation from the window's average bedtime. */
function DriftPill({ minutes }: { minutes: number | null }) {
  if (minutes == null) return null;
  const color = minutes <= 25 ? 'var(--lime)' : minutes <= 50 ? 'var(--amber)' : 'var(--red)';
  return (
    <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.03em', color, whiteSpace: 'nowrap' }}>
      ±{Math.round(minutes)}m
    </span>
  );
}

export function SleepScheduleCard() {
  const meta = metaFor('sleepStart');
  const startQ = useQuery({
    queryKey: ['metrics', 'history', 'sleepStart', NIGHTS],
    queryFn: () => api.get<HistoryResponse>(`/api/metrics/history?key=sleepStart&days=${NIGHTS}`),
  });
  const hoursQ = useQuery({
    queryKey: ['metrics', 'history', 'sleepHours', NIGHTS],
    queryFn: () => api.get<HistoryResponse>(`/api/metrics/history?key=sleepHours&days=${NIGHTS}`),
  });

  // Fixed 10-night domain ending today, so a skipped sync reads as a gap
  // instead of silently compressing the timeline.
  const byDay = (rows?: Array<{ date: string; value: number }>) => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) m.set(new Date(r.date).toDateString(), r.value);
    return m;
  };
  const starts = byDay(startQ.data?.series);
  const hours = byDay(hoursQ.data?.series);
  const nights: Night[] = [];
  for (let i = NIGHTS - 1; i >= 0; i--) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    const k = d.toDateString();
    nights.push({ date: d, bedtime: starts.get(k) ?? null, hours: hours.get(k) ?? null });
  }
  const slept = nights.filter((n): n is Night & { bedtime: number } => n.bedtime != null);

  // No bedtimes synced yet → no card. It appears after the first uplink
  // pull that carries sleep sessions (SYNC NOW backfills history).
  if (slept.length === 0) return null;

  return (
    <div className="panel hud" style={{ ...CARD, gridColumn: 'span 2' }}>
      <CardHead meta={meta} label="Sleep Schedule" />
      <SleepScheduleChart nights={nights} slept={slept} />
    </div>
  );
}

function SleepScheduleChart({ nights, slept }: { nights: Night[]; slept: Array<Night & { bedtime: number }> }) {
  const [ref, W] = useWidth();
  const H = 170, PAD_T = 12, PAD_B = 20;
  const [hover, setHover] = useState<number | null>(null);

  const bedtimes = slept.map(n => n.bedtime);
  const avg = bedtimes.reduce((a, b) => a + b, 0) / bedtimes.length;
  const driftMin = bedtimes.length > 1
    ? (bedtimes.reduce((a, b) => a + Math.abs(b - avg), 0) / bedtimes.length) * 60
    : null;
  const wakes = slept.map(n => n.bedtime + (n.hours ?? 0.5));

  // Evening at the top, morning at the bottom — a schedule, not a quantity.
  const lo = Math.min(-1, Math.floor(Math.min(...bedtimes)) - 0.5);
  const hi = Math.max(7, Math.ceil(Math.max(...wakes)) + 0.5);
  const y = (v: number) => PAD_T + ((v - lo) / (hi - lo)) * (H - PAD_T - PAD_B);

  const slotW = W / nights.length;
  const x = (i: number) => i * slotW + slotW / 2;
  const barW = Math.max(2, slotW * 0.62);

  // Hover snaps to the nearest night that actually has data.
  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const raw = ((e.clientX - rect.left) / rect.width) * nights.length - 0.5;
    let best: number | null = null;
    for (let i = 0; i < nights.length; i++) {
      if (nights[i].bedtime == null) continue;
      if (best == null || Math.abs(i - raw) < Math.abs(best - raw)) best = i;
    }
    setHover(best);
  };

  const shownIdx = hover ?? nights.reduce((acc, n, i) => (n.bedtime != null ? i : acc), -1);
  const shown = shownIdx >= 0 ? nights[shownIdx] : null;

  // Gridlines every 2h on even signed hours; midnight gets the stronger rule.
  const gridHours: number[] = [];
  for (let h = Math.ceil(lo / 2) * 2; h <= hi; h += 2) gridHours.push(h);

  const earliest = Math.min(...bedtimes);
  const latest = Math.max(...bedtimes);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      {/* header: scrubbed (or latest) bedtime + drift vs the window average */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span className="ncx-val" style={{ fontSize: 25, color: VIOLET, lineHeight: 1 }}>
            {shown?.bedtime != null ? clock(shown.bedtime) : '—'}
          </span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-faint)' }}>
            {shown?.hours != null ? `→ ${clock(shown.bedtime! + shown.hours)} · ${shown.hours.toFixed(1)}h` : 'BEDTIME'}
          </span>
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <span className="mono" style={{ fontSize: 9, letterSpacing: '0.18em', color: 'var(--text-faint)', marginRight: 6 }}>DRIFT</span>
          <DriftPill minutes={driftMin} />
          <div className="ncx-serial" style={{ marginTop: 3 }}>
            {hover != null && shown ? nightLabel(shown.date) : `LAST ${nights.length} NIGHTS`}
          </div>
        </div>
      </div>

      {/* chart */}
      <div ref={ref} style={{ position: 'relative', height: H }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg width={W} height={H} style={{ display: 'block', overflow: 'visible' }}>
          <defs>
            <linearGradient id="sleep-sched-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={VIOLET} stopOpacity={0.85} />
              <stop offset="100%" stopColor={VIOLET} stopOpacity={0.22} />
            </linearGradient>
          </defs>

          {/* recessive clock grid; midnight slightly stronger */}
          {gridHours.map(h => (
            <g key={h}>
              <line x1={0} y1={y(h)} x2={W} y2={y(h)}
                stroke={h === 0 ? 'var(--line-2)' : 'var(--line)'} strokeWidth="1" />
              <text x={2} y={y(h) - 3} className="mono"
                style={{ fontSize: 8.5, fill: 'var(--text-ghost)', letterSpacing: '0.08em' }}>
                {clock(h).replace(':00 ', '')}
              </text>
            </g>
          ))}

          {/* the alignment reference: average bedtime across the window */}
          <line x1={0} y1={y(avg)} x2={W} y2={y(avg)}
            stroke={VIOLET} strokeWidth="1" strokeDasharray="5 4" opacity={0.65}
            style={{ filter: `drop-shadow(0 0 3px ${VIOLET})` }} />
          <text x={W - 2} y={y(avg) - 4} textAnchor="end" className="mono"
            style={{ fontSize: 8.5, fill: VIOLET, letterSpacing: '0.08em', opacity: 0.9 }}>
            AVG {clock(avg)}
          </text>

          {/* one bar per night: bedtime → wake, bedtime end emphasized */}
          {nights.map((n, i) => {
            if (n.bedtime == null) return null;
            const top = y(n.bedtime);
            const bottom = y(n.bedtime + Math.max(0.5, n.hours ?? 0.5));
            const on = hover === i;
            return (
              <g key={i}>
                <rect x={x(i) - barW / 2} y={top} width={barW} height={Math.max(3, bottom - top)}
                  fill="url(#sleep-sched-grad)" opacity={on ? 1 : 0.75} />
                {/* bedtime cap — the mark whose alignment the card is about */}
                <rect x={x(i) - barW / 2} y={top - 1} width={barW} height={2.5}
                  fill={VIOLET} style={on ? { filter: `drop-shadow(0 0 5px ${VIOLET})` } : undefined} />
              </g>
            );
          })}

          {/* weekday ticks; hovered night brightens */}
          {nights.map((n, i) => (
            <text key={i} x={x(i)} y={H - 6} textAnchor="middle" className="mono"
              style={{
                fontSize: 8.5, letterSpacing: '0.08em',
                fill: hover === i ? 'var(--text-dim)' : n.bedtime == null ? 'var(--text-ghost)' : 'var(--text-faint)',
              }}>
              {'SMTWTFS'[n.date.getDay()]}
            </text>
          ))}
        </svg>
      </div>

      {/* footer stats */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'baseline', borderTop: '1px solid var(--line)', paddingTop: 8 }}>
        <FootStat label="EARLIEST" value={clock(earliest)} />
        <FootStat label="AVG" value={clock(avg)} />
        <FootStat label="LATEST" value={clock(latest)} />
        <span className="ncx-serial" style={{ marginLeft: 'auto' }}>{slept.length} NIGHTS SYNCED</span>
      </div>
    </div>
  );
}
