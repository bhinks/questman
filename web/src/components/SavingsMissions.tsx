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
  const configs = {
    easy: { color: 'var(--lime)', bg: 'rgba(67,255,166,0.1)', border: 'rgba(67,255,166,0.3)', label: 'EASY' },
    medium: { color: 'var(--amber)', bg: 'rgba(255,194,75,0.1)', border: 'rgba(255,194,75,0.3)', label: 'MEDIUM' },
    hard: { color: 'var(--red)', bg: 'rgba(255,77,109,0.1)', border: 'rgba(255,77,109,0.3)', label: 'HARD' }
  };
  
  const config = configs[difficulty];
  
  return (
    <span
      className="mono"
      style={{
        fontSize: 10,
        padding: '3px 7px',
        borderRadius: 5,
        background: config.bg,
        color: config.color,
        border: `1px solid ${config.border}`,
        letterSpacing: '0.08em'
      }}
    >
      {config.label}
    </span>
  );
}

function ProgressRing({ progress, size = 60, strokeWidth = 3 }: { 
  progress: number; 
  size?: number; 
  strokeWidth?: number; 
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progress / 100) * circumference;
  
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--panel-hi)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--cyan)"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{
            transition: 'stroke-dashoffset 0.8s ease',
            filter: 'drop-shadow(0 0 4px var(--cyan))'
          }}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--text)'
        }}
        className="mono"
      >
        {Math.round(progress)}%
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
          ? '1px solid var(--lime)' 
          : '1px solid var(--line)',
        background: isCompleted
          ? 'linear-gradient(180deg, rgba(67,255,166,0.06), rgba(67,255,166,0.02))'
          : undefined
      }}
    >
      {/* Mission level badge */}
      <div
        style={{
          position: 'absolute',
          top: -8,
          right: 16,
          background: 'var(--panel-2)',
          border: '1px solid var(--line-bright)',
          borderRadius: 8,
          padding: '4px 8px',
          fontSize: 10,
          color: 'var(--cyan)',
          fontWeight: 600
        }}
        className="mono"
      >
        LVL {mission.level}
      </div>
      
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* Mission icon */}
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            background: isCompleted 
              ? 'linear-gradient(135deg, var(--lime), var(--teal))'
              : 'linear-gradient(135deg, var(--cyan), var(--violet))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            boxShadow: isCompleted
              ? 'var(--glow-lime)'
              : '0 4px 20px rgba(28,226,255,0.25)'
          }}
        >
          <Icon 
            name={isCompleted ? 'check' : mission.icon} 
            size={20} 
            style={{ color: 'white' }} 
          />
        </div>
        
        {/* Mission details */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <h3 style={{ 
              fontSize: 16, 
              fontWeight: 600, 
              margin: 0,
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
            top: -1,
            left: -1,
            right: -1,
            height: 2,
            background: 'linear-gradient(90deg, var(--lime), var(--teal))',
            borderRadius: '10px 10px 0 0'
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
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: 'linear-gradient(135deg, var(--lime), var(--teal))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: 'var(--glow-lime)'
            }}
          >
            <Icon name="target" size={24} style={{ color: 'white' }} />
          </div>
          
          <div>
            <h2 style={{ 
              fontSize: 24, 
              fontWeight: 600, 
              margin: 0, 
              marginBottom: 4,
              fontFamily: 'var(--font-display)'
            }}>
              Savings Missions
            </h2>
            <div style={{ fontSize: 14, color: 'var(--text-dim)' }}>
              Transform spending patterns into actionable missions
            </div>
          </div>
        </div>
        
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
          gap: 20 
        }}>
          <div className="panel-inset" style={{ padding: 16, textAlign: 'center' }}>
            <div className="kicker" style={{ marginBottom: 8 }}>TOTAL POTENTIAL</div>
            <div style={{ 
              fontSize: 28, 
              fontWeight: 700, 
              color: 'var(--lime)' 
            }} className="mono">
              {fmtMoney(totalPotential)}
            </div>
          </div>
          
          <div className="panel-inset" style={{ padding: 16, textAlign: 'center' }}>
            <div className="kicker" style={{ marginBottom: 8 }}>ACTIVE MISSIONS</div>
            <div style={{ 
              fontSize: 28, 
              fontWeight: 700, 
              color: 'var(--cyan)' 
            }} className="mono">
              {missions.length}
            </div>
          </div>
          
          <div className="panel-inset" style={{ padding: 16, textAlign: 'center' }}>
            <div className="kicker" style={{ marginBottom: 8 }}>AVG PROGRESS</div>
            <div style={{ 
              fontSize: 28, 
              fontWeight: 700, 
              color: 'var(--violet)' 
            }} className="mono">
              {Math.round(totalProgress)}%
            </div>
          </div>
        </div>
      </div>
      
      {/* Mission cards */}
      {missions.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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