import { useState } from 'react';
import { Icon } from './Icon';
import type { CategorySpending, SpendingPeriod } from '../types';
import { fmtMoney } from '../utils/formatters';
import { usePeriodMode, framing } from '../lib/periodFraming';

interface CategoryChartProps {
  categories: CategorySpending[];
  onCategoryClick: (category: string) => void;
  selectedCategory?: string | null;
  showAll?: boolean;
  /** Analyzed span. When provided and the active framing is a rate, rows lead
      with the per-period average and show the full-period total as a faint
      secondary. Omit to show plain totals (e.g. legacy/standalone usage). */
  period?: SpendingPeriod;
}

/* Positional neon palette — cycled per row (theme-reactive CSS vars). */
const NEON_VARS = [
  'var(--cyan)',
  'var(--magenta)',
  'var(--violet)',
  'var(--blue)',
  'var(--pink)',
  'var(--lime)',
  'var(--teal)',
  'var(--amber)',
];

const MONTH_ABBR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Serial like "JUN.160" — current month + day-of-year. */
function monthSerial(): string {
  const now = new Date();
  const dayOfYear = Math.floor(
    (now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000,
  );
  return `${MONTH_ABBR[now.getMonth()]}.${String(dayOfYear).padStart(3, '0')}`;
}

/** Outline icon for a spending category (no emoji in this direction). */
function categoryIcon(category: string): string {
  const c = category.toLowerCase();
  if (c.includes('grocer')) return 'cart';
  if (c.includes('coffee')) return 'coffee';
  if (c.includes('food') || c.includes('dining') || c.includes('restaurant')) return 'food';
  if (c.includes('transport') || c.includes('auto') || c.includes('car') || c.includes('gas')) return 'car';
  if (c.includes('travel') || c.includes('flight')) return 'plane';
  if (c.includes('shop')) return 'bag';
  if (c.includes('subscri')) return 'repeat';
  if (c.includes('entertain') || c.includes('stream') || c.includes('media')) return 'tv';
  if (c.includes('bill') || c.includes('utilit')) return 'bolt';
  if (c.includes('health') || c.includes('medical') || c.includes('fitness')) return 'heart';
  if (c.includes('rent') || c.includes('hous') || c.includes('home')) return 'shield';
  if (c.includes('income') || c.includes('salary')) return 'trend';
  return 'wallet';
}

export function CategoryChart({
  categories,
  onCategoryClick,
  selectedCategory,
  showAll = false,
  period,
}: CategoryChartProps) {
  const { mode } = usePeriodMode();
  const f = period ? framing(period, mode) : null;
  // Collapsed shows the top 6; expanded shows every category. Defaults to the
  // `showAll` prop, but the user can toggle inline (no separate page needed).
  const [expanded, setExpanded] = useState(showAll);
  const collapsedCount = 6;
  const canToggle = categories.length > collapsedCount;
  const displayCategories = expanded ? categories : categories.slice(0, collapsedCount);
  // Scale bars against the widest visible category so the list reads clearly
  // in either state.
  const maxCat = Math.max(...displayCategories.map(c => c.amount), 1);
  // Reframe rows to a rate only when we have a span and the toggle isn't TOTAL.
  const asRate = !!f && mode !== 'total';

  return (
    <div className="panel" style={{ padding: 20 }}>
      <div style={{ display: 'flex', marginBottom: 16, alignItems: 'baseline' }}>
        <span
          className="mono"
          style={{ fontSize: 10, letterSpacing: '0.26em', color: 'var(--text-dim)', textTransform: 'uppercase' }}
        >
          CATEGORY BREAKDOWN
        </span>
        {asRate && (
          <span
            className="mono"
            style={{ fontSize: 8.5, letterSpacing: '0.18em', color: 'var(--text-faint)', marginLeft: 8 }}
          >
            AVG {f!.unit}
          </span>
        )}
        <span style={{ flex: 1 }}></span>
        {canToggle && (
          <button
            className="mono"
            onClick={() => setExpanded(e => !e)}
            title={expanded ? 'Show the top 6 only' : 'Show every category'}
            style={{
              cursor: 'pointer', fontSize: 9, letterSpacing: '0.12em', padding: '4px 9px', marginRight: 10,
              border: '1px solid var(--line-2)', background: 'var(--panel-2)', color: 'var(--text-dim)',
            }}
          >
            {expanded ? 'TOP 6' : `ALL ${categories.length}`}
          </button>
        )}
        <span className="ncx-serial">{monthSerial()}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {displayCategories.map((c, i) => {
          const color = NEON_VARS[i % NEON_VARS.length];
          const selected = selectedCategory === c.category;
          return (
            <div
              key={c.category}
              role="button"
              tabIndex={0}
              onClick={() => onCategoryClick(c.category)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onCategoryClick(c.category);
                }
              }}
              style={{
                display: 'grid',
                gridTemplateColumns: '18px 104px 1fr 72px',
                gap: 10,
                alignItems: 'center',
                cursor: 'pointer',
              }}
            >
              <Icon name={categoryIcon(c.category)} size={13} style={{ color }} />
              <span
                style={{
                  fontSize: 12,
                  color: selected ? 'var(--cyan)' : 'var(--text-dim)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {c.category}
              </span>
              <div className="ncx-bar slim">
                <i
                  style={{
                    width: (c.amount / maxCat * 100) + '%',
                    background: color,
                    opacity: selected ? 1 : 0.88,
                  }}
                ></i>
                <span className="seg-mask"></span>
              </div>
              <span
                className="mono"
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.25 }}
              >
                <span style={{ fontSize: 11 }}>
                  {fmtMoney(asRate ? f!.rate(c.amount) : c.amount)}
                </span>
                {asRate && (
                  <span style={{ fontSize: 8.5, color: 'var(--text-faint)' }}>
                    {fmtMoney(c.amount)} TOT
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
