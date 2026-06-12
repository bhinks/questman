/**
 * BudgetsView — the "BUDGETS" tab (finance depth, phase 7).
 *
 * Monthly per-category envelopes with a HARD reset every month (no rollover).
 * "Remaining budget" is treated as a competition: every category ranks against
 * the others (the server returns them already sorted most-under-budget first),
 * so the operator can see at a glance who's winning and who's blown the cap.
 *
 * Four stacked sections:
 *   1. HERO + TOTALS — the month, big colored total-remaining, spend / cap, and
 *      over/warn chips. A surplus suggestion (banking the leftover near
 *      month-end) renders as a lime callout when present.
 *   2. ENVELOPES — the leaderboard: a fill bar per category (green ok / amber
 *      warn / red over), spend vs cap, signed remaining, pct used.
 *   3. TRACK RECORD — a compact month-to-month grid (rows = categories, cols =
 *      months) with under/over dots and a per-category under-rate badge, so you
 *      can read how consistently you come in under budget.
 *   4. MANAGE — inline cap editor per category, a "new category" form, and
 *      rename / recolor / delete (server reassigns transactions to Uncategorized).
 *
 * Design system only — .panel / .panel-inset / .hud / kicker / mono / .btn /
 * .btn-ghost / .btn-primary / .fade-up and CSS color vars. Never hardcodes hex.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { api } from '../lib/api';
import type {
  BudgetOverview,
  BudgetItem,
  BudgetStatus,
  BudgetHistory,
  BudgetHistoryCategory,
  CategoriesResponse,
  FinanceCategory,
} from '../lib/api';
import { Icon } from './Icon';
import { AccentPicker } from './AccentPicker';

/** Status → accent color for the fill bar / chips. */
const STATUS_COLOR: Record<BudgetStatus, string> = {
  ok: 'var(--lime)',
  warn: 'var(--amber)',
  over: 'var(--red)',
};

/** "$1,234" for whole-ish numbers; keeps dense grids scannable. */
function money(n: number): string {
  const abs = Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
  return `${n < 0 ? '-' : ''}$${abs}`;
}
/** Signed money for remaining ("+$120" / "-$45"). */
function signedMoney(n: number): string {
  const abs = Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
  return `${n < 0 ? '-' : '+'}$${abs}`;
}

