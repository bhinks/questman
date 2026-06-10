/**
 * Focus-time rollup (GET /api/focus/summary) — ACTUAL minutes accumulated
 * per target by JACK IN sessions, for the "time actually spent" badges on
 * projects / habits / chores / workout plans. One cached query feeds every
 * view; FocusView invalidates the ['focus'] prefix after each jack-out.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { FocusSummaryRow, FocusTargetType } from './api';

/** Map of targetId → total focus minutes, filtered to the given types. */
export function useFocusTotals(types: FocusTargetType[]): Map<string, number> {
  const q = useQuery({
    queryKey: ['focus', 'summary'],
    queryFn: () => api.get<{ totals: FocusSummaryRow[] }>('/api/focus/summary').then(r => r.totals),
    staleTime: 60_000,
  });
  const key = types.join(',');
  return useMemo(() => {
    const map = new Map<string, number>();
    for (const row of q.data ?? []) {
      if (row.targetId && row.minutes > 0 && types.includes(row.targetType)) {
        map.set(row.targetId, row.minutes);
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, key]);
}

/** "47M" / "3H20" — compact badge text for focus minutes. */
export function fmtFocusMin(min: number): string {
  if (min < 60) return `${min}M`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}H${String(m).padStart(2, '0')}` : `${h}H`;
}
