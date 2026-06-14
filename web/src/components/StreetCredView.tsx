/**
 * StreetCredView — the consolidated "STREET CRED" page (merges the old
 * Progress analytics view + the Achievements badge wall into one progression
 * command center).
 *
 * Laid out as a dashboard, not a scroll:
 *   CRED STRIP (full)          — level hex, XP→next-level bar, and tallies
 *                                (TOTAL XP / EDDIES / STREAK / BADGES) + a
 *                                cred-completion bar. The shared identity header.
 *   ANALYTICS + LEDGER (.pdash) — left: XP VELOCITY + XP BY MODULE (2-up) then
 *                                the ACTIVITY GRID + a consistency readout;
 *                                right: the DATA-SHARD LOG (ledger) with an
 *                                ALL/XP/EDDIES filter and a capped scroll.
 *   BADGE WALL (full, .bwall)   — the achievements grid with an
 *                                ALL/UNLOCKED/IN-PROGRESS filter.
 *
 * All data contracts are preserved — every endpoint the two old pages called is
 * reused. The achievements GET evaluates + may unlock lazily, paying XP/eddies,
 * so after it loads we invalidate ['player'] (prefix-matches stats + ledger too)
 * to keep the cred strip honest. Design system only (.panel/.ncx-panel,
 * .ncx-bar/.slim/.seg-mask, .ncx-cell/.l1–.l4, .ncx-hex, .ncx-term, .ncx-val,
 * .pdash/.pcol/.p2up/.bwall + CSS color vars). Never hardcodes hex.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type {
  Achievement,
  AchievementsResponse,
  LedgerEntry,
  PlayerStats,
  PlayerSnapshot,
} from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { TITLE_META } from '../lib/market';
import { Icon } from './Icon';

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

export function StreetCredView() {
  const qc = useQueryClient();
  const { user } = useAuth();
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

  const achQ = useQuery({
    queryKey: ['achievements'],
    queryFn: () => api.get<AchievementsResponse>('/api/achievements'),
  });

  // The achievements GET evaluates lazily and may have just unlocked + paid
  // out badges; refresh everything player-derived (prefix match covers
  // ['player','stats'] + ['player','ledger',...]) so the cred strip stays honest.
  useEffect(() => {
    if (achQ.data) qc.invalidateQueries({ queryKey: ['player'] });
  }, [achQ.data, qc]);

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

  if (statsQ.isLoading) return <Empty>LOADING…</Empty>;
  if (statsQ.isError || !statsQ.data) return <Empty color="var(--red)">FAILED TO LOAD</Empty>;

  const { player } = statsQ.data;
  const handle = (user?.name || user?.email?.split('@')[0] || 'RUNNER').toUpperCase();
  const titleName = player.equippedTitle ? TITLE_META[player.equippedTitle]?.name ?? 'RUNNER-01' : 'RUNNER-01';
  const unlockedCount = achQ.data?.unlockedCount ?? 0;
  const totalCount = achQ.data?.totalCount ?? 0;

  return (
    <div className="qm-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <CredStrip player={player} handle={handle} titleName={titleName} unlockedCount={unlockedCount} totalCount={totalCount} />

      <div className="pdash">
        <div className="pcol">
          <div className="p2up">
            <VelocityPanel weekly={weekly} />
            <ModulesPanel domainXp={player.domainXp} />
          </div>
          <ActivityPanel cells={cells} streak={player.currentStreak} />
        </div>
        <LedgerPanel
          entries={ledgerQ.data ?? []}
          currency={currency}
          setCurrency={setCurrency}
          loading={ledgerQ.isLoading}
        />
      </div>

      <BadgeWall
        achievements={achQ.data?.achievements ?? []}
        unlockedCount={unlockedCount}
        totalCount={totalCount}
        loading={achQ.isLoading}
        error={achQ.isError}
      />
    </div>
  );
}

/* ----------------------------------------------------------------- shared -- */

