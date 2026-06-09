import type { 
  Transaction, 
  SpendingAnalysis, 
  CategorySpending, 
  VendorSpending, 
  WastefulSpending, 
  WastefulPattern,
  FilterOptions 
} from '../types';
import { 
  differenceInDays, 
  format, 
  isWithinInterval 
} from 'date-fns';

export function analyzeSpending(transactions: Transaction[], filters?: FilterOptions): SpendingAnalysis {
  const filteredTransactions = applyFilters(transactions, filters);
  
  const expenses = filteredTransactions.filter(t => t.amount < 0);
  const income = filteredTransactions.filter(t => t.amount > 0);
  
  const totalSpent = Math.abs(expenses.reduce((sum, t) => sum + t.amount, 0));
  const totalIncome = income.reduce((sum, t) => sum + t.amount, 0);
  const netAmount = totalIncome - totalSpent;
  
  const dateRange = getDateRange(filteredTransactions);
  const days = differenceInDays(dateRange.end, dateRange.start) || 1;
  
  // Calculate actual months between start and end dates
  const startMonth = dateRange.start.getFullYear() * 12 + dateRange.start.getMonth();
  const endMonth = dateRange.end.getFullYear() * 12 + dateRange.end.getMonth();
  const actualMonths = Math.max(1, endMonth - startMonth + 1); // At least 1 month
  
  // Debug logging
  console.log('Date Range Debug:', {
    start: dateRange.start,
    end: dateRange.end,
    startMonth: dateRange.start.getFullYear() + '-' + (dateRange.start.getMonth() + 1),
    endMonth: dateRange.end.getFullYear() + '-' + (dateRange.end.getMonth() + 1),
    calculatedMonths: actualMonths,
    totalSpent,
    days
  });
  
  const avgDaily = totalSpent / days;
  const avgWeekly = avgDaily * 7;
  const avgMonthly = totalSpent / actualMonths; // Use actual number of months
  
  const topCategories = calculateCategorySpending(expenses);
  const topVendors = calculateVendorSpending(expenses);
  const wastefulSpending = analyzeWastefulSpending(expenses);
  
  return {
    totalSpent,
    totalIncome,
    netAmount,
    avgDaily,
    avgWeekly,
    avgMonthly,
    topCategories,
    topVendors,
    wastefulSpending
  };
}

function applyFilters(transactions: Transaction[], filters?: FilterOptions): Transaction[] {
  if (!filters) return transactions;
  
  return transactions.filter(transaction => {
    if (filters.dateRange) {
      if (!isWithinInterval(transaction.date, filters.dateRange)) {
        return false;
      }
    }
    
    if (filters.categories && filters.categories.length > 0) {
      if (!transaction.category || !filters.categories.includes(transaction.category)) {
        return false;
      }
    }
    
    if (filters.minAmount !== undefined && Math.abs(transaction.amount) < filters.minAmount) {
      return false;
    }
    
    if (filters.maxAmount !== undefined && Math.abs(transaction.amount) > filters.maxAmount) {
      return false;
    }
    
    if (filters.searchTerm) {
      const searchLower = filters.searchTerm.toLowerCase();
      if (!transaction.description.toLowerCase().includes(searchLower) &&
          !transaction.vendor?.toLowerCase().includes(searchLower)) {
        return false;
      }
    }
    
    return true;
  });
}

function getDateRange(transactions: Transaction[]): { start: Date; end: Date } {
  if (transactions.length === 0) {
    const now = new Date();
    return { start: now, end: now };
  }
  
  const dates = transactions.map(t => t.date);
  return {
    start: new Date(Math.min(...dates.map(d => d.getTime()))),
    end: new Date(Math.max(...dates.map(d => d.getTime())))
  };
}

function calculateCategorySpending(expenses: Transaction[]): CategorySpending[] {
  const categoryMap = new Map<string, Transaction[]>();
  
  expenses.forEach(transaction => {
    const category = transaction.category || 'Uncategorized';
    if (!categoryMap.has(category)) {
      categoryMap.set(category, []);
    }
    categoryMap.get(category)!.push(transaction);
  });
  
  const totalSpent = Math.abs(expenses.reduce((sum, t) => sum + t.amount, 0));
  
  const categorySpending: CategorySpending[] = Array.from(categoryMap.entries())
    .map(([category, transactions]) => {
      const amount = Math.abs(transactions.reduce((sum, t) => sum + t.amount, 0));
      return {
        category,
        amount,
        percentage: (amount / totalSpent) * 100,
        transactions: transactions.length,
        avgPerTransaction: amount / transactions.length
      };
    })
    .sort((a, b) => b.amount - a.amount);
  
  return categorySpending;
}

