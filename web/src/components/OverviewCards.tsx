import { MetricCard } from './MetricCard';
import type { SpendingAnalysis } from '../types';

interface OverviewCardsProps {
  analysis: SpendingAnalysis;
}

export function OverviewCards({ analysis }: OverviewCardsProps) {
  // Calculate some mock trend data (in a real app, this would come from historical data)
  const spentTrend = -5.2; // 5.2% decrease in spending
  const incomeTrend = 2.1;  // 2.1% increase in income
  const netTrend = analysis.netAmount >= 0 ? 8.3 : -3.1;
  const avgTrend = -2.8; // 2.8% decrease in average monthly

  // Mock spark data for mini charts
  const spentSpark = [0.8, 0.6, 0.7, 0.9, 0.5, 0.4, 0.6];
  const incomeSpark = [0.3, 0.5, 0.4, 0.6, 0.8, 0.7, 0.9];
  const netSpark = [0.2, 0.4, 0.3, 0.5, 0.7, 0.6, 0.8];
  const avgSpark = [0.7, 0.5, 0.6, 0.8, 0.4, 0.3, 0.5];

  return (
    <div 
      className="metric-grid"
      style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(4, 1fr)', 
        gap: 22 
      }}
    >
      <MetricCard
        label="TOTAL SPENT"
        value={analysis.totalSpent}
        trend={spentTrend}
        invertGood={true}
        color="var(--red)"
        spark={spentSpark}
        sub="Total expenses"
      />
      
      <MetricCard
        label="TOTAL INCOME"
        value={analysis.totalIncome}
        trend={incomeTrend}
        color="var(--lime)"
        spark={incomeSpark}
        sub="Total income"
      />
      
      <MetricCard
        label="NET AMOUNT"
        value={analysis.netAmount}
        trend={netTrend}
        color={analysis.netAmount >= 0 ? "var(--lime)" : "var(--red)"}
        spark={netSpark}
        sub="Income - Expenses"
      />
      
      <MetricCard
        label="AVG MONTHLY"
        value={analysis.avgMonthly}
        trend={avgTrend}
        invertGood={true}
        color="var(--cyan)"
        spark={avgSpark}
        sub="Average monthly spending"
      />
    </div>
  );
}