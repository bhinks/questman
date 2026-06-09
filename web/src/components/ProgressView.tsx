/**
 * ProgressView — the "Ledger" / data-shard log (roadmap §8). A
 * chronological record of every XP grant and eddie movement, decoupled
 * from whether the originating task still exists. Player level and the
 * eddie balance are pure functions of these ledgers server-side, so a
 * grant survives the deletion of whatever produced it — this page is the
 * proof of that history.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { LedgerEntry, PlayerStats } from '../lib/api';
import { Icon } from './Icon';

type CurrencyFilter = 'all' | 'xp' | 'eddies';

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

  if (statsQ.isLoading) {
    return <Empty>LOADING…</Empty>;
  }
  if (statsQ.isError || !statsQ.data) {
    return <Empty color="var(--red)">FAILED TO LOAD</Empty>;
  }

  const { player, xpLast7Days, xpLast30Days, completionsLast30Days } = statsQ.data;
  const entries = ledgerQ.data ?? [];

  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div className="panel hud" style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Icon name="layers" size={20} style={{ color: 'var(--cyan)' }} />
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, fontFamily: 'var(--font-display)' }}>Progress · The Ledger</h2>
      </div>

      {/* Summary tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <Stat label="LEVEL" value={player.level} color="var(--cyan)" />
        <Stat label="TOTAL XP" value={player.totalXp.toLocaleString()} color="var(--violet)" />
        <Stat label="EDDIES" value={`€$ ${player.eddies.toLocaleString()}`} color="var(--amber)" />
        <Stat label="XP · 7 DAYS" value={`+${xpLast7Days.toLocaleString()}`} color="var(--lime)" />
        <Stat label="XP · 30 DAYS" value={`+${xpLast30Days.toLocaleString()}`} color="var(--lime)" />
        <Stat label="QUESTS · 30 DAYS" value={completionsLast30Days} color="var(--text)" />
      </div>

      {/* Level progress bar */}
      <div className="panel" style={{ padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span className="kicker">LEVEL {player.level} → {player.level + 1}</span>
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            {player.xpIntoLevel} / {player.xpForNextLevel} XP
          </span>
        </div>
        <div style={{ height: 10, borderRadius: 5, background: 'var(--panel-2)', border: '1px solid var(--line)', overflow: 'hidden' }}>
          <div style={{
            width: `${Math.round(player.progress * 100)}%`, height: '100%',
            background: 'linear-gradient(90deg, var(--cyan), var(--violet))',
            boxShadow: '0 0 8px rgba(28,226,255,0.5)', transition: 'width 0.5s ease',
          }} />
        </div>
        <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-faint)', marginTop: 6 }}>
          CURVE: xpForLevel(n) = 100 · (n−1)^1.5
        </div>
      </div>

      {/* Ledger feed */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="kicker">DATA-SHARD LOG</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {(['all', 'xp', 'eddies'] as CurrencyFilter[]).map(c => (
              <button
                key={c}
                onClick={() => setCurrency(c)}
                className="mono"
                style={{
                  fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                  letterSpacing: '0.06em',
                  border: currency === c ? '1px solid var(--cyan)' : '1px solid var(--line-2)',
                  background: currency === c ? 'color-mix(in srgb, var(--cyan) 14%, transparent)' : 'var(--panel-2)',
                  color: currency === c ? 'var(--cyan)' : 'var(--text-dim)',
                }}
              >
                {c.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {ledgerQ.isLoading ? (
          <Empty>LOADING LEDGER…</Empty>
        ) : entries.length === 0 ? (
          <Empty>No entries yet — complete a quest to bank your first grant.</Empty>
        ) : (
          <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
            {entries.map((e, i) => (
              <LedgerRow key={e.id} entry={e} last={i === entries.length - 1} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: React.ReactNode; color: string }) {
  return (
    <div className="panel-inset" style={{ padding: 14, textAlign: 'center' }}>
      <div className="kicker" style={{ marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color, fontFamily: 'var(--font-display)' }}>{value}</div>
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

function LedgerRow({ entry, last }: { entry: LedgerEntry; last: boolean }) {
  const positive = entry.amount >= 0;
  const isEddies = entry.currency === 'eddies';
  const when = new Date(entry.createdAt);
  const sign = positive ? '+' : '−';
  const amount = Math.abs(entry.amount);
  const unit = isEddies ? '€$' : 'XP';
  const amtColor = !positive ? 'var(--red)' : isEddies ? 'var(--amber)' : 'var(--lime)';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 16px',
      borderBottom: last ? 'none' : '1px solid var(--line)',
    }}>
      <div className="mono" style={{
        fontSize: 9.5, padding: '2px 6px', borderRadius: 4, letterSpacing: '0.06em',
        color: isEddies ? 'var(--amber)' : 'var(--violet)',
        background: `color-mix(in srgb, ${isEddies ? 'var(--amber)' : 'var(--violet)'} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${isEddies ? 'var(--amber)' : 'var(--violet)'} 30%, transparent)`,
        flexShrink: 0, width: 44, textAlign: 'center',
      }}>
        {unit}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
          {REASON_LABELS[entry.reason] ?? entry.reason}
          {entry.module && (
            <span className="mono" style={{ fontSize: 10, color: 'var(--text-faint)', marginLeft: 8 }}>
              {entry.module.toUpperCase()}
            </span>
          )}
        </div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          {when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
      <div className="mono" style={{ fontSize: 14, fontWeight: 700, color: amtColor, flexShrink: 0 }}>
        {entry.reason === 'level_up' ? '★' : `${sign}${amount.toLocaleString()}`}
      </div>
    </div>
  );
}

function Empty({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div className="panel hud" style={{ padding: 40, textAlign: 'center', color: color ?? 'var(--text-faint)' }}>
      <div className="mono" style={{ fontSize: 13 }}>{children}</div>
    </div>
  );
}
