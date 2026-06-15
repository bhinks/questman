import { useQuery } from '@tanstack/react-query';
import { Icon } from './Icon';
import { fmtMoney } from '../utils/formatters';
import { api } from '../lib/api';

/**
 * SAVINGS MISSIONS — real, not theatre. Every number is derived from live
 * data: missions are the user's budgeted categories (spend vs cap → surplus
 * and progress), and the subscription stat is the real detected-subscription
 * count + monthly cost from the recurring audit. Nothing is fabricated.
 */

interface BudgetRow {
  categoryId: string; name: string; color: string | null; icon: string | null;
  cap: number; spent: number; remaining: number; pct: number;
  status: 'ok' | 'warn' | 'over';
}
interface BudgetsResponse {
  budgets: BudgetRow[];
  totals: { totalCap: number; totalSpent: number; totalRemaining: number };
}
interface AuditResponse { count: number; monthlySubCost: number; annualSubCost: number }

interface Mission {
  id: string;
  title: string;
  description: string;
  category: string;
  potential: number;   // monthly surplus still protectable in this category ($)
  difficulty: 'easy' | 'medium' | 'hard';
  icon: string;
  progress: number;    // % of the budget preserved so far this month
  level: number;
}

function iconForCategory(name: string): string {
  const n = name.toLowerCase();
  if (/food|dining|restaurant|grocer|coffee/.test(n)) return 'food';
  if (/transport|gas|fuel|car|auto|uber|lyft/.test(n)) return 'car';
  if (/shop|amazon|cloth|retail/.test(n)) return 'bag';
  if (/entertain|stream|movie|game|music/.test(n)) return 'tv';
  if (/health|medical|pharm|fitness|gym/.test(n)) return 'heart';
  if (/travel|flight|hotel/.test(n)) return 'plane';
  if (/bill|util|subscription|rent|mortgage/.test(n)) return 'bolt';
  return 'wallet';
}

function DifficultyBadge({ difficulty }: { difficulty: Mission['difficulty'] }) {
  return (
    <span className={`ncx-stamp ${difficulty}`} style={{ flexShrink: 0 }}>
      {difficulty.toUpperCase()}
    </span>
  );
}

function ProgressRing({ progress }: { progress: number }) {
  const pct = Math.max(0, Math.min(100, progress));
  const done = pct >= 100;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, width: 96 }}>
      <span className="ncx-val" style={{ fontSize: 16, color: done ? 'var(--lime)' : 'var(--cyan)' }}>
        {Math.round(pct)}%
      </span>
      <div className="ncx-bar slim" style={{ width: '100%' }}>
        <i
          style={{
            width: `${pct}%`,
            background: done
              ? 'linear-gradient(90deg, color-mix(in srgb, var(--lime) 70%, #032), var(--lime))'
              : 'linear-gradient(90deg, var(--cyan-deep), var(--cyan))',
            boxShadow: done
              ? '0 0 10px color-mix(in srgb, var(--lime) 45%, transparent)'
              : '0 0 10px rgba(var(--accent-rgb),0.45)',
          }}
        />
        <span className="seg-mask" />
      </div>
    </div>
  );
}

function MissionCard({ mission }: { mission: Mission }) {
  const onTrack = mission.progress >= 100;

  return (
    <div
      className="panel"
      style={{
        padding: 20,
        position: 'relative',
        border: onTrack
          ? '1px solid color-mix(in srgb, var(--lime) 45%, transparent)'
          : '1px solid var(--line)',
        background: onTrack
          ? 'linear-gradient(180deg, color-mix(in srgb, var(--lime) 6%, transparent), color-mix(in srgb, var(--lime) 2%, transparent))'
          : undefined,
      }}
    >
      <span className="ncx-serial" style={{ position: 'absolute', top: 14, right: 16, color: 'rgba(var(--accent-rgb),0.65)' }}>
        LVL-{String(mission.level).padStart(2, '0')}
      </span>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div
          className="ncx-chip"
          style={{
            width: 44, height: 44,
            color: onTrack ? 'var(--lime)' : 'var(--cyan)',
            ...(onTrack ? {
              background: 'color-mix(in srgb, var(--lime) 10%, transparent)',
              boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--lime) 35%, transparent)',
            } : {}),
          }}
        >
          <Icon name={mission.icon} size={20} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
            <h3 style={{
              fontSize: 16, fontWeight: 700, margin: 0,
              fontFamily: 'var(--font-display)', textTransform: 'uppercase',
              color: onTrack ? 'var(--lime)' : 'var(--text)',
            }}>
              {mission.title}
            </h3>
            <DifficultyBadge difficulty={mission.difficulty} />
          </div>

          <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.4, marginBottom: 12 }}>
            {mission.description}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="kicker" style={{ color: 'var(--text-faint)' }}>{mission.category.toUpperCase()}</div>
            <div
              className="mono"
              style={{ fontSize: 14, fontWeight: 600, color: 'var(--lime)', display: 'flex', alignItems: 'baseline', gap: 4 }}
            >
              {fmtMoney(mission.potential)}
              <span style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em' }}>SURPLUS / MO</span>
            </div>
          </div>
        </div>

        <div style={{ flexShrink: 0 }}>
          <ProgressRing progress={mission.progress} />
        </div>
      </div>

      {onTrack && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, var(--lime), var(--teal))' }} />
      )}
    </div>
  );
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="panel-inset" style={{ padding: 16, textAlign: 'center' }}>
      <div className="kicker" style={{ marginBottom: 8 }}>{label}</div>
      <div className="ncx-val" style={{ fontSize: 26, color }}>{value}</div>
      {sub && <div className="mono" style={{ fontSize: 9, color: 'var(--text-faint)', marginTop: 6, letterSpacing: '0.1em' }}>{sub}</div>}
    </div>
  );
}

