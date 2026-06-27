import { prisma } from '../server';
import { logger } from '../utils/logger';
import { DescriptionNormalizer } from './DescriptionNormalizer';

export interface TransactionInput {
  date: Date;
  description: string;
  amount: number;
  userId: string;
  originalDescription?: string;
  sourceFile?: string;
  sourceRow?: number;
  // Optional source-account label carried through from the import mapping.
  account?: string | null;
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  existingTransactionId?: string;
  similarity: number;
  reason: 'exact_match' | 'fuzzy_match' | 'amount_date_match' | 'description_similarity' | 'none';
  confidence: number;
}

export interface ImportSummary {
  totalProcessed: number;
  imported: number;
  duplicatesSkipped: number;
  errors: number;
  duplicateDetails: Array<{
    originalTransaction: TransactionInput;
    existingTransaction: any;
    reason: string;
  }>;
}

/**
 * Advanced duplicate detection system for financial transactions
 */
export class DuplicateDetection {
  
  /**
   * Check if a transaction is a duplicate using multiple detection strategies
   */
  static async isDuplicate(
    transaction: TransactionInput,
    options: {
      strictMode?: boolean;
      dateTolerance?: number; // days
      amountTolerance?: number; // percentage
      descriptionThreshold?: number; // similarity threshold 0-1
    } = {}
  ): Promise<DuplicateCheckResult> {
    
    const {
      strictMode = false,
      dateTolerance = 1, // 1 day tolerance
      amountTolerance = 0.01, // 1% amount tolerance
      descriptionThreshold = 0.85 // 85% similarity threshold
    } = options;

    // Strategy 1: Exact match (date, amount, description)
    const exactMatch = await this.findExactMatch(transaction);
    if (exactMatch) {
      return {
        isDuplicate: true,
        existingTransactionId: exactMatch.id,
        similarity: 1.0,
        reason: 'exact_match',
        confidence: 1.0
      };
    }

    // Strategy 2: Amount + Date match (within tolerance)
    const amountDateMatch = await this.findAmountDateMatch(
      transaction, 
      dateTolerance, 
      amountTolerance
    );
    if (amountDateMatch) {
      const descSimilarity = this.calculateDescriptionSimilarity(
        transaction.description, 
        amountDateMatch.description
      );
      
      if (descSimilarity > descriptionThreshold) {
        return {
          isDuplicate: true,
          existingTransactionId: amountDateMatch.id,
          similarity: descSimilarity,
          reason: 'amount_date_match',
          confidence: 0.9
        };
      }
    }

    // Strategy 3: Fuzzy description matching (for same vendor, different formatting)
    if (!strictMode) {
      const fuzzyMatch = await this.findFuzzyDescriptionMatch(
        transaction, 
        descriptionThreshold,
        dateTolerance * 2 // Wider date tolerance for fuzzy matching
      );
      
      if (fuzzyMatch) {
        return {
          isDuplicate: true,
          existingTransactionId: fuzzyMatch.id,
          similarity: fuzzyMatch.similarity,
          reason: 'description_similarity',
          confidence: 0.7
        };
      }
    }

    // Strategy 4: Bank-specific duplicate patterns
    const bankPatternMatch = await this.findBankPatternDuplicate(transaction);
    if (bankPatternMatch) {
      return {
        isDuplicate: true,
        existingTransactionId: bankPatternMatch.id,
        similarity: bankPatternMatch.similarity,
        reason: 'fuzzy_match',
        confidence: 0.8
      };
    }

    return {
      isDuplicate: false,
      similarity: 0,
      reason: 'none',
      confidence: 0
    };
  }

