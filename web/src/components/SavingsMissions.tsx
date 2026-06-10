import { Icon } from './Icon';
import { fmtMoney } from '../utils/formatters';
import type { SpendingAnalysis } from '../types';

interface SavingsMissionsProps {
  analysis: SpendingAnalysis;
}

interface Mission {
  id: string;
  title: string;
  description: string;
  category: string;
  potential: number;
  difficulty: 'easy' | 'medium' | 'hard';
  icon: string;
  progress: number;
  level: number;
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
        {Math.round(progress)}%
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
  const isCompleted = mission.progress >= 100;
  
  return (
    <div
      className="panel"
      style={{
        padding: 20,
        position: 'relative',
        border: isCompleted
          ? '1px solid color-mix(in srgb, var(--lime) 45%, transparent)'
          : '1px solid var(--line)',
        background: isCompleted
          ? 'linear-gradient(180deg, color-mix(in srgb, var(--lime) 6%, transparent), color-mix(in srgb, var(--lime) 2%, transparent))'
          : undefined
      }}
    >
      {/* Mission level badge */}
      <span
        className="ncx-serial"
        style={{
          position: 'absolute',
          top: 14,
          right: 16,
          color: 'rgba(var(--accent-rgb),0.65)'
        }}
      >
        LVL-{String(mission.level).padStart(2, '0')}
      </span>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* Mission icon */}
        <div
          className="ncx-chip"
          style={{
            width: 44,
            height: 44,
            color: isCompleted ? 'var(--lime)' : 'var(--cyan)',
            ...(isCompleted ? {
              background: 'color-mix(in srgb, var(--lime) 10%, transparent)',
              boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--lime) 35%, transparent)',
            } : {})
          }}
        >
          <Icon
            name={isCompleted ? 'check' : mission.icon}
            size={20}
          />
        </div>
        
        {/* Mission details */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
            <h3 style={{
              fontSize: 16,
              fontWeight: 700,
              margin: 0,
              fontFamily: 'var(--font-display)',
              textTransform: 'uppercase',
              color: isCompleted ? 'var(--lime)' : 'var(--text)'
            }}>
              {mission.title}
            </h3>
            <DifficultyBadge difficulty={mission.difficulty} />
          </div>
          
          <div style={{ 
            fontSize: 13, 
            color: 'var(--text-dim)', 
            lineHeight: 1.4,
            marginBottom: 12
          }}>
            {mission.description}
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="kicker" style={{ color: 'var(--text-faint)' }}>
              {mission.category.toUpperCase()}
            </div>
            <div 
              style={{ 
                fontSize: 14, 
                fontWeight: 600, 
                color: 'var(--lime)' 
              }}
              className="mono"
            >
              +{fmtMoney(mission.potential)}
            </div>
          </div>
        </div>
        
        {/* Progress ring */}
        <div style={{ flexShrink: 0 }}>
          <ProgressRing progress={mission.progress} />
        </div>
      </div>
      
      {isCompleted && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            background: 'linear-gradient(90deg, var(--lime), var(--teal))'
          }}
        />
      )}
    </div>
  );
}

