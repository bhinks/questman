import express from 'express';
import { z } from 'zod';
import { prisma } from '../server';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import { AnalyticsEngine } from '../services/AnalyticsEngine';
import { subMonths, startOfMonth, endOfMonth, format } from 'date-fns';

const router = express.Router();

// Validation schemas
const analyticsQuerySchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  period: z.enum(['monthly', 'quarterly', 'yearly']).optional(),
  granularity: z.enum(['daily', 'weekly', 'monthly']).default('monthly')
});

const comparePeriodsSchema = z.object({
  currentStart: z.string().datetime(),
  currentEnd: z.string().datetime(),
  previousStart: z.string().datetime(),
  previousEnd: z.string().datetime()
});

// Get comprehensive user analytics
router.get('/overview', asyncHandler(async (req: AuthRequest, res) => {
  const { startDate, endDate, period } = analyticsQuerySchema.parse(req.query);

  let start, end;
  
  if (period) {
    const now = new Date();
    const monthsBack = period === 'monthly' ? 1 : period === 'quarterly' ? 3 : 12;
    start = subMonths(now, monthsBack);
    end = now;
  } else {
    start = startDate ? new Date(startDate) : subMonths(new Date(), 12);
    end = endDate ? new Date(endDate) : new Date();
  }

  const analytics = await AnalyticsEngine.calculateUserAnalytics(
    req.user!.id,
    start,
    end
  );

  res.json({
    analytics,
    period: { start, end }
  });
}));

// Get spending trends over time
router.get('/trends', asyncHandler(async (req: AuthRequest, res) => {
  const { startDate, endDate, granularity } = analyticsQuerySchema.parse(req.query);

  const start = startDate ? new Date(startDate) : subMonths(new Date(), 12);
  const end = endDate ? new Date(endDate) : new Date();

  let dateFormat: string;
  let groupBy: string;

  switch (granularity) {
    case 'daily':
      dateFormat = '%Y-%m-%d';
      groupBy = 'DATE(date)';
      break;
    case 'weekly':
      dateFormat = '%Y-W%u';
      groupBy = 'YEARWEEK(date, 1)';
      break;
    case 'monthly':
    default:
      dateFormat = '%Y-%m';
      groupBy = 'DATE_FORMAT(date, "%Y-%m")';
      break;
  }

  const trends = await prisma.$queryRaw`
    SELECT 
      ${groupBy} as period,
      SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as spending,
      SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as income,
      COUNT(CASE WHEN amount < 0 THEN 1 END) as expense_count,
      COUNT(CASE WHEN amount > 0 THEN 1 END) as income_count,
      AVG(CASE WHEN amount < 0 THEN ABS(amount) END) as avg_expense,
      MAX(CASE WHEN amount < 0 THEN ABS(amount) END) as max_expense
    FROM transactions 
    WHERE userId = ${req.user!.id}
      AND date >= ${start}
      AND date <= ${end}
    GROUP BY ${groupBy}
    ORDER BY period
  `;

  res.json({
    trends: trends.map((trend: any) => ({
      ...trend,
      net: trend.income - trend.spending,
      period: trend.period
    })),
    granularity,
    period: { start, end }
  });
}));

