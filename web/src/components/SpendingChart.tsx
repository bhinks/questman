import { useState } from 'react';
import { fmtMoney } from '../utils/formatters';

interface SpendingChartProps {
  monthlyData: Array<{ month: string; spending: number; income: number; net: number }>;
  dailyData: Array<{ date: string; amount: number }>;
  /** Currently filtered month ("YYYY-MM") — highlighted in the chart. */
  selectedMonth?: string | null;
  /** Click a month to drill the transaction list into it. Omit → static. */
  onSelectMonth?: (month: string | null) => void;
}

const MONTH_ABBR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** "YYYY-MM" → "MMM" without Date parsing (avoids UTC off-by-one). */
function monthLabel(month: string): string {
  const m = Number(month.slice(5, 7));
  return MONTH_ABBR[m - 1] ?? month.toUpperCase();
}

/** "YYYY-MM" → "MMM YYYY". */
function monthYearLabel(month: string): string {
  return `${monthLabel(month)} ${month.slice(0, 4)}`;
}

export function SpendingChart({ monthlyData, selectedMonth, onSelectMonth }: SpendingChartProps) {
  const [chart, setChart] = useState<'bar' | 'line'>('bar');
  const [hovered, setHovered] = useState<string | null>(null);

  const data = monthlyData.slice(-12);
  const maxMon = Math.max(...data.map(d => d.spending), 1);
  const lastIdx = data.length - 1;
  const step = data.length > 1 ? 480 / (data.length - 1) : 0;

  const interactive = !!onSelectMonth;
  const hasSel = !!selectedMonth;
  // A month reads "hot" when it's the one selected, or — with nothing
  // selected — the latest month (the previous default emphasis).
  const isHot = (d: { month: string }, i: number) => hasSel ? d.month === selectedMonth : i === lastIdx;
  const pick = (month: string) => {
    if (!onSelectMonth) return;
    onSelectMonth(month === selectedMonth ? null : month);
  };

  // Average monthly burn across the visible window — the reference line the
  // bars/line are measured against, so a "big month" reads as big vs. typical.
  const avg = data.length > 0 ? data.reduce((s, d) => s + d.spending, 0) / data.length : 0;
  const avgY = 118 - Math.min(100, (avg / maxMon) * 100); // line-chart y for the avg

  return (
    <div className="ncx-ticks">
      <span className="tick" style={{ top: -4, left: -4 }}></span>
      <span className="tick" style={{ bottom: -4, right: -4 }}></span>
      <div className="panel" style={{ padding: 20 }}>
        <div style={{ display: 'flex', marginBottom: 16, alignItems: 'center', gap: 10 }}>
          <span
            className="mono"
            style={{ fontSize: 10, letterSpacing: '0.26em', color: 'var(--text-dim)', textTransform: 'uppercase' }}
          >
            MONTHLY BURN — 12 MO
          </span>
          {avg > 0 && (
            <span
              className="mono"
              style={{ fontSize: 9, letterSpacing: '0.12em', color: 'var(--text-faint)' }}
            >
              AVG {fmtMoney(avg)} / MO
            </span>
          )}
          <span style={{ flex: 1 }}></span>
          {interactive && (
            hasSel ? (
              <button
                className="mono"
                onClick={() => onSelectMonth?.(null)}
                title="Clear month filter"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                  fontSize: 9, letterSpacing: '0.12em', padding: '4px 9px',
                  border: '1px solid color-mix(in srgb, var(--cyan) 45%, transparent)',
                  background: 'color-mix(in srgb, var(--cyan) 14%, transparent)', color: 'var(--cyan)',
                }}
              >
                FILTERING {monthYearLabel(selectedMonth!)} ✕
              </button>
            ) : (
              <span className="mono" style={{ fontSize: 9, letterSpacing: '0.12em', color: 'var(--text-ghost)' }}>
                CLICK A MONTH TO FILTER
              </span>
            )
          )}
          <button
            key={'bar-' + (chart === 'bar')}
            className={'btn' + (chart === 'bar' ? ' btn-primary' : '')}
            style={{ padding: '5px 12px', fontSize: 10 }}
            onClick={() => setChart('bar')}
          >
            BAR
          </button>
          <button
            key={'line-' + (chart === 'line')}
            className={'btn' + (chart === 'line' ? ' btn-primary' : '')}
            style={{ padding: '5px 12px', fontSize: 10 }}
            onClick={() => setChart('line')}
          >
            LINE
          </button>
        </div>

        {chart === 'bar' ? (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 140 }}>
            {data.map((d, i) => {
              const hot = isHot(d, i);
              const hov = hovered === d.month;
              return (
                <div
                  key={d.month}
                  onClick={() => pick(d.month)}
                  onMouseEnter={() => interactive && setHovered(d.month)}
                  onMouseLeave={() => interactive && setHovered(null)}
                  title={interactive ? `${monthYearLabel(d.month)} · ${fmtMoney(d.spending)} — click to filter` : `${monthYearLabel(d.month)} · ${fmtMoney(d.spending)}`}
                  style={{
                    flex: 1,
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'flex-end',
                    gap: 5,
                    alignItems: 'center',
                    cursor: interactive ? 'pointer' : 'default',
                  }}
                >
                  <div
                    style={{
                      width: '100%',
                      height: (d.spending / maxMon * 100) + '%',
                      background: hot ? 'linear-gradient(180deg, var(--cyan), var(--cyan-deep))' : '#181b2e',
                      boxShadow: hot
                        ? '0 0 18px rgba(var(--accent-rgb),0.4)'
                        : hov
                          ? 'inset 0 0 0 1px var(--line-bright)'
                          : 'inset 0 0 0 1px var(--line)',
                      clipPath: 'polygon(0 4px, 100% 0, 100% 100%, 0 100%)',
                      transition: 'box-shadow .15s',
                    }}
                  ></div>
                  <span
                    className="mono"
                    style={{
                      fontSize: 8,
                      color: hot ? 'var(--cyan)' : hov ? 'var(--text-dim)' : 'var(--text-ghost)',
                      letterSpacing: '0.1em',
                    }}
                  >
                    {monthLabel(d.month)}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ height: 140, position: 'relative' }}>
            <svg
              width="100%"
              height="122"
              viewBox="0 0 480 122"
              preserveAspectRatio="none"
              style={{ display: 'block', overflow: 'visible' }}
            >
              {[0.25, 0.5, 0.75].map(g => (
                <line key={g} x1="0" x2="480" y1={122 * g} y2={122 * g} stroke="var(--line)" strokeWidth="1" />
              ))}
              {avg > 0 && (
                <line
                  x1="0"
                  x2="480"
                  y1={avgY}
                  y2={avgY}
                  stroke="var(--amber)"
                  strokeWidth="1"
                  strokeDasharray="4 4"
                  opacity="0.7"
                />
              )}
              <polyline
                points={data.map((d, i) => `${i * step},${118 - (d.spending / maxMon) * 100}`).join(' ')}
                fill="none"
                stroke="var(--cyan)"
                strokeWidth="2"
                style={{ filter: 'drop-shadow(0 0 6px rgba(var(--accent-rgb),0.7))' }}
              />
              {data.map((d, i) => {
                const hot = isHot(d, i);
                return (
                  <circle
                    key={d.month}
                    cx={i * step}
                    cy={118 - (d.spending / maxMon) * 100}
                    r={hot ? 4 : 2.5}
                    fill={hot ? 'var(--cyan)' : '#181b2e'}
                    stroke="var(--cyan)"
                    strokeWidth="1.5"
                  />
                );
              })}
              {/* transparent per-month hit areas for easy clicking */}
              {interactive && data.map((d, i) => (
                <rect
                  key={'hit-' + d.month}
                  x={Math.max(0, i * step - step / 2)}
                  y={0}
                  width={data.length > 1 ? step : 480}
                  height={122}
                  fill="transparent"
                  style={{ cursor: 'pointer' }}
                  onClick={() => pick(d.month)}
                  onMouseEnter={() => setHovered(d.month)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <title>{`${monthYearLabel(d.month)} · ${fmtMoney(d.spending)} — click to filter`}</title>
                </rect>
              ))}
            </svg>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              {data.map((d, i) => {
                const hot = isHot(d, i);
                return (
                  <span
                    key={d.month}
                    className="mono"
                    style={{
                      fontSize: 8,
                      color: hot ? 'var(--cyan)' : 'var(--text-ghost)',
                      letterSpacing: '0.1em',
                    }}
                  >
                    {monthLabel(d.month)}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
