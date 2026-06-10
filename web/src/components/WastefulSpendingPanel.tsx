import type { WastefulSpending, WastefulPattern } from '../types';
import { format } from 'date-fns';
import { Icon } from './Icon';

interface WastefulSpendingPanelProps {
  wastefulSpending: WastefulSpending;
}

export function WastefulSpendingPanel({ wastefulSpending }: WastefulSpendingPanelProps) {
  const getPatternIcon = (type: WastefulPattern['type']): string => {
    switch (type) {
      case 'frequent_small':
        return 'repeat';
      case 'large_discretionary':
        return 'cart';
      case 'subscription_overlap':
        return 'trend';
      case 'impulse_buy':
        return 'zap';
      default:
        return 'flame';
    }
  };

  const getPatternColor = (type: WastefulPattern['type']): string => {
    switch (type) {
      case 'frequent_small':
        return 'var(--amber)';
      case 'large_discretionary':
        return 'var(--red)';
      case 'subscription_overlap':
        return 'var(--violet)';
      case 'impulse_buy':
        return 'var(--magenta)';
      default:
        return 'var(--text-dim)';
    }
  };

  const getPatternTitle = (type: WastefulPattern['type']) => {
    switch (type) {
      case 'frequent_small':
        return 'Frequent Small Purchases';
      case 'large_discretionary':
        return 'Large Discretionary Spending';
      case 'subscription_overlap':
        return 'Subscription Overlaps';
      case 'impulse_buy':
        return 'Impulse Buying';
      default:
        return 'Wasteful Pattern';
    }
  };

  const wastePct = Math.max(0, Math.min(100, wastefulSpending.percentage));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {/* Overview Card */}
      <div className="panel hud" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div
            className="ncx-chip"
            style={{
              width: 46,
              height: 46,
              color: 'var(--red)',
              background: 'color-mix(in srgb, var(--red) 10%, transparent)',
              boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--red) 35%, transparent)',
            }}
          >
            <Icon name="flame" size={20} />
          </div>
          <div style={{ minWidth: 0 }}>
            <h2
              className="ncx-chroma"
              style={{ fontSize: 18, fontWeight: 700, margin: 0, fontFamily: 'var(--font-display)', textTransform: 'uppercase' }}
            >
              Wasteful Spending Analysis
            </h2>
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 3 }}>
              <span style={{ color: 'var(--red)', fontWeight: 700 }}>
                ${wastefulSpending.total.toLocaleString()}
              </span>
              {' '}({wastefulSpending.percentage.toFixed(1)}%) flagged as potentially wasteful
            </div>
          </div>
          <span className="ncx-serial" style={{ marginLeft: 'auto' }}>
            WST-{String(wastefulSpending.patterns.length).padStart(2, '0')}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="ncx-bar slim" style={{ flex: 1 }}>
            <i
              style={{
                width: `${wastePct}%`,
                background: 'linear-gradient(90deg, color-mix(in srgb, var(--red) 60%, #200008), var(--red))',
                boxShadow: '0 0 10px color-mix(in srgb, var(--red) 45%, transparent)',
              }}
            />
            <span className="seg-mask" />
          </div>
          <span className="mono" style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.1em', whiteSpace: 'nowrap' }}>
            {wastefulSpending.percentage.toFixed(1)}% OF SPEND
          </span>
        </div>

        {wastefulSpending.total > 0 && (
          <div className="panel-inset" style={{ padding: 14 }}>
            <div className="kicker" style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--lime)', marginBottom: 6 }}>
              <Icon name="spark" size={12} style={{ color: 'var(--lime)' }} /> QUICK WINS
            </div>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5 }}>
              By addressing these patterns, you could potentially save{' '}
              <span className="mono" style={{ fontWeight: 700, color: 'var(--lime)' }}>
                ${(wastefulSpending.total * 0.8).toLocaleString()}
              </span>{' '}
              per year.
            </p>
          </div>
        )}
      </div>

      {/* Patterns */}
      {wastefulSpending.patterns.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 2 }}>
            <span
              className="mono"
              style={{ fontSize: 10, letterSpacing: '0.26em', textTransform: 'uppercase', color: 'var(--text-dim)' }}
            >
              Identified Patterns
            </span>
            <span className="ncx-serial">// {wastefulSpending.patterns.length} FLAGGED</span>
          </div>

          {wastefulSpending.patterns.map((pattern, index) => {
            const color = getPatternColor(pattern.type);

            return (
              <div key={index} className="panel" style={{ padding: 18 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                  <div
                    className="ncx-chip"
                    style={{
                      color,
                      background: `color-mix(in srgb, ${color} 10%, transparent)`,
                      boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 35%, transparent)`,
                    }}
                  >
                    <Icon name={getPatternIcon(pattern.type)} size={18} />
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                      <h4 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>
                        {getPatternTitle(pattern.type)}
                      </h4>
                      <span className="ncx-stamp flat" style={{ fontSize: 8.5, color: 'var(--amber)' }}>
                        WASTE
                      </span>
                      <span className="ncx-val" style={{ marginLeft: 'auto', fontSize: 18, color }}>
                        ${pattern.amount.toLocaleString()}
                      </span>
                    </div>

                    <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                      {pattern.description}
                    </p>

                    <div className="panel-inset" style={{ padding: 12, marginBottom: 12 }}>
                      <div className="kicker" style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--lime)', marginBottom: 4 }}>
                        <Icon name="spark" size={11} style={{ color: 'var(--lime)' }} /> SUGGESTION
                      </div>
                      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                        {pattern.suggestion}
                      </p>
                    </div>

                    {/* Transaction Details */}
                    <details>
                      <summary
                        className="mono"
                        style={{ cursor: 'pointer', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-faint)' }}
                      >
                        View {pattern.transactions.length} related transactions
                      </summary>
                      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {pattern.transactions.slice(0, 10).map(transaction => (
                          <div
                            key={transaction.id}
                            className="panel-inset"
                            style={{
                              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                              gap: 12, padding: '8px 12px', fontSize: 13,
                            }}
                          >
                            <div style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              <span style={{ color: 'var(--text)' }}>{transaction.description}</span>
                              <span className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 8 }}>
                                {format(transaction.date, 'MMM dd, yyyy')}
                              </span>
                            </div>
                            <span className="mono" style={{ fontWeight: 600, color: 'var(--text)', flexShrink: 0 }}>
                              ${Math.abs(transaction.amount).toFixed(2)}
                            </span>
                          </div>
                        ))}
                        {pattern.transactions.length > 10 && (
                          <p className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', textAlign: 'center', margin: '4px 0 0' }}>
                            … and {pattern.transactions.length - 10} more transactions
                          </p>
                        )}
                      </div>
                    </details>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="panel hud" style={{ padding: 40, textAlign: 'center' }}>
          <div
            className="ncx-chip"
            style={{
              width: 46,
              height: 46,
              margin: '0 auto 14px',
              color: 'var(--lime)',
              background: 'color-mix(in srgb, var(--lime) 10%, transparent)',
              boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--lime) 35%, transparent)',
            }}
          >
            <Icon name="check" size={20} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--lime)', marginBottom: 6 }}>
            NO WASTE DETECTED
          </div>
          <p className="mono" style={{ fontSize: 12, color: 'var(--text-faint)', margin: '0 auto', maxWidth: 440, lineHeight: 1.6 }}>
            We didn't detect any obvious wasteful spending patterns in your data.
            Your spending habits look quite disciplined.
          </p>
        </div>
      )}
    </div>
  );
}
