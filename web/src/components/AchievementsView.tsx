/**
 * AchievementsView — "Street Cred", the trophy wall.
 *
 * Shows every achievement in the fixed catalog with its unlocked state and,
 * for locked ones, a progress bar + label toward the next unlock. Unlocks
 * are evaluated server-side (lazily, on GET /api/player and on this fetch)
 * and bank XP/eddies — so after loading this view we invalidate ['player']
 * to refresh the HUD in case the fetch itself unlocked something.
 *
 * Design system only: .panel / .panel-inset / .hud / kicker / mono and CSS
 * vars. Unlocked cards glow in their tier color; locked cards dim with a
 * lock overlay + progress bar.
 */
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Achievement, AchievementsResponse } from '../lib/api';
import { Icon } from './Icon';

type Tier = NonNullable<Achievement['tier']>;

const TIER_META: Record<Tier, { label: string; color: string }> = {
  bronze:   { label: 'BRONZE',   color: 'var(--amber)' },
  silver:   { label: 'SILVER',   color: 'var(--text-dim)' },
  gold:     { label: 'GOLD',     color: 'var(--amber)' },
  platinum: { label: 'PLATINUM', color: 'var(--cyan)' },
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

export function AchievementsView() {
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ['achievements'],
    queryFn: () => api.get<AchievementsResponse>('/api/achievements'),
  });

  // The GET evaluates lazily and may have just unlocked + paid out
  // achievements; refresh the HUD / equipped-theme so balances stay honest.
  useEffect(() => {
    if (q.data) qc.invalidateQueries({ queryKey: ['player'] });
  }, [q.data, qc]);

  if (q.isLoading) return <Empty>READING STREET CRED…</Empty>;
  if (q.isError || !q.data) return <Empty color="var(--red)">FAILED TO LOAD STREET CRED</Empty>;

  const { achievements, unlockedCount, totalCount } = q.data;
  const pct = totalCount > 0 ? Math.round((unlockedCount / totalCount) * 100) : 0;

  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <Header unlocked={unlockedCount} total={totalCount} pct={pct} />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: 14,
        }}
      >
        {achievements.map(a => <Card key={a.key} a={a} />)}
      </div>

      {achievements.length === 0 && (
        <Empty>No achievements wired yet.</Empty>
      )}
    </div>
  );
}

function Header({ unlocked, total, pct }: { unlocked: number; total: number; pct: number }) {
  return (
    <div className="panel hud" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Icon name="trophy" size={20} style={{ color: 'var(--amber)' }} />
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, fontFamily: 'var(--font-display)' }}>Street Cred</h2>
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
            reputation earned across the grid
          </div>
        </div>
        <div
          className="mono"
          style={{
            marginLeft: 'auto', fontSize: 11, color: 'var(--text-dim)',
            padding: '4px 8px', background: 'var(--panel-2)',
            borderRadius: 6, border: '1px solid var(--line)',
          }}
        >
          {unlocked} / {total} UNLOCKED
        </div>
      </div>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span className="kicker">COMPLETION</span>
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>{pct}%</span>
        </div>
        <div style={{ height: 10, borderRadius: 5, background: 'var(--panel-2)', border: '1px solid var(--line)', overflow: 'hidden' }}>
          <div style={{
            width: `${pct}%`, height: '100%',
            background: 'linear-gradient(90deg, var(--amber), var(--cyan))',
            boxShadow: '0 0 8px rgba(255,196,61,0.4)', transition: 'width 0.5s ease',
          }} />
        </div>
      </div>
    </div>
  );
}

function Card({ a }: { a: Achievement }) {
  const tier = (a.tier ?? 'bronze') as Tier;
  const color = tierColor(tier);
  const unlocked = a.unlocked;
  const progress = Math.max(0, Math.min(1, a.progress ?? 0));

  return (
    <div
      className="panel"
      style={{
        position: 'relative',
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        overflow: 'hidden',
        border: unlocked ? `1px solid ${color}` : '1px solid var(--line)',
        background: unlocked
          ? `linear-gradient(180deg, color-mix(in srgb, ${color} 10%, transparent), color-mix(in srgb, ${color} 3%, transparent))`
          : 'var(--panel)',
        boxShadow: unlocked ? `0 0 14px color-mix(in srgb, ${color} 22%, transparent)` : undefined,
        opacity: unlocked ? 1 : 0.78,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div
          style={{
            width: 42, height: 42, borderRadius: 8, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: unlocked ? color : 'var(--text-faint)',
            background: unlocked
              ? `color-mix(in srgb, ${color} 14%, transparent)`
              : 'var(--panel-2)',
            border: `1px solid ${unlocked ? `color-mix(in srgb, ${color} 40%, transparent)` : 'var(--line)'}`,
          }}
        >
          <Icon name={unlocked ? a.icon : 'lock'} size={20} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14, fontWeight: 600,
            color: unlocked ? 'var(--text)' : 'var(--text-dim)',
          }}>
            {a.name}
          </div>
          <div
            className="mono"
            style={{
              fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
              color, marginTop: 3,
            }}
          >
            {TIER_META[tier].label}
          </div>
        </div>

        {unlocked && (
          <Icon name="check" size={16} style={{ color, flexShrink: 0 }} />
        )}
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.4 }}>
        {a.description}
      </div>

      {/* Reward chips */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {a.xpReward != null && a.xpReward > 0 && (
          <Chip color="var(--violet)">+{a.xpReward.toLocaleString()} XP</Chip>
        )}
        {a.eddieReward != null && a.eddieReward > 0 && (
          <Chip color="var(--amber)">+{a.eddieReward.toLocaleString()} €$</Chip>
        )}
      </div>

      {/* Footer: unlocked date OR locked progress */}
      {unlocked ? (
        a.unlockedAt && (
          <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-faint)', marginTop: 'auto' }}>
            UNLOCKED {new Date(a.unlockedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
          </div>
        )
      ) : (
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ height: 4, background: 'var(--panel-2)', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{
              width: `${Math.round(progress * 100)}%`, height: '100%',
              background: `linear-gradient(90deg, color-mix(in srgb, ${color} 70%, transparent), ${color})`,
              transition: 'width 0.3s ease',
            }} />
          </div>
          {a.progressLabel && (
            <div className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>
              {a.progressLabel}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Chip({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span
      className="mono"
      style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
        color,
        padding: '2px 7px', borderRadius: 5,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
      }}
    >
      {children}
    </span>
  );
}

function Empty({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div className="fade-up panel hud" style={{ padding: 60, textAlign: 'center', color: color ?? 'var(--text-faint)' }}>
      <div className="mono" style={{ fontSize: 13 }}>{children}</div>
    </div>
  );
}
