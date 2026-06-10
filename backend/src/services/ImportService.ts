import { prisma } from '../server';
import { logger } from '../utils/logger';
import { DuplicateDetection, ImportSummary, TransactionInput } from './DuplicateDetection';
import { CategorizationEngine } from './CategorizationEngine';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { parse as parseDate, isValid } from 'date-fns';

export interface ImportOptions {
  skipDuplicates: boolean;
  updateDuplicates: boolean;
  strictDuplicateMode: boolean;
  autoCategorize: boolean;
  dateFormat?: string;
  encoding?: string;
}

export interface ColumnMapping {
  date: string;
  description: string;
  amount: string;
  category?: string;
  vendor?: string;
  notes?: string;
  // Optional source-account label column (e.g. "Checking", "Visa"). Just a
  // string dimension — no balances or sync.
  account?: string;
}

export interface ImportResult extends ImportSummary {
  importId: string;
  filename: string;
  processingTime: number;
  warnings: string[];
  preview: any[];
}

/**
 * Advanced file import service with intelligent duplicate detection
 */
export class ImportService {
  
  /**
   * Import transactions from file with comprehensive duplicate detection
   */
  static async importFile(
    userId: string,
    file: Express.Multer.File,
    columnMapping: ColumnMapping,
    options: ImportOptions = {
      skipDuplicates: true,
      updateDuplicates: false,
      strictDuplicateMode: false,
      autoCategorize: true
    }
  ): Promise<ImportResult> {
    
    const startTime = Date.now();
    const importRecord = await this.createImportRecord(userId, file);
    
    try {
      // Parse file based on type
      const rawData = await this.parseFile(file);
      
      // Validate and map columns
      const { transactions, warnings } = await this.mapTransactions(
        rawData,
        columnMapping,
        userId,
        file.originalname,
        options
      );

      // Process transactions with duplicate detection
      const summary = await DuplicateDetection.processTransactionBatch(
        transactions,
        {
          skipDuplicates: options.skipDuplicates,
          updateDuplicates: options.updateDuplicates,
          strictMode: options.strictDuplicateMode,
          importId: importRecord.id
        }
      );

      // Auto-categorize imported transactions if enabled
      if (options.autoCategorize && summary.imported > 0) {
        await this.autoCategorizeImportedTransactions(userId, importRecord.id);
      }

      // Update import record with results
      await this.updateImportRecord(importRecord.id, summary, 'completed');

      // Broadcast import completion
      global.io.to(`user-${userId}`).emit('import-completed', {
        importId: importRecord.id,
        summary
      });

      const processingTime = Date.now() - startTime;

      return {
        ...summary,
        importId: importRecord.id,
        filename: file.originalname,
        processingTime,
        warnings,
        preview: transactions.slice(0, 5).map(t => ({
          date: t.date,
          description: t.description,
          amount: t.amount
        }))
      };

    } catch (error) {
      await this.updateImportRecord(importRecord.id, {
        totalProcessed: 0,
        imported: 0,
        duplicatesSkipped: 0,
        errors: 1,
        duplicateDetails: []
      }, 'failed', error.message);

      throw error;
    }
  }

  /**
   * Preview file contents and suggest column mappings
   */
  static async previewFile(
    file: Express.Multer.File,
    sampleSize: number = 10
  ): Promise<{
    preview: any[];
    suggestedMapping: ColumnMapping;
    columns: string[];
    detectedFormat: 'csv' | 'excel';
    stats: { totalRows: number; hasHeaders: boolean };
  }> {
    
    const rawData = await this.parseFile(file);
    const preview = rawData.slice(0, sampleSize);
    
    if (preview.length === 0) {
      throw new Error('File appears to be empty or corrupted');
    }

    const columns = Object.keys(preview[0]);
    const suggestedMapping = this.suggestColumnMapping(columns, preview);
    
    return {
      preview,
      suggestedMapping,
      columns,
      detectedFormat: this.getFileType(file),
      stats: {
        totalRows: rawData.length,
        hasHeaders: this.hasHeaders(preview)
      }
    };
  }

