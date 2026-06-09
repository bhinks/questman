import type { Transaction, CategoryRule } from '../types';

export const DEFAULT_CATEGORY_RULES: CategoryRule[] = [
  // Food & Dining
  { id: '1', keywords: ['starbucks', 'coffee', 'cafe', 'restaurant', 'food', 'dining', 'pizza', 'mcdonalds', 'burger', 'taco', 'sushi', 'doordash', 'uber eats', 'grubhub', 'postmates'], category: 'Food & Dining', subcategory: 'Restaurants', priority: 10 },
  { id: '2', keywords: ['grocery', 'supermarket', 'walmart', 'target', 'costco', 'safeway', 'kroger', 'whole foods', 'trader joes'], category: 'Food & Dining', subcategory: 'Groceries', priority: 9 },
  { id: '3', keywords: ['bar', 'brewery', 'wine', 'liquor', 'alcohol', 'beer'], category: 'Food & Dining', subcategory: 'Alcohol', priority: 8 },
  
  // Transportation
  { id: '4', keywords: ['gas', 'fuel', 'shell', 'exxon', 'chevron', 'bp', 'mobil'], category: 'Transportation', subcategory: 'Gas', priority: 10 },
  { id: '5', keywords: ['uber', 'lyft', 'taxi', 'rideshare'], category: 'Transportation', subcategory: 'Rideshare', priority: 9 },
  { id: '6', keywords: ['parking', 'toll', 'bridge'], category: 'Transportation', subcategory: 'Parking & Tolls', priority: 8 },
  { id: '7', keywords: ['auto', 'car', 'mechanic', 'oil change', 'tire', 'repair'], category: 'Transportation', subcategory: 'Auto Maintenance', priority: 7 },
  
  // Shopping
  { id: '8', keywords: ['amazon', 'ebay', 'etsy', 'shopping', 'mall', 'department'], category: 'Shopping', subcategory: 'Online Shopping', priority: 8 },
  { id: '9', keywords: ['clothing', 'apparel', 'fashion', 'shoes', 'nike', 'adidas'], category: 'Shopping', subcategory: 'Clothing', priority: 7 },
  { id: '10', keywords: ['electronics', 'best buy', 'apple store', 'computer', 'phone'], category: 'Shopping', subcategory: 'Electronics', priority: 7 },
  
  // Entertainment
  { id: '11', keywords: ['netflix', 'spotify', 'hulu', 'disney', 'streaming', 'subscription'], category: 'Entertainment', subcategory: 'Streaming', priority: 10 },
  { id: '12', keywords: ['movie', 'theater', 'cinema', 'concert', 'event', 'tickets'], category: 'Entertainment', subcategory: 'Events', priority: 8 },
  { id: '13', keywords: ['gym', 'fitness', 'yoga', 'sport', 'recreation'], category: 'Entertainment', subcategory: 'Fitness', priority: 7 },
  
  // Bills & Utilities
  { id: '14', keywords: ['electric', 'electricity', 'power', 'utility', 'pge', 'edison'], category: 'Bills & Utilities', subcategory: 'Electricity', priority: 10 },
  { id: '15', keywords: ['water', 'sewer', 'trash', 'waste'], category: 'Bills & Utilities', subcategory: 'Water & Waste', priority: 9 },
  { id: '16', keywords: ['internet', 'phone', 'mobile', 'verizon', 'at&t', 'tmobile', 'comcast'], category: 'Bills & Utilities', subcategory: 'Phone & Internet', priority: 9 },
  { id: '17', keywords: ['rent', 'mortgage', 'housing'], category: 'Bills & Utilities', subcategory: 'Housing', priority: 10 },
  
  // Healthcare
  { id: '18', keywords: ['doctor', 'medical', 'hospital', 'pharmacy', 'cvs', 'walgreens', 'health'], category: 'Healthcare', subcategory: 'Medical', priority: 9 },
  { id: '19', keywords: ['dental', 'dentist'], category: 'Healthcare', subcategory: 'Dental', priority: 8 },
  { id: '20', keywords: ['insurance', 'premium'], category: 'Healthcare', subcategory: 'Insurance', priority: 7 },
  
  // Financial
  { id: '21', keywords: ['bank', 'fee', 'atm', 'overdraft', 'interest', 'finance'], category: 'Financial', subcategory: 'Fees', priority: 8 },
  { id: '22', keywords: ['transfer', 'payment', 'credit card'], category: 'Financial', subcategory: 'Transfers', priority: 7 },
  
  // Income (positive amounts)
  { id: '23', keywords: ['salary', 'paycheck', 'deposit', 'refund', 'cashback', 'dividend'], category: 'Income', subcategory: 'Salary', priority: 10 },
];

