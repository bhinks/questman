import { useMemo, useState } from 'react';
import type { Transaction, SpendingPeriod } from '../types';
import { Icon } from './Icon';
import { fmtMoney } from '../utils/formatters';
import { usePeriodMode, framing } from '../lib/periodFraming';

interface CategoryTransactionsProps {
  category: string;
  transactions: Transaction[];
  onClose: () => void;
  /** Analyzed span — adds a per-period average to the header when set. */
  period?: SpendingPeriod;
}

type GroupBy = 'none' | 'date' | 'vendor';

interface TxGroup {
  key: string;
  label: string;
  total: number;
  items: Transaction[];
}

/**
 * Drill-down list of the transactions that make up a single category.
 * Shown when a category is selected in the CategoryChart. Supports
 * grouping the rows by date or by vendor, each group carrying a subtotal.
 *
 * Mirrors the category breakdown's basis (expenses only) so the totals
 * here reconcile with the chart slice the user clicked.
 */
export function CategoryTransactions({ category, transactions, onClose, period }: CategoryTransactionsProps) {
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const { mode } = usePeriodMode();
  const f = period ? framing(period, mode) : null;
  const asRate = !!f && mode !== 'total';

  const items = useMemo(
    () =>
      transactions
        .filter(t => (t.category || 'Uncategorized') === category && t.amount < 0)
        .sort((a, b) => b.date.getTime() - a.date.getTime()),
    [transactions, category]
  );

  const total = useMemo(
    () => items.reduce((sum, t) => sum + Math.abs(t.amount), 0),
    [items]
  );

  const groups = useMemo<TxGroup[]>(() => {
    if (groupBy === 'none') {
      return [{ key: 'all', label: '', total, items }];
    }

    const map = new Map<string, Transaction[]>();
    for (const t of items) {
      const key =
        groupBy === 'date'
          ? t.date.toLocaleDateString()
          : t.vendor || 'Unknown';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }

    const built: TxGroup[] = Array.from(map.entries()).map(([key, groupItems]) => ({
      key,
      label: key,
      total: groupItems.reduce((sum, t) => sum + Math.abs(t.amount), 0),
      items: groupItems,
    }));

    // Dates read best newest-first; vendors by spend.
    if (groupBy === 'date') {
      built.sort((a, b) => b.items[0].date.getTime() - a.items[0].date.getTime());
    } else {
      built.sort((a, b) => b.total - a.total);
    }
    return built;
  }, [groupBy, items, total]);

  const groupButtons: Array<{ value: GroupBy; label: string }> = [
    { value: 'none', label: 'NONE' },
    { value: 'date', label: 'DATE' },
    { value: 'vendor', label: 'VENDOR' },
  ];

  return (
    <div className="panel hud" style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div className="ncx-chip" style={{ width: 40, height: 40, color: 'var(--cyan)' }}>
          <Icon name="file" size={18} />
        </div>
        <div style={{ minWidth: 0 }}>
          <h3
            className="ncx-chroma"
            style={{
              fontSize: 18,
              fontWeight: 700,
              margin: 0,
              color: 'var(--text)',
              fontFamily: 'var(--font-display)',
              textTransform: 'uppercase',
            }}
          >
            {category}
          </h3>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 3 }}>
            <span className="ncx-serial">{items.length} TXN</span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              ${total.toLocaleString()}
            </span>
            {asRate && (
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                · ~{fmtMoney(f!.rate(total))} {f!.unit}
              </span>
            )}
          </div>
        </div>

        {/* Group-by toggle */}
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span
            className="mono"
            style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.26em', textTransform: 'uppercase' }}
          >
            GROUP BY
          </span>
          <div style={{ display: 'flex', border: '1px solid var(--line-2)', background: '#070811' }}>
            {groupButtons.map(btn => {
              const on = groupBy === btn.value;
              return (
                <button
                  key={`${btn.value}-${on ? 'on' : 'off'}`}
                  onClick={() => setGroupBy(btn.value)}
                  className="mono"
                  style={{
                    padding: '6px 10px',
                    fontSize: 10,
                    border: 'none',
                    cursor: 'pointer',
                    letterSpacing: '0.1em',
                    background: on ? 'rgba(var(--accent-rgb),0.18)' : 'transparent',
                    color: on ? 'var(--cyan)' : 'var(--text-dim)',
                    fontWeight: on ? 700 : 400,
                    transition: 'background .15s, color .15s',
                  }}
                >
                  {btn.label}
                </button>
              );
            })}
          </div>
          <button
            onClick={onClose}
            className="btn btn-ghost"
            style={{ padding: '4px 6px', marginLeft: 4 }}
            title="Close"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      </div>

      {/* Body */}
      {items.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-faint)' }}>
          <div className="mono" style={{ fontSize: 13 }}>NO TRANSACTIONS IN THIS CATEGORY</div>
        </div>
      ) : (
        <div
          className="panel-inset"
          style={{
            maxHeight: 460,
            overflow: 'auto',
          }}
        >
          {groups.map(group => (
            <div key={group.key}>
              {/* Group subtotal header (hidden when ungrouped) */}
              {groupBy !== 'none' && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    background: 'var(--panel-2)',
                    borderBottom: '1px solid var(--line)',
                    position: 'sticky',
                    top: 0,
                    zIndex: 1,
                  }}
                >
                  <span
                    className="mono"
                    style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600, letterSpacing: '0.06em' }}
                  >
                    {group.label}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span className="ncx-serial">{group.items.length} TXN</span>
                    <span
                      className="mono"
                      style={{ fontSize: 11, color: 'var(--text-dim)' }}
                    >
                      ${group.total.toLocaleString()}
                    </span>
                  </span>
                </div>
              )}

              {group.items.map((t, i) => (
                <div
                  key={t.id || `${group.key}-${i}`}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '90px 1fr 130px 100px',
                    gap: 12,
                    padding: '10px 12px',
                    borderBottom: '1px solid var(--line)',
                    fontSize: 13,
                    color: 'var(--text)',
                    alignItems: 'center',
                  }}
                >
                  <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                    {t.date.toLocaleDateString()}
                  </div>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.description}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--text-faint)',
                      fontFamily: 'var(--font-mono)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t.vendor || '—'}
                  </div>
                  <div
                    className="mono"
                    style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text)' }}
                  >
                    ${Math.abs(t.amount).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