// Get category breakdown with spending analysis
router.get('/categories', asyncHandler(async (req: AuthRequest, res) => {
  const { startDate, endDate } = analyticsQuerySchema.parse(req.query);

  const start = startDate ? new Date(startDate) : subMonths(new Date(), 12);
  const end = endDate ? new Date(endDate) : new Date();

  const categoryBreakdown = await prisma.$queryRaw`
    SELECT 
      c.id,
      c.name,
      c.color,
      c.icon,
      c.budget,
      COUNT(t.id) as transaction_count,
      SUM(CASE WHEN t.amount < 0 THEN ABS(t.amount) ELSE 0 END) as total_spent,
      AVG(CASE WHEN t.amount < 0 THEN ABS(t.amount) END) as avg_transaction,
      MIN(t.date) as first_transaction,
      MAX(t.date) as last_transaction
    FROM categories c
    LEFT JOIN transactions t ON c.id = t.categoryId 
      AND t.userId = ${req.user!.id}
      AND t.date >= ${start}
      AND t.date <= ${end}
    WHERE c.userId = ${req.user!.id}
    GROUP BY c.id, c.name, c.color, c.icon, c.budget
    HAVING COUNT(t.id) > 0
    ORDER BY total_spent DESC
  `;

  // Calculate percentages
  const totalSpent = categoryBreakdown.reduce((sum: number, cat: any) => sum + (cat.total_spent || 0), 0);
  
  const categoriesWithPercentage = categoryBreakdown.map((cat: any) => ({
    ...cat,
    percentage: totalSpent > 0 ? (cat.total_spent / totalSpent) * 100 : 0,
    budget_used: cat.budget && cat.total_spent ? (cat.total_spent / cat.budget) * 100 : null,
    budget_remaining: cat.budget ? Math.max(0, cat.budget - cat.total_spent) : null
  }));

  res.json({
    categories: categoriesWithPercentage,
    summary: {
      totalSpent,
      categoryCount: categoryBreakdown.length,
      avgCategorySpending: totalSpent / categoryBreakdown.length
    },
    period: { start, end }
  });
}));

// Get vendor analysis
router.get('/vendors', asyncHandler(async (req: AuthRequest, res) => {
  const { startDate, endDate } = analyticsQuerySchema.parse(req.query);

  const start = startDate ? new Date(startDate) : subMonths(new Date(), 12);
  const end = endDate ? new Date(endDate) : new Date();

  const vendorAnalysis = await prisma.$queryRaw`
    SELECT 
      v.id,
      v.name,
      COUNT(t.id) as transaction_count,
      SUM(CASE WHEN t.amount < 0 THEN ABS(t.amount) ELSE 0 END) as total_spent,
      AVG(CASE WHEN t.amount < 0 THEN ABS(t.amount) END) as avg_transaction,
      MIN(t.date) as first_transaction,
      MAX(t.date) as last_transaction,
      c.name as primary_category,
      c.color as category_color
    FROM vendors v
    LEFT JOIN transactions t ON v.id = t.vendorId 
      AND t.userId = ${req.user!.id}
      AND t.date >= ${start}
      AND t.date <= ${end}
    LEFT JOIN categories c ON t.categoryId = c.id
    WHERE v.userId = ${req.user!.id}
    GROUP BY v.id, v.name, c.name, c.color
    HAVING COUNT(t.id) > 0
    ORDER BY total_spent DESC
    LIMIT 50
  `;

  const totalSpent = vendorAnalysis.reduce((sum: number, vendor: any) => sum + (vendor.total_spent || 0), 0);

  const vendorsWithPercentage = vendorAnalysis.map((vendor: any) => ({
    ...vendor,
    percentage: totalSpent > 0 ? (vendor.total_spent / totalSpent) * 100 : 0
  }));

  res.json({
    vendors: vendorsWithPercentage,
    summary: {
      totalSpent,
      vendorCount: vendorAnalysis.length,
      avgVendorSpending: totalSpent / vendorAnalysis.length
    },
    period: { start, end }
  });
}));