  /**
   * Process multiple transactions with duplicate detection
   */
  static async processTransactionBatch(
    transactions: TransactionInput[],
    options: {
      skipDuplicates?: boolean;
      updateDuplicates?: boolean;
      strictMode?: boolean;
      importId?: string;
    } = {}
  ): Promise<ImportSummary> {
    
    const {
      skipDuplicates = true,
      updateDuplicates = false,
      strictMode = false,
      importId
    } = options;

    const summary: ImportSummary = {
      totalProcessed: 0,
      imported: 0,
      duplicatesSkipped: 0,
      errors: 0,
      duplicateDetails: []
    };

    const processedHashes = new Set<string>(); // Track duplicates within the batch

    for (const transaction of transactions) {
      summary.totalProcessed++;

      try {
        // Check for duplicates within the current batch
        const batchHash = this.generateTransactionHash(transaction);
        if (processedHashes.has(batchHash)) {
          summary.duplicatesSkipped++;
          summary.duplicateDetails.push({
            originalTransaction: transaction,
            existingTransaction: null,
            reason: 'Duplicate within import batch'
          });
          continue;
        }

        // Check against existing database transactions
        const duplicateCheck = await this.isDuplicate(transaction, { strictMode });

        if (duplicateCheck.isDuplicate) {
          if (skipDuplicates) {
            summary.duplicatesSkipped++;
            
            const existingTransaction = await prisma.transaction.findUnique({
              where: { id: duplicateCheck.existingTransactionId! }
            });

            summary.duplicateDetails.push({
              originalTransaction: transaction,
              existingTransaction,
              reason: `${duplicateCheck.reason} (confidence: ${(duplicateCheck.confidence * 100).toFixed(0)}%)`
            });
            
            continue;
          } else if (updateDuplicates) {
            // Update existing transaction with new data if it's more complete
            await this.updateTransactionIfBetter(
              duplicateCheck.existingTransactionId!,
              transaction
            );
            summary.imported++;
            continue;
          }
        }

        // Import new transaction
        await prisma.transaction.create({
          data: {
            userId: transaction.userId,
            date: transaction.date,
            description: transaction.description,
            amount: transaction.amount,
            originalDescription: transaction.originalDescription || transaction.description,
            descriptionNormalized: DescriptionNormalizer.normalizeOne(transaction.description),
            // The source filename lives on the linked Import record; the
            // Transaction model has no `sourceFile` column.
            importId: importId || null,
            notes: transaction.sourceRow ? `Imported from row ${transaction.sourceRow}` : null,
            account: transaction.account ?? null
          }
        });

        processedHashes.add(batchHash);
        summary.imported++;

      } catch (error) {
        logger.error('Error processing transaction:', error);
        summary.errors++;
      }
    }

    // Log import summary
    logger.info('Import completed', {
      summary,
      duplicateRate: (summary.duplicatesSkipped / summary.totalProcessed) * 100
    });

    return summary;
  }

  /**
   * Find exact match: same date, amount, and description
   */
  private static async findExactMatch(transaction: TransactionInput) {
    return await prisma.transaction.findFirst({
      where: {
        userId: transaction.userId,
        date: transaction.date,
        amount: transaction.amount,
        description: transaction.description
      }
    });
  }

  /**
   * Find match by amount and date within tolerance
   */
  private static async findAmountDateMatch(
    transaction: TransactionInput,
    dateTolerance: number,
    amountTolerance: number
  ) {
    const dateStart = new Date(transaction.date);
    dateStart.setDate(dateStart.getDate() - dateTolerance);
    
    const dateEnd = new Date(transaction.date);
    dateEnd.setDate(dateEnd.getDate() + dateTolerance);

    const amountLower = transaction.amount * (1 - amountTolerance);
    const amountUpper = transaction.amount * (1 + amountTolerance);

    return await prisma.transaction.findFirst({
      where: {
        userId: transaction.userId,
        date: {
          gte: dateStart,
          lte: dateEnd
        },
        amount: {
          gte: Math.min(amountLower, amountUpper),
          lte: Math.max(amountLower, amountUpper)
        }
      },
      orderBy: [
        { date: 'desc' },
        { createdAt: 'desc' }
      ]
    });
  }

  /**
   * Find fuzzy description match using similarity algorithms
   */
  private static async findFuzzyDescriptionMatch(
    transaction: TransactionInput,
    threshold: number,
    dateTolerance: number
  ): Promise<{ id: string; similarity: number } | null> {
    
    const dateStart = new Date(transaction.date);
    dateStart.setDate(dateStart.getDate() - dateTolerance);
    
    const dateEnd = new Date(transaction.date);
    dateEnd.setDate(dateEnd.getDate() + dateTolerance);

    // Get potential matches within date range
    const candidates = await prisma.transaction.findMany({
      where: {
        userId: transaction.userId,
        date: {
          gte: dateStart,
          lte: dateEnd
        }
      },
      select: { id: true, description: true, amount: true }
    });

    let bestMatch = null;
    let bestSimilarity = 0;

    for (const candidate of candidates) {
      const similarity = this.calculateDescriptionSimilarity(
        transaction.description,
        candidate.description
      );

      if (similarity > threshold && similarity > bestSimilarity) {
        bestMatch = candidate;
        bestSimilarity = similarity;
      }
    }

    return bestMatch ? { id: bestMatch.id, similarity: bestSimilarity } : null;
  }

