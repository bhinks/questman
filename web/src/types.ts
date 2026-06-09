export interface Transaction {
  id: string;
  date: Date;
  description: string;
  amount: number;
  category?: string;
  subcategory?: string;
  vendor?: string;
  isWasteful?: boolean;
  notes?: string;
}

export interface CategoryRule {
  id: string;
  keywords: string[];
  category: string;
  subcategory?: string;
  priority: number;
}

export interface SpendingAnalysis {
  totalSpent: number;
  totalIncome: number;
  netAmount: number;
  avgDaily: number;
  avgWeekly: number;
  avgMonthly: number;
  topCategories: CategorySpending[];
  topVendors: VendorSpending[];
  wastefulSpending: WastefulSpending;
}

export interface CategorySpending {
  category: string;
  amount: number;
  percentage: number;
  transactions: number;
  avgPerTransaction: number;
}

export interface VendorSpending {
  vendor: string;
  amount: number;
  percentage: number;
  transactions: number;
  category: string;
  frequency: number;
}

export interface WastefulSpending {
  total: number;
  percentage: number;
  patterns: WastefulPattern[];
}

export interface WastefulPattern {
  type: 'frequent_small' | 'large_discretionary' | 'subscription_overlap' | 'impulse_buy';
  description: string;
  amount: number;
  transactions: Transaction[];
  suggestion: string;
}

export interface DateRange {
  start: Date;
  end: Date;
}

export interface FilterOptions {
  dateRange?: DateRange;
  categories?: string[];
  minAmount?: number;
  maxAmount?: number;
  searchTerm?: string;
}