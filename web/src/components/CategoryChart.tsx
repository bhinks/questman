import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid
} from 'recharts';
import type { CategorySpending } from '../types';

interface CategoryChartProps {
  categories: CategorySpending[];
  onCategoryClick: (category: string) => void;
  selectedCategory?: string | null;
  showAll?: boolean;
}

const NEON_COLORS = [
  '#1ce2ff', '#ff2e9a', '#43ffa6', '#ffc24b', '#9d6bff',
  '#ff4d6d', '#4d8bff', '#ff77c8', '#2ff5d6', '#969cba'
];

export function CategoryChart({ categories, onCategoryClick, selectedCategory, showAll = false }: CategoryChartProps) {
  const displayCategories = showAll ? categories : categories.slice(0, 8);
  
  const pieData = displayCategories.map((cat, index) => ({
    ...cat,
    color: NEON_COLORS[index % NEON_COLORS.length]
  }));

  const handlePieClick = (entry: any) => {
    onCategoryClick(entry.category);
  };

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div 
          className="panel-inset" 
          style={{ 
            padding: 12, 
            border: '1px solid var(--line-bright)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)'
          }}
        >
          <div style={{ 
            fontWeight: 600, 
            color: 'var(--text)', 
            marginBottom: 6,
            fontFamily: 'var(--font-ui)'
          }}>
            {data.category}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.4 }}>
            <div className="mono">${data.amount.toLocaleString()}</div>
            <div>{data.percentage.toFixed(1)}% of spending</div>
            <div>{data.transactions} transactions</div>
          </div>
        </div>
      );
    }
    return null;
  };

  const renderCustomLabel = (entry: any) => {
    if (entry.percentage < 5) return '';
    return `${entry.percentage.toFixed(1)}%`;
  };

  return (
    <div className="panel hud" style={{ padding: 24 }}>
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: 12, 
        marginBottom: 20 
      }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: 'linear-gradient(135deg, var(--cyan), var(--violet))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <span style={{ color: 'white', fontSize: 16, fontWeight: 600 }}>📊</span>
        </div>
        <h3 style={{
          fontSize: 18, 
          fontWeight: 600, 
          margin: 0,
          color: 'var(--text)',
          fontFamily: 'var(--font-display)'
        }}>
          Category Breakdown
        </h3>
      </div>
      
      {showAll ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Bar Chart for all categories */}
          <div style={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={displayCategories} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid 
                  strokeDasharray="1 3" 
                  stroke="var(--line)" 
                  strokeOpacity={0.3}
                />
                <XAxis 
                  dataKey="category" 
                  angle={-45}
                  textAnchor="end"
                  height={80}
                  tick={{ fontSize: 11, fill: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}
                  axisLine={{ stroke: 'var(--line)' }}
                  tickLine={{ stroke: 'var(--line)' }}
                />
                <YAxis 
                  tickFormatter={(value) => `$${value.toLocaleString()}`}
                  tick={{ fontSize: 11, fill: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}
                  axisLine={{ stroke: 'var(--line)' }}
                  tickLine={{ stroke: 'var(--line)' }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Bar 
                  dataKey="amount" 
                  fill="var(--cyan)"
                  onClick={handlePieClick}
                  style={{ cursor: 'pointer', filter: 'drop-shadow(0 0 4px var(--cyan))' }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          
          {/* Category List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {displayCategories.map((category, index) => (
              <div
                key={category.category}
                className="panel-inset"
                style={{
                  padding: 12,
                  cursor: 'pointer',
                  border: selectedCategory === category.category 
                    ? '1px solid var(--cyan)' 
                    : '1px solid var(--line)',
                  background: selectedCategory === category.category
                    ? 'linear-gradient(90deg, rgba(28,226,255,0.08), rgba(28,226,255,0.02))'
                    : undefined,
                  transition: 'all 0.2s ease'
                }}
                onClick={() => onCategoryClick(category.category)}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div 
                      style={{ 
                        width: 12, 
                        height: 12, 
                        borderRadius: 3,
                        background: NEON_COLORS[index % NEON_COLORS.length],
                        boxShadow: `0 0 8px ${NEON_COLORS[index % NEON_COLORS.length]}60`
                      }}
                    />
                    <span style={{ 
                      fontWeight: 500, 
                      color: 'var(--text)',
                      fontSize: 13
                    }}>
                      {category.category}
                    </span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div 
                      className="mono"
                      style={{
                        fontWeight: 600, 
                        color: 'var(--text)',
                        fontSize: 13
                      }}
                    >
                      ${category.amount.toLocaleString()}
                    </div>
                    <div style={{ 
                      fontSize: 11, 
                      color: 'var(--text-faint)',
                      fontFamily: 'var(--font-mono)'
                    }}>
                      {category.percentage.toFixed(1)}% • {category.transactions}tx
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Pie Chart */}
          <div style={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={renderCustomLabel}
                  outerRadius={120}
                  innerRadius={40}
                  fill="#8884d8"
                  dataKey="amount"
                  onClick={handlePieClick}
                  style={{ cursor: 'pointer', filter: 'drop-shadow(0 0 12px rgba(28,226,255,0.3))' }}
                >
                  {pieData.map((entry, index) => (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={entry.color}
                      stroke={selectedCategory === entry.category ? 'var(--cyan)' : 'var(--panel)'}
                      strokeWidth={selectedCategory === entry.category ? 3 : 1}
                      style={{ filter: `drop-shadow(0 0 6px ${entry.color}60)` }}
                    />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          
          {/* Legend */}
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(2, 1fr)', 
            gap: 8 
          }}>
            {pieData.map((category, _index) => (
              <div
                key={category.category}
                className="panel-inset"
                style={{
                  padding: 8,
                  cursor: 'pointer',
                  border: selectedCategory === category.category
                    ? '1px solid var(--cyan)'
                    : '1px solid transparent',
                  background: selectedCategory === category.category
                    ? 'rgba(28,226,255,0.05)'
                    : undefined,
                  transition: 'all 0.15s ease'
                }}
                onClick={() => onCategoryClick(category.category)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div 
                    style={{ 
                      width: 10, 
                      height: 10, 
                      borderRadius: 2,
                      background: category.color,
                      boxShadow: `0 0 6px ${category.color}60`
                    }}
                  />
                  <span style={{
                    fontSize: 12,
                    fontWeight: 500, 
                    color: 'var(--text)',
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    {category.category}
                  </span>
                  <span 
                    className="mono"
                    style={{ 
                      fontSize: 11, 
                      color: 'var(--text-dim)' 
                    }}
                  >
                    ${category.amount.toLocaleString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}