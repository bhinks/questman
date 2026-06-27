export interface Transaction {
  id: string;
  date: Date;
  description: string;
  descriptionNormalized?: string; // cleaned + clustered vendor name for grouping
  amount: number;
  category?: string;
  categoryId?: string;        // finance depth: id for server-side re-categorize
  subcategory?: string;
  vendor?: string;
  isWasteful?: boolean;
  notes?: string;
  // Finance depth: exclusion (transfers) + chore/project links + account.
  excluded?: boolean;
  account?: string;
  projectId?: string;
  choreId?: string;
  projectName?: string;
  choreName?: string;
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
  // Time context for the analyzed set: lets the UI label what span the
  // totals cover and re-express them as monthly / weekly rates.
  period: SpendingPeriod;
}

export interface SpendingPeriod {
  start: Date;
  end: Date;
  days: number;   // calendar days spanned (>= 1)
  weeks: number;  // days / 7 (>= 1)
  months: number; // inclusive calendar-month span (>= 1)
  transactionCount: number;
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