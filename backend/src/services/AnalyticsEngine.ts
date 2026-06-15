import { prisma } from '../server';
import { differenceInDays, format, startOfMonth, endOfMonth, subMonths } from 'date-fns';

export class AnalyticsEngine {
  /**
   * Calculate comprehensive analytics for a user
   */
  static async calculateUserAnalytics(userId: string, startDate?: Date, endDate?: Date) {
    const now = new Date();
    const start = startDate || subMonths(now, 12); // Default: last 12 months
    const end = endDate || now;

    // Get all transactions in period
    const transactions = await prisma.transaction.findMany({
      where: {
        userId,
        date: {
          gte: start,
          lte: end
        }
      },
      include: {
        category: true,
        vendor: true
      },
      orderBy: { date: 'asc' }
    });

    if (transactions.length === 0) {
      return this.getEmptyAnalytics();
    }

    const expenses = transactions.filter(t => t.amount < 0);
    const income = transactions.filter(t => t.amount > 0);

    // Basic metrics
    const totalSpent = Math.abs(expenses.reduce((sum, t) => sum + t.amount, 0));
    const totalIncome = income.reduce((sum, t) => sum + t.amount, 0);
    const netAmount = totalIncome - totalSpent;

    // Time-based calculations
    const dateRange = this.getDateRange(transactions);
    const days = Math.max(1, differenceInDays(dateRange.end, dateRange.start));
    const months = this.calculateMonthsBetween(dateRange.start, dateRange.end);

    const avgDaily = totalSpent / days;
    const avgWeekly = avgDaily * 7;
    const avgMonthly = totalSpent / months;

    // Category analysis
    const categorySpending = this.calculateCategorySpending(expenses);
    const topCategories = categorySpending.slice(0, 10);

    // Vendor analysis  
    const vendorSpending = this.calculateVendorSpending(expenses);
    const topVendors = vendorSpending.slice(0, 10);

    // Monthly trends
    const monthlyTrends = this.calculateMonthlyTrends(transactions);

    // Wasteful spending patterns
    const wastefulSpending = await this.analyzeWastefulSpending(userId, expenses);

    // Recurring transactions
    const recurringTransactions = this.findRecurringTransactions(transactions);

    // Savings opportunities
    const savingsOpportunities = this.identifySavingsOpportunities(categorySpending, vendorSpending);

    return {
      period: { start, end, days, months },
      totals: {
        spent: totalSpent,
        income: totalIncome,
        net: netAmount,
        transactionCount: transactions.length
      },
      averages: {
        daily: avgDaily,
        weekly: avgWeekly,
        monthly: avgMonthly
      },
      categories: {
        spending: categorySpending,
        top: topCategories
      },
      vendors: {
        spending: vendorSpending,
        top: topVendors
      },
      trends: {
        monthly: monthlyTrends,
        growth: this.calculateGrowthRates(monthlyTrends)
      },
      patterns: {
        wasteful: wastefulSpending,
        recurring: recurringTransactions,
        savings: savingsOpportunities
      },
      metadata: {
        calculatedAt: new Date(),
        dataQuality: this.assessDataQuality(transactions)
      }
    };
  }

  /**
   * Get transaction statistics summary
   */
  static async getTransactionStats(userId: string) {
    const [totalTransactions, totalCategories, totalVendors, recentActivity] = await Promise.all([
      prisma.transaction.count({ where: { userId } }),
      prisma.category.count({ where: { userId } }),
      prisma.vendor.count({ where: { userId } }),
      prisma.transaction.findMany({
        where: { userId },
        orderBy: { date: 'desc' },
        take: 5,
        include: { category: true }
      })
    ]);

    const thirtyDaysAgo = subMonths(new Date(), 1);
    const recentTransactions = await prisma.transaction.count({
      where: {
        userId,
        date: { gte: thirtyDaysAgo }
      }
    });

    return {
      totals: {
        transactions: totalTransactions,
        categories: totalCategories,
        vendors: totalVendors,
        recentTransactions
      },
      recentActivity
    };
  }

  /**
   * Update cached analytics for a user
   */
  static async updateUserAnalytics(userId: string) {
    // Calculate analytics for different periods
    const periods = [
      { name: 'monthly', months: 1 },
      { name: 'quarterly', months: 3 },
      { name: 'yearly', months: 12 }
    ];

    for (const period of periods) {
      const analytics = await this.calculateUserAnalytics(
        userId,
        subMonths(new Date(), period.months)
      );

      await prisma.analytics.upsert({
        where: {
          userId_period_date: {
            userId,
            period: period.name,
            date: startOfMonth(new Date())
          }
        },
        update: {
          metrics: JSON.stringify(analytics)
        },
        create: {
          userId,
          period: period.name,
          date: startOfMonth(new Date()),
          metrics: JSON.stringify(analytics)
        }
      });
    }
  }

  private static getEmptyAnalytics() {
    return {
      period: { start: new Date(), end: new Date(), days: 0, months: 0 },
      totals: { spent: 0, income: 0, net: 0, transactionCount: 0 },
      averages: { daily: 0, weekly: 0, monthly: 0 },
      categories: { spending: [], top: [] },
      vendors: { spending: [], top: [] },
      trends: { monthly: [], growth: { spending: 0, income: 0 } },
      patterns: { wasteful: [], recurring: [], savings: [] },
      metadata: { calculatedAt: new Date(), dataQuality: 'insufficient' }
    };
  }

