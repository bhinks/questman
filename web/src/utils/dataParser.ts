import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { Transaction } from '../types';
import { v4 as uuidv4 } from 'uuid';

export interface ParseResult {
  transactions: Transaction[];
  errors: string[];
}

export async function parseFile(file: File): Promise<ParseResult> {
  const fileExtension = file.name.split('.').pop()?.toLowerCase();
  
  try {
    if (fileExtension === 'csv') {
      return await parseCSV(file);
    } else if (fileExtension === 'xlsx' || fileExtension === 'xls') {
      return await parseExcel(file);
    } else {
      return {
        transactions: [],
        errors: ['Unsupported file format. Please upload a CSV or Excel file.']
      };
    }
  } catch (error) {
    return {
      transactions: [],
      errors: [error instanceof Error ? error.message : 'Unknown error occurred while parsing file']
    };
  }
}

async function parseCSV(file: File): Promise<ParseResult> {
  return new Promise((resolve) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const { transactions, errors } = processRawData(results.data);
        resolve({ transactions, errors });
      },
      error: (error) => {
        resolve({
          transactions: [],
          errors: [`CSV parsing error: ${error.message}`]
        });
      }
    });
  });
}

async function parseExcel(file: File): Promise<ParseResult> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Use the first sheet
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);
        
        const { transactions, errors } = processRawData(jsonData);
        resolve({ transactions, errors });
      } catch (error) {
        resolve({
          transactions: [],
          errors: [error instanceof Error ? error.message : 'Excel parsing error']
        });
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

function processRawData(data: any[]): ParseResult {
  const transactions: Transaction[] = [];
  const errors: string[] = [];
  
  if (data.length === 0) {
    return {
      transactions: [],
      errors: ['No data found in file']
    };
  }
  
  // Find column mappings (case-insensitive)
  const firstRow = data[0];
  const columnMappings = findColumnMappings(firstRow);
  
  if (!columnMappings.date || !columnMappings.description || !columnMappings.amount) {
    errors.push('Required columns not found. Expected: Date, Description, Amount');
  }
  
  data.forEach((row, index) => {
    try {
      const transaction = parseTransaction(row, columnMappings, index);
      if (transaction) {
        transactions.push(transaction);
      }
    } catch (error) {
      errors.push(`Row ${index + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });
  
  return { transactions, errors };
}

interface ColumnMappings {
  date: string | null;
  description: string | null;
  amount: string | null;
}

function findColumnMappings(firstRow: any): ColumnMappings {
  const columns = Object.keys(firstRow);
  
  return {
    date: findColumn(columns, ['date', 'transaction date', 'posted date', 'datetime']),
    description: findColumn(columns, ['description', 'memo', 'transaction', 'details', 'payee']),
    amount: findColumn(columns, ['amount', 'debit', 'credit', 'value', 'transaction amount'])
  };
}

function findColumn(columns: string[], possibleNames: string[]): string | null {
  for (const name of possibleNames) {
    const found = columns.find(col => 
      col.toLowerCase().trim() === name.toLowerCase() ||
      col.toLowerCase().includes(name.toLowerCase())
    );
    if (found) return found;
  }
  return null;
}

function parseTransaction(row: any, mappings: ColumnMappings, _index: number): Transaction | null {
  if (!mappings.date || !mappings.description || !mappings.amount) {
    throw new Error('Missing required columns');
  }
  
  const dateStr = row[mappings.date];
  const description = row[mappings.description];
  const amountStr = row[mappings.amount];
  
  if (!dateStr || !description || (amountStr === undefined || amountStr === null)) {
    throw new Error('Missing required data');
  }
  
  // Parse date
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${dateStr}`);
  }
  
  // Parse amount
  let amount: number;
  if (typeof amountStr === 'number') {
    amount = amountStr;
  } else {
    // Remove currency symbols, commas, etc.
    const cleanAmount = String(amountStr).replace(/[$,\s]/g, '');
    amount = parseFloat(cleanAmount);
    if (isNaN(amount)) {
      throw new Error(`Invalid amount: ${amountStr}`);
    }
  }
  
  return {
    id: uuidv4(),
    date,
    description: String(description).trim(),
    amount,
  };
}

export function validateTransactions(transactions: Transaction[]): string[] {
  const errors: string[] = [];
  
  if (transactions.length === 0) {
    errors.push('No valid transactions found');
    return errors;
  }
  
  // Check for duplicate transactions
  const seen = new Set();
  const duplicates = new Set();
  
  transactions.forEach((transaction, _index) => {
    const key = `${transaction.date.toISOString()}_${transaction.description}_${transaction.amount}`;
    if (seen.has(key)) {
      duplicates.add(key);
    }
    seen.add(key);
  });
  
  if (duplicates.size > 0) {
    errors.push(`Found ${duplicates.size} potential duplicate transactions`);
  }
  
  // Check date range
  const dates = transactions.map(t => t.date.getTime());
  const minDate = new Date(Math.min(...dates));
  const maxDate = new Date(Math.max(...dates));
  const daysDiff = (maxDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24);
  
  if (daysDiff > 400) {
    errors.push(`Date range spans ${Math.round(daysDiff)} days, which seems unusually long`);
  }
  
  return errors;
}