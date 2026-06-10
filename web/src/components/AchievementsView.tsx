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
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div className="ncx-chip" style={{ color: 'var(--amber)' }}>
          <Icon name="trophy" size={18} />
        </div>
        <div>
          <h2 className="ncx-glitch ncx-chroma" style={{ fontSize: 20, fontWeight: 700, margin: 0, fontFamily: 'var(--font-display)', letterSpacing: '0.02em' }}>STREET CRED</h2>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '0.24em', color: 'var(--text-faint)', marginTop: 3 }}>
            REPUTATION EARNED ACROSS THE GRID
          </div>
        </div>
        <span className="mono" style={{ marginLeft: 'auto', fontSize: 10.5, letterSpacing: '0.12em', color: 'var(--text-dim)' }}>
          {unlocked} / {total} UNLOCKED
        </span>
      </div>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span className="mono" style={{ fontSize: 10, letterSpacing: '0.26em', color: 'var(--text-dim)', textTransform: 'uppercase' }}>COMPLETION</span>
          <span className="ncx-val" style={{ fontSize: 12, color: 'var(--text-dim)' }}>{pct}%</span>
        </div>
        <div className="ncx-bar">
          <i style={{
            width: `${pct}%`,
            background: 'linear-gradient(90deg, var(--amber), var(--cyan))',
            boxShadow: '0 0 12px rgba(var(--accent-rgb),0.4)',
          }} />
          <span className="seg-mask" />
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
        borderColor: unlocked ? `color-mix(in srgb, ${color} 55%, transparent)` : undefined,
        background: unlocked
          ? `linear-gradient(180deg, color-mix(in srgb, ${color} 10%, transparent), color-mix(in srgb, ${color} 3%, transparent)), #0b0c16`
          : undefined,
        opacity: unlocked ? 1 : 0.55,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div
          style={{
            width: 42, height: 42, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            clipPath: 'polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)',
            color: unlocked ? color : 'var(--text-ghost)',
            background: unlocked
              ? `linear-gradient(150deg, color-mix(in srgb, ${color} 32%, #0b0c16), #0b0c16)`
              : '#10121f',
          }}
        >
          <Icon name={unlocked ? a.icon : 'lock'} size={18} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14, fontWeight: 600,
            color: unlocked ? 'var(--text)' : 'var(--text-dim)',
          }}>
            {a.name}
          </div>
          <div style={{ marginTop: 5 }}>
            <span className="ncx-stamp flat" style={{ color, fontSize: 8 }}>
              {TIER_META[tier].label}
            </span>
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
          <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 9.5, letterSpacing: '0.14em', color: 'var(--lime)', marginTop: 'auto' }}>
            <Icon name="check" size={10} />
            UNLOCKED {new Date(a.unlockedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
          </div>
        )
      ) : (
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="ncx-bar slim">
            <i style={{
              width: `${Math.round(progress * 100)}%`,
              background: `linear-gradient(90deg, color-mix(in srgb, ${color} 70%, transparent), ${color})`,
              opacity: 0.85,
            }} />
            <span className="seg-mask" />
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
        padding: '2px 7px',
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
