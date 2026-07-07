/**
 * TransactionsView — the "Transactions" tab: the raw transaction log.
 *
 * A scrollable cyberpunk grid-table of every logged transaction, with
 * MULTI-SELECT bulk actions (Brent's ask: bulk-exclude inter-account
 * transfers so they drop out of every total) plus per-row edit.
 *
 * Excluded rows stay in place — greyed with an "EXCLUDED" tag — they're
 * never hidden, just visually dropped and ignored by the analyzer. Selected
 * ids live in a Set<string>; a sticky bulk bar appears once anything is
 * selected. Each bulk op POSTs /api/transactions/bulk, then clears the
 * selection and invalidates ["transactions"] (the parent owns that query,
 * so refetching pushes fresh props down).
 *
 * Design system only — .panel / .panel-inset / .hud / .btn / .btn-ghost /
 * .btn-primary / kicker / mono / .fade-up and CSS color vars. No hardcoded hex.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { CategoriesResponse, FinanceCategory } from '../lib/api';
import type { Transaction } from '../types';
import { Icon } from './Icon';

interface TransactionsViewProps {
  transactions: Transaction[];
  onEdit: (t: Transaction) => void;
  /** Drill filters driven by the Finance charts above (click a month / a
   *  category). Both optional so the log still works standalone. */
  monthFilter?: string | null;     // "YYYY-MM"
  categoryFilter?: string | null;  // category name
  onClearMonth?: () => void;
  onClearCategory?: () => void;
}

/** Cap rendered rows for perf — the log can run to thousands of records. */
const RENDER_CAP = 200;

type BulkOp = 'exclude' | 'include' | 'delete' | 'categorize';