  private static getDateRange(transactions: any[]) {
    const dates = transactions.map(t => t.date);
    return {
      start: new Date(Math.min(...dates.map(d => d.getTime()))),
      end: new Date(Math.max(...dates.map(d => d.getTime())))
    };
  }

  private static calculateMonthsBetween(start: Date, end: Date): number {
    const startMonth = start.getFullYear() * 12 + start.getMonth();
    const endMonth = end.getFullYear() * 12 + end.getMonth();
    return Math.max(1, endMonth - startMonth + 1);
  }

  private static calculateCategorySpending(expenses: any[]) {
    const categoryMap = new Map();
    const totalSpent = Math.abs(expenses.reduce((sum, t) => sum + t.amount, 0));

    expenses.forEach(transaction => {
      const category = transaction.category?.name || 'Uncategorized';
      const current = categoryMap.get(category) || {
        category,
        amount: 0,
        transactions: 0,
        percentage: 0
      };

      current.amount += Math.abs(transaction.amount);
      current.transactions += 1;
      categoryMap.set(category, current);
    });

    return Array.from(categoryMap.values())
      .map(cat => ({
        ...cat,
        percentage: (cat.amount / totalSpent) * 100,
        avgPerTransaction: cat.amount / cat.transactions
      }))
      .sort((a, b) => b.amount - a.amount);
  }

  private static calculateVendorSpending(expenses: any[]) {
    const vendorMap = new Map();
    const totalSpent = Math.abs(expenses.reduce((sum, t) => sum + t.amount, 0));

    expenses.forEach(transaction => {
      const vendor = transaction.vendor?.name || this.extractVendorFromDescription(transaction.description);
      const current = vendorMap.get(vendor) || {
        vendor,
        amount: 0,
        transactions: 0,
        percentage: 0,
        category: transaction.category?.name || 'Uncategorized'
      };

      current.amount += Math.abs(transaction.amount);
      current.transactions += 1;
      vendorMap.set(vendor, current);
    });

    return Array.from(vendorMap.values())
      .map(vendor => ({
        ...vendor,
        percentage: (vendor.amount / totalSpent) * 100,
        avgPerTransaction: vendor.amount / vendor.transactions
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 50); // Top 50 vendors
  }

  private static calculateMonthlyTrends(transactions: any[]) {
    const monthlyMap = new Map();

    transactions.forEach(transaction => {
      const monthKey = format(transaction.date, 'yyyy-MM');
      const current = monthlyMap.get(monthKey) || {
        month: monthKey,
        spending: 0,
        income: 0,
        net: 0,
        transactions: 0
      };

      if (transaction.amount < 0) {
        current.spending += Math.abs(transaction.amount);
      } else {
        current.income += transaction.amount;
      }
      current.transactions += 1;
      monthlyMap.set(monthKey, current);
    });

    return Array.from(monthlyMap.values())
      .map(month => ({
        ...month,
        net: month.income - month.spending
      }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }

  private static calculateGrowthRates(monthlyTrends: any[]) {
    if (monthlyTrends.length < 2) {
      return { spending: 0, income: 0 };
    }

    const recent = monthlyTrends[monthlyTrends.length - 1];
    const previous = monthlyTrends[monthlyTrends.length - 2];

    const spendingGrowth = previous.spending > 0 
      ? ((recent.spending - previous.spending) / previous.spending) * 100 
      : 0;

    const incomeGrowth = previous.income > 0 
      ? ((recent.income - previous.income) / previous.income) * 100 
      : 0;

    return {
      spending: spendingGrowth,
      income: incomeGrowth
    };
  }

  private static async analyzeWastefulSpending(userId: string, expenses: any[]) {
    // Implementation would analyze patterns similar to the frontend version
    // but with more sophisticated ML/statistics
    return [];
  }

  private static findRecurringTransactions(transactions: any[]) {
    // Identify recurring payments by vendor and amount similarity
    return [];
  }

  private static identifySavingsOpportunities(categorySpending: any[], vendorSpending: any[]) {
    const opportunities: Array<{ type: string; category: string; amount: number; suggestion: string }> = [];

    // High spending categories
    categorySpending.slice(0, 3).forEach(cat => {
      if (cat.percentage > 20) {
        opportunities.push({
          type: 'high_category_spending',
          category: cat.category,
          amount: cat.amount,
          suggestion: `Consider reducing spending in ${cat.category} - it represents ${cat.percentage.toFixed(1)}% of your expenses`
        });
      }
    });

    return opportunities;
  }

  private static assessDataQuality(transactions: any[]) {
    const categorized = transactions.filter(t => t.categoryId).length;
    const categorizationRate = (categorized / transactions.length) * 100;

    if (categorizationRate > 90) return 'excellent';
    if (categorizationRate > 70) return 'good';
    if (categorizationRate > 50) return 'fair';
    return 'poor';
  }

  private static extractVendorFromDescription(description: string): string {
    // Simple vendor extraction - could be enhanced with NLP
    return description.split(' ')[0].toUpperCase();
  }
}