// Compare two time periods
router.post('/compare', asyncHandler(async (req: AuthRequest, res) => {
  const { currentStart, currentEnd, previousStart, previousEnd } = comparePeriodsSchema.parse(req.body);

  const [currentPeriod, previousPeriod] = await Promise.all([
    AnalyticsEngine.calculateUserAnalytics(
      req.user!.id,
      new Date(currentStart),
      new Date(currentEnd)
    ),
    AnalyticsEngine.calculateUserAnalytics(
      req.user!.id,
      new Date(previousStart),
      new Date(previousEnd)
    )
  ]);

  const comparison = {
    spending: {
      current: currentPeriod.totals.spent,
      previous: previousPeriod.totals.spent,
      change: currentPeriod.totals.spent - previousPeriod.totals.spent,
      percentChange: previousPeriod.totals.spent > 0 
        ? ((currentPeriod.totals.spent - previousPeriod.totals.spent) / previousPeriod.totals.spent) * 100
        : 0
    },
    income: {
      current: currentPeriod.totals.income,
      previous: previousPeriod.totals.income,
      change: currentPeriod.totals.income - previousPeriod.totals.income,
      percentChange: previousPeriod.totals.income > 0
        ? ((currentPeriod.totals.income - previousPeriod.totals.income) / previousPeriod.totals.income) * 100
        : 0
    },
    transactions: {
      current: currentPeriod.totals.transactionCount,
      previous: previousPeriod.totals.transactionCount,
      change: currentPeriod.totals.transactionCount - previousPeriod.totals.transactionCount
    },
    avgDaily: {
      current: currentPeriod.averages.daily,
      previous: previousPeriod.averages.daily,
      change: currentPeriod.averages.daily - previousPeriod.averages.daily,
      percentChange: previousPeriod.averages.daily > 0
        ? ((currentPeriod.averages.daily - previousPeriod.averages.daily) / previousPeriod.averages.daily) * 100
        : 0
    }
  };

  res.json({
    comparison,
    current: currentPeriod,
    previous: previousPeriod,
    periods: {
      current: { start: currentStart, end: currentEnd },
      previous: { start: previousStart, end: previousEnd }
    }
  });
}));

// Get wasteful spending analysis
router.get('/wasteful-spending', asyncHandler(async (req: AuthRequest, res) => {
  const { startDate, endDate } = analyticsQuerySchema.parse(req.query);

  const start = startDate ? new Date(startDate) : subMonths(new Date(), 3);
  const end = endDate ? new Date(endDate) : new Date();

  // Find patterns that might indicate wasteful spending
  const wastefulPatterns = await prisma.$queryRaw`
    SELECT 
      'frequent_small_purchases' as pattern_type,
      c.name as category,
      COUNT(*) as transaction_count,
      SUM(ABS(t.amount)) as total_amount,
      AVG(ABS(t.amount)) as avg_amount,
      'Multiple small transactions in same category' as description
    FROM transactions t
    LEFT JOIN categories c ON t.categoryId = c.id
    WHERE t.userId = ${req.user!.id}
      AND t.date >= ${start}
      AND t.date <= ${end}
      AND t.amount < 0
      AND ABS(t.amount) < 25
    GROUP BY c.id, c.name
    HAVING COUNT(*) >= 10
    
    UNION ALL
    
    SELECT 
      'duplicate_subscriptions' as pattern_type,
      'Subscriptions' as category,
      COUNT(*) as transaction_count,
      SUM(ABS(t.amount)) as total_amount,
      AVG(ABS(t.amount)) as avg_amount,
      'Potential duplicate subscription services' as description
    FROM transactions t
    WHERE t.userId = ${req.user!.id}
      AND t.date >= ${start}
      AND t.date <= ${end}
      AND t.amount < 0
      AND (
        t.description LIKE '%subscription%' OR
        t.description LIKE '%netflix%' OR
        t.description LIKE '%spotify%' OR
        t.description LIKE '%amazon prime%'
      )
    HAVING COUNT(*) > 1
    
    UNION ALL
    
    SELECT 
      'high_dining_frequency' as pattern_type,
      'Dining Out' as category,
      COUNT(*) as transaction_count,
      SUM(ABS(t.amount)) as total_amount,
      AVG(ABS(t.amount)) as avg_amount,
      'Frequent dining out expenses' as description
    FROM transactions t
    LEFT JOIN categories c ON t.categoryId = c.id
    WHERE t.userId = ${req.user!.id}
      AND t.date >= ${start}
      AND t.date <= ${end}
      AND t.amount < 0
      AND (
        c.name LIKE '%dining%' OR
        c.name LIKE '%restaurant%' OR
        c.name LIKE '%food%' OR
        t.description LIKE '%restaurant%' OR
        t.description LIKE '%cafe%' OR
        t.description LIKE '%pizza%'
      )
    HAVING COUNT(*) >= 15
  `;

  res.json({
    wastefulPatterns,
    period: { start, end },
    summary: {
      totalPatterns: wastefulPatterns.length,
      potentialSavings: wastefulPatterns.reduce((sum: number, pattern: any) => sum + (pattern.total_amount || 0), 0)
    }
  });
}));

