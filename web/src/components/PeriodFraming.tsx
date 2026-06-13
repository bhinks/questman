import { useState, type ReactNode } from 'react';
import { format } from 'date-fns';
import type { SpendingPeriod } from '../types';
import { fmtNum } from '../utils/formatters';
import {
  PeriodModeContext,
  usePeriodMode,
  type FramingMode,
} from '../lib/periodFraming';

export function PeriodFramingProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<FramingMode>('monthly');
  return <PeriodModeContext.Provider value={{ mode, setMode }}>{children}</PeriodModeContext.Provider>;
}

const MODES: Array<{ id: FramingMode; label: string }> = [
  { id: 'total', label: 'TOTAL' },
  { id: 'monthly', label: 'MONTHLY' },
  { id: 'weekly', label: 'WEEKLY' },
];

/** Period banner + TOTAL / MONTHLY / WEEKLY toggle. One per finance tab. */
export function PeriodBar({ period }: { period: SpendingPeriod }) {
  const { mode, setMode } = usePeriodMode();
  if (period.transactionCount === 0) return null;

  return (
    <div
      className="metric-period-bar"
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 10,
      }}
    >
      <div
        className="mono"
        style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.14em' }}
      >
        {format(period.start, 'MMM yyyy')} – {format(period.end, 'MMM yyyy')}
        <span style={{ color: 'var(--text-ghost)' }}> · </span>
        {period.months} MO
        <span style={{ color: 'var(--text-ghost)' }}> · </span>
        {fmtNum(period.transactionCount)} TXNS
      </div>
      <div style={{ display: 'flex', gap: 4 }} role="tablist" aria-label="Spending timeframe">
        {MODES.map(m => {
          const active = mode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setMode(m.id)}
              className="mono"
              style={{
                fontSize: 9,
                letterSpacing: '0.12em',
                padding: '4px 10px',
                background: active ? 'rgba(var(--accent-rgb),0.10)' : 'transparent',
                color: active ? 'var(--brand)' : 'var(--text-faint)',
                border: `1px solid ${active ? 'var(--brand)' : 'var(--line-2)'}`,
                borderRadius: 4,
                cursor: 'pointer',
                transition: 'all 120ms ease',
                textShadow: active ? '0 0 8px rgba(var(--accent-rgb),0.5)' : 'none',
              }}
            >
              {m.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