function calculateVendorSpending(expenses: Transaction[]): VendorSpending[] {
  const vendorMap = new Map<string, Transaction[]>();
  
  expenses.forEach(transaction => {
    const vendor = transaction.vendor || 'Unknown';
    if (!vendorMap.has(vendor)) {
      vendorMap.set(vendor, []);
    }
    vendorMap.get(vendor)!.push(transaction);
  });
  
  const totalSpent = Math.abs(expenses.reduce((sum, t) => sum + t.amount, 0));
  
  const vendorSpending: VendorSpending[] = Array.from(vendorMap.entries())
    .map(([vendor, transactions]) => {
      const amount = Math.abs(transactions.reduce((sum, t) => sum + t.amount, 0));
      const dateRange = getDateRange(transactions);
      const days = differenceInDays(dateRange.end, dateRange.start) || 1;
      const frequency = transactions.length / (days / 7); // transactions per week
      
      return {
        vendor,
        amount,
        percentage: (amount / totalSpent) * 100,
        transactions: transactions.length,
        category: transactions[0].category || 'Uncategorized',
        frequency
      };
    })
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 20); // Top 20 vendors
  
  return vendorSpending;
}

function analyzeWastefulSpending(expenses: Transaction[]): WastefulSpending {
  const patterns: WastefulPattern[] = [];
  
  // Pattern 1: Frequent small purchases from same vendor
  const frequentSmall = findFrequentSmallPurchases(expenses);
  patterns.push(...frequentSmall);
  
  // Pattern 2: Large discretionary spending
  const largeDiscretionary = findLargeDiscretionarySpending(expenses);
  patterns.push(...largeDiscretionary);
  
  // Pattern 3: Subscription overlaps
  const subscriptionOverlaps = findSubscriptionOverlaps(expenses);
  patterns.push(...subscriptionOverlaps);
  
  // Pattern 4: Impulse buying (multiple purchases in short time)
  const impulseBuys = findImpulseBuying(expenses);
  patterns.push(...impulseBuys);
  
  const totalWasteful = patterns.reduce((sum, pattern) => sum + pattern.amount, 0);
  const totalSpent = Math.abs(expenses.reduce((sum, t) => sum + t.amount, 0));
  
  return {
    total: totalWasteful,
    percentage: (totalWasteful / totalSpent) * 100,
    patterns: patterns.sort((a, b) => b.amount - a.amount)
  };
}

function findFrequentSmallPurchases(expenses: Transaction[]): WastefulPattern[] {
  const vendorMap = new Map<string, Transaction[]>();
  
  // Group by vendor
  expenses.forEach(transaction => {
    if (Math.abs(transaction.amount) < 20) { // Small purchases under $20
      const vendor = transaction.vendor || 'Unknown';
      if (!vendorMap.has(vendor)) {
        vendorMap.set(vendor, []);
      }
      vendorMap.get(vendor)!.push(transaction);
    }
  });
  
  const patterns: WastefulPattern[] = [];
  
  vendorMap.forEach((transactions, vendor) => {
    if (transactions.length >= 5) { // 5 or more small purchases
      const amount = Math.abs(transactions.reduce((sum, t) => sum + t.amount, 0));
      const avgFrequency = calculateFrequency(transactions);
      
      if (avgFrequency > 1) { // More than once per week on average
        patterns.push({
          type: 'frequent_small',
          description: `Frequent small purchases at ${vendor} (${transactions.length} transactions, avg $${(amount / transactions.length).toFixed(2)} each)`,
          amount,
          transactions,
          suggestion: `Consider bulk purchasing or setting a monthly budget for ${vendor} to reduce transaction fees and impulse purchases.`
        });
      }
    }
  });
  
  return patterns;
}

function findLargeDiscretionarySpending(expenses: Transaction[]): WastefulPattern[] {
  const discretionaryCategories = ['Shopping', 'Entertainment', 'Food & Dining'];
  const patterns: WastefulPattern[] = [];
  
  const largeExpenses = expenses.filter(t => 
    Math.abs(t.amount) > 200 && 
    discretionaryCategories.includes(t.category || '')
  );
  
  largeExpenses.forEach(transaction => {
    patterns.push({
      type: 'large_discretionary',
      description: `Large discretionary purchase: ${transaction.description} ($${Math.abs(transaction.amount).toFixed(2)})`,
      amount: Math.abs(transaction.amount),
      transactions: [transaction],
      suggestion: 'Consider waiting 24-48 hours before making large discretionary purchases to avoid impulse buying.'
    });
  });
  
  return patterns;
}