export function BudgetsView() {
  const qc = useQueryClient();

  const overviewQ = useQuery({
    queryKey: ['budgets'],
    queryFn: () => api.get<BudgetOverview>('/api/budgets'),
  });
  const historyQ = useQuery({
    queryKey: ['budgets', 'history'],
    queryFn: () => api.get<BudgetHistory>('/api/budgets/history?months=6'),
  });
  const categoriesQ = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<CategoriesResponse>('/api/categories'),
  });

  /** Any budget/category mutation can shift all four data shapes. */
  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['budgets'] });
    qc.invalidateQueries({ queryKey: ['budgets', 'history'] });
    qc.invalidateQueries({ queryKey: ['categories'] });
    qc.invalidateQueries({ queryKey: ['transactions'] });
  };

  if (overviewQ.isLoading) return <Empty>SPOOLING ENVELOPES…</Empty>;
  if (overviewQ.isError) return <Empty color="var(--red)">FAILED TO LOAD BUDGETS</Empty>;

  const overview = overviewQ.data!;

  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <Hero overview={overview} />

      {/* 2. ENVELOPES — the leaderboard */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <SectionLabel
          icon="wallet"
          color="var(--cyan)"
          title="ENVELOPES"
          sub="ranked most-under-budget first · hard reset each month"
        />
        {overview.budgets.length === 0 ? (
          <Empty>
            No envelopes yet. Set a monthly cap on a category in MANAGE below and it
            joins the leaderboard.
          </Empty>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {overview.budgets.map((b, i) => (
              <EnvelopeRow key={b.categoryId} item={b} rank={i + 1} />
            ))}
          </div>
        )}
      </section>

      {/* 3. MONTH-TO-MONTH TRACK RECORD */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <SectionLabel
          icon="trend"
          color="var(--violet)"
          title="TRACK RECORD"
          sub="month-to-month · how often you come in under"
        />
        {historyQ.isLoading ? (
          <Empty>READING THE TAPE…</Empty>
        ) : historyQ.isError ? (
          <Empty color="var(--red)">HISTORY UNREACHABLE</Empty>
        ) : (historyQ.data?.categories.length ?? 0) === 0 ? (
          <Empty>No history yet. Come back after a month or two of spending.</Empty>
        ) : (
          <HistoryGrid history={historyQ.data!} />
        )}
      </section>

      {/* 4. MANAGE CATEGORIES & CAPS */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <SectionLabel
          icon="layers"
          color="var(--amber)"
          title="MANAGE CATEGORIES & CAPS"
          sub="set envelopes · rename · recolor · retire"
        />
        <ManageCategories categoriesQ={categoriesQ} onMutated={invalidateAll} />
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------- hero -- */

function Hero({ overview }: { overview: BudgetOverview }) {
  const { totals } = overview;
  const remaining = totals.totalRemaining;
  const remainingColor = remaining < 0 ? 'var(--red)' : 'var(--lime)';
  const usedPct = totals.totalCap > 0 ? Math.round((totals.totalSpent / totals.totalCap) * 100) : 0;

  return (
    <div className="panel hud" style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div className="ncx-chip" style={{ color: 'var(--cyan)' }}>
          <Icon name="wallet" size={18} />
        </div>
        <div>
          <h2 className="ncx-chroma" style={{ fontSize: 18, fontWeight: 700, margin: 0, fontFamily: 'var(--font-display)', textTransform: 'uppercase' }}>
            BUDGETS // {fmtMonth(overview.month)}
          </h2>
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
            monthly envelopes · remaining budget is the score
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {overview.overCount > 0 && <Chip color="var(--red)">{overview.overCount} OVER</Chip>}
          {overview.warnCount > 0 && <Chip color="var(--amber)">{overview.warnCount} NEAR CAP</Chip>}
          {overview.unbudgetedCount > 0 && (
            <Chip color="var(--text-faint)">{overview.unbudgetedCount} UNCAPPED</Chip>
          )}
          {overview.overCount === 0 && overview.warnCount === 0 && overview.budgets.length > 0 && (
            <Chip color="var(--lime)">ALL UNDER</Chip>
          )}
        </div>
      </div>

      {/* big remaining number + spend/cap */}
      <div
        className="panel-inset"
        style={{ padding: 18, display: 'flex', alignItems: 'flex-end', gap: 24, flexWrap: 'wrap' }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="kicker" style={{ color: 'var(--text-faint)' }}>REMAINING BUDGET</span>
          <span
            className="ncx-val"
            style={{ fontSize: 38, lineHeight: 1, color: remainingColor }}
          >
            {signedMoney(remaining)}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', marginBottom: 4 }}>
          <MiniStat label="SPENT" value={money(totals.totalSpent)} color="var(--text)" />
          <MiniStat label="CAP" value={money(totals.totalCap)} color="var(--text-dim)" />
          <MiniStat label="USED" value={`${usedPct}%`} color="var(--cyan)" />
        </div>
      </div>

      {overview.suggestion && (
        <div
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            padding: '12px 14px',
            background: 'color-mix(in srgb, var(--lime) 9%, transparent)',
            border: '1px solid color-mix(in srgb, var(--lime) 35%, transparent)',
          }}
        >
          <Icon name="spark" size={16} style={{ color: 'var(--lime)', flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}>{overview.suggestion}</span>
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.06em', color: 'var(--text-faint)' }}>
        {label}
      </span>
      <span className="ncx-val" style={{ fontSize: 18, color }}>{value}</span>
    </div>
  );
}

/* -------------------------------------------------------------- envelopes -- */

function EnvelopeRow({ item, rank }: { item: BudgetItem; rank: number }) {
  const accent = STATUS_COLOR[item.status];
  const fillPct = Math.min(100, Math.max(0, item.pct));
  const over = item.status === 'over';

  return (
    <div
      className="panel"
      style={{
        padding: 14,
        display: 'flex', flexDirection: 'column', gap: 10,
        border: over
          ? '1px solid color-mix(in srgb, var(--red) 45%, transparent)'
          : '1px solid var(--line)',
        background: over
          ? 'linear-gradient(180deg, color-mix(in srgb, var(--red) 6%, transparent), transparent)'
          : undefined,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {/* rank medal */}
        <span
          className="mono"
          title={`Rank #${rank} — most under budget`}
          style={{
            flexShrink: 0,
            width: 26, height: 26,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700,
            color: rank <= 3 ? 'var(--lime)' : 'var(--text-faint)',
            background: rank <= 3
              ? 'color-mix(in srgb, var(--lime) 12%, transparent)'
              : 'var(--panel-2)',
            border: `1px solid ${rank <= 3 ? 'color-mix(in srgb, var(--lime) 35%, transparent)' : 'var(--line)'}`,
          }}
        >
          {rank}
        </span>

        {/* category icon + name */}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Icon name={item.icon || 'bag'} size={15} style={{ color: item.color || accent, flexShrink: 0 }} />
          <span
            style={{
              fontSize: 15, fontWeight: 600, color: 'var(--text)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {item.name}
          </span>
        </span>

        {/* spend / cap + remaining + pct */}
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            {money(item.spent)} <span style={{ color: 'var(--text-faint)' }}>/ {money(item.cap)}</span>
          </span>
          <span
            className="mono"
            title="Remaining in this envelope"
            style={{ fontSize: 13, fontWeight: 700, color: item.remaining < 0 ? 'var(--red)' : 'var(--lime)' }}
          >
            {signedMoney(item.remaining)}
          </span>
          <span className="mono" style={{ fontSize: 11, color: accent }}>
            {Math.round(item.pct)}%
          </span>
        </span>
      </div>

      {/* fill bar */}
      <div className="ncx-bar slim">
        <i
          style={{
            width: `${fillPct}%`,
            background: accent,
            boxShadow: `0 0 10px color-mix(in srgb, ${accent} 45%, transparent)`,
          }}
        />
        <span className="seg-mask" />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- history -- */

function HistoryGrid({ history }: { history: BudgetHistory }) {
  const months = history.months;
  // Label column + one column per month + under-rate column.
  const cols = `minmax(120px, 1.4fr) repeat(${months.length}, minmax(58px, 1fr)) auto`;

  return (
    <div className="panel" style={{ padding: 16, overflowX: 'auto' }}>
      <div
        style={{
          display: 'grid', gridTemplateColumns: cols, gap: '6px 8px',
          minWidth: 'min-content', alignItems: 'center',
        }}
      >
        {/* header row */}
        <span className="kicker" style={{ color: 'var(--text-faint)' }}>CATEGORY</span>
        {months.map(m => (
          <span
            key={m}
            className="mono"
            style={{ fontSize: 10, color: 'var(--text-faint)', textAlign: 'center', letterSpacing: '0.02em' }}
          >
            {fmtMonthShort(m)}
          </span>
        ))}
        <span className="mono" style={{ fontSize: 10, color: 'var(--text-faint)', textAlign: 'right' }}>
          UNDER&nbsp;RATE
        </span>

        {/* category rows */}
        {history.categories.map(cat => (
          <HistoryRow key={cat.categoryId} cat={cat} months={months} />
        ))}
      </div>
    </div>
  );
}

function HistoryRow({ cat, months }: { cat: BudgetHistoryCategory; months: string[] }) {
  // Index cells by month for safe lookup (gaps render as a faint dash).
  const byMonth = new Map(cat.cells.map(c => [c.month, c]));
  const rate = cat.underRate;
  const rateColor =
    rate == null ? 'var(--text-faint)'
      : rate >= 70 ? 'var(--lime)'
        : rate >= 40 ? 'var(--amber)'
          : 'var(--red)';

  return (
    <>
      <span
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 0,
          fontSize: 13, color: 'var(--text-dim)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >
        <span
          style={{ width: 8, height: 8, flexShrink: 0, background: cat.color || 'var(--cyan)' }}
        />
        {cat.name}
      </span>

      {months.map(m => {
        const cell = byMonth.get(m);
        if (!cell || cell.cap <= 0) {
          return (
            <span key={m} className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', textAlign: 'center' }}>
              –
            </span>
          );
        }
        const dot = cell.under ? 'var(--lime)' : 'var(--red)';
        return (
          <span
            key={m}
            title={`${fmtMonthShort(m)}: ${money(cell.spent)} / ${money(cell.cap)} (${Math.round(cell.pct)}%)`}
            style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}
          >
            <span className="mono" style={{ fontSize: 11, color: cell.under ? 'var(--text-dim)' : 'var(--red)' }}>
              {money(cell.spent)}
            </span>
            <span style={{ width: 8, height: 3, background: dot }} />
          </span>
        );
      })}

      <span
        className="ncx-stamp flat"
        title="Share of completed months that came in under cap"
        style={{ justifySelf: 'end', color: rateColor }}
      >
        {rate == null ? '—' : `${Math.round(rate)}%`}
      </span>
    </>
  );
}

/* ----------------------------------------------------------------- manage -- */

function ManageCategories({
  categoriesQ,
  onMutated,
}: {
  categoriesQ: UseQueryResult<CategoriesResponse>;
  onMutated: () => void;
}) {
  const [adding, setAdding] = useState(false);

  if (categoriesQ.isLoading) return <Empty>LOADING CATEGORIES…</Empty>;
  if (categoriesQ.isError) return <Empty color="var(--red)">CATEGORIES UNREACHABLE</Empty>;

  const categories = (categoriesQ.data?.categories ?? []).filter(c => c.isActive);

  return (
    <div className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="ncx-serial">
          {categories.length} categor{categories.length === 1 ? 'y' : 'ies'}
        </span>
        {!adding && (
          <button
            className="btn"
            style={{ marginLeft: 'auto', padding: '6px 12px', fontSize: 12 }}
            onClick={() => setAdding(true)}
          >
            <Icon name="plus" size={13} /> NEW CATEGORY
          </button>
        )}
      </div>

      {adding && <NewCategoryForm onClose={() => setAdding(false)} onDone={onMutated} />}

      {categories.length === 0 && !adding ? (
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-faint)' }}>
          No categories yet. Add one above to start budgeting.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {categories.map(cat => (
            <CategoryRow key={cat.id} cat={cat} onMutated={onMutated} />
          ))}
        </div>
      )}
    </div>
  );
}

function CategoryRow({ cat, onMutated }: { cat: FinanceCategory; onMutated: () => void }) {
  const [capDraft, setCapDraft] = useState<string>(cat.budget != null ? String(cat.budget) : '');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(cat.name);
  const [color, setColor] = useState(cat.color ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Save cap → PUT /api/budgets/:categoryId { cap: number | null }.
  const saveCap = useMutation({
    mutationFn: () => {
      const trimmed = capDraft.trim();
      const cap = trimmed === '' ? null : Number(trimmed);
      return api.put(`/api/budgets/${cat.id}`, { cap });
    },
    onSuccess: onMutated,
  });

  // Rename / recolor → PUT /api/categories/:id.
  const saveMeta = useMutation({
    mutationFn: () =>
      api.put(`/api/categories/${cat.id}`, {
        name: name.trim() || cat.name,
        color: color.trim() || null,
      }),
    onSuccess: () => { onMutated(); setEditing(false); },
  });

  // Delete → server reassigns its transactions to Uncategorized.
  const remove = useMutation({
    mutationFn: () => api.del(`/api/categories/${cat.id}`),
    onSuccess: () => { onMutated(); setConfirmDelete(false); },
  });

  const capNum = capDraft.trim() === '' ? null : Number(capDraft);
  const capInvalid = capNum != null && (!Number.isFinite(capNum) || capNum < 0);
  const capDirty = (cat.budget != null ? String(cat.budget) : '') !== capDraft.trim();
  const accent = cat.color || 'var(--cyan)';

  return (
    <div className="panel-inset" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Icon name={cat.icon || 'bag'} size={16} style={{ color: accent, flexShrink: 0 }} />

        {editing ? (
          <div style={{ display: 'flex', gap: 8, flex: 1, minWidth: 200, flexWrap: 'wrap' }}>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Name"
              style={{ ...inputStyle, flex: 1, minWidth: 120 }}
            />
            {/* Pick list, never hex entry (Brent's rule) — preset values are
                hex, which is exactly what the API validates color as. */}
            <AccentPicker value={color} onChange={setColor} autoTitle="Default" />
            <button
              className="btn btn-primary"
              style={{ padding: '6px 12px', fontSize: 11 }}
              disabled={saveMeta.isPending}
              onClick={() => saveMeta.mutate()}
            >
              {saveMeta.isPending ? 'SAVING…' : 'SAVE'}
            </button>
            <button
              className="btn btn-ghost"
              style={{ padding: '6px 10px', fontSize: 11 }}
              onClick={() => { setEditing(false); setName(cat.name); setColor(cat.color ?? ''); }}
            >
              CANCEL
            </button>
          </div>
        ) : (
          <>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{cat.name}</span>
            {cat.isSystem && (
              <span className="mono" style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.06em' }}>
                SYSTEM
              </span>
            )}
            {typeof cat.transactionCount === 'number' && cat.transactionCount > 0 && (
              <span className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>
                · {cat.transactionCount} txn{cat.transactionCount === 1 ? '' : 's'}
              </span>
            )}

            {/* cap editor */}
            <label
              title="Monthly cap — leave blank for no envelope"
              style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-faint)' }}>CAP $</span>
              <input
                type="number"
                min={0}
                step={1}
                value={capDraft}
                onChange={e => setCapDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && capDirty && !capInvalid && !saveCap.isPending) saveCap.mutate();
                }}
                placeholder="—"
                style={{ ...inputStyle, width: 92, textAlign: 'right' }}
              />
            </label>
            <button
              className="btn"
              style={{ padding: '6px 12px', fontSize: 11, opacity: capDirty && !capInvalid ? 1 : 0.5 }}
              disabled={!capDirty || capInvalid || saveCap.isPending}
              onClick={() => saveCap.mutate()}
              title={capInvalid ? 'Cap must be a non-negative number' : 'Save cap'}
            >
              <Icon name="check" size={12} /> {saveCap.isPending ? 'SAVING…' : 'SET'}
            </button>

            <button
              className="btn btn-ghost"
              style={{ padding: '6px 8px', fontSize: 11 }}
              onClick={() => setEditing(true)}
              title="Rename / recolor"
            >
              <Icon name="edit" size={13} />
            </button>
            {!cat.isSystem && (
              <button
                className="btn btn-ghost"
                style={{ padding: '6px 8px', fontSize: 11, color: 'var(--red)' }}
                onClick={() => setConfirmDelete(true)}
                title="Delete (transactions move to Uncategorized)"
              >
                <Icon name="close" size={14} />
              </button>
            )}
          </>
        )}
      </div>

      {capInvalid && (
        <div className="mono" style={{ fontSize: 11, color: 'var(--red)' }}>
          Cap must be a non-negative number.
        </div>
      )}

      {confirmDelete && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            padding: '10px 12px',
            background: 'color-mix(in srgb, var(--red) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--red) 35%, transparent)',
          }}
        >
          <span className="mono" style={{ fontSize: 12, color: 'var(--text)' }}>
            Delete <strong style={{ color: 'var(--text)' }}>{cat.name}</strong>? Its transactions move to
            Uncategorized.
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button
              className="ncx-btn danger"
              style={{ padding: '6px 12px', fontSize: 11 }}
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {remove.isPending ? 'DELETING…' : 'DELETE'}
            </button>
            <button
              className="btn btn-ghost"
              style={{ padding: '6px 10px', fontSize: 11 }}
              onClick={() => setConfirmDelete(false)}
            >
              CANCEL
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function NewCategoryForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('');
  const [budget, setBudget] = useState('');

  const create = useMutation({
    mutationFn: () => {
      const body: { name: string; color?: string; budget?: number } = { name: name.trim() };
      if (color.trim()) body.color = color.trim();
      const b = budget.trim();
      if (b !== '' && Number.isFinite(Number(b))) body.budget = Number(b);
      return api.post('/api/categories', body);
    },
    onSuccess: () => { onDone(); onClose(); },
  });

  const budgetNum = budget.trim() === '' ? null : Number(budget);
  const budgetInvalid = budgetNum != null && (!Number.isFinite(budgetNum) || budgetNum < 0);
  const canSave = name.trim().length > 0 && !budgetInvalid && !create.isPending;

  return (
    <div className="panel-inset" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 180 }}>
          <span className="kicker" style={{ color: 'var(--text-faint)' }}>NAME</span>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Coffee runs"
            onKeyDown={e => { if (e.key === 'Enter' && canSave) create.mutate(); }}
            style={inputStyle}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="kicker" style={{ color: 'var(--text-faint)' }}>COLOR</span>
          {/* Pick list, never hex entry — same swatches as bosses/projects. */}
          <AccentPicker value={color} onChange={setColor} autoTitle="Default" />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 120 }}>
          <span className="kicker" style={{ color: 'var(--text-faint)' }}>CAP $</span>
          <input
            type="number"
            min={0}
            step={1}
            value={budget}
            onChange={e => setBudget(e.target.value)}
            placeholder="optional"
            onKeyDown={e => { if (e.key === 'Enter' && canSave) create.mutate(); }}
            style={{ ...inputStyle, textAlign: 'right' }}
          />
        </label>
      </div>

      {budgetInvalid && (
        <div className="mono" style={{ fontSize: 11, color: 'var(--red)' }}>
          Cap must be a non-negative number.
        </div>
      )}
      {create.isError && (
        <div className="mono" style={{ fontSize: 11, color: 'var(--red)' }}>
          Couldn&rsquo;t create category — try again.
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost" onClick={onClose} style={{ padding: '6px 12px', fontSize: 12 }}>
          CANCEL
        </button>
        <button
          className="btn btn-primary"
          disabled={!canSave}
          onClick={() => create.mutate()}
          style={{ padding: '6px 14px', fontSize: 12 }}
        >
          <Icon name="plus" size={13} /> {create.isPending ? 'ADDING…' : 'ADD CATEGORY'}
        </button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- shared -- */

function SectionLabel({
  icon, color, title, sub,
}: { icon: string; color: string; title: string; sub: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 2, flexWrap: 'wrap' }}>
      <Icon name={icon} size={14} style={{ color }} />
      <span
        className="mono"
        style={{ fontSize: 10, letterSpacing: '0.26em', color: 'var(--text-dim)', textTransform: 'uppercase' }}
      >
        {title}
      </span>
      <span className="mono" style={{ fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-faint)' }}>// {sub}</span>
    </div>
  );
}

function Chip({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span className="ncx-stamp flat" style={{ flexShrink: 0, color }}>
      {children}
    </span>
  );
}

function Empty({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div className="panel hud" style={{ padding: 36, textAlign: 'center', color: color ?? 'var(--text-faint)' }}>
      <div className="mono" style={{ fontSize: 13, lineHeight: 1.5, maxWidth: 480, margin: '0 auto' }}>
        {children}
      </div>
    </div>
  );
}

/** "2026-06" → "June 2026". */
function fmtMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}
/** "2026-06" → "Jun". */
function fmtMonthShort(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short' });
}

const inputStyle: React.CSSProperties = {
  padding: '7px 10px',
  background: '#070811',
  border: '1px solid var(--line-2)',
  borderRadius: 0,
  color: 'var(--text)',
  fontFamily: 'var(--font-mono)',
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
};
