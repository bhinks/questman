import { prisma } from '../server';
import { logger } from '../utils/logger';

export interface CategorizationResult {
  categoryId?: string;
  vendorId?: string;
  confidence: number;
  rule?: string;
  suggested?: boolean;
}

export interface CategorizationRule {
  id: string;
  userId: string;
  name: string;
  conditions: {
    descriptionContains?: string[];
    descriptionMatches?: string;
    amountRange?: { min?: number; max?: number };
    vendor?: string;
  };
  actions: {
    categoryId?: string;
    vendorId?: string;
    addTag?: string;
  };
  priority: number;
  isActive: boolean;
}

/**
 * Advanced transaction categorization engine with machine learning and custom rules
 */
export class CategorizationEngine {
  
  /**
   * Categorize a single transaction using rules and ML patterns
   */
  static async categorizeTransaction(
    userId: string,
    description: string,
    amount: number,
    existingCategoryId?: string
  ): Promise<CategorizationResult> {
    
    // Don't re-categorize if already has a manual category
    if (existingCategoryId) {
      return { confidence: 1.0 };
    }

    // Try custom rules first (highest priority)
    const ruleResult = await this.applyUserRules(userId, description, amount);
    if (ruleResult) {
      return ruleResult;
    }

    // Try machine learning patterns from user's history
    const mlResult = await this.applyMLCategorization(userId, description, amount);
    if (mlResult) {
      return mlResult;
    }

    // Fall back to default categorization patterns
    const defaultResult = this.applyDefaultRules(description, amount);
    if (defaultResult) {
      return { ...defaultResult, suggested: true };
    }

    return { confidence: 0 };
  }

  /**
   * Create or update a custom categorization rule
   */
  static async createRule(userId: string, rule: Omit<CategorizationRule, 'id' | 'userId'>): Promise<CategorizationRule> {
    const created = await prisma.categorizationRule.create({
      data: {
        userId,
        name: rule.name,
        conditions: JSON.stringify(rule.conditions),
        actions: JSON.stringify(rule.actions),
        priority: rule.priority,
        isActive: rule.isActive
      }
    });

    return {
      ...created,
      conditions: JSON.parse(created.conditions as string),
      actions: JSON.parse(created.actions as string)
    };
  }

  /**
   * Get all rules for a user
   */
  static async getUserRules(userId: string): Promise<CategorizationRule[]> {
    const rules = await prisma.categorizationRule.findMany({
      where: { userId },
      orderBy: { priority: 'asc' }
    });

    return rules.map(rule => ({
      ...rule,
      conditions: JSON.parse(rule.conditions as string),
      actions: JSON.parse(rule.actions as string)
    }));
  }

  /**
   * Auto-generate rules from user's transaction patterns
   */
  static async suggestRules(userId: string): Promise<CategorizationRule[]> {
    const suggestions: CategorizationRule[] = [];

    // Find patterns in manually categorized transactions
    const categorizedTransactions = await prisma.transaction.findMany({
      where: {
        userId,
        categoryId: { not: null },
        isManual: true
      },
      include: {
        category: true,
        vendor: true
      }
    });

    // Group by vendor and category
    const vendorPatterns = this.analyzeVendorPatterns(categorizedTransactions);
    const descriptionPatterns = this.analyzeDescriptionPatterns(categorizedTransactions);

    // Generate vendor-based rules
    for (const [vendor, data] of vendorPatterns) {
      if (data.confidence > 0.8 && data.count >= 3) {
        suggestions.push({
          id: '',
          userId,
          name: `Auto-categorize ${vendor}`,
          conditions: {
            vendor: vendor
          },
          actions: {
            categoryId: data.categoryId,
            vendorId: data.vendorId
          },
          priority: 100,
          isActive: false
        });
      }
    }

    // Generate description-based rules
    for (const [pattern, data] of descriptionPatterns) {
      if (data.confidence > 0.9 && data.count >= 5) {
        suggestions.push({
          id: '',
          userId,
          name: `Auto-categorize ${pattern}`,
          conditions: {
            descriptionContains: [pattern]
          },
          actions: {
            categoryId: data.categoryId
          },
          priority: 200,
          isActive: false
        });
      }
    }

    return suggestions;
  }

