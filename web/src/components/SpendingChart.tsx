import { useState } from 'react';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar
} from 'recharts';
import { format } from 'date-fns';

interface SpendingChartProps {
  monthlyData: Array<{ month: string; spending: number; income: number; net: number }>;
  dailyData: Array<{ date: string; amount: number }>;
}

export function SpendingChart({ monthlyData, dailyData }: SpendingChartProps) {
  const [viewType, setViewType] = useState<'monthly' | 'daily'>('monthly');
  const [chartType, setChartType] = useState<'line' | 'area' | 'bar'>('line');

  const formatMonthlyData = monthlyData.map(item => ({
    ...item,
    monthLabel: format(new Date(item.month + '-01'), 'MMM yyyy')
  }));

  const formatDailyData = dailyData.map(item => ({
    ...item,
    dateLabel: format(new Date(item.date), 'MMM dd')
  }));

  const renderChart = () => {
    const data = viewType === 'monthly' ? formatMonthlyData : formatDailyData.slice(-30) as any; // Last 30 days
    
    if (chartType === 'area') {
      return (
        <AreaChart data={data}>
          <CartesianGrid 
            strokeDasharray="1 3" 
            stroke="var(--line)" 
            strokeOpacity={0.3}
          />
          <XAxis 
            dataKey={viewType === 'monthly' ? 'monthLabel' : 'dateLabel'}
            tick={{ fontSize: 11, fill: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}
            axisLine={{ stroke: 'var(--line)' }}
            tickLine={{ stroke: 'var(--line)' }}
          />
          <YAxis 
            tick={{ fontSize: 11, fill: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}
            tickFormatter={(value) => `$${value.toLocaleString()}`}
            axisLine={{ stroke: 'var(--line)' }}
            tickLine={{ stroke: 'var(--line)' }}
          />
          <Tooltip 
            formatter={(value, name) => [
              `$${Number(value).toLocaleString()}`,
              name === 'spending' ? 'Spending' :
              name === 'income' ? 'Income' :
              name === 'net' ? 'Net' : 'Amount'
            ]}
            labelFormatter={(label) => label}
          />
          {viewType === 'monthly' ? (
            <>
              <Area 
                type="monotone" 
                dataKey="spending" 
                stackId="1"
                stroke="var(--red)" 
                fill="var(--red)" 
                fillOpacity={0.2}
                strokeWidth={2}
                style={{ filter: 'drop-shadow(0 0 4px var(--red))' }}
              />
              <Area 
                type="monotone" 
                dataKey="income" 
                stackId="2"
                stroke="var(--lime)" 
                fill="var(--lime)" 
                fillOpacity={0.2}
                strokeWidth={2}
                style={{ filter: 'drop-shadow(0 0 4px var(--lime))' }}
              />
            </>
          ) : (
            <Area 
              type="monotone" 
              dataKey="amount" 
              stroke="var(--cyan)" 
              fill="var(--cyan)" 
              fillOpacity={0.2}
              strokeWidth={2}
              style={{ filter: 'drop-shadow(0 0 4px var(--cyan))' }}
            />
          )}
        </AreaChart>
      );
    }
    
    if (chartType === 'bar') {
      return (
        <BarChart data={data}>
          <CartesianGrid 
            strokeDasharray="1 3" 
            stroke="var(--line)" 
            strokeOpacity={0.3}
          />
          <XAxis 
            dataKey={viewType === 'monthly' ? 'monthLabel' : 'dateLabel'}
            tick={{ fontSize: 11, fill: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}
            axisLine={{ stroke: 'var(--line)' }}
            tickLine={{ stroke: 'var(--line)' }}
          />
          <YAxis 
            tick={{ fontSize: 11, fill: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}
            tickFormatter={(value) => `$${value.toLocaleString()}`}
            axisLine={{ stroke: 'var(--line)' }}
            tickLine={{ stroke: 'var(--line)' }}
          />
          <Tooltip 
            formatter={(value, name) => [
              `$${Number(value).toLocaleString()}`,
              name === 'spending' ? 'Spending' :
              name === 'income' ? 'Income' :
              name === 'net' ? 'Net' : 'Amount'
            ]}
          />
          {viewType === 'monthly' ? (
            <>
              <Bar 
                dataKey="spending" 
                fill="var(--red)"
                style={{ filter: 'drop-shadow(0 0 4px var(--red))' }}
              />
              <Bar 
                dataKey="income" 
                fill="var(--lime)"
                style={{ filter: 'drop-shadow(0 0 4px var(--lime))' }}
              />
            </>
          ) : (
            <Bar 
              dataKey="amount" 
              fill="var(--cyan)"
              style={{ filter: 'drop-shadow(0 0 4px var(--cyan))' }}
            />
          )}
        </BarChart>
      );
    }
    
    // Default: line chart
    return (
      <LineChart data={data}>
        <CartesianGrid 
          strokeDasharray="1 3" 
          stroke="var(--line)" 
          strokeOpacity={0.3}
        />
        <XAxis 
          dataKey={viewType === 'monthly' ? 'monthLabel' : 'dateLabel'}
          tick={{ fontSize: 11, fill: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}
          axisLine={{ stroke: 'var(--line)' }}
          tickLine={{ stroke: 'var(--line)' }}
        />
        <YAxis 
          tick={{ fontSize: 11, fill: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}
          tickFormatter={(value) => `$${value.toLocaleString()}`}
          axisLine={{ stroke: 'var(--line)' }}
          tickLine={{ stroke: 'var(--line)' }}
        />
        <Tooltip 
          formatter={(value, name) => [
            `$${Number(value).toLocaleString()}`,
            name === 'spending' ? 'Spending' :
            name === 'income' ? 'Income' :
            name === 'net' ? 'Net' : 'Amount'
          ]}
        />
        {viewType === 'monthly' ? (
          <>
            <Line 
              type="monotone" 
              dataKey="spending" 
              stroke="var(--red)" 
              strokeWidth={2}
              dot={{ fill: 'var(--red)', strokeWidth: 2, r: 4 }}
              style={{ filter: 'drop-shadow(0 0 4px var(--red))' }}
            />
            <Line 
              type="monotone" 
              dataKey="income" 
              stroke="var(--lime)" 
              strokeWidth={2}
              dot={{ fill: 'var(--lime)', strokeWidth: 2, r: 4 }}
              style={{ filter: 'drop-shadow(0 0 4px var(--lime))' }}
            />
            <Line 
              type="monotone" 
              dataKey="net" 
              stroke="var(--cyan)" 
              strokeWidth={2}
              strokeDasharray="4 4"
              dot={{ fill: 'var(--cyan)', strokeWidth: 2, r: 4 }}
              style={{ filter: 'drop-shadow(0 0 4px var(--cyan))' }}
            />
          </>
        ) : (
          <Line 
            type="monotone" 
            dataKey="amount" 
            stroke="var(--cyan)" 
            strokeWidth={2}
            dot={{ fill: 'var(--cyan)', strokeWidth: 2, r: 4 }}
            style={{ filter: 'drop-shadow(0 0 4px var(--cyan))' }}
          />
        )}
      </LineChart>
    );
  };

  return (
    <div className="panel hud" style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: 'linear-gradient(135deg, var(--violet), var(--magenta))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <span style={{ color: 'white', fontSize: 16, fontWeight: 600 }}>📈</span>
          </div>
          <h3 style={{
            fontSize: 18, 
            fontWeight: 600, 
            margin: 0,
            color: 'var(--text)',
            fontFamily: 'var(--font-display)'
          }}>
            Spending Trends
          </h3>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--line)' }}>
            <button
              className={viewType === 'monthly' ? 'btn-primary' : 'btn'}
              style={{
                padding: '6px 12px',
                fontSize: 11,
                borderRadius: 0,
                border: 'none',
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.05em'
              }}
              onClick={() => setViewType('monthly')}
            >
              MONTHLY
            </button>
            <button
              className={viewType === 'daily' ? 'btn-primary' : 'btn'}
              style={{
                padding: '6px 12px',
                fontSize: 11,
                borderRadius: 0,
                border: 'none',
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.05em'
              }}
              onClick={() => setViewType('daily')}
            >
              DAILY
            </button>
          </div>
          
          <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--line)' }}>
            <button
              className={chartType === 'line' ? 'btn-primary' : 'btn'}
              style={{
                padding: '6px 12px',
                fontSize: 11,
                borderRadius: 0,
                border: 'none',
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.05em'
              }}
              onClick={() => setChartType('line')}
            >
              LINE
            </button>
            <button
              className={chartType === 'area' ? 'btn-primary' : 'btn'}
              style={{
                padding: '6px 12px',
                fontSize: 11,
                borderRadius: 0,
                border: 'none',
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.05em'
              }}
              onClick={() => setChartType('area')}
            >
              AREA
            </button>
            <button
              className={chartType === 'bar' ? 'btn-primary' : 'btn'}
              style={{
                padding: '6px 12px',
                fontSize: 11,
                borderRadius: 0,
                border: 'none',
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.05em'
              }}
              onClick={() => setChartType('bar')}
            >
              BAR
            </button>
          </div>
        </div>
      </div>
      
      <div style={{ height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          {renderChart()}
        </ResponsiveContainer>
      </div>
      
      {viewType === 'monthly' && (
        <div style={{ 
          marginTop: 16, 
          display: 'flex', 
          justifyContent: 'center', 
          gap: 24 
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ 
              width: 10, 
              height: 10, 
              background: 'var(--red)', 
              borderRadius: 2,
              boxShadow: '0 0 6px var(--red)60'
            }} />
            <span style={{ 
              fontSize: 12, 
              color: 'var(--text-dim)',
              fontFamily: 'var(--font-mono)'
            }}>
              SPENDING
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ 
              width: 10, 
              height: 10, 
              background: 'var(--lime)', 
              borderRadius: 2,
              boxShadow: '0 0 6px var(--lime)60'
            }} />
            <span style={{ 
              fontSize: 12, 
              color: 'var(--text-dim)',
              fontFamily: 'var(--font-mono)'
            }}>
              INCOME
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ 
              width: 10, 
              height: 10, 
              background: 'var(--cyan)', 
              borderRadius: 2,
              boxShadow: '0 0 6px var(--cyan)60'
            }} />
            <span style={{ 
              fontSize: 12, 
              color: 'var(--text-dim)',
              fontFamily: 'var(--font-mono)'
            }}>
              NET
            </span>
          </div>
        </div>
      )}
    </div>
  );
}