export function SavingsMissions() {
  const budgetsQ = useQuery({
    queryKey: ['budgets'],
    queryFn: () => api.get<BudgetsResponse>('/api/budgets'),
  });
  const auditQ = useQuery({
    queryKey: ['recurring', 'audit'],
    queryFn: () => api.get<AuditResponse>('/api/recurring/audit'),
  });

  const budgets = budgetsQ.data?.budgets ?? [];
  const totalRemaining = Math.max(0, budgetsQ.data?.totals.totalRemaining ?? 0);
  const subCount = auditQ.data?.count ?? 0;
  const subMonthly = auditQ.data?.monthlySubCost ?? 0;

  // One mission per budgeted category — target is the cap, progress is how much
  // of the budget is still preserved this month, surplus is the real headroom.
  const missions: Mission[] = budgets.map((b, i) => {
    const preserved = b.cap > 0 ? Math.round((Math.max(0, b.remaining) / b.cap) * 100) : 0;
    const difficulty: Mission['difficulty'] = b.status === 'over' ? 'hard' : b.status === 'warn' ? 'medium' : 'easy';
    const desc = b.remaining >= 0
      ? `${fmtMoney(b.spent)} of ${fmtMoney(b.cap)} spent — ${fmtMoney(b.remaining)} headroom left this month.`
      : `${fmtMoney(b.spent)} spent against a ${fmtMoney(b.cap)} cap — ${fmtMoney(-b.remaining)} over. Rein it in.`;
    return {
      id: b.categoryId,
      title: b.name,
      description: desc,
      category: b.name,
      potential: Math.max(0, b.remaining),
      difficulty,
      icon: b.icon || iconForCategory(b.name),
      progress: preserved,
      level: (i % 5) + 1,
    };
  });

  const loading = budgetsQ.isLoading || auditQ.isLoading;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header with real stats */}
      <div className="panel hud" style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
          <div
            className="ncx-chip"
            style={{
              width: 48, height: 48, color: 'var(--lime)',
              background: 'color-mix(in srgb, var(--lime) 10%, transparent)',
              boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--lime) 35%, transparent)',
            }}
          >
            <Icon name="target" size={22} />
          </div>

          <div>
            <h2 className="ncx-chroma" style={{ fontSize: 22, fontWeight: 700, margin: 0, marginBottom: 4, fontFamily: 'var(--font-display)', textTransform: 'uppercase' }}>
              Savings Missions
            </h2>
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-faint)' }}>
              hold the line on your budgets · cut the leeches
            </div>
          </div>

          <span className="ncx-serial" style={{ marginLeft: 'auto', alignSelf: 'flex-start' }}>
            OPS-{String(missions.length).padStart(2, '0')}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
          <Stat label="SURPLUS LEFT / MO" value={fmtMoney(totalRemaining)} sub={`~${fmtMoney(totalRemaining * 12)} / YR IF HELD`} color="var(--lime)" />
          <Stat label="ACTIVE MISSIONS" value={String(missions.length)} color="var(--cyan)" />
          <Stat
            label="SUBSCRIPTIONS"
            value={String(subCount)}
            sub={subCount > 0 ? `${fmtMoney(subMonthly)} / MO LEECHED` : 'NONE DETECTED'}
            color="var(--violet)"
          />
        </div>
      </div>

      {/* Mission cards */}
      {loading ? (
        <div className="panel hud" style={{ padding: 60, textAlign: 'center', color: 'var(--text-faint)' }}>
          <div className="mono" style={{ fontSize: 13 }}>READING THE VAULT…</div>
        </div>
      ) : missions.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 2 }}>
            <span className="mono" style={{ fontSize: 10, letterSpacing: '0.26em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
              Mission Board
            </span>
            <span className="ncx-serial">// {missions.length} ACTIVE</span>
          </div>
          {missions.map(mission => <MissionCard key={mission.id} mission={mission} />)}
        </div>
      ) : (
        <div className="panel hud" style={{ padding: 60, textAlign: 'center', color: 'var(--text-faint)' }}>
          <Icon name="target" size={32} style={{ color: 'var(--cyan)', marginBottom: 16 }} />
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>No budgets set yet</div>
          <div className="mono" style={{ fontSize: 13 }}>
            Set a cap on a category in BUDGETS to turn it into a savings mission.
          </div>
        </div>
      )}
    </div>
  );
}