function PanelHead({
  icon, color, title, sub, right,
}: { icon?: string; color?: string; title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {icon && <Icon name={icon} size={14} style={{ color: color ?? 'var(--text-dim)' }} />}
      <span className="mono" style={{ ...SECTION, color: color ?? 'var(--text-dim)' }}>{title}</span>
      {sub && <span className="ncx-serial">{sub}</span>}
      {right && (
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {right}
        </span>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- cred strip -- */

function Tally({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
      <span className="ncx-serial">{label}</span>
      <span className="ncx-val" style={{ fontSize: 19, color: color ?? 'var(--text)' }}>{value}</span>
    </div>
  );
}

function CredStrip({
  player, handle, titleName, unlockedCount, totalCount,
}: {
  player: PlayerSnapshot;
  handle: string;
  titleName: string;
  unlockedCount: number;
  totalCount: number;
}) {
  const pctLevel = Math.min(100, (player.xpIntoLevel / Math.max(1, player.xpForNextLevel)) * 100);
  const badgePct = totalCount ? Math.round((unlockedCount / totalCount) * 100) : 0;
  return (
    <div className="panel hud ncx-scan" style={{ padding: 20, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="sweep" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        <div className="ncx-hex" style={{ width: 58, height: 58, fontSize: 22, flex: 'none' }}>{player.level}</div>
        <div style={{ minWidth: 220, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 className="ncx-glitch ncx-chroma" style={{ fontSize: 22, fontWeight: 700, margin: 0, fontFamily: 'var(--font-display)', letterSpacing: '0.03em', textTransform: 'uppercase' }}>STREET CRED</h2>
            <span className="mono" style={{ fontSize: 10.5, letterSpacing: '0.14em', color: 'var(--text-faint)' }}>{handle} // {titleName}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
            <span className="mono" style={{ fontSize: 9.5, color: 'var(--text-faint)', letterSpacing: '0.12em' }}>LVL {player.level}</span>
            <div className="ncx-bar" style={{ flex: 1 }}>
              <i style={{ width: `${pctLevel}%`, background: 'linear-gradient(90deg, var(--cyan-deep), var(--cyan))', boxShadow: '0 0 12px rgba(var(--accent-rgb),0.4)' }} />
              <span className="seg-mask" />
            </div>
            <span className="mono" style={{ fontSize: 9.5, color: 'var(--text-faint)', letterSpacing: '0.12em' }}>LVL {player.level + 1}</span>
            <span className="mono" style={{ fontSize: 10, color: 'var(--cyan)', minWidth: 86, textAlign: 'right' }}>{player.xpIntoLevel} / {player.xpForNextLevel} XP</span>
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 14, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
        <Tally label="TOTAL XP" value={player.totalXp.toLocaleString()} color="var(--cyan)" />
        <Tally label="EDDIES" value={`€$${player.eddies.toLocaleString()}`} color="var(--amber)" />
        <Tally label="STREAK" value={`${player.currentStreak}D`} color="var(--lime)" />
        <Tally label="BADGES" value={`${unlockedCount} / ${totalCount}`} color="var(--violet)" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, justifyContent: 'center' }}>
          <span className="ncx-serial">CRED COMPLETION</span>
          <div className="ncx-bar slim">
            <i style={{ width: `${badgePct}%`, background: 'linear-gradient(90deg, var(--amber), var(--cyan))' }} />
            <span className="seg-mask" />
          </div>
          <span className="mono" style={{ fontSize: 9.5, color: 'var(--text-faint)', textAlign: 'right' }}>{badgePct}%</span>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- analytics -- */

function VelocityPanel({ weekly }: { weekly: number[] }) {
  const max = Math.max(...weekly, 1);
  return (
    <div className="ncx-panel" style={{ padding: 18 }}>
      <PanelHead title={`XP VELOCITY — ${weekly.length}W`} />
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 7, height: 108, marginTop: 16 }}>
        {weekly.map((v, i) => {
          const last = i === weekly.length - 1;
          return (
            <div key={i} style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end' }}>
              <div style={{
                width: '100%', height: `${(v / max) * 100}%`,
                background: last ? 'linear-gradient(180deg, var(--cyan), var(--cyan-deep))' : '#181b2e',
                boxShadow: last ? '0 0 16px rgba(var(--accent-rgb),0.4)' : 'inset 0 0 0 1px var(--line)',
                clipPath: 'polygon(0 5px, 100% 0, 100% 100%, 0 100%)',
              }} />
            </div>
          );
        })}
      </div>
      <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-ghost)', marginTop: 8, letterSpacing: '0.14em' }}>
        <span>W-{weekly.length}</span>
        <span style={{ color: 'var(--cyan)' }}>THIS WEEK {weekly[weekly.length - 1].toLocaleString()} XP ▴</span>
      </div>
    </div>
  );
}

function ModulesPanel({ domainXp }: { domainXp: Record<string, number> }) {
  const domain = Object.entries(domainXp).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...domain.map(([, xp]) => xp), 1);
  return (
    <div className="ncx-panel" style={{ padding: 18 }}>
      <PanelHead title="XP BY MODULE" />
      {domain.length === 0 ? (
        <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-faint)', letterSpacing: '0.14em', marginTop: 16 }}>
          NO MODULE XP BANKED YET
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
          {domain.map(([mod, xp]) => (
            <div key={mod} style={{ display: 'grid', gridTemplateColumns: '70px 1fr 52px', gap: 12, alignItems: 'center' }}>
              <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.14em', color: 'var(--text-dim)', textTransform: 'uppercase' }}>{mod}</span>
              <div className="ncx-bar slim">
                <i style={{ width: `${(xp / max) * 100}%`, background: MODULE_COLORS[mod] ?? 'var(--cyan)', opacity: 0.9 }} />
                <span className="seg-mask" />
              </div>
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-dim)', textAlign: 'right' }}>{xp.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActivityReadout({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span className="ncx-serial">{label}</span>
      <span className="ncx-val" style={{ fontSize: 18, color: color ?? 'var(--text)' }}>{value}</span>
    </div>
  );
}

function ActivityPanel({ cells, streak }: { cells: number[]; streak: number }) {
  const stats = useMemo(() => {
    const active = cells.filter(v => v > 0).length;
    const rest = cells.length - active;
    const busiest = Math.max(0, ...cells);
    let longest = 0, run = 0;
    for (let i = 0; i < cells.length; i++) { if (cells[i] > 0) { run++; longest = Math.max(longest, run); } else run = 0; }
    const consistency = cells.length ? Math.round((active / cells.length) * 100) : 0;
    return { active, rest, busiest, longest: Math.max(longest, streak), consistency };
  }, [cells, streak]);

  return (
    <div className="ncx-panel" style={{ padding: 18 }}>
      <PanelHead title="ACTIVITY GRID — 17W" right={<span className="mono" style={{ fontSize: 10, color: 'var(--lime)' }}>STREAK {streak}D ▰▰▰</span>} />
      <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap', marginTop: 16, alignItems: 'flex-start' }}>
        {/* heat grid */}
        <div style={{ display: 'grid', gridTemplateRows: 'repeat(7, 1fr)', gridAutoFlow: 'column', gap: 3, justifyContent: 'start', flex: 'none' }}>
          {cells.map((v, i) => <div key={i} className={'ncx-cell' + (v ? ` l${v}` : '')} />)}
        </div>
        {/* consistency readout — fills the space beside the grid */}
        <div style={{ flex: 1, minWidth: 220, display: 'flex', flexDirection: 'column', gap: 16, alignSelf: 'stretch' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="ncx-serial">LESS</span>
            {[0, 1, 2, 3, 4].map(l => <div key={l} className={'ncx-cell' + (l ? ` l${l}` : '')} />)}
            <span className="ncx-serial">MORE</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(86px, 1fr))', gap: 14 }}>
            <ActivityReadout label="ACTIVE DAYS" value={stats.active} color="var(--lime)" />
            <ActivityReadout label="REST DAYS" value={stats.rest} color="var(--text-dim)" />
            <ActivityReadout label="CONSISTENCY" value={`${stats.consistency}%`} color="var(--cyan)" />
            <ActivityReadout label="CURRENT RUN" value={`${streak}D`} color="var(--lime)" />
            <ActivityReadout label="LONGEST RUN" value={`${stats.longest}D`} color="var(--violet)" />
            <ActivityReadout label="PEAK DAY" value={`${stats.busiest}×`} color="var(--amber)" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- data-shard ledger -- */

const REASON_LABELS: Record<string, string> = {
  quest_complete: 'Quest cleared',
  quest_progress: 'Quest progress',
  habit_log: 'Habit logged',
  habit_log_undo: 'Habit undone',
  workout_log: 'Workout logged',
  streak_bonus: 'Streak bonus',
  level_up: 'Level up',
  shop_purchase: 'Shop purchase',
  boss_defeat: 'Target flatlined',
  achievement: 'Badge unlocked',
  anti_goal_clean: 'Clean day',
};

/** Habits and chores share the 'habit_log' reason — the module column tells
 *  them apart. */
function reasonLabel(entry: LedgerEntry): string {
  if (entry.module === 'chores') {
    if (entry.reason === 'habit_log') return 'Chore logged';
    if (entry.reason === 'habit_log_undo') return 'Chore undone';
  }
  return REASON_LABELS[entry.reason] ?? entry.reason;
}

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
        {reasonLabel(entry).toUpperCase()}
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

function LedgerPanel({
  entries, currency, setCurrency, loading,
}: {
  entries: LedgerEntry[];
  currency: CurrencyFilter;
  setCurrency: (c: CurrencyFilter) => void;
  loading: boolean;
}) {
  return (
    <div className="ncx-panel" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
      <PanelHead
        title="DATA-SHARD LOG"
        sub="LEDGER // SOURCE OF TRUTH"
        right={(['all', 'xp', 'eddies'] as CurrencyFilter[]).map(c => {
          const active = currency === c;
          return (
            <button
              key={`${c}-${active}`}
              onClick={() => setCurrency(c)}
              className={'ncx-btn' + (active ? ' primary' : '')}
              style={{ fontSize: 9.5, padding: '4px 11px', letterSpacing: '0.14em' }}
            >
              {c.toUpperCase()}
            </button>
          );
        })}
      />
      {loading ? (
        <div className="ncx-term">&gt; READING LEDGER…</div>
      ) : entries.length === 0 ? (
        <div className="ncx-term">&gt; NO ENTRIES YET — COMPLETE A QUEST TO BANK YOUR FIRST GRANT.</div>
      ) : (
        <div className="ncx-term noscroll" style={{ maxHeight: 470, overflowY: 'auto', flex: 1 }}>
          {entries.map(e => <TermRow key={e.id} entry={e} />)}
          <span className="cursor-blink cy">▌</span>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ badges -- */

type Tier = NonNullable<Achievement['tier']>;
const TIER_LABEL: Record<Tier, string> = {
  bronze: 'BRONZE', silver: 'SILVER', gold: 'GOLD', platinum: 'PLATINUM',
};

/** Tier glow color for unlocked cards (bronze is a dimmer amber than gold). */
function tierColor(tier: Tier): string {
  switch (tier) {
    case 'bronze':   return 'color-mix(in srgb, var(--amber) 65%, var(--text-faint))';
    case 'silver':   return 'var(--text-dim)';
    case 'gold':     return 'var(--amber)';
    case 'platinum': return 'var(--cyan)';
  }
}

function BadgeChip({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span
      className="mono"
      style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', color,
        padding: '2px 7px',
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
      }}
    >
      {children}
    </span>
  );
}

function AchCard({ a }: { a: Achievement }) {
  const tier = (a.tier ?? 'bronze') as Tier;
  const color = tierColor(tier);
  const unlocked = a.unlocked;
  const progress = Math.max(0, Math.min(1, a.progress ?? 0));
  return (
    <div
      className="panel"
      style={{
        position: 'relative', padding: 16, display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden',
        borderColor: unlocked ? `color-mix(in srgb, ${color} 55%, transparent)` : undefined,
        background: unlocked
          ? `linear-gradient(180deg, color-mix(in srgb, ${color} 10%, transparent), color-mix(in srgb, ${color} 3%, transparent)), #0b0c16`
          : undefined,
        opacity: unlocked ? 1 : 0.62,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{
          width: 42, height: 42, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          clipPath: 'polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)',
          color: unlocked ? color : 'var(--text-ghost)',
          background: unlocked ? `linear-gradient(150deg, color-mix(in srgb, ${color} 32%, #0b0c16), #0b0c16)` : '#10121f',
        }}>
          <Icon name={unlocked ? a.icon : 'lock'} size={18} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: unlocked ? 'var(--text)' : 'var(--text-dim)' }}>{a.name}</div>
          <div style={{ marginTop: 5 }}>
            <span className="ncx-stamp flat" style={{ color, fontSize: 8 }}>{TIER_LABEL[tier]}</span>
          </div>
        </div>
        {unlocked && <Icon name="check" size={16} style={{ color, flexShrink: 0 }} />}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.4 }}>{a.description}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {a.xpReward != null && a.xpReward > 0 && <BadgeChip color="var(--violet)">+{a.xpReward.toLocaleString()} XP</BadgeChip>}
        {a.eddieReward != null && a.eddieReward > 0 && <BadgeChip color="var(--amber)">+{a.eddieReward.toLocaleString()} €$</BadgeChip>}
      </div>
      {unlocked ? (
        a.unlockedAt && (
          <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 9.5, letterSpacing: '0.14em', color: 'var(--lime)', marginTop: 'auto' }}>
            <Icon name="check" size={10} /> UNLOCKED {new Date(a.unlockedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
          </div>
        )
      ) : (
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="ncx-bar slim">
            <i style={{ width: `${Math.round(progress * 100)}%`, background: `linear-gradient(90deg, color-mix(in srgb, ${color} 70%, transparent), ${color})`, opacity: 0.85 }} />
            <span className="seg-mask" />
          </div>
          {a.progressLabel && <div className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>{a.progressLabel}</div>}
        </div>
      )}
    </div>
  );
}

function BadgeWall({
  achievements, unlockedCount, totalCount, loading, error,
}: {
  achievements: Achievement[];
  unlockedCount: number;
  totalCount: number;
  loading: boolean;
  error: boolean;
}) {
  const [filter, setFilter] = useState<'all' | 'unlocked' | 'locked'>('all');
  const shown = achievements.filter(a => filter === 'all' || (filter === 'unlocked' ? a.unlocked : !a.unlocked));
  const FILTERS: [typeof filter, string][] = [
    ['all', `ALL ${totalCount}`],
    ['unlocked', `UNLOCKED ${unlockedCount}`],
    ['locked', `IN PROGRESS ${totalCount - unlockedCount}`],
  ];
  return (
    <div className="panel" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PanelHead
        icon="trophy"
        color="var(--amber)"
        title="BADGE WALL"
        sub="reputation earned across the grid"
        right={FILTERS.map(([k, label]) => {
          const active = filter === k;
          return (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className="mono"
              style={{
                fontSize: 10, padding: '5px 11px', letterSpacing: '0.06em', cursor: 'pointer', borderRadius: 0,
                border: active ? '1px solid rgba(var(--accent-rgb),0.55)' : '1px solid var(--line-2)',
                background: active ? 'rgba(var(--accent-rgb),0.12)' : 'var(--panel-2)',
                color: active ? 'var(--cyan)' : 'var(--text-dim)',
              }}
            >
              {label}
            </button>
          );
        })}
      />
      {loading ? (
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-faint)' }}>READING STREET CRED…</div>
      ) : error ? (
        <div className="mono" style={{ fontSize: 12, color: 'var(--red)' }}>FAILED TO LOAD STREET CRED</div>
      ) : achievements.length === 0 ? (
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-faint)' }}>No achievements wired yet.</div>
      ) : (
        <div className="bwall">
          {shown.map(a => <AchCard key={a.key} a={a} />)}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ shared -- */

function Empty({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div className="ncx-panel focal" style={{ padding: 40, textAlign: 'center', color: color ?? 'var(--text-faint)' }}>
      <div className="mono" style={{ fontSize: 13 }}>{children}</div>
    </div>
  );
}