export function TransactionsView({
  transactions, onEdit, monthFilter, categoryFilter, onClearMonth, onClearCategory,
}: TransactionsViewProps) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // ACCOUNT filter — '' means all accounts.
  const [accountFilter, setAccountFilter] = useState('');
  // Free-text description/vendor search — '' means no text filter.
  const [search, setSearch] = useState('');
  // Group the log by normalized vendor name instead of a flat chronological list.
  const [groupByVendor, setGroupByVendor] = useState(false);
  // Manual ledger entry form — cash/Venmo spend the imports never see.
  const [adding, setAdding] = useState(false);

  // Categories for the bulk RECATEGORIZE picker (shared cache).
  const catsQ = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<CategoriesResponse>('/api/categories').then(r => r.categories),
    staleTime: 5 * 60_000,
  });

  // Distinct source-account labels for the filter dropdown.
  const accountsQ = useQuery({
    queryKey: ['transactions', 'accounts'],
    queryFn: () => api.get<{ accounts: string[] }>('/api/transactions/accounts').then(r => r.accounts),
    staleTime: 5 * 60_000,
  });
  const accounts = accountsQ.data ?? [];

  // The component receives the full list as props — every filter (account,
  // the chart-driven month + category, and the text search) is applied
  // client-side here; the count chips reflect the filtered set.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return transactions.filter(t => {
      if (accountFilter && t.account !== accountFilter) return false;
      if (monthFilter && monthKey(t.date) !== monthFilter) return false;
      if (categoryFilter && (t.category || 'Uncategorized') !== categoryFilter) return false;
      if (q && !`${t.description ?? ''} ${t.vendor ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [transactions, accountFilter, monthFilter, categoryFilter, search]);

  const anyFilter = !!(accountFilter || monthFilter || categoryFilter || search.trim());

  const total = filtered.length;
  const excludedCount = useMemo(
    () => filtered.reduce((n, t) => n + (t.excluded ? 1 : 0), 0),
    [filtered],
  );

  // Only the rows we actually paint are selectable via "select all (visible)".
  const visible = useMemo(() => filtered.slice(0, RENDER_CAP), [filtered]);
  const hiddenCount = total - visible.length;

  // When group-by-vendor is on, aggregate filtered rows into vendor groups sorted
  // by total absolute spend. Each group is capped at RENDER_CAP rows.
  const grouped = useMemo(() => {
    if (!groupByVendor) return null;
    const map = new Map<string, Transaction[]>();
    for (const t of filtered) {
      const key = t.descriptionNormalized || t.description;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return [...map.entries()]
      .map(([name, txs]) => ({
        name,
        total: txs.reduce((s, t) => s + t.amount, 0),
        count: txs.length,
        txs: txs.slice(0, RENDER_CAP),
      }))
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  }, [filtered, groupByVendor]);

  // Batch normalize descriptions via the API.
  const normalizeMut = useMutation({
    mutationFn: () => api.post<{ updated: number }>('/api/transactions/normalize-descriptions'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transactions'] }),
  });

  /** A row was added or recategorized — refresh the log + budget math. */
  const invalidateLedger = () => {
    qc.invalidateQueries({ queryKey: ['transactions'] });
    qc.invalidateQueries({ queryKey: ['budgets'] });
    qc.invalidateQueries({ queryKey: ['budgets', 'history'] });
  };

  // Inline per-row recategorize — PUTs the category directly, no modal round-trip.
  const recat = useMutation({
    mutationFn: (vars: { id: string; categoryId: string | null }) =>
      api.put(`/api/transactions/${vars.id}`, { categoryId: vars.categoryId }),
    onSuccess: invalidateLedger,
    onError: () => {
      window.alert('Category change failed — please try again.');
    },
  });

  const bulk = useMutation({
    mutationFn: (vars: { operation: BulkOp; data?: Record<string, unknown> }) =>
      api.post('/api/transactions/bulk', {
        transactionIds: Array.from(selected),
        operation: vars.operation,
        ...(vars.data ? { data: vars.data } : {}),
      }),
    onSuccess: () => {
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['transactions'] });
      // Excluding/including/deleting rows shifts budget spend too.
      qc.invalidateQueries({ queryKey: ['budgets'] });
      qc.invalidateQueries({ queryKey: ['budgets', 'history'] });
    },
    onError: () => {
      // Surface failure so the selection isn't left looking stuck.
      window.alert('Bulk action failed — please try again.');
    },
  });

  const toggleOne = (id: string) =>
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const visibleIds = visible.map(t => t.id);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every(id => selected.has(id));

  const toggleAllVisible = () =>
    setSelected(prev => {
      if (allVisibleSelected) {
        // Clear only the visible ids (leave any off-screen selections alone).
        const next = new Set(prev);
        visibleIds.forEach(id => next.delete(id));
        return next;
      }
      return new Set([...prev, ...visibleIds]);
    });

  const runBulk = (operation: BulkOp, data?: Record<string, unknown>) => {
    if (selected.size === 0 || bulk.isPending) return;
    if (operation === 'delete') {
      const n = selected.size;
      if (!window.confirm(`Delete ${n} transaction${n === 1 ? '' : 's'}? This can't be undone.`)) {
        return;
      }
    }
    bulk.mutate({ operation, data });
  };

  const filterProps = {
    search, onSearch: setSearch,
    monthFilter: monthFilter ?? null,
    categoryFilter: categoryFilter ?? null,
    onClearMonth, onClearCategory,
    groupByVendor, onGroupByVendor: setGroupByVendor,
    normalizing: normalizeMut.isPending,
    onNormalize: () => normalizeMut.mutate(),
    onAdd: () => setAdding(true),
  };

  const addForm = adding && (
    <AddTransactionForm
      categories={catsQ.data ?? []}
      onClose={() => setAdding(false)}
      onDone={invalidateLedger}
    />
  );

  if (transactions.length === 0) {
    return (
      <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <Header total={0} excluded={0} accounts={[]} account="" onAccount={setAccountFilter} {...filterProps} />
        {addForm}
        <Empty>NO TRANSACTIONS LOADED — import a statement or ADD TRANSACTION to populate the log.</Empty>
      </div>
    );
  }

  // Data exists but the active filters matched nothing.
  if (total === 0) {
    return (
      <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <Header total={0} excluded={0} accounts={accounts} account={accountFilter} onAccount={setAccountFilter} {...filterProps} />
        {addForm}
        <Empty>
          {anyFilter
            ? 'NO RECORDS MATCH THESE FILTERS — adjust or clear them to see the rest of the log.'
            : 'NO RECORDS IN THE LOG.'}
        </Empty>
      </div>
    );
  }

  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Header
        total={total}
        excluded={excludedCount}
        accounts={accounts}
        account={accountFilter}
        onAccount={setAccountFilter}
        {...filterProps}
      />

      {addForm}

      <BulkBar
        count={selected.size}
        busy={bulk.isPending}
        onExclude={() => runBulk('exclude', { excluded: true })}
        onInclude={() => runBulk('exclude', { excluded: false })}
        onDelete={() => runBulk('delete')}
        onClear={() => setSelected(new Set())}
        categories={catsQ.data ?? []}
        onCategorize={categoryId => runBulk('categorize', { categoryId })}
      />

      {groupByVendor ? (
        /* Grouped-by-vendor view */
        <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <div className="mono" style={{ minWidth: 720, fontSize: 12.5 }}>
              {grouped!.map(group => (
                <div key={group.name}>
                  <VendorGroupHeader name={group.name} total={group.total} count={group.count} />
                  {group.txs.map(t => (
                    <Row
                      key={t.id}
                      tx={t}
                      selected={selected.has(t.id)}
                      categories={catsQ.data ?? []}
                      onToggle={() => toggleOne(t.id)}
                      onEdit={() => onEdit(t)}
                      onCategory={categoryId => recat.mutate({ id: t.id, categoryId })}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* Flat chronological view */
        <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <div
              className="mono"
              role="table"
              style={{ minWidth: 720, fontSize: 12.5 }}
            >
              {/* Header row */}
              <div role="row" style={{ ...gridRow, ...headerRow }}>
                <div style={cellCenter}>
                  <Check
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    title="Select all visible"
                  />
                </div>
                <div className="kicker" style={cellHead}>DATE</div>
                <div className="kicker" style={cellHead}>DESCRIPTION</div>
                <div className="kicker" style={cellHead}>CATEGORY</div>
                <div className="kicker" style={{ ...cellHead, textAlign: 'right' }}>AMOUNT</div>
                <div style={cellCenter} aria-hidden />
              </div>

              {/* Body rows */}
              {visible.map(t => (
                <Row
                  key={t.id}
                  tx={t}
                  selected={selected.has(t.id)}
                  categories={catsQ.data ?? []}
                  onToggle={() => toggleOne(t.id)}
                  onEdit={() => onEdit(t)}
                  onCategory={categoryId => recat.mutate({ id: t.id, categoryId })}
                />
              ))}
            </div>
          </div>

          {hiddenCount > 0 && (
            <div
              className="ncx-serial"
              style={{
                padding: '10px 16px',
                borderTop: '1px solid var(--line)',
                background: 'rgba(150,168,224,0.03)',
              }}
            >
              SHOWING FIRST {visible.length.toLocaleString()} OF {total.toLocaleString()} RECORDS
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- header -- */

function Header({
  total, excluded, accounts, account, onAccount,
  search, onSearch, monthFilter, categoryFilter, onClearMonth, onClearCategory,
  groupByVendor, onGroupByVendor, normalizing, onNormalize, onAdd,
}: {
  total: number;
  excluded: number;
  accounts: string[];
  account: string;
  onAccount: (account: string) => void;
  search: string;
  onSearch: (q: string) => void;
  monthFilter: string | null;
  categoryFilter: string | null;
  onClearMonth?: () => void;
  onClearCategory?: () => void;
  groupByVendor: boolean;
  onGroupByVendor: (v: boolean) => void;
  normalizing: boolean;
  onNormalize: () => void;
  onAdd: () => void;
}) {
  const hasChips = !!(monthFilter || categoryFilter);
  return (
    <div className="panel hud" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div className="ncx-chip" style={{ color: 'var(--cyan)' }}>
          <Icon name="list" size={18} />
        </div>
        <div>
          <h2 className="ncx-chroma" style={{ fontSize: 18, fontWeight: 700, margin: 0, fontFamily: 'var(--font-display)', textTransform: 'uppercase' }}>
            TRANSACTION LOG
          </h2>
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
            every movement on the ledger · filter by month, category, account or text
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button
            className="btn"
            onClick={onAdd}
            title="Record a manual transaction — cash, Venmo, anything imports miss"
            style={{ padding: '7px 12px', fontSize: 11, color: 'var(--lime)' }}
          >
            <Icon name="plus" size={12} /> ADD TRANSACTION
          </button>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Icon name="search" size={12} style={{ position: 'absolute', left: 9, color: 'var(--text-faint)', pointerEvents: 'none' }} />
            <input
              value={search}
              onChange={e => onSearch(e.target.value)}
              placeholder="FIND DESCRIPTION…"
              title="Filter by description or vendor text"
              style={{
                padding: '7px 26px 7px 26px', fontSize: 11, fontFamily: 'var(--font-mono)',
                letterSpacing: '0.05em', width: 180,
                background: '#070811', border: '1px solid var(--line-2)', color: 'var(--text)', outline: 'none',
              }}
            />
            {search && (
              <button
                onClick={() => onSearch('')}
                title="Clear search"
                style={{ position: 'absolute', right: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', padding: 2, lineHeight: 1 }}
              >
                <Icon name="close" size={11} />
              </button>
            )}
          </div>
          {accounts.length > 0 && (
            <select
              value={account}
              onChange={e => onAccount(e.target.value)}
              title="Filter the log by source account"
              style={{
                padding: '7px 10px', fontSize: 11, fontFamily: 'var(--font-mono)',
                letterSpacing: '0.05em',
                background: '#070811', border: '1px solid var(--line-2)', color: 'var(--text)',
              }}
            >
              <option value="">ALL ACCOUNTS</option>
              {accounts.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
          <button
            className="btn btn-ghost"
            onClick={() => onGroupByVendor(!groupByVendor)}
            title={groupByVendor ? 'Switch to chronological view' : 'Group by normalized vendor name'}
            style={{
              padding: '7px 12px', fontSize: 11,
              color: groupByVendor ? 'var(--cyan)' : 'var(--text-dim)',
              border: groupByVendor ? '1px solid color-mix(in srgb, var(--cyan) 45%, transparent)' : undefined,
              background: groupByVendor ? 'color-mix(in srgb, var(--cyan) 10%, transparent)' : undefined,
            }}
          >
            <Icon name="layers" size={12} /> GROUP BY VENDOR
          </button>
          <button
            className="btn btn-ghost"
            onClick={onNormalize}
            disabled={normalizing}
            title="Cluster similar descriptions into consistent vendor names"
            style={{ padding: '7px 12px', fontSize: 11, color: 'var(--text-faint)' }}
          >
            <Icon name="zap" size={12} /> {normalizing ? 'NORMALIZING…' : 'NORMALIZE'}
          </button>
          <span className="ncx-stamp flat" style={{ color: 'var(--cyan)' }}>
            {total.toLocaleString()} RECORDS
          </span>
          {excluded > 0 && (
            <span
              className="ncx-stamp flat"
              title="Excluded from all totals (transfers, refunds, etc.)"
              style={{ color: 'var(--text-faint)' }}
            >
              {excluded.toLocaleString()} EXCLUDED
            </span>
          )}
        </div>
      </div>

      {hasChips && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="mono" style={{ fontSize: 9, letterSpacing: '0.16em', color: 'var(--text-faint)' }}>FILTERED BY</span>
          {monthFilter && <FilterChip label="MONTH" value={monthChipLabel(monthFilter)} onClear={onClearMonth} />}
          {categoryFilter && <FilterChip label="CATEGORY" value={categoryFilter} onClear={onClearCategory} />}
        </div>
      )}
    </div>
  );
}

/** An active drill-filter pill (month / category) with a clear ✕. */
function FilterChip({ label, value, onClear }: { label: string; value: string; onClear?: () => void }) {
  return (
    <span
      className="mono"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 10, letterSpacing: '0.06em',
        padding: '4px 6px 4px 10px', color: 'var(--cyan)',
        border: '1px solid color-mix(in srgb, var(--cyan) 40%, transparent)',
        background: 'color-mix(in srgb, var(--cyan) 12%, transparent)',
      }}
    >
      <span style={{ color: 'var(--text-faint)' }}>{label}</span>
      {value}
      {onClear && (
        <button
          onClick={onClear}
          title={`Clear ${label.toLowerCase()} filter`}
          style={{ display: 'inline-flex', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--cyan)', padding: 0, lineHeight: 1 }}
        >
          <Icon name="close" size={11} />
        </button>
      )}
    </span>
  );
}

/* ---------------------------------------------------------- manual entry -- */

/** Local YYYY-MM-DD for the date input default (today). Local fields, not
 *  toISOString(), so a late-night entry doesn't land on tomorrow's UTC day. */
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Compact inline form for a manual ledger entry (cash / Venmo / anything the
 *  statement imports never see). POSTs the existing /api/transactions endpoint,
 *  which auto-categorizes when no category is picked. */
function AddTransactionForm({
  categories, onClose, onDone,
}: {
  categories: FinanceCategory[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [date, setDate] = useState(todayLocal());
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [categoryId, setCategoryId] = useState('');

  const amountNum = parseFloat(amount);
  const valid = date !== '' && description.trim().length > 0 && Number.isFinite(amountNum) && amountNum > 0;

  const create = useMutation({
    mutationFn: () => {
      // Parse the date on LOCAL calendar fields — new Date('YYYY-MM-DD')
      // is UTC midnight, a day off in a negative-offset zone.
      const [y, m, d] = date.split('-').map(Number);
      return api.post('/api/transactions', {
        date: new Date(y, (m || 1) - 1, d || 1).toISOString(),
        description: description.trim(),
        // Ledger sign convention (matches imports): expenses negative, income positive.
        amount: kind === 'expense' ? -Math.abs(amountNum) : Math.abs(amountNum),
        // Omitting categoryId lets the backend auto-categorize.
        ...(categoryId ? { categoryId } : {}),
      });
    },
    onSuccess: () => { onDone(); onClose(); },
  });

  const submit = () => { if (valid && !create.isPending) create.mutate(); };

  return (
    <div className="panel" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="kicker" style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--lime)' }}>
        <Icon name="plus" size={13} style={{ color: 'var(--lime)' }} />
        MANUAL LEDGER ENTRY
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 140 }}>
          <span className="kicker">DATE</span>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            style={addInputStyle}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 2, minWidth: 200 }}>
          <span className="kicker">DESCRIPTION</span>
          <input
            autoFocus
            placeholder="e.g. Venmo — split dinner"
            value={description}
            onChange={e => setDescription(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit(); }}
            style={addInputStyle}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 110 }}>
          <span className="kicker">AMOUNT ($)</span>
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit(); }}
            style={addInputStyle}
          />
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="kicker">TYPE</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <KindToggle active={kind === 'expense'} color="var(--red)" onClick={() => setKind('expense')}>
              EXPENSE
            </KindToggle>
            <KindToggle active={kind === 'income'} color="var(--lime)" onClick={() => setKind('income')}>
              INCOME
            </KindToggle>
          </div>
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 150 }}>
          <span className="kicker">CATEGORY</span>
          <select value={categoryId} onChange={e => setCategoryId(e.target.value)} style={addInputStyle}>
            <option value="">— auto —</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {create.isError && (
          <span className="mono" style={{ fontSize: 11, color: 'var(--red)', marginRight: 'auto' }}>
            COULDN&rsquo;T ADD — TRY AGAIN
          </span>
        )}
        <button className="btn btn-ghost" onClick={onClose} disabled={create.isPending}>CANCEL</button>
        <button className="btn btn-primary" disabled={!valid || create.isPending} onClick={submit}>
          {create.isPending ? 'ADDING…' : 'ADD TRANSACTION'}
        </button>
      </div>
    </div>
  );
}

function KindToggle({
  active, color, onClick, children,
}: { active: boolean; color: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="btn btn-ghost"
      onClick={onClick}
      style={{
        padding: '7px 12px', fontSize: 11,
        color: active ? color : 'var(--text-dim)',
        border: active ? `1px solid color-mix(in srgb, ${color} 45%, transparent)` : undefined,
        background: active ? `color-mix(in srgb, ${color} 10%, transparent)` : undefined,
      }}
    >
      {children}
    </button>
  );
}

const addInputStyle: React.CSSProperties = {
  padding: '8px 12px',
  background: '#070811',
  border: '1px solid var(--line-2)',
  borderRadius: 0,
  color: 'var(--text)',
  fontFamily: 'var(--font-mono)',
  fontSize: 13,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

/* -------------------------------------------------------------- bulk bar -- */

function BulkBar({
  count, busy, onExclude, onInclude, onDelete, onClear, categories, onCategorize,
}: {
  count: number;
  busy: boolean;
  onExclude: () => void;
  onInclude: () => void;
  onDelete: () => void;
  onClear: () => void;
  categories: FinanceCategory[];
  onCategorize: (categoryId: string) => void;
}) {
  const [catId, setCatId] = useState('');
  if (count === 0) return null;
  return (
    <div
      className="panel hud"
      style={{
        position: 'sticky', top: 12, zIndex: 5,
        padding: '12px 16px',
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        border: '1px solid color-mix(in srgb, var(--magenta) 45%, transparent)',
        boxShadow: '0 0 18px color-mix(in srgb, var(--magenta) 18%, transparent)',
      }}
    >
      <span className="ncx-stamp" style={{ color: 'var(--magenta)' }}>
        {count.toLocaleString()} SELECTED
      </span>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginLeft: 'auto', alignItems: 'center' }}>
        {/* Bulk re-categorize: pick a category, apply to the selection. */}
        <select
          value={catId}
          onChange={e => setCatId(e.target.value)}
          disabled={busy}
          style={{
            padding: '7px 10px', fontSize: 11, fontFamily: 'var(--font-mono)',
            background: '#070811', border: '1px solid var(--line-2)', color: 'var(--text)',
          }}
        >
          <option value="">RECATEGORIZE TO…</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button
          className="btn"
          disabled={busy || !catId}
          onClick={() => catId && onCategorize(catId)}
          title="Set the selected category on every selected transaction"
          style={{ padding: '7px 14px', fontSize: 11, color: 'var(--cyan)' }}
        >
          <Icon name="layers" size={13} /> RECAT
        </button>
        <button
          className="btn"
          disabled={busy}
          onClick={onExclude}
          title="Mark as inter-account transfer — drops these from all totals"
          style={{ padding: '7px 14px', fontSize: 11, color: 'var(--amber)' }}
        >
          <Icon name="repeat" size={13} /> MARK TRANSFER (EXCLUDE)
        </button>
        <button
          className="btn"
          disabled={busy}
          onClick={onInclude}
          title="Re-include in totals"
          style={{ padding: '7px 14px', fontSize: 11, color: 'var(--lime)' }}
        >
          <Icon name="check" size={13} /> INCLUDE
        </button>
        <button
          className="ncx-btn danger"
          disabled={busy}
          onClick={onDelete}
          title="Delete selected"
          style={{ padding: '7px 14px', fontSize: 11 }}
        >
          <Icon name="close" size={13} /> DELETE
        </button>
        <button
          className="btn btn-ghost"
          disabled={busy}
          onClick={onClear}
          title="Clear selection"
          style={{ padding: '7px 12px', fontSize: 11, color: 'var(--text-faint)' }}
        >
          CLEAR
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------- vendor group row -- */

function VendorGroupHeader({ name, total, count }: { name: string; total: number; count: number }) {
  const income = total >= 0;
  return (
    <div
      className="mono"
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto auto',
        alignItems: 'center',
        gap: 12,
        padding: '10px 16px',
        background: 'rgba(150,168,224,0.05)',
        borderTop: '1px solid var(--line-2)',
        borderBottom: '1px solid var(--line)',
        position: 'sticky',
        top: 0,
        zIndex: 2,
      }}
    >
      <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--text)', letterSpacing: '0.04em' }}>
        {name}
      </span>
      <span className="kicker" style={{ fontSize: 9.5, color: 'var(--text-faint)' }}>
        {count} {count === 1 ? 'txn' : 'txns'}
      </span>
      <span style={{ fontWeight: 700, fontSize: 13, color: income ? 'var(--lime)' : 'var(--text)', whiteSpace: 'nowrap' }}>
        {fmtMoney(total)}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------- row -- */

function Row({
  tx, selected, categories, onToggle, onEdit, onCategory,
}: {
  tx: Transaction;
  selected: boolean;
  categories: FinanceCategory[];
  onToggle: () => void;
  onEdit: () => void;
  onCategory: (categoryId: string | null) => void;
}) {
  const excluded = !!tx.excluded;
  const income = tx.amount >= 0;

  return (
    <div
      role="row"
      style={{
        ...gridRow,
        borderTop: '1px solid var(--line)',
        opacity: excluded ? 0.5 : 1,
        background: selected ? 'rgba(var(--accent-rgb),0.08)' : undefined,
      }}
    >
      <div style={cellCenter}>
        <Check checked={selected} onChange={onToggle} title="Select transaction" />
      </div>

      <div style={{ ...cell, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
        {fmtDate(tx.date)}
      </div>

      <div style={{ ...cell, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span
            style={{
              color: 'var(--text)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              maxWidth: 320,
            }}
            title={tx.description}
          >
            {tx.description || '—'}
          </span>
          {excluded && (
            <span className="ncx-stamp flat" style={{ fontSize: 9.5, color: 'var(--text-faint)' }}>
              EXCLUDED
            </span>
          )}
          {tx.isWasteful && (
            <span title="Flagged wasteful">
              <Icon name="flame" size={12} style={{ color: 'var(--amber)' }} />
            </span>
          )}
        </div>
        {(tx.projectName || tx.choreName) && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
            {tx.projectName && <LinkChip icon="layers" color="var(--violet)" label={tx.projectName} />}
            {tx.choreName && <LinkChip icon="check" color="var(--cyan)" label={tx.choreName} />}
          </div>
        )}
      </div>

      <div style={{ ...cell, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, maxWidth: 160 }}>
        {categories.length === 0 ? (
          <span style={{ color: tx.category ? 'var(--text-dim)' : 'var(--text-faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {tx.category || 'Uncategorized'}
          </span>
        ) : (
          /* Inline recategorize — PUTs the change directly, no editor round-trip. */
          <select
            value={tx.categoryId ?? ''}
            onChange={e => onCategory(e.target.value || null)}
            title="Recategorize this transaction"
            style={{
              flex: 1, minWidth: 0,
              padding: '3px 4px', fontSize: 11, fontFamily: 'var(--font-mono)',
              background: '#070811', border: '1px solid var(--line-2)',
              color: tx.categoryId ? 'var(--text-dim)' : 'var(--text-faint)',
              cursor: 'pointer',
            }}
          >
            <option value="">Uncategorized</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {tx.account && (
          <span
            className="mono"
            title={`Account: ${tx.account}`}
            style={{
              flexShrink: 0,
              fontSize: 9,
              color: 'var(--text-faint)',
              padding: '1px 6px',
              border: '1px solid var(--line-2)',
              background: 'rgba(150,168,224,0.05)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              maxWidth: 84,
            }}
          >
            {tx.account}
          </span>
        )}
      </div>

      <div
        style={{
          ...cell,
          textAlign: 'right',
          whiteSpace: 'nowrap',
          fontWeight: 700,
          color: income ? 'var(--lime)' : 'var(--text)',
        }}
      >
        {fmtMoney(tx.amount)}
      </div>

      <div style={cellCenter}>
        <button
          className="btn btn-ghost"
          onClick={onEdit}
          aria-label={`Edit ${tx.description}`}
          title="Edit transaction"
          style={{ padding: '5px 8px', fontSize: 11 }}
        >
          <Icon name="edit" size={14} />
        </button>
      </div>
    </div>
  );
}

function LinkChip({ icon, color, label }: { icon: string; color: string; label: string }) {
  return (
    <span
      className="mono"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: 10,
        color,
        padding: '1px 7px',
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 28%, transparent)`,
        maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}
      title={label}
    >
      <Icon name={icon} size={10} style={{ color, flexShrink: 0 }} /> {label}
    </span>
  );
}

/* -------------------------------------------------------------- controls -- */

/** Styled checkbox that inherits the cyberpunk accent via accentColor. */
function Check({
  checked, onChange, title,
}: { checked: boolean; onChange: () => void; title: string }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      title={title}
      style={{
        width: 15, height: 15, cursor: 'pointer',
        accentColor: 'var(--cyan)',
        margin: 0,
      }}
    />
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="panel hud" style={{ padding: 48, textAlign: 'center', color: 'var(--text-faint)' }}>
      <div className="mono" style={{ fontSize: 13, lineHeight: 1.6, maxWidth: 480, margin: '0 auto' }}>
        {children}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- helpers -- */

function fmtDate(d: Date): string {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString(undefined, { year: '2-digit', month: 'short', day: 'numeric' });
}

const MONTH_ABBR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** A transaction's bucket key "YYYY-MM" — LOCAL fields, matching the burn
 *  chart and the server's local-month budgets (toISOString would bucket a
 *  late-night transaction into the next UTC month). */
function monthKey(d: Date): string {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

/** "YYYY-MM" → "MMM YYYY" for the active-filter chip. */
function monthChipLabel(month: string): string {
  const m = Number(month.slice(5, 7));
  return `${MONTH_ABBR[m - 1] ?? month} ${month.slice(0, 4)}`;
}

/** "$1,234.56" / "-$12.00" — sign in front of the $ for negatives. */
function fmtMoney(amount: number): string {
  const abs = Math.abs(amount).toLocaleString(undefined, {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  return `${amount < 0 ? '-' : ''}$${abs}`;
}

/* ----------------------------------------------------------------- style -- */

// The 6-column grid: select · date · description(flex) · category · amount · edit.
const gridRow: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '36px 84px minmax(180px, 1fr) minmax(96px, 160px) 110px 44px',
  alignItems: 'center',
  gap: 10,
  padding: '10px 14px',
};

const headerRow: React.CSSProperties = {
  background: 'rgba(150,168,224,0.03)',
  borderBottom: '1px solid var(--line-2)',
  position: 'sticky',
  top: 0,
};

const cell: React.CSSProperties = { padding: '0 2px' };
const cellHead: React.CSSProperties = { ...cell, fontSize: 9.5, color: 'var(--text-faint)' };
const cellCenter: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
