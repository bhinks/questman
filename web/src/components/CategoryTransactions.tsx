import { useMemo, useState } from 'react';
import type { Transaction } from '../types';
import { Icon } from './Icon';

interface CategoryTransactionsProps {
  category: string;
  transactions: Transaction[];
  onClose: () => void;
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
export function CategoryTransactions({ category, transactions, onClose }: CategoryTransactionsProps) {
  const [groupBy, setGroupBy] = useState<GroupBy>('none');

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
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: 'linear-gradient(135deg, var(--cyan), var(--lime))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span style={{ color: 'white', fontSize: 16, fontWeight: 600 }}>🧾</span>
        </div>
        <div style={{ minWidth: 0 }}>
          <h3
            style={{
              fontSize: 18,
              fontWeight: 600,
              margin: 0,
              color: 'var(--text)',
              fontFamily: 'var(--font-display)',
            }}
          >
            {category}
          </h3>
          <div
            className="mono"
            style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}
          >
            {items.length} transactions · ${total.toLocaleString()}
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
            style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.08em' }}
          >
            GROUP BY
          </span>
          <div style={{ display: 'flex', border: '1px solid var(--line)', borderRadius: 6, overflow: 'hidden' }}>
            {groupButtons.map(btn => (
              <button
                key={btn.value}
                onClick={() => setGroupBy(btn.value)}
                className="mono"
                style={{
                  padding: '6px 10px',
                  fontSize: 11,
                  border: 'none',
                  cursor: 'pointer',
                  letterSpacing: '0.05em',
                  background: groupBy === btn.value ? 'var(--cyan)' : 'var(--panel-2)',
                  color: groupBy === btn.value ? '#06060c' : 'var(--text-dim)',
                  fontWeight: groupBy === btn.value ? 600 : 400,
                  transition: 'all 0.15s ease',
                }}
              >
                {btn.label}
              </button>
            ))}
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
          style={{
            maxHeight: 460,
            overflow: 'auto',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r)',
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
                    style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600 }}
                  >
                    {group.label}
                  </span>
                  <span
                    className="mono"
                    style={{ fontSize: 11, color: 'var(--text-dim)' }}
                  >
                    {group.items.length}tx · ${group.total.toLocaleString()}
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