export function categorizeTransaction(transaction: Transaction, rules: CategoryRule[] = DEFAULT_CATEGORY_RULES): Transaction {
  if (transaction.category && transaction.category !== 'Uncategorized') {
    return transaction;
  }
  
  const description = transaction.description.toLowerCase();
  
  // Special handling for income (positive amounts)
  if (transaction.amount > 0) {
    const incomeRules = rules.filter(rule => rule.category === 'Income');
    for (const rule of incomeRules) {
      if (rule.keywords.some(keyword => description.includes(keyword.toLowerCase()))) {
        return {
          ...transaction,
          category: rule.category,
          subcategory: rule.subcategory,
          vendor: extractVendor(transaction.description)
        };
      }
    }
    
    return {
      ...transaction,
      category: 'Income',
      subcategory: 'Other',
      vendor: extractVendor(transaction.description)
    };
  }
  
  // Sort rules by priority (higher priority first)
  const sortedRules = rules
    .filter(rule => rule.category !== 'Income')
    .sort((a, b) => b.priority - a.priority);
  
  for (const rule of sortedRules) {
    if (rule.keywords.some(keyword => description.includes(keyword.toLowerCase()))) {
      return {
        ...transaction,
        category: rule.category,
        subcategory: rule.subcategory,
        vendor: extractVendor(transaction.description)
      };
    }
  }
  
  return {
    ...transaction,
    category: 'Uncategorized',
    vendor: extractVendor(transaction.description)
  };
}

export function categorizeTransactions(transactions: Transaction[], rules: CategoryRule[] = DEFAULT_CATEGORY_RULES): Transaction[] {
  return transactions.map(transaction => categorizeTransaction(transaction, rules));
}

function extractVendor(description: string): string {
  let vendor = description.trim();
  
  // Remove common prefixes and suffixes
  vendor = vendor
    .replace(/^(purchase\s+|payment\s+to\s+|debit\s+)/i, '')
    .replace(/\s+(#\d+|purchase|payment|debit|credit).*$/i, '')
    .replace(/\s+\d{2}\/\d{2}.*$/i, '') // Remove dates
    .replace(/\s+[A-Z]{2}$/i, '') // Remove state codes
    .trim();
  
  // Take first part if multiple parts separated by common delimiters
  const parts = vendor.split(/[\-\*\/\\]/);
  if (parts.length > 1) {
    vendor = parts[0].trim();
  }
  
  // Limit length
  if (vendor.length > 30) {
    vendor = vendor.substring(0, 30).trim();
  }
  
  return vendor || 'Unknown Vendor';
}

export function addCustomRule(rules: CategoryRule[], keywords: string[], category: string, subcategory?: string): CategoryRule[] {
  const newRule: CategoryRule = {
    id: Date.now().toString(),
    keywords: keywords.map(k => k.toLowerCase()),
    category,
    subcategory,
    priority: 15 // High priority for custom rules
  };
  
  return [newRule, ...rules];
}

export function updateCategoryRule(rules: CategoryRule[], ruleId: string, updates: Partial<CategoryRule>): CategoryRule[] {
  return rules.map(rule => 
    rule.id === ruleId ? { ...rule, ...updates } : rule
  );
}

export function removeCategoryRule(rules: CategoryRule[], ruleId: string): CategoryRule[] {
  return rules.filter(rule => rule.id !== ruleId);
}

export function getUniqueCategories(transactions: Transaction[]): string[] {
  const categories = new Set(transactions.map(t => t.category).filter((cat): cat is string => Boolean(cat)));
  return Array.from(categories).sort();
}

export function getUniqueVendors(transactions: Transaction[]): string[] {
  const vendors = new Set(transactions.map(t => t.vendor).filter((vendor): vendor is string => Boolean(vendor)));
  return Array.from(vendors).sort();
}