  /**
   * Apply user-defined custom rules
   */
  private static async applyUserRules(
    userId: string,
    description: string,
    amount: number
  ): Promise<CategorizationResult | null> {
    
    const rules = await this.getUserRules(userId);
    const activeRules = rules.filter(rule => rule.isActive);

    for (const rule of activeRules) {
      if (this.matchesRule(rule, description, amount)) {
        const result: CategorizationResult = {
          confidence: 0.95,
          rule: rule.name
        };

        if (rule.actions.categoryId) {
          result.categoryId = rule.actions.categoryId;
        }
        if (rule.actions.vendorId) {
          result.vendorId = rule.actions.vendorId;
        }

        logger.info(`Applied categorization rule: ${rule.name}`, { description, rule });
        return result;
      }
    }

    return null;
  }

  /**
   * Apply machine learning categorization based on user's history
   */
  private static async applyMLCategorization(
    userId: string,
    description: string,
    amount: number
  ): Promise<CategorizationResult | null> {
    
    // Get user's transaction history for pattern matching
    const historicalTransactions = await prisma.transaction.findMany({
      where: {
        userId,
        categoryId: { not: null }
      },
      include: {
        category: true,
        vendor: true
      },
      orderBy: { date: 'desc' },
      take: 1000 // Limit for performance
    });

    if (historicalTransactions.length < 10) {
      return null; // Not enough data for ML
    }

    // Find similar transactions using text similarity
    const similarities = historicalTransactions.map(transaction => ({
      transaction,
      similarity: this.calculateSimilarity(description, transaction.description),
      amountSimilarity: this.calculateAmountSimilarity(amount, transaction.amount)
    }));

    // Filter for high similarity matches
    const matches = similarities.filter(s => s.similarity > 0.7);

    if (matches.length === 0) {
      return null;
    }

    // Weight by both description and amount similarity
    const weightedMatches = matches.map(match => ({
      ...match,
      combinedScore: (match.similarity * 0.7) + (match.amountSimilarity * 0.3)
    })).sort((a, b) => b.combinedScore - a.combinedScore);

    const bestMatch = weightedMatches[0];

    if (bestMatch.combinedScore > 0.6) {
      return {
        categoryId: bestMatch.transaction.categoryId!,
        vendorId: bestMatch.transaction.vendorId,
        confidence: bestMatch.combinedScore
      };
    }

    return null;
  }

  /**
   * Apply default categorization rules for common patterns
   */
  private static applyDefaultRules(description: string, amount: number): CategorizationResult | null {
    const desc = description.toLowerCase();

    // Common merchant patterns
    const patterns = [
      { keywords: ['grocery', 'market', 'food'], category: 'groceries' },
      { keywords: ['gas', 'fuel', 'station'], category: 'transportation' },
      { keywords: ['restaurant', 'cafe', 'pizza'], category: 'dining' },
      { keywords: ['amazon', 'ebay', 'shopping'], category: 'shopping' },
      { keywords: ['uber', 'lyft', 'taxi'], category: 'transportation' },
      { keywords: ['netflix', 'spotify', 'subscription'], category: 'entertainment' },
      { keywords: ['pharmacy', 'medical', 'doctor'], category: 'healthcare' },
      { keywords: ['rent', 'mortgage', 'housing'], category: 'housing' }
    ];

    for (const pattern of patterns) {
      if (pattern.keywords.some(keyword => desc.includes(keyword))) {
        return {
          confidence: 0.6
          // Note: Would need to map to actual category IDs in database
        };
      }
    }

    return null;
  }

  /**
   * Check if transaction matches a rule's conditions
   */
  private static matchesRule(rule: CategorizationRule, description: string, amount: number): boolean {
    const { conditions } = rule;
    const desc = description.toLowerCase();

    // Check description contains
    if (conditions.descriptionContains) {
      const matches = conditions.descriptionContains.some(keyword => 
        desc.includes(keyword.toLowerCase())
      );
      if (!matches) return false;
    }

    // Check description regex
    if (conditions.descriptionMatches) {
      const regex = new RegExp(conditions.descriptionMatches, 'i');
      if (!regex.test(description)) return false;
    }

    // Check amount range
    if (conditions.amountRange) {
      const { min, max } = conditions.amountRange;
      if (min !== undefined && Math.abs(amount) < min) return false;
      if (max !== undefined && Math.abs(amount) > max) return false;
    }

    // Check vendor
    if (conditions.vendor) {
      if (!desc.includes(conditions.vendor.toLowerCase())) return false;
    }

    return true;
  }

