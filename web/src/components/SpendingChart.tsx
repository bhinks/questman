import { useState } from 'react';

interface SpendingChartProps {
  monthlyData: Array<{ month: string; spending: number; income: number; net: number }>;
  dailyData: Array<{ date: string; amount: number }>;
}

const MONTH_ABBR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** "YYYY-MM" → "MMM" without Date parsing (avoids UTC off-by-one). */
function monthLabel(month: string): string {
  const m = Number(month.slice(5, 7));
  return MONTH_ABBR[m - 1] ?? month.toUpperCase();
}

export function SpendingChart({ monthlyData }: SpendingChartProps) {
  const [chart, setChart] = useState<'bar' | 'line'>('bar');

  const data = monthlyData.slice(-12);
  const maxMon = Math.max(...data.map(d => d.spending), 1);
  const lastIdx = data.length - 1;
  const step = data.length > 1 ? 480 / (data.length - 1) : 0;

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
          <span style={{ flex: 1 }}></span>
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
              const last = i === lastIdx;
              return (
                <div
                  key={d.month}
                  style={{
                    flex: 1,
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'flex-end',
                    gap: 5,
                    alignItems: 'center',
                  }}
                >
                  <div
                    style={{
                      width: '100%',
                      height: (d.spending / maxMon * 100) + '%',
                      background: last ? 'linear-gradient(180deg, var(--cyan), var(--cyan-deep))' : '#181b2e',
                      boxShadow: last
                        ? '0 0 18px rgba(var(--accent-rgb),0.4)'
                        : 'inset 0 0 0 1px var(--line)',
                      clipPath: 'polygon(0 4px, 100% 0, 100% 100%, 0 100%)',
                    }}
                  ></div>
                  <span
                    className="mono"
                    style={{
                      fontSize: 8,
                      color: last ? 'var(--cyan)' : 'var(--text-ghost)',
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
              <polyline
                points={data.map((d, i) => `${i * step},${118 - (d.spending / maxMon) * 100}`).join(' ')}
                fill="none"
                stroke="var(--cyan)"
                strokeWidth="2"
                style={{ filter: 'drop-shadow(0 0 6px rgba(var(--accent-rgb),0.7))' }}
              />
              {data.map((d, i) => (
                <circle
                  key={d.month}
                  cx={i * step}
                  cy={118 - (d.spending / maxMon) * 100}
                  r={i === lastIdx ? 4 : 2.5}
                  fill={i === lastIdx ? 'var(--cyan)' : '#181b2e'}
                  stroke="var(--cyan)"
                  strokeWidth="1.5"
                />
              ))}
            </svg>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              {data.map((d, i) => (
                <span
                  key={d.month}
                  className="mono"
                  style={{
                    fontSize: 8,
                    color: i === lastIdx ? 'var(--cyan)' : 'var(--text-ghost)',
                    letterSpacing: '0.1em',
                  }}
                >
                  {monthLabel(d.month)}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
