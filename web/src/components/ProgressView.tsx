/**
 * ProgressView — "Street Cred" (NIGHT CITY direction).
 *
 * The ANALYTICS view: XP velocity (12 ISO weeks bucketed client-side from
 * the XP ledger), XP by module (domainXp), a 7×17 activity grid (completed
 * quests per local day, last 119 days), and the original "data-shard log" —
 * the combined XP/eddie ledger feed (roadmap §8), styled as a terminal.
 * (The cred strip + badge wall live on the Street Cred page, per Brent.)
 * Level and balances are pure functions of these ledgers server-side, so a
 * grant survives the deletion of whatever produced it.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { LedgerEntry, PlayerStats } from '../lib/api';

type CurrencyFilter = 'all' | 'xp' | 'eddies';

const WEEKS = 12;          // XP velocity window
const GRID_DAYS = 119;     // 7 × 17 activity cells
const WEEK_MS = 7 * 86400000;

/** Module accent colors for the XP BY MODULE meters. */
const MODULE_COLORS: Record<string, string> = {
  fitness:  'var(--lime)',
  finance:  'var(--cyan)',
  habits:   'var(--violet)',
  chores:   'var(--teal)',
  projects: 'var(--blue)',
  media:    'var(--pink)',
  vitals:   'var(--lime)',
  social:   'var(--magenta)',
};

/** mono 10px / 0.26em section header style (design-system standard). */
const SECTION: React.CSSProperties = {
  fontSize: 10, letterSpacing: '0.26em', color: 'var(--text-dim)', textTransform: 'uppercase',
};

/** Local midnight of the Monday starting d's ISO week. */
function weekStart(d: Date): number {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x.getTime();
}

/** Local-day bucket key. */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

interface HistoryQuest { id: string; questDate: string; status: string; }