// Get budget vs actual spending
router.get('/budget-analysis', asyncHandler(async (req: AuthRequest, res) => {
  const currentMonth = new Date();
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);

  const budgetAnalysis = await prisma.$queryRaw`
    SELECT 
      c.id,
      c.name,
      c.budget,
      c.color,
      COALESCE(SUM(CASE WHEN t.amount < 0 THEN ABS(t.amount) ELSE 0 END), 0) as spent_this_month,
      COUNT(CASE WHEN t.amount < 0 THEN 1 END) as transaction_count
    FROM categories c
    LEFT JOIN transactions t ON c.id = t.categoryId 
      AND t.userId = ${req.user!.id}
      AND t.date >= ${monthStart}
      AND t.date <= ${monthEnd}
    WHERE c.userId = ${req.user!.id}
      AND c.budget IS NOT NULL
      AND c.budget > 0
    GROUP BY c.id, c.name, c.budget, c.color
    ORDER BY c.name
  `;

  const analysisWithStatus = budgetAnalysis.map((item: any) => {
    const usedPercentage = item.budget > 0 ? (item.spent_this_month / item.budget) * 100 : 0;
    let status = 'under_budget';
    
    if (usedPercentage >= 100) status = 'over_budget';
    else if (usedPercentage >= 80) status = 'approaching_limit';
    else if (usedPercentage >= 50) status = 'on_track';

    return {
      ...item,
      remaining: Math.max(0, item.budget - item.spent_this_month),
      used_percentage: usedPercentage,
      status,
      days_remaining: new Date(monthEnd).getDate() - new Date().getDate()
    };
  });

  const totals = analysisWithStatus.reduce((acc: any, item: any) => {
    acc.totalBudget += item.budget || 0;
    acc.totalSpent += item.spent_this_month || 0;
    return acc;
  }, { totalBudget: 0, totalSpent: 0 });

  res.json({
    budgetAnalysis: analysisWithStatus,
    summary: {
      ...totals,
      totalRemaining: totals.totalBudget - totals.totalSpent,
      overallUsage: totals.totalBudget > 0 ? (totals.totalSpent / totals.totalBudget) * 100 : 0
    },
    period: { start: monthStart, end: monthEnd }
  });
}));

// Get income analysis
router.get('/income', asyncHandler(async (req: AuthRequest, res) => {
  const { startDate, endDate } = analyticsQuerySchema.parse(req.query);

  const start = startDate ? new Date(startDate) : subMonths(new Date(), 12);
  const end = endDate ? new Date(endDate) : new Date();

  const incomeAnalysis = await prisma.$queryRaw`
    SELECT 
      DATE_FORMAT(date, '%Y-%m') as month,
      SUM(amount) as total_income,
      COUNT(*) as transaction_count,
      AVG(amount) as avg_income,
      MAX(amount) as max_income,
      MIN(amount) as min_income
    FROM transactions 
    WHERE userId = ${req.user!.id}
      AND amount > 0
      AND date >= ${start}
      AND date <= ${end}
    GROUP BY DATE_FORMAT(date, '%Y-%m')
    ORDER BY month
  `;

  const totalIncome = incomeAnalysis.reduce((sum: number, month: any) => sum + (month.total_income || 0), 0);
  const avgMonthlyIncome = incomeAnalysis.length > 0 ? totalIncome / incomeAnalysis.length : 0;

  res.json({
    incomeAnalysis,
    summary: {
      totalIncome,
      avgMonthlyIncome,
      months: incomeAnalysis.length
    },
    period: { start, end }
  });
}));

// Update analytics cache
router.post('/update-cache', asyncHandler(async (req: AuthRequest, res) => {
  await AnalyticsEngine.updateUserAnalytics(req.user!.id);
  
  res.json({
    message: 'Analytics cache updated successfully'
  });
}));

export default router;