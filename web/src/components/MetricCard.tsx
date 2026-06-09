import { Icon } from './Icon';
import { fmtMoney, fmtPct } from '../utils/formatters';

interface TrendProps {
  value: number;
  invertGood?: boolean;
  size?: 'sm' | 'md';
}

function Trend({ value, invertGood = false, size = 'md' }: TrendProps) {
  const up = value >= 0;
  const good = invertGood ? !up : up;
  const color = good ? 'var(--lime)' : 'var(--red)';
  const sm = size === 'sm';
  
  return (
    <span 
      className="mono" 
      style={{
        display: 'inline-flex', 
        alignItems: 'center', 
        gap: 3,
        color, 
        fontSize: sm ? 11 : 12.5, 
        fontWeight: 600,
        padding: sm ? '2px 6px' : '3px 8px', 
        borderRadius: 6,
        background: good ? 'rgba(67,255,166,0.10)' : 'rgba(255,77,109,0.10)',
        border: `1px solid ${good ? 'rgba(67,255,166,0.22)' : 'rgba(255,77,109,0.22)'}`,
      }}
    >
      <Icon name={up ? 'arrowUp' : 'arrowDn'} size={sm ? 11 : 12} stroke={2.4} />
      {fmtPct(Math.abs(value))}
    </span>
  );
}

interface CountUpProps {
  value: number;
  format: (n: number) => string;
}

function CountUp({ value, format }: CountUpProps) {
  // Simple implementation - in a real app you'd use a proper animation library
  return <span>{format(value)}</span>;
}

interface MetricCardProps {
  label: string;
  value: number;
  trend?: number;
  invertGood?: boolean;
  color: string;
  spark?: number[];
  sub?: string;
}

export function MetricCard({ label, value, trend, invertGood, color, spark, sub }: MetricCardProps) {
  return (
    <div 
      className="panel" 
      style={{ 
        padding: 20, 
        position: 'relative', 
        overflow: 'hidden' 
      }}
    >
      {/* Top accent line */}
      <div 
        style={{ 
          position: 'absolute', 
          top: 0, 
          left: 0, 
          width: '100%', 
          height: 2,
          background: `linear-gradient(90deg, ${color}, transparent)` 
        }} 
      />
      
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'flex-start' 
      }}>
        <div className="kicker">{label}</div>
        {trend != null && <Trend value={trend} invertGood={invertGood} size="sm" />}
      </div>
      
      <div style={{ 
        display: 'flex', 
        alignItems: 'flex-end', 
        justifyContent: 'space-between', 
        gap: 10, 
        marginTop: 14 
      }}>
        <div>
          <div style={{ 
            fontSize: 30, 
            fontWeight: 600, 
            letterSpacing: '-0.02em', 
            lineHeight: 1 
          }}>
            <CountUp value={value} format={(n) => fmtMoney(n)} />
          </div>
          {sub && (
            <div style={{ 
              fontSize: 12, 
              color: 'var(--text-faint)', 
              marginTop: 7 
            }}>
              {sub}
            </div>
          )}
        </div>
        
        {spark && (
          <div style={{ width: 84, height: 34 }}>
            <svg width="84" height="34" style={{ overflow: 'visible' }}>
              <defs>
                <linearGradient id={`spark-gradient-${label}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity="0.4" />
                  <stop offset="100%" stopColor={color} stopOpacity="0.1" />
                </linearGradient>
              </defs>
              
              {/* Simple spark line */}
              <path
                d={`M0,${34 - (spark[0] || 0) * 30} ${spark.map((val, i) => 
                  `L${(i / (spark.length - 1)) * 84},${34 - val * 30}`
                ).join(' ')}`}
                fill="none"
                stroke={color}
                strokeWidth="1.5"
                style={{ filter: `drop-shadow(0 0 3px ${color})` }}
              />
              
              {/* Area fill */}
              <path
                d={`M0,${34 - (spark[0] || 0) * 30} ${spark.map((val, i) => 
                  `L${(i / (spark.length - 1)) * 84},${34 - val * 30}`
                ).join(' ')} L84,34 L0,34 Z`}
                fill={`url(#spark-gradient-${label})`}
              />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}