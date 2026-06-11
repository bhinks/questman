/**
 * BillsView — the "Bills" tab: recurring money drains framed as
 * "LEECH PROCESSES" quietly siphoning eddies out of the account.
 *
 * Flow:
 *   1. HEADER — total monthly drain (big) + the yearly bleed-out.
 *   2. DETECTED — auto-detected recurring charges, NOT yet tracked. Each is a
 *      confirm-to-track card (or dismiss locally). Auto-detect with a human
 *      confirmation, never silent tracking.
 *   3. TRACKED BILLS — the active leeches: amount/cadence, next due (amber when
 *      imminent), monthly equivalent. PAID / edit / kill actions. Cancelled
 *      bills greyed in a collapsed area.
 *   4. SUBSCRIPTION AUDIT ("KILL RUNNING PROCESSES") — a keep/cancel pass over
 *      active subscriptions, with monthly/annual sub totals up top.
 *   5. "+ Add bill" — manual entry.
 *
 * Design system only: .panel / .panel-inset / .hud / kicker / mono / .btn /
 * .btn-ghost / .btn-primary / .fade-up and CSS color vars. Never hardcodes hex.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type {
  RecurringListResponse,
  RecurringExpense,
  RecurringCandidate,
  DetectResponse,
  SubscriptionAudit,
  CategoriesResponse,
  FinanceCategory,
  Cadence,
} from '../lib/api';
import { Icon } from './Icon';

const CADENCE_LABEL: Record<Cadence, string> = {
  weekly: '/wk',
  monthly: '/mo',
  yearly: '/yr',
};

function money(n: number, decimals = 2): string {
  const v = Number.isFinite(n) ? n : 0;
  return `$${v.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

export function BillsView() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  // Candidates dismissed locally this session (keyed by candidate.key).
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [showCancelled, setShowCancelled] = useState(false);
  const [editing, setEditing] = useState<RecurringExpense | null>(null);

  const listQ = useQuery({
    queryKey: ['recurring'],
    queryFn: () => api.get<RecurringListResponse>('/api/recurring'),
  });
  const detectQ = useQuery({
    queryKey: ['recurring', 'detect'],
    queryFn: () => api.get<DetectResponse>('/api/recurring/detect'),
  });
  const auditQ = useQuery({
    queryKey: ['recurring', 'audit'],
    queryFn: () => api.get<SubscriptionAudit>('/api/recurring/audit'),
  });
  const catsQ = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<CategoriesResponse>('/api/categories').then(r => r.categories),
    staleTime: 5 * 60 * 1000,
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['recurring'] });
    qc.invalidateQueries({ queryKey: ['recurring', 'detect'] });
    qc.invalidateQueries({ queryKey: ['recurring', 'audit'] });
  };

  if (listQ.isLoading) return <Splash>SPINNING UP LEECH MONITOR…</Splash>;
  if (listQ.isError) return <Splash color="var(--red)">FAILED TO LOAD RECURRING DRAINS</Splash>;

  const all = listQ.data?.recurring ?? [];
  const monthlyTotal = listQ.data?.monthlyTotal ?? 0;
  const active = all.filter(r => r.active);
  const cancelled = all.filter(r => !r.active);
  const cats = catsQ.data ?? [];

  const candidates = (detectQ.data?.candidates ?? []).filter(c => !dismissed.has(c.key));

  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <Header monthlyTotal={monthlyTotal} activeCount={active.length} />

      {!adding ? (
        <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setAdding(true)}>
          <Icon name="plus" size={14} /> ADD BILL
        </button>
      ) : (
        <BillForm
          categories={cats}
          onClose={() => setAdding(false)}
          onDone={invalidateAll}
        />
      )}

      {editing && (
        <BillForm
          key={editing.id}
          existing={editing}
          categories={cats}
          onClose={() => setEditing(null)}
          onDone={invalidateAll}
        />
      )}

      {/* 2 — DETECTED, confirm to track */}
      {candidates.length > 0 && (
        <DetectedSection
          candidates={candidates}
          onDismiss={(key) => setDismissed(prev => new Set(prev).add(key))}
          onTracked={invalidateAll}
        />
      )}

      {/* 3 — TRACKED BILLS */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <SectionLabel
          icon="repeat"
          color="var(--magenta)"
          title="LEECH PROCESSES"
          sub="active recurring drains"
        />
        {active.length === 0 ? (
          <Splash>
            No leeches tracked. Confirm a detected charge above or add a bill manually —
            recurring drains quietly siphon eddies every cycle.
          </Splash>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {active.map(bill => (
              <BillCard
                key={bill.id}
                bill={bill}
                onEdit={() => setEditing(bill)}
                onChanged={invalidateAll}
              />
            ))}
          </div>
        )}

        {cancelled.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button
              className="btn btn-ghost"
              onClick={() => setShowCancelled(v => !v)}
              style={{
                alignSelf: 'flex-start', padding: '4px 10px', fontSize: 11,
                color: 'var(--text-faint)',
              }}
            >
              <Icon name={showCancelled ? 'arrowUp' : 'arrowDn'} size={12} />
              {showCancelled ? 'HIDE' : 'SHOW'} KILLED · {cancelled.length}
            </button>
            {showCancelled && cancelled.map(bill => (
              <BillCard
                key={bill.id}
                bill={bill}
                inactive
                onEdit={() => setEditing(bill)}
                onChanged={invalidateAll}
              />
            ))}
          </div>
        )}
      </section>

      {/* 4 — SUBSCRIPTION AUDIT */}
      <AuditSection
        audit={auditQ.data}
        loading={auditQ.isLoading}
        error={auditQ.isError}
        onChanged={invalidateAll}
      />
    </div>
  );
}

