import { Icon } from './Icon';
import type { CategorySpending } from '../types';
import { fmtMoney } from '../utils/formatters';

interface CategoryChartProps {
  categories: CategorySpending[];
  onCategoryClick: (category: string) => void;
  selectedCategory?: string | null;
  showAll?: boolean;
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
}: CategoryChartProps) {
  const displayCategories = showAll ? categories : categories.slice(0, 6);
  const maxCat = Math.max(...displayCategories.map(c => c.amount), 1);

  return (
    <div className="panel" style={{ padding: 20 }}>
      <div style={{ display: 'flex', marginBottom: 16 }}>
        <span
          className="mono"
          style={{ fontSize: 10, letterSpacing: '0.26em', color: 'var(--text-dim)', textTransform: 'uppercase' }}
        >
          CATEGORY BREAKDOWN
        </span>
        <span style={{ flex: 1 }}></span>
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
                gridTemplateColumns: '18px 104px 1fr 60px',
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
              <span className="mono" style={{ fontSize: 11, textAlign: 'right' }}>
                {fmtMoney(c.amount)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