export function ProgressView() {
  const [currency, setCurrency] = useState<CurrencyFilter>('all');

  const statsQ = useQuery({
    queryKey: ['player', 'stats'],
    queryFn: () => api.get<PlayerStats>('/api/player/stats'),
  });

  const ledgerQ = useQuery({
    queryKey: ['player', 'ledger', currency],
    queryFn: () => api.get<{ entries: LedgerEntry[] }>(`/api/player/ledger?currency=${currency}&limit=500`)
      .then(r => r.entries),
  });

  // XP-only ledger for the 12-week velocity chart (bucketed client-side).
  const xpQ = useQuery({
    queryKey: ['player', 'ledger', 'xp', 'velocity'],
    queryFn: () => api.get<{ entries: LedgerEntry[] }>('/api/player/ledger?currency=xp&limit=1000')
      .then(r => r.entries),
  });

  // Completed quests per local day for the activity grid.
  const histQ = useQuery({
    queryKey: ['quests', 'history', 'grid'],
    queryFn: () => {
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (GRID_DAYS - 1)).toISOString();
      return api.get<{ quests: HistoryQuest[] }>(
        `/api/quests/history?from=${from}&to=${now.toISOString()}&limit=500`,
      ).then(r => r.quests);
    },
  });

  // ---- derived: weekly XP velocity (sum of positive grants per ISO week) ----
  const weekly = useMemo(() => {
    const buckets = new Array<number>(WEEKS).fill(0);
    const current = weekStart(new Date());
    for (const e of xpQ.data ?? []) {
      if (e.amount <= 0) continue;
      const idx = (WEEKS - 1) - Math.round((current - weekStart(new Date(e.createdAt))) / WEEK_MS);
      if (idx >= 0 && idx < WEEKS) buckets[idx] += e.amount;
    }
    return buckets;
  }, [xpQ.data]);

  // ---- derived: activity heat cells, oldest first (today = last cell) ----
  const cells = useMemo(() => {
    const counts = new Map<string, number>();
    for (const q of histQ.data ?? []) {
      if (q.status !== 'completed') continue;
      const k = dayKey(new Date(q.questDate));
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const out: number[] = [];
    const now = new Date();
    for (let i = GRID_DAYS - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      out.push(Math.min(4, counts.get(dayKey(d)) ?? 0));
    }
    return out;
  }, [histQ.data]);

  if (statsQ.isLoading) {
    return <Empty>LOADING…</Empty>;
  }
  if (statsQ.isError || !statsQ.data) {
    return <Empty color="var(--red)">FAILED TO LOAD</Empty>;
  }

  const { player } = statsQ.data;
  const entries = ledgerQ.data ?? [];

  const maxWeek = Math.max(...weekly, 1);
  const domain = Object.entries(player.domainXp).sort((a, b) => b[1] - a[1]);
  const maxDomain = Math.max(...domain.map(([, xp]) => xp), 1);

  return (
    <div className="qm-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* (The cred strip + badge wall live on the Street Cred page — this
          screen is the analytics view: velocity, modules, activity, ledger.) */}

      {/* ---- two-up: XP velocity / XP by module ---- */}
      <div className="split-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="ncx-panel" style={{ padding: 20 }}>
          <div className="mono" style={{ ...SECTION, marginBottom: 16 }}>XP VELOCITY — {WEEKS}W</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 7, height: 110 }}>
            {weekly.map((v, i) => {
              const last = i === weekly.length - 1;
              return (
                <div key={i} style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end' }}>
                  <div style={{
                    width: '100%',
                    height: `${(v / maxWeek) * 100}%`,
                    background: last ? 'linear-gradient(180deg, var(--cyan), var(--cyan-deep))' : '#181b2e',
                    boxShadow: last ? '0 0 16px rgba(var(--accent-rgb),0.4)' : 'inset 0 0 0 1px var(--line)',
                    clipPath: 'polygon(0 5px, 100% 0, 100% 100%, 0 100%)',
                  }} />
                </div>
              );
            })}
          </div>
          <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-ghost)', marginTop: 8, letterSpacing: '0.14em' }}>
            <span>W-{WEEKS}</span>
            <span style={{ color: 'var(--cyan)' }}>THIS WEEK {weekly[WEEKS - 1].toLocaleString()} XP ▴</span>
          </div>
        </div>

        <div className="ncx-panel" style={{ padding: 20 }}>
          <div className="mono" style={{ ...SECTION, marginBottom: 16 }}>XP BY MODULE</div>
          {domain.length === 0 ? (
            <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-faint)', letterSpacing: '0.14em' }}>
              NO MODULE XP BANKED YET
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              {domain.map(([mod, xp]) => (
                <div key={mod} style={{ display: 'grid', gridTemplateColumns: '72px 1fr 56px', gap: 12, alignItems: 'center' }}>
                  <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.16em', color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                    {mod}
                  </span>
                  <div className="ncx-bar slim">
                    <i style={{ width: `${(xp / maxDomain) * 100}%`, background: MODULE_COLORS[mod] ?? 'var(--cyan)', opacity: 0.9 }} />
                    <span className="seg-mask" />
                  </div>
                  <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-dim)', textAlign: 'right' }}>
                    {xp.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ---- activity grid ---- */}
      <div className="ncx-panel" style={{ padding: 20 }}>
        <div style={{ display: 'flex', marginBottom: 14 }}>
          <span className="mono" style={SECTION}>ACTIVITY GRID — 17W</span>
          <span style={{ flex: 1 }} />
          <span className="mono" style={{ fontSize: 10, color: 'var(--lime)' }}>
            STREAK {player.currentStreak}D ▰▰▰
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateRows: 'repeat(7, auto)', gridAutoFlow: 'column', gap: 3, justifyContent: 'start' }}>
          {cells.map((v, i) => <div key={i} className={'ncx-cell' + (v ? ` l${v}` : '')} />)}
        </div>
      </div>

      {/* ---- data-shard log (combined XP / eddie ledger feed) ---- */}
      <div className="ncx-panel" style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <span className="mono" style={SECTION}>DATA-SHARD LOG</span>
          <span className="ncx-serial" style={{ marginLeft: 10 }}>LEDGER // SOURCE OF TRUTH</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {(['all', 'xp', 'eddies'] as CurrencyFilter[]).map(c => {
              const active = currency === c;
              return (
                <button
                  key={`${c}-${active}`}
                  onClick={() => setCurrency(c)}
                  className={'ncx-btn' + (active ? ' primary' : '')}
                  style={{ fontSize: 10, padding: '5px 13px', letterSpacing: '0.14em' }}
                >
                  {c.toUpperCase()}
                </button>
              );
            })}
          </div>
        </div>

        {ledgerQ.isLoading ? (
          <div className="ncx-term">&gt; READING LEDGER…</div>
        ) : entries.length === 0 ? (
          <div className="ncx-term">&gt; NO ENTRIES YET — COMPLETE A QUEST TO BANK YOUR FIRST GRANT.</div>
        ) : (
          <div className="ncx-term" style={{ maxHeight: 440, overflowY: 'auto' }}>
            {entries.map(e => <TermRow key={e.id} entry={e} />)}
            <span className="cursor-blink cy">▌</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Human-friendly label for a ledger `reason`. */
const REASON_LABELS: Record<string, string> = {
  quest_complete: 'Quest cleared',
  habit_log: 'Habit logged',
  habit_log_undo: 'Habit undone',
  workout_log: 'Workout logged',
  streak_bonus: 'Streak bonus',
  level_up: 'Level up',
  shop_purchase: 'Shop purchase',
};

function TermRow({ entry }: { entry: LedgerEntry }) {
  const positive = entry.amount >= 0;
  const isEddies = entry.currency === 'eddies';
  const when = new Date(entry.createdAt);
  const stamp = when.toLocaleDateString(undefined, { month: 'short', day: '2-digit' }).toUpperCase()
    + ' ' + when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  const amtColor = !positive ? 'var(--red)' : isEddies ? 'var(--amber)' : 'var(--lime)';

  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, whiteSpace: 'nowrap' }}>
      <span style={{ color: 'var(--text-ghost)' }}>&gt; {stamp}</span>
      <span style={{ color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {(REASON_LABELS[entry.reason] ?? entry.reason).toUpperCase()}
        {entry.module && <span style={{ color: 'var(--text-ghost)' }}>{' // ' + entry.module.toUpperCase()}</span>}
      </span>
      <span style={{ marginLeft: 'auto', color: amtColor }}>
        {entry.reason === 'level_up'
          ? '▲ LVL'
          : `${positive ? '+' : '−'}${Math.abs(entry.amount).toLocaleString()} ${isEddies ? '€$' : 'XP'}`}
      </span>
    </div>
  );
}

function Empty({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div className="ncx-panel focal" style={{ padding: 40, textAlign: 'center', color: color ?? 'var(--text-faint)' }}>
      <div className="mono" style={{ fontSize: 13 }}>{children}</div>
    </div>
  );
}
