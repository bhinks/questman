import { createContext, useContext } from 'react';
import type { SpendingPeriod } from '../types';

/**
 * Shared time-framing for the finance views. 18 months of raw totals don't mean
 * much without a denominator, so the whole finance area reads one global
 * preference — TOTAL / MONTHLY / WEEKLY — and re-expresses its numbers against
 * it. The period banner (see PeriodBar) keeps the span explicit so TOTAL is
 * never ambiguous.
 *
 * Context + hook + pure helper live here (no components) so the component file
 * stays a clean Fast Refresh boundary.
 */
export type FramingMode = 'total' | 'monthly' | 'weekly';

export interface ModeCtx {
  mode: FramingMode;
  setMode: (m: FramingMode) => void;
}

// Default to monthly even without a provider, so any stray usage still renders.
export const PeriodModeContext = createContext<ModeCtx>({ mode: 'monthly', setMode: () => {} });

export function usePeriodMode() {
  return useContext(PeriodModeContext);
}

export interface Framing {
  mode: FramingMode;
  divisor: number;
  unit: string; // '/ MO' | '/ WK' | 'TOTAL'
  /** Re-express a full-period total against the active mode. */
  rate: (v: number) => number;
  /** Annualized value (mode-independent), for "per year" projections. */
  perYear: (v: number) => number;
}

/** Pure: turn a period + mode into the scalars a component needs. */
export function framing(period: SpendingPeriod, mode: FramingMode): Framing {
  const divisor = mode === 'monthly' ? period.months : mode === 'weekly' ? period.weeks : 1;
  const unit = mode === 'monthly' ? '/ MO' : mode === 'weekly' ? '/ WK' : 'TOTAL';
  return {
    mode,
    divisor,
    unit,
    rate: (v: number) => v / divisor,
    perYear: (v: number) => (v / period.months) * 12,
  };
}