function findSubscriptionOverlaps(expenses: Transaction[]): WastefulPattern[] {
  const subscriptionKeywords = ['netflix', 'hulu', 'spotify', 'apple music', 'subscription', 'monthly', 'premium'];
  const patterns: WastefulPattern[] = [];
  
  const subscriptions = expenses.filter(t => 
    subscriptionKeywords.some(keyword => 
      t.description.toLowerCase().includes(keyword) ||
      t.vendor?.toLowerCase().includes(keyword) || ''
    )
  );
  
  // Group by similar services
  const streamingServices = subscriptions.filter(t => 
    ['netflix', 'hulu', 'disney', 'amazon prime', 'apple tv'].some(service =>
      t.description.toLowerCase().includes(service) ||
      t.vendor?.toLowerCase().includes(service) || ''
    )
  );
  
  const musicServices = subscriptions.filter(t => 
    ['spotify', 'apple music', 'youtube music', 'pandora'].some(service =>
      t.description.toLowerCase().includes(service) ||
      t.vendor?.toLowerCase().includes(service) || ''
    )
  );
  
  if (streamingServices.length > 2) {
    const amount = Math.abs(streamingServices.reduce((sum, t) => sum + t.amount, 0));
    patterns.push({
      type: 'subscription_overlap',
      description: `Multiple streaming subscriptions (${streamingServices.length} services)`,
      amount,
      transactions: streamingServices,
      suggestion: 'Consider consolidating to 1-2 streaming services and cancel unused subscriptions.'
    });
  }
  
  if (musicServices.length > 1) {
    const amount = Math.abs(musicServices.reduce((sum, t) => sum + t.amount, 0));
    patterns.push({
      type: 'subscription_overlap',
      description: `Multiple music subscriptions (${musicServices.length} services)`,
      amount,
      transactions: musicServices,
      suggestion: 'You only need one music streaming service. Cancel redundant subscriptions.'
    });
  }
  
  return patterns;
}

function findImpulseBuying(expenses: Transaction[]): WastefulPattern[] {
  const patterns: WastefulPattern[] = [];
  const sortedExpenses = [...expenses].sort((a, b) => a.date.getTime() - b.date.getTime());
  
  for (let i = 0; i < sortedExpenses.length - 2; i++) {
    const current = sortedExpenses[i];
    const next1 = sortedExpenses[i + 1];
    const next2 = sortedExpenses[i + 2];
    
    // Check for 3+ purchases within 2 hours at shopping/entertainment venues
    if (current.category === 'Shopping' || current.category === 'Entertainment') {
      const timeDiff1 = next1.date.getTime() - current.date.getTime();
      const timeDiff2 = next2.date.getTime() - current.date.getTime();
      const twoHours = 2 * 60 * 60 * 1000; // 2 hours in milliseconds
      
      if (timeDiff1 <= twoHours && timeDiff2 <= twoHours) {
        const relatedTransactions = [current, next1, next2];
        const amount = Math.abs(relatedTransactions.reduce((sum, t) => sum + t.amount, 0));
        
        if (amount > 100) { // Only flag if total > $100
          patterns.push({
            type: 'impulse_buy',
            description: `Rapid shopping spree on ${format(current.date, 'MMM dd')} ($${amount.toFixed(2)} in 2 hours)`,
            amount,
            transactions: relatedTransactions,
            suggestion: 'Try the 24-hour rule: wait a day before making non-essential purchases to avoid impulse buying.'
          });
        }
      }
    }
  }
  
  return patterns;
}

function calculateFrequency(transactions: Transaction[]): number {
  if (transactions.length < 2) return 0;
  
  const dateRange = getDateRange(transactions);
  const weeks = differenceInDays(dateRange.end, dateRange.start) / 7 || 1;
  return transactions.length / weeks;
}

export function getMonthlySpending(transactions: Transaction[]): Array<{ month: string; spending: number; income: number; net: number }> {
  const monthlyData = new Map<string, { spending: number; income: number }>();
  
  transactions.forEach(transaction => {
    const monthKey = format(transaction.date, 'yyyy-MM');
    
    if (!monthlyData.has(monthKey)) {
      monthlyData.set(monthKey, { spending: 0, income: 0 });
    }
    
    const data = monthlyData.get(monthKey)!;
    if (transaction.amount < 0) {
      data.spending += Math.abs(transaction.amount);
    } else {
      data.income += transaction.amount;
    }
  });
  
  return Array.from(monthlyData.entries())
    .map(([month, data]) => ({
      month,
      spending: data.spending,
      income: data.income,
      net: data.income - data.spending
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export function getDailySpending(transactions: Transaction[]): Array<{ date: string; amount: number }> {
  const dailyData = new Map<string, number>();
  
  transactions
    .filter(t => t.amount < 0) // Only expenses
    .forEach(transaction => {
      const dateKey = format(transaction.date, 'yyyy-MM-dd');
      const current = dailyData.get(dateKey) || 0;
      dailyData.set(dateKey, current + Math.abs(transaction.amount));
    });
  
  return Array.from(dailyData.entries())
    .map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function getCategoryTrends(transactions: Transaction[], category: string): Array<{ month: string; amount: number; transactions: number }> {
  const monthlyData = new Map<string, { amount: number; count: number }>();
  
  transactions
    .filter(t => t.category === category && t.amount < 0)
    .forEach(transaction => {
      const monthKey = format(transaction.date, 'yyyy-MM');
      
      if (!monthlyData.has(monthKey)) {
        monthlyData.set(monthKey, { amount: 0, count: 0 });
      }
      
      const data = monthlyData.get(monthKey)!;
      data.amount += Math.abs(transaction.amount);
      data.count += 1;
    });
  
  return Array.from(monthlyData.entries())
    .map(([month, data]) => ({
      month,
      amount: data.amount,
      transactions: data.count
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}