  /**
   * Calculate text similarity using Levenshtein distance
   */
  private static calculateSimilarity(str1: string, str2: string): number {
    const clean1 = this.cleanDescription(str1);
    const clean2 = this.cleanDescription(str2);

    const distance = this.levenshteinDistance(clean1, clean2);
    const maxLength = Math.max(clean1.length, clean2.length);

    if (maxLength === 0) return 1;
    return 1 - (distance / maxLength);
  }

  /**
   * Calculate amount similarity (closer amounts = higher similarity)
   */
  private static calculateAmountSimilarity(amount1: number, amount2: number): number {
    const diff = Math.abs(amount1 - amount2);
    const max = Math.max(Math.abs(amount1), Math.abs(amount2));
    
    if (max === 0) return 1;
    return Math.max(0, 1 - (diff / max));
  }

  /**
   * Clean description for better matching
   */
  private static cleanDescription(description: string): string {
    return description
      .toLowerCase()
      .replace(/\b\d{4,}\b/g, '') // Remove long numbers
      .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, '') // Remove dates
      .replace(/[^a-z\s]/g, ' ') // Remove special characters
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private static levenshteinDistance(str1: string, str2: string): number {
    const matrix = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1, // insertion
            matrix[i - 1][j] + 1 // deletion
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Analyze vendor patterns from transaction history
   */
  private static analyzeVendorPatterns(transactions: any[]): Map<string, any> {
    const vendorMap = new Map();

    transactions.forEach(transaction => {
      if (!transaction.vendor) return;

      const vendor = transaction.vendor.name;
      const existing = vendorMap.get(vendor) || {
        categoryId: null,
        vendorId: null,
        count: 0,
        categories: new Map()
      };

      existing.count++;
      existing.vendorId = transaction.vendor.id;

      const categoryCount = existing.categories.get(transaction.categoryId) || 0;
      existing.categories.set(transaction.categoryId, categoryCount + 1);

      // Find most common category
      let mostCommonCategory = null;
      let maxCount = 0;
      for (const [categoryId, count] of existing.categories) {
        if (count > maxCount) {
          maxCount = count;
          mostCommonCategory = categoryId;
        }
      }

      existing.categoryId = mostCommonCategory;
      existing.confidence = maxCount / existing.count;

      vendorMap.set(vendor, existing);
    });

    return vendorMap;
  }

  /**
   * Analyze description patterns from transaction history
   */
  private static analyzeDescriptionPatterns(transactions: any[]): Map<string, any> {
    const patternMap = new Map();

    transactions.forEach(transaction => {
      const words = this.extractKeywords(transaction.description);

      words.forEach(word => {
        if (word.length < 3) return; // Skip short words

        const existing = patternMap.get(word) || {
          categoryId: null,
          count: 0,
          categories: new Map()
        };

        existing.count++;

        const categoryCount = existing.categories.get(transaction.categoryId) || 0;
        existing.categories.set(transaction.categoryId, categoryCount + 1);

        // Find most common category for this word
        let mostCommonCategory = null;
        let maxCount = 0;
        for (const [categoryId, count] of existing.categories) {
          if (count > maxCount) {
            maxCount = count;
            mostCommonCategory = categoryId;
          }
        }

        existing.categoryId = mostCommonCategory;
        existing.confidence = maxCount / existing.count;

        patternMap.set(word, existing);
      });
    });

    return patternMap;
  }

  /**
   * Extract meaningful keywords from transaction description
   */
  private static extractKeywords(description: string): string[] {
    const cleaned = this.cleanDescription(description);
    const words = cleaned.split(/\s+/).filter(word => word.length >= 3);
    
    // Remove common stop words
    const stopWords = ['the', 'and', 'for', 'inc', 'llc', 'corp', 'ltd'];
    return words.filter(word => !stopWords.includes(word));
  }
}