  /**
   * Get import history for a user
   */
  static async getImportHistory(userId: string, limit: number = 50) {
    return await prisma.import.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        _count: {
          select: { transactions: true }
        }
      }
    });
  }

  /**
   * Get detailed import information
   */
  static async getImportDetails(userId: string, importId: string) {
    const importRecord = await prisma.import.findFirst({
      where: { id: importId, userId },
      include: {
        transactions: {
          take: 100,
          orderBy: { date: 'desc' },
          include: {
            category: { select: { name: true, color: true } }
          }
        },
        _count: {
          select: { transactions: true }
        }
      }
    });

    if (!importRecord) {
      throw new Error('Import not found');
    }

    return importRecord;
  }

  /**
   * Delete an import and optionally its transactions
   */
  static async deleteImport(
    userId: string, 
    importId: string, 
    deleteTransactions: boolean = false
  ) {
    const importRecord = await prisma.import.findFirst({
      where: { id: importId, userId }
    });

    if (!importRecord) {
      throw new Error('Import not found');
    }

    if (deleteTransactions) {
      await prisma.transaction.deleteMany({
        where: { importId, userId }
      });
    } else {
      // Just remove the import association
      await prisma.transaction.updateMany({
        where: { importId, userId },
        data: { importId: null }
      });
    }

    await prisma.import.delete({
      where: { id: importId }
    });

    // Broadcast update
    global.io.to(`user-${userId}`).emit('import-deleted', { importId });
  }

  /**
   * Parse file contents based on file type
   */
  private static async parseFile(file: Express.Multer.File): Promise<any[]> {
    const fileType = this.getFileType(file);
    
    if (fileType === 'csv') {
      return this.parseCsvFile(file);
    } else if (fileType === 'excel') {
      return this.parseExcelFile(file);
    } else {
      throw new Error(`Unsupported file type: ${file.mimetype}`);
    }
  }

  /**
   * Parse CSV file
   */
  private static async parseCsvFile(file: Express.Multer.File): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const content = file.buffer.toString('utf8');
      
      Papa.parse(content, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header) => header.trim(),
        complete: (results) => {
          if (results.errors.length > 0) {
            logger.warn('CSV parsing warnings:', results.errors);
          }
          resolve(results.data);
        },
        error: (error) => {
          reject(new Error(`CSV parsing failed: ${error.message}`));
        }
      });
    });
  }

  /**
   * Parse Excel file
   */
  private static async parseExcelFile(file: Express.Multer.File): Promise<any[]> {
    try {
      // cellDates converts date-formatted cells into JS Date objects
      // instead of raw serial numbers (a 2026 date ≈ serial 46024,
      // which otherwise gets misread as the year 46024).
      const workbook = XLSX.read(file.buffer, { type: 'buffer', cellDates: true });
      const sheetName = workbook.SheetNames[0];
      
      if (!sheetName) {
        throw new Error('Excel file contains no worksheets');
      }

      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { 
        header: 1,
        defval: ''
      });

      // Convert array of arrays to array of objects
      if (jsonData.length === 0) return [];
      
      const headers = jsonData[0] as string[];
      const rows = jsonData.slice(1) as any[][];
      
      return rows
        .filter(row => row.some(cell => cell !== '')) // Filter empty rows
        .map(row => {
          const obj: any = {};
          headers.forEach((header, index) => {
            obj[header.toString().trim()] = row[index] || '';
          });
          return obj;
        });

    } catch (error) {
      throw new Error(`Excel parsing failed: ${error.message}`);
    }
  }

  /**
   * Map raw data to transaction objects
   */
  private static async mapTransactions(
    rawData: any[],
    mapping: ColumnMapping,
    userId: string,
    sourceFile: string,
    options: ImportOptions
  ): Promise<{ transactions: TransactionInput[]; warnings: string[] }> {
    
    const transactions: TransactionInput[] = [];
    const warnings: string[] = [];
    let successfulRows = 0;

    for (let i = 0; i < rawData.length; i++) {
      const row = rawData[i];
      
      try {
        const transaction = await this.mapSingleTransaction(
          row, 
          mapping, 
          userId, 
          sourceFile, 
          i + 1,
          options
        );
        
        if (transaction) {
          transactions.push(transaction);
          successfulRows++;
        }
      } catch (error) {
        warnings.push(`Row ${i + 1}: ${error.message}`);
      }
    }

    if (successfulRows === 0) {
      throw new Error('No valid transactions found in file');
    }

    if (warnings.length > 0) {
      logger.warn(`Import warnings for ${sourceFile}:`, warnings);
    }

    return { transactions, warnings };
  }

  /**
   * Map single row to transaction
   */
  private static async mapSingleTransaction(
    row: any,
    mapping: ColumnMapping,
    userId: string,
    sourceFile: string,
    rowNumber: number,
    options: ImportOptions
  ): Promise<TransactionInput | null> {
    
    // Extract and validate required fields
    const dateStr = this.getFieldValue(row, mapping.date);
    const description = this.getFieldValue(row, mapping.description);
    const amountStr = this.getFieldValue(row, mapping.amount);

    if (!dateStr || !description || !amountStr) {
      throw new Error('Missing required fields (date, description, or amount)');
    }

    // Parse date
    const date = this.parseDate(dateStr, options.dateFormat);
    if (!date) {
      throw new Error(`Invalid date format: ${dateStr}`);
    }

    // Parse amount
    const amount = this.parseAmount(amountStr);
    if (isNaN(amount)) {
      throw new Error(`Invalid amount: ${amountStr}`);
    }

    // Clean description
    const cleanDescription = description.trim();
    if (cleanDescription.length === 0) {
      throw new Error('Empty description');
    }

    // Optional account label — trimmed string, empty cell → null.
    const accountStr = mapping.account ? this.getFieldValue(row, mapping.account) : '';
    const account = accountStr.length > 0 ? accountStr : null;

    return {
      date,
      description: cleanDescription,
      amount,
      userId,
      originalDescription: description,
      sourceFile,
      sourceRow: rowNumber,
      account
    };
  }

  /**
   * Get field value from row, handling different column name formats
   */
  private static getFieldValue(row: any, columnName: string): string {
    // Try exact match first
    if (row[columnName] !== undefined) {
      return String(row[columnName]).trim();
    }

    // Try case-insensitive match
    const keys = Object.keys(row);
    const matchingKey = keys.find(key => 
      key.toLowerCase() === columnName.toLowerCase()
    );

    if (matchingKey) {
      return String(row[matchingKey]).trim();
    }

    return '';
  }

  /**
   * Parse date string with multiple format support
   */
  private static parseDate(dateStr: string, preferredFormat?: string): Date | null {
    const raw = dateStr.trim();
    if (!raw) return null;

    // Excel serial date: a bare number that XLSX exports use for dates
    // (days since the 1900 epoch). Convert if it's in a plausible range.
    if (/^\d+(\.\d+)?$/.test(raw)) {
      const serial = parseFloat(raw);
      if (serial >= 10000 && serial <= 80000) { // ~1927..2119
        const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000);
        if (this.plausibleYear(d)) return d;
      }
    }

    // 4-digit-year formats first so e.g. "01/15/2024" never matches a
    // 2-digit-year pattern; 2-digit formats are the fallback.
    const formats = [
      preferredFormat,
      'yyyy-MM-dd',
      'MM/dd/yyyy', 'M/d/yyyy',
      'dd/MM/yyyy', 'd/M/yyyy',
      'MM-dd-yyyy', 'dd-MM-yyyy',
      'MM/dd/yy', 'M/d/yy',
    ].filter(Boolean) as string[];

    for (const format of formats) {
      try {
        const parsed = parseDate(raw, format, new Date());
        // Reject implausible years (e.g. a misparse yielding year 24 or
        // 46024) so they fall through instead of reaching the DB.
        if (isValid(parsed) && this.plausibleYear(parsed)) {
          return parsed;
        }
      } catch (error) {
        // Continue to next format
      }
    }

    // Native parsing as a last resort (handles "Jan 15, 2024", ISO, etc.).
    const nativeDate = new Date(raw);
    return isValid(nativeDate) && this.plausibleYear(nativeDate) ? nativeDate : null;
  }

  /** A transaction date should land in a sane window, not year 24 or 46024. */
  private static plausibleYear(d: Date): boolean {
    const y = d.getFullYear();
    return y >= 1990 && y <= 2100;
  }

  /**
   * Parse amount string, handling various formats
   */
  private static parseAmount(amountStr: string): number {
    // Remove currency symbols and whitespace
    const cleaned = amountStr
      .replace(/[$€£¥₹,\s]/g, '')
      .replace(/[()]/g, '') // Remove parentheses
      .trim();

    // Handle negative amounts in parentheses
    const isNegative = amountStr.includes('(') && amountStr.includes(')');
    
    let amount = parseFloat(cleaned);
    
    if (isNegative && amount > 0) {
      amount = -amount;
    }

    return amount;
  }

  /**
   * Suggest column mapping based on header analysis
   */
  private static suggestColumnMapping(columns: string[], preview: any[]): ColumnMapping {
    const mapping: ColumnMapping = {
      date: '',
      description: '',
      amount: ''
    };

    const columnLower = columns.map(c => c.toLowerCase());

    // Date column
    const dateKeywords = ['date', 'transaction date', 'posted date', 'posted', 'time'];
    mapping.date = this.findBestMatch(columnLower, dateKeywords, columns);

    // Description column
    const descKeywords = ['description', 'memo', 'transaction', 'detail', 'payee', 'merchant'];
    mapping.description = this.findBestMatch(columnLower, descKeywords, columns);

    // Amount column
    const amountKeywords = ['amount', 'value', 'debit', 'credit', 'total', 'sum'];
    mapping.amount = this.findBestMatch(columnLower, amountKeywords, columns);

    // Account column (optional) — only set when a header actually matches;
    // there is no sensible fallback for an optional dimension.
    const accountIndex = columnLower.findIndex(col => /account|acct|source|bank|card/i.test(col));
    if (accountIndex !== -1) {
      mapping.account = columns[accountIndex];
    }

    return mapping;
  }

  private static findBestMatch(columnLower: string[], keywords: string[], originalColumns: string[]): string {
    for (const keyword of keywords) {
      const index = columnLower.findIndex(col => col.includes(keyword));
      if (index !== -1) {
        return originalColumns[index];
      }
    }
    return originalColumns[0] || '';
  }

  private static hasHeaders(preview: any[]): boolean {
    if (preview.length < 2) return true;
    
    const firstRow = preview[0];
    const secondRow = preview[1];
    
    // Check if first row has non-numeric values while second row has numbers
    const firstRowKeys = Object.keys(firstRow);
    return firstRowKeys.some(key => {
      const firstValue = firstRow[key];
      const secondValue = secondRow[key];
      return isNaN(Number(firstValue)) && !isNaN(Number(secondValue));
    });
  }

  private static getFileType(file: Express.Multer.File): 'csv' | 'excel' {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      return 'csv';
    }
    if (
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.originalname.endsWith('.xlsx') ||
      file.originalname.endsWith('.xls')
    ) {
      return 'excel';
    }
    return 'csv'; // Default fallback
  }

  private static async createImportRecord(userId: string, file: Express.Multer.File) {
    return await prisma.import.create({
      data: {
        userId,
        filename: `import_${Date.now()}_${file.originalname}`,
        originalName: file.originalname,
        fileSize: file.size,
        format: this.getFileType(file),
        totalRows: 0,
        processedRows: 0,
        errorRows: 0,
        duplicateRows: 0,
        status: 'processing'
      }
    });
  }

  private static async updateImportRecord(
    importId: string, 
    summary: ImportSummary, 
    status: string, 
    errorMessage?: string
  ) {
    await prisma.import.update({
      where: { id: importId },
      data: {
        totalRows: summary.totalProcessed,
        processedRows: summary.imported,
        errorRows: summary.errors,
        duplicateRows: summary.duplicatesSkipped,
        status,
        errorMessage
      }
    });
  }

  private static async autoCategorizeImportedTransactions(userId: string, importId: string) {
    const transactions = await prisma.transaction.findMany({
      where: { userId, importId, categoryId: null }
    });

    for (const transaction of transactions) {
      const categorization = await CategorizationEngine.categorizeTransaction(
        userId,
        transaction.description,
        transaction.amount
      );

      if (categorization.categoryId) {
        await prisma.transaction.update({
          where: { id: transaction.id },
          data: {
            categoryId: categorization.categoryId,
            vendorId: categorization.vendorId,
            confidence: categorization.confidence
          }
        });
      }
    }
  }
}