/* ----------------------------------------------------------------- header -- */

function Header({ monthlyTotal, activeCount }: { monthlyTotal: number; activeCount: number }) {
  const annual = monthlyTotal * 12;
  return (
    <div className="panel hud" style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
      <div className="ncx-chip" style={{ width: 46, height: 46, color: 'var(--magenta)' }}>
        <Icon name="repeat" size={20} />
      </div>
      <div>
        <h2 className="ncx-chroma" style={{ fontSize: 18, fontWeight: 700, margin: 0, fontFamily: 'var(--font-display)', textTransform: 'uppercase' }}>
          LEECH PROCESSES
        </h2>
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
          recurring drains siphoning your eddies · {activeCount} active
        </div>
      </div>
      <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
        <div className="ncx-val" style={{ fontSize: 28, color: 'var(--magenta)', lineHeight: 1 }}>
          {money(monthlyTotal)}<span style={{ fontSize: 14, color: 'var(--text-faint)', fontWeight: 600 }}>/mo</span>
        </div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--red)', marginTop: 6 }}>
          {money(annual, 0)}/yr bleeding out
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- detected -- */

function DetectedSection({
  candidates, onDismiss, onTracked,
}: {
  candidates: RecurringCandidate[];
  onDismiss: (key: string) => void;
  onTracked: () => void;
}) {
  return (
    <section
      className="panel"
      style={{
        padding: 18,
        display: 'flex', flexDirection: 'column', gap: 14,
        border: '1px solid color-mix(in srgb, var(--amber) 40%, transparent)',
        background: 'linear-gradient(180deg, color-mix(in srgb, var(--amber) 7%, transparent), transparent)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Icon name="search" size={16} style={{ color: 'var(--amber)' }} />
        <span className="kicker" style={{ color: 'var(--amber)' }}>DETECTED — CONFIRM TO TRACK</span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-faint)' }}>
          · {candidates.length} suspected leech{candidates.length === 1 ? '' : 'es'} in your transactions
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {candidates.map(c => (
          <CandidateCard key={c.key} candidate={c} onDismiss={() => onDismiss(c.key)} onTracked={onTracked} />
        ))}
      </div>
    </section>
  );
}

function CandidateCard({
  candidate, onDismiss, onTracked,
}: {
  candidate: RecurringCandidate;
  onDismiss: () => void;
  onTracked: () => void;
}) {
  const qc = useQueryClient();
  const track = useMutation({
    mutationFn: () => api.post('/api/recurring', {
      name: candidate.name,
      amount: candidate.amount,
      cadence: candidate.cadence,
      dueDay: candidate.dueDay,
      categoryId: candidate.categoryId,
      isSubscription: candidate.isSubscription,
      source: 'detected',
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recurring'] });
      qc.invalidateQueries({ queryKey: ['recurring', 'detect'] });
      qc.invalidateQueries({ queryKey: ['recurring', 'audit'] });
      onTracked();
    },
  });

  return (
    <div
      className="panel-inset"
      style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}
    >
      <div style={{ flex: 1, minWidth: 180, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{candidate.name}</span>
          {candidate.isSubscription && <Chip color="var(--violet)">SUBSCRIPTION</Chip>}
        </div>
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--magenta)', fontWeight: 700 }}>
            {money(candidate.amount)}{CADENCE_LABEL[candidate.cadence]}
          </span>
          <span style={{ color: 'var(--text-faint)' }}>·</span>
          <span style={{ color: 'var(--text-faint)' }}>
            <Icon name="eye" size={11} style={{ marginRight: 4, color: 'var(--text-faint)' }} />
            seen {candidate.matchCount}×
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <button
          className="btn btn-primary"
          disabled={track.isPending}
          onClick={() => track.mutate()}
          style={{ padding: '7px 14px', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em' }}
        >
          <Icon name="check" size={13} /> {track.isPending ? 'TRACKING…' : 'TRACK'}
        </button>
        <button
          className="btn btn-ghost"
          disabled={track.isPending}
          onClick={onDismiss}
          title="Not a recurring drain — hide it"
          aria-label={`Dismiss ${candidate.name}`}
          style={{ padding: '7px 9px', fontSize: 11, color: 'var(--text-faint)' }}
        >
          <Icon name="close" size={14} />
        </button>
      </div>
      {track.isError && (
        <div className="mono" style={{ fontSize: 11, color: 'var(--red)', flexBasis: '100%' }}>
          COULDN&rsquo;T TRACK — TRY AGAIN
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ tracked bill -- */

function dueMeta(bill: RecurringExpense): { tag: string | null; color: string } {
  const d = bill.dueInDays;
  if (d == null) return { tag: null, color: 'var(--text-dim)' };
  if (d <= 0) return { tag: 'DUE TODAY', color: 'var(--red)' };
  if (d <= 3) return { tag: 'DUE SOON', color: 'var(--amber)' };
  return { tag: null, color: 'var(--text-dim)' };
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function BillCard({
  bill, inactive, onEdit, onChanged,
}: {
  bill: RecurringExpense;
  inactive?: boolean;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();

  const pay = useMutation({
    mutationFn: () => api.post(`/api/recurring/${bill.id}/pay`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['recurring'] }); onChanged(); },
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/api/recurring/${bill.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recurring'] });
      qc.invalidateQueries({ queryKey: ['recurring', 'audit'] });
      onChanged();
    },
  });

  const due = dueMeta(bill);
  const accent = bill.category?.color || 'var(--magenta)';
  const due3 = !inactive && bill.dueInDays != null && bill.dueInDays <= 3;

  return (
    <div
      className="panel"
      style={{
        padding: 16,
        display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
        opacity: inactive ? 0.5 : 1,
        border: `1px solid ${due3 ? `color-mix(in srgb, ${due.color} 45%, transparent)` : 'var(--line)'}`,
        background: due3
          ? `linear-gradient(180deg, color-mix(in srgb, ${due.color} 7%, transparent), transparent)`
          : undefined,
      }}
    >
      {/* sigil */}
      <div style={{
        width: 44, height: 44, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: `color-mix(in srgb, ${accent} 10%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${accent} 35%, transparent)`,
        clipPath: 'polygon(7px 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 7px)',
        color: accent,
      }}>
        <Icon name={bill.isSubscription ? 'repeat' : 'wallet'} size={20} />
      </div>

      {/* body */}
      <div style={{ flex: 1, minWidth: 160, display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{bill.name}</span>
          {bill.isSubscription && <Chip color="var(--violet)">SUB</Chip>}
          {bill.category && (
            <span
              className="ncx-stamp flat"
              style={{ fontSize: 9.5, color: bill.category.color || 'var(--text-dim)' }}
            >
              {bill.category.name}
            </span>
          )}
          {inactive && (
            <span className="mono" style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.06em' }}>
              KILLED
            </span>
          )}
        </div>

        <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--magenta)', fontWeight: 700 }}>
            {money(bill.amount)}{CADENCE_LABEL[bill.cadence]}
          </span>
          {bill.cadence !== 'monthly' && (
            <>
              <span style={{ color: 'var(--text-faint)' }}>·</span>
              <span style={{ color: 'var(--text-faint)' }}>≈ {money(bill.monthlyEquivalent)}/mo</span>
            </>
          )}
          {!inactive && (
            <>
              <span style={{ color: 'var(--text-faint)' }}>·</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: due.color }}>
                <Icon name="clock" size={11} style={{ color: due.color }} />
                {bill.dueInDays != null
                  ? `due ${fmtDate(bill.nextDueDate)} (${bill.dueInDays <= 0 ? 'today' : `${bill.dueInDays}d`})`
                  : `due ${fmtDate(bill.nextDueDate)}`}
              </span>
              {due.tag && <Chip color={due.color}>{due.tag}</Chip>}
            </>
          )}
        </div>
      </div>

      {/* actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {!inactive && (
          <button
            className="btn"
            disabled={pay.isPending}
            onClick={() => pay.mutate()}
            title="Mark this cycle paid — advances the next due date"
            style={{ padding: '8px 14px', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--lime)' }}
          >
            <Icon name="check" size={13} /> {pay.isPending ? 'PAID…' : 'PAID'}
          </button>
        )}
        <button
          className="btn btn-ghost"
          onClick={onEdit}
          title="Edit bill"
          aria-label={`Edit ${bill.name}`}
          style={{ padding: '6px 9px', fontSize: 11, color: 'var(--text-faint)' }}
        >
          <Icon name="edit" size={13} />
        </button>
        <button
          className="btn btn-ghost"
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
          title="Delete bill permanently"
          aria-label={`Delete ${bill.name}`}
          style={{ padding: '6px 8px', fontSize: 11, color: 'var(--text-faint)' }}
        >
          <Icon name="close" size={14} />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ audit -- */

function AuditSection({
  audit, loading, error, onChanged,
}: {
  audit: SubscriptionAudit | undefined;
  loading: boolean;
  error: boolean;
  onChanged: () => void;
}) {
  const subs = audit?.subscriptions ?? [];

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <SectionLabel
        icon="bolt"
        color="var(--red)"
        title="KILL RUNNING PROCESSES"
        sub="subscription audit · keep or cancel"
      />

      {loading ? (
        <Splash>AUDITING SUBSCRIPTIONS…</Splash>
      ) : error ? (
        <Splash color="var(--red)">AUDIT UNREACHABLE</Splash>
      ) : subs.length === 0 ? (
        <Splash>No active subscriptions. Nothing running in the background.</Splash>
      ) : (
        <>
          <div
            className="panel hud"
            style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}
          >
            <AuditStat label="RUNNING" value={String(audit!.count)} color="var(--violet)" icon="repeat" />
            <AuditStat label="MONTHLY" value={money(audit!.monthlySubCost)} color="var(--magenta)" icon="trend" />
            <AuditStat label="ANNUAL" value={money(audit!.annualSubCost, 0)} color="var(--red)" icon="flame" />
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 'auto', maxWidth: 220, lineHeight: 1.4 }}>
              Each kill stops the bleed. Cancel anything you forgot you were paying for.
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {subs.map(sub => (
              <AuditRow key={sub.id} sub={sub} onChanged={onChanged} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function AuditStat({ label, value, color, icon }: { label: string; value: string; color: string; icon: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span className="kicker" style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-faint)' }}>
        <Icon name={icon} size={11} style={{ color }} /> {label}
      </span>
      <span className="ncx-val" style={{ fontSize: 20, color }}>{value}</span>
    </div>
  );
}

function AuditRow({ sub, onChanged }: { sub: RecurringExpense; onChanged: () => void }) {
  const qc = useQueryClient();
  const cancel = useMutation({
    mutationFn: () => api.post(`/api/recurring/${sub.id}/cancel`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recurring'] });
      qc.invalidateQueries({ queryKey: ['recurring', 'audit'] });
      onChanged();
    },
  });

  return (
    <div
      className="panel-inset"
      style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}
    >
      <Icon name="repeat" size={16} style={{ color: 'var(--violet)', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 160 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{sub.name}</div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 3 }}>
          <span style={{ color: 'var(--magenta)', fontWeight: 700 }}>
            {money(sub.amount)}{CADENCE_LABEL[sub.cadence]}
          </span>
          <span style={{ color: 'var(--text-faint)' }}> · ≈ {money(sub.monthlyEquivalent)}/mo</span>
        </div>
      </div>
      <button
        className="ncx-btn danger"
        disabled={cancel.isPending}
        onClick={() => cancel.mutate()}
        title="Cancel this subscription — stop the drain"
        style={{ padding: '8px 16px', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', flexShrink: 0 }}
      >
        <Icon name="bolt" size={13} /> {cancel.isPending ? 'KILLING…' : 'CANCEL'}
      </button>
      {cancel.isError && (
        <div className="mono" style={{ fontSize: 11, color: 'var(--red)', flexBasis: '100%' }}>
          COULDN&rsquo;T CANCEL — TRY AGAIN
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- form -- */

function BillForm({
  existing, categories, onClose, onDone,
}: {
  existing?: RecurringExpense;
  categories: FinanceCategory[];
  onClose: () => void;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!existing;
  const [name, setName] = useState(existing?.name ?? '');
  const [amount, setAmount] = useState(existing ? String(existing.amount) : '');
  const [cadence, setCadence] = useState<Cadence>(existing?.cadence ?? 'monthly');
  const [dueDay, setDueDay] = useState(existing?.dueDay != null ? String(existing.dueDay) : '');
  const [categoryId, setCategoryId] = useState(existing?.categoryId ?? '');
  const [isSubscription, setIsSubscription] = useState(existing?.isSubscription ?? false);

  const amountNum = parseFloat(amount);
  const dueDayNum = dueDay.trim() === '' ? null : parseInt(dueDay, 10);
  const valid = name.trim().length > 0 && Number.isFinite(amountNum) && amountNum > 0;

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        amount: amountNum,
        cadence,
        dueDay: dueDayNum != null && Number.isFinite(dueDayNum) ? dueDayNum : null,
        categoryId: categoryId || null,
        isSubscription,
      };
      return isEdit
        ? api.put(`/api/recurring/${existing!.id}`, body)
        : api.post('/api/recurring', { ...body, source: 'manual' });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recurring'] });
      qc.invalidateQueries({ queryKey: ['recurring', 'audit'] });
      onDone();
      onClose();
    },
  });

  const submit = () => { if (valid && !save.isPending) save.mutate(); };

  return (
    <div className="panel" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="kicker" style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--magenta)' }}>
        <Icon name={isEdit ? 'edit' : 'plus'} size={13} style={{ color: 'var(--magenta)' }} />
        {isEdit ? 'EDIT LEECH' : 'NEW LEECH PROCESS'}
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 2, minWidth: 200 }}>
          <span className="kicker">NAME</span>
          <input
            autoFocus
            placeholder="e.g. Netflix, Rent, Gym"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit(); }}
            style={inputStyle}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 110 }}>
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
            style={inputStyle}
          />
        </label>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 120 }}>
          <span className="kicker">CADENCE</span>
          <select value={cadence} onChange={e => setCadence(e.target.value as Cadence)} style={inputStyle}>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 110 }}>
          <span className="kicker">DUE DAY</span>
          <input
            type="number"
            min="1"
            max="31"
            inputMode="numeric"
            placeholder="optional"
            value={dueDay}
            onChange={e => setDueDay(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 160 }}>
          <span className="kicker">CATEGORY</span>
          <select value={categoryId} onChange={e => setCategoryId(e.target.value)} style={inputStyle}>
            <option value="">— none —</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-dim)' }}>
        <input
          type="checkbox"
          checked={isSubscription}
          onChange={e => setIsSubscription(e.target.checked)}
          style={{ accentColor: 'var(--violet)', width: 16, height: 16 }}
        />
        <span>This is a subscription (include in the audit)</span>
      </label>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {save.isError && (
          <span className="mono" style={{ fontSize: 11, color: 'var(--red)', marginRight: 'auto' }}>
            COULDN&rsquo;T SAVE — TRY AGAIN
          </span>
        )}
        <button className="btn btn-ghost" onClick={onClose} disabled={save.isPending}>CANCEL</button>
        <button className="btn btn-primary" disabled={!valid || save.isPending} onClick={submit}>
          {save.isPending ? (isEdit ? 'SAVING…' : 'ADDING…') : (isEdit ? 'SAVE' : 'ADD BILL')}
        </button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- shared -- */

function SectionLabel({ icon, color, title, sub }: { icon: string; color: string; title: string; sub: string }) {
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
    <span className="ncx-stamp flat" style={{ flexShrink: 0, fontSize: 9.5, color }}>
      {children}
    </span>
  );
}

function Splash({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div className="panel hud" style={{ padding: 40, textAlign: 'center', color: color ?? 'var(--text-faint)' }}>
      <div className="mono" style={{ fontSize: 13, lineHeight: 1.5, maxWidth: 480, margin: '0 auto' }}>
        {children}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
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
