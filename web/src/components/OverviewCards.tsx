import type { SpendingAnalysis } from '../types';
import { fmtMoney } from '../utils/formatters';

interface OverviewCardsProps {
  analysis: SpendingAnalysis;
}

/** Minimal neon sparkline. data: array of 0..1 normalized values. */
function Spark({ data, color, w = 130, h = 22 }: { data: number[]; color: string; w?: number; h?: number }) {
  const step = w / (data.length - 1);
  const points = data.map((v, i) => `${i * step},${h - 3 - v * (h - 6)}`).join(' ');
  return (
    <svg width={w} height={h} style={{ display: 'block', overflow: 'visible' }}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ filter: `drop-shadow(0 0 4px ${color})`, opacity: 0.9 }}
      />
    </svg>
  );
}

/** Normalize a series to 0..1. Returns null when no drawable series exists. */
function normalize(values: number[]): number[] | null {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  if (max <= 0) return null;
  return values.map(v => Math.max(0, v) / max);
}

export function OverviewCards({ analysis }: OverviewCardsProps) {
  // SpendingAnalysis carries no income/net time series — the only real series
  // on it is the per-category spend distribution, which drives the BURN spark.
  // Metrics without a derivable series fall back to a mono sub-caption
  // (the mock does the same for RECLAIMABLE).
  const burnSpark = normalize(analysis.topCategories.map(c => c.amount));
  const savingsRate = analysis.totalIncome > 0
    ? Math.round((analysis.netAmount / analysis.totalIncome) * 100)
    : null;

  const metrics: Array<{
    k: string;
    v: number;
    c: string;
    focal?: boolean;
    spark?: number[] | null;
    sub: string;
  }> = [
    {
      k: 'NET BALANCE',
      v: analysis.netAmount,
      c: 'var(--cyan)',
      focal: true,
      sub: savingsRate !== null ? `SAVINGS RATE ${savingsRate}%` : 'INCOME - BURN',
    },
    {
      k: 'INCOME',
      v: analysis.totalIncome,
      c: 'var(--lime)',
      sub: 'TOTAL CREDITS // PERIOD',
    },
    {
      k: 'BURN',
      v: analysis.totalSpent,
      c: 'var(--red)',
      spark: burnSpark,
      sub: `AVG MONTHLY ${fmtMoney(analysis.avgMonthly)}`,
    },
    {
      k: 'RECLAIMABLE',
      v: analysis.wastefulSpending.total,
      c: 'var(--amber)',
      sub: `${analysis.wastefulSpending.patterns.length} WASTEFUL PATTERNS FLAGGED`,
    },
  ];

  return (
    <div
      className="metric-grid"
      style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}
    >
      {metrics.map(m => (
        <div
          key={m.k}
          className={'panel' + (m.focal ? ' hud' : '')}
          style={{ padding: '16px 18px' }}
        >
          <div className="kicker" style={{ fontSize: 9.5, marginBottom: 8 }}>{m.k}</div>
          <div
            className="ncx-val"
            style={{
              fontSize: 27,
              color: m.c,
              textShadow: m.focal ? '0 0 16px rgba(var(--accent-rgb),0.4)' : 'none',
            }}
          >
            {fmtMoney(m.v)}
          </div>
          <div style={{ marginTop: 8, minHeight: 24 }}>
            {m.spark ? (
              <Spark data={m.spark} color={m.c} w={130} h={22} />
            ) : (
              <span
                className="mono"
                style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.14em' }}
              >
                {m.sub}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