  /**
   * Detect bank-specific duplicate patterns
   */
  private static async findBankPatternDuplicate(
    transaction: TransactionInput
  ): Promise<{ id: string; similarity: number } | null> {
    
    // Common bank duplicate patterns
    const cleanDescription = this.cleanBankDescription(transaction.description);
    const vendor = this.extractVendorName(transaction.description);

    if (!vendor || vendor.length < 3) return null;

    // Look for transactions with same vendor and amount within 3 days
    const dateStart = new Date(transaction.date);
    dateStart.setDate(dateStart.getDate() - 3);
    
    const dateEnd = new Date(transaction.date);
    dateEnd.setDate(dateEnd.getDate() + 3);

    const candidates = await prisma.transaction.findMany({
      where: {
        userId: transaction.userId,
        date: { gte: dateStart, lte: dateEnd },
        amount: transaction.amount,
        // SQLite has no `mode: 'insensitive'` (Postgres-only); `contains`
        // compiles to LIKE, which is already case-insensitive for ASCII.
        description: {
          contains: vendor
        }
      }
    });

    if (candidates.length > 0) {
      return {
        id: candidates[0].id,
        similarity: 0.95
      };
    }

    return null;
  }

  /**
   * Calculate text similarity using Levenshtein distance
   */
  private static calculateDescriptionSimilarity(desc1: string, desc2: string): number {
    const clean1 = this.cleanBankDescription(desc1);
    const clean2 = this.cleanBankDescription(desc2);

    const distance = this.levenshteinDistance(clean1, clean2);
    const maxLength = Math.max(clean1.length, clean2.length);
    
    if (maxLength === 0) return 1;
    
    return 1 - (distance / maxLength);
  }

  /**
   * Generate unique hash for transaction to detect batch duplicates
   */
  private static generateTransactionHash(transaction: TransactionInput): string {
    const dateStr = transaction.date.toISOString().split('T')[0]; // YYYY-MM-DD
    const cleanDesc = this.cleanBankDescription(transaction.description);
    const amountStr = transaction.amount.toFixed(2);
    
    return `${transaction.userId}:${dateStr}:${cleanDesc}:${amountStr}`;
  }

  /**
   * Clean bank transaction descriptions for better matching
   */
  private static cleanBankDescription(description: string): string {
    return description
      .toLowerCase()
      .replace(/\b\d{4,}\b/g, '') // Remove long numbers (reference numbers)
      .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, '') // Remove dates
      .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, '') // Remove times
      .replace(/[^\w\s]/g, ' ') // Replace special characters with spaces
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  /**
   * Extract vendor name from transaction description
   */
  private static extractVendorName(description: string): string {
    const cleaned = this.cleanBankDescription(description);
    const words = cleaned.split(' ').filter(word => word.length > 2);
    
    // Return first meaningful word as vendor
    return words[0] || '';
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
   * Update existing transaction if new one has better data
   */
  private static async updateTransactionIfBetter(
    existingId: string,
    newTransaction: TransactionInput
  ) {
    const existing = await prisma.transaction.findUnique({
      where: { id: existingId }
    });

    if (!existing) return;

    const updates: any = {};

    // Update if new description is longer/more detailed
    if (newTransaction.description.length > existing.description.length) {
      updates.description = newTransaction.description;
    }

    // Store original description if not present
    if (!existing.originalDescription && newTransaction.originalDescription) {
      updates.originalDescription = newTransaction.originalDescription;
    }

    if (Object.keys(updates).length > 0) {
      await prisma.transaction.update({
        where: { id: existingId },
        data: updates
      });
    }
  }

  /**
   * Get duplicate statistics for a user
   */
  static async getDuplicateStats(userId: string) {
    const totalTransactions = await prisma.transaction.count({
      where: { userId }
    });

    // Find potential duplicates (same amount and similar date)
    const potentialDuplicates = await prisma.$queryRaw<Array<{ duplicate_groups: number; total_duplicates: number }>>`
      SELECT 
        COUNT(*) as duplicate_groups,
        SUM(group_size - 1) as total_duplicates
      FROM (
        SELECT 
          date, 
          amount, 
          COUNT(*) as group_size
        FROM transactions 
        WHERE userId = ${userId}
        GROUP BY date, amount
        HAVING COUNT(*) > 1
      ) duplicate_groups
    `;

    return {
      totalTransactions,
      potentialDuplicates: potentialDuplicates[0] || { duplicate_groups: 0, total_duplicates: 0 }
    };
  }
}