export function SavingsMissions({ analysis }: SavingsMissionsProps) {
  // Convert wasteful spending into gamified missions
  const totalWasteful = analysis.wastefulSpending.total;
  const missions: Mission[] = [
    {
      id: 'dining-out',
      title: 'Operation Fast Food',
      description: 'Reduce excessive dining out and takeaway orders',
      category: 'Food & Dining',
      potential: totalWasteful * 0.35, // 35% of wasteful spending typically dining
      difficulty: 'easy' as const,
      icon: 'chef',
      progress: 85,
      level: 1
    },
    {
      id: 'subscriptions',
      title: 'Ghost Protocol',
      description: 'Eliminate unused subscriptions and recurring charges',
      category: 'Subscriptions',
      potential: totalWasteful * 0.20, // 20% typically subscriptions
      difficulty: 'medium' as const,
      icon: 'zap',
      progress: 100,
      level: 2
    },
    {
      id: 'impulse-shopping',
      title: 'Impulse Control',
      description: 'Reduce spontaneous shopping and unnecessary purchases',
      category: 'Shopping',
      potential: totalWasteful * 0.30, // 30% typically impulse purchases
      difficulty: 'hard' as const,
      icon: 'bag',
      progress: 45,
      level: 3
    },
    {
      id: 'entertainment',
      title: 'Digital Detox',
      description: 'Optimize entertainment spending and streaming services',
      category: 'Entertainment',
      potential: totalWasteful * 0.15, // 15% typically entertainment
      difficulty: 'easy' as const,
      icon: 'tv',
      progress: 70,
      level: 1
    }
  ].filter(mission => mission.potential > 20); // Only show if potential savings > $20

  const totalPotential = missions.reduce((sum, mission) => sum + mission.potential, 0);
  const totalProgress = missions.length > 0 
    ? missions.reduce((sum, mission) => sum + mission.progress, 0) / missions.length 
    : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header with stats */}
      <div className="panel hud" style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
          <div
            className="ncx-chip"
            style={{
              width: 48,
              height: 48,
              color: 'var(--lime)',
              background: 'color-mix(in srgb, var(--lime) 10%, transparent)',
              boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--lime) 35%, transparent)'
            }}
          >
            <Icon name="target" size={22} />
          </div>

          <div>
            <h2 className="ncx-chroma" style={{
              fontSize: 22,
              fontWeight: 700,
              margin: 0,
              marginBottom: 4,
              fontFamily: 'var(--font-display)',
              textTransform: 'uppercase'
            }}>
              Savings Missions
            </h2>
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-faint)' }}>
              transform spending patterns into actionable missions
            </div>
          </div>

          <span className="ncx-serial" style={{ marginLeft: 'auto', alignSelf: 'flex-start' }}>
            OPS-{String(missions.length).padStart(2, '0')}
          </span>
        </div>
        
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
          gap: 20 
        }}>
          <div className="panel-inset" style={{ padding: 16, textAlign: 'center' }}>
            <div className="kicker" style={{ marginBottom: 8 }}>TOTAL POTENTIAL</div>
            <div className="ncx-val" style={{ fontSize: 26, color: 'var(--lime)' }}>
              {fmtMoney(totalPotential)}
            </div>
          </div>

          <div className="panel-inset" style={{ padding: 16, textAlign: 'center' }}>
            <div className="kicker" style={{ marginBottom: 8 }}>ACTIVE MISSIONS</div>
            <div className="ncx-val" style={{ fontSize: 26, color: 'var(--cyan)' }}>
              {missions.length}
            </div>
          </div>

          <div className="panel-inset" style={{ padding: 16, textAlign: 'center' }}>
            <div className="kicker" style={{ marginBottom: 8 }}>AVG PROGRESS</div>
            <div className="ncx-val" style={{ fontSize: 26, color: 'var(--violet)' }}>
              {Math.round(totalProgress)}%
            </div>
          </div>
        </div>
      </div>
      
      {/* Mission cards */}
      {missions.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 2 }}>
            <span
              className="mono"
              style={{ fontSize: 10, letterSpacing: '0.26em', textTransform: 'uppercase', color: 'var(--text-dim)' }}
            >
              Mission Board
            </span>
            <span className="ncx-serial">// {missions.length} ACTIVE</span>
          </div>
          {missions.map(mission => (
            <MissionCard key={mission.id} mission={mission} />
          ))}
        </div>
      ) : (
        <div className="panel hud" style={{ 
          padding: 60, 
          textAlign: 'center', 
          color: 'var(--text-faint)' 
        }}>
          <Icon name="check" size={32} style={{ 
            color: 'var(--lime)', 
            marginBottom: 16 
          }} />
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
            All missions complete!
          </div>
          <div className="mono" style={{ fontSize: 13 }}>
            No wasteful spending patterns detected
          </div>
        </div>
      )}
    </div>
  );
}