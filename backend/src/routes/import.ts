import express from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../server';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import { ImportService } from '../services/ImportService';
import { DuplicateDetection } from '../services/DuplicateDetection';
import { config } from '../config';

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.upload.maxFileSize,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    if (config.upload.allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed`));
    }
  }
});

// Validation schemas
const columnMappingSchema = z.object({
  date: z.string().min(1, 'Date column is required'),
  description: z.string().min(1, 'Description column is required'),
  amount: z.string().min(1, 'Amount column is required'),
  category: z.string().optional(),
  vendor: z.string().optional(),
  notes: z.string().optional()
});

const importOptionsSchema = z.object({
  skipDuplicates: z.boolean().default(true),
  updateDuplicates: z.boolean().default(false),
  strictDuplicateMode: z.boolean().default(false),
  autoCategorize: z.boolean().default(true),
  dateFormat: z.string().optional(),
  encoding: z.string().optional()
});

const previewOptionsSchema = z.object({
  sampleSize: z.number().min(1).max(100).default(10)
});

// Preview file contents before import
router.post('/preview', upload.single('file'), asyncHandler(async (req: AuthRequest, res) => {
  if (!req.file) {
    throw new AppError('No file uploaded', 400);
  }

  const { sampleSize } = previewOptionsSchema.parse(req.body);

  try {
    const preview = await ImportService.previewFile(req.file, sampleSize);
    
    res.json({
      message: 'File preview generated successfully',
      ...preview
    });
  } catch (error) {
    throw new AppError(`File preview failed: ${error.message}`, 400);
  }
}));

// Import transactions from file
router.post('/upload', upload.single('file'), asyncHandler(async (req: AuthRequest, res) => {
  if (!req.file) {
    throw new AppError('No file uploaded', 400);
  }

  const columnMapping = columnMappingSchema.parse(
    typeof req.body.columnMapping === 'string' 
      ? JSON.parse(req.body.columnMapping)
      : req.body.columnMapping
  );

  const options = importOptionsSchema.parse(
    typeof req.body.options === 'string'
      ? JSON.parse(req.body.options)
      : req.body.options || {}
  );

  try {
    // Start import process
    global.io.to(`user-${req.user!.id}`).emit('import-started', {
      filename: req.file.originalname,
      fileSize: req.file.size
    });

    const result = await ImportService.importFile(
      req.user!.id,
      req.file,
      columnMapping,
      options
    );

    res.json({
      message: 'File imported successfully',
      result
    });

  } catch (error) {
    // Broadcast error to user
    global.io.to(`user-${req.user!.id}`).emit('import-error', {
      filename: req.file.originalname,
      error: error.message
    });

    throw new AppError(`Import failed: ${error.message}`, 400);
  }
}));

// Get import history
router.get('/history', asyncHandler(async (req: AuthRequest, res) => {
  const querySchema = z.object({
    limit: z.string().transform(Number).default('50'),
    offset: z.string().transform(Number).default('0')
  });

  const { limit, offset } = querySchema.parse(req.query);

  const [imports, total] = await Promise.all([
    prisma.import.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        _count: {
          select: { transactions: true }
        }
      }
    }),
    prisma.import.count({
      where: { userId: req.user!.id }
    })
  ]);

  res.json({
    imports,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + limit < total
    }
  });
}));

// Get detailed import information
router.get('/:importId', asyncHandler(async (req: AuthRequest, res) => {
  const importDetails = await ImportService.getImportDetails(
    req.user!.id,
    req.params.importId
  );

  res.json({
    import: importDetails
  });
}));

// Delete import and optionally its transactions
router.delete('/:importId', asyncHandler(async (req: AuthRequest, res) => {
  const deleteOptionsSchema = z.object({
    deleteTransactions: z.boolean().default(false)
  });

  const { deleteTransactions } = deleteOptionsSchema.parse(req.body);

  await ImportService.deleteImport(
    req.user!.id,
    req.params.importId,
    deleteTransactions
  );

  res.json({
    message: 'Import deleted successfully'
  });
}));

// Check for duplicate transactions
router.post('/check-duplicates', asyncHandler(async (req: AuthRequest, res) => {
  const duplicateCheckSchema = z.object({
    transactions: z.array(z.object({
      date: z.string(),
      description: z.string(),
      amount: z.number()
    })).max(1000, 'Maximum 1000 transactions per check'),
    options: z.object({
      strictMode: z.boolean().default(false),
      dateTolerance: z.number().min(0).max(30).default(1),
      amountTolerance: z.number().min(0).max(0.5).default(0.01),
      descriptionThreshold: z.number().min(0).max(1).default(0.85)
    }).optional()
  });

  const { transactions, options = {} } = duplicateCheckSchema.parse(req.body);

  const results = [];

  for (const transaction of transactions) {
    const transactionInput = {
      date: new Date(transaction.date),
      description: transaction.description,
      amount: transaction.amount,
      userId: req.user!.id
    };

    const duplicateCheck = await DuplicateDetection.isDuplicate(
      transactionInput,
      options
    );

    results.push({
      originalTransaction: transaction,
      duplicateCheck
    });
  }

  res.json({
    message: 'Duplicate check completed',
    results
  });
}));

// Get duplicate statistics
router.get('/stats/duplicates', asyncHandler(async (req: AuthRequest, res) => {
  const stats = await DuplicateDetection.getDuplicateStats(req.user!.id);

  res.json({
    duplicateStats: stats
  });
}));

// Export transactions to file
router.get('/export/:format', asyncHandler(async (req: AuthRequest, res) => {
  const exportSchema = z.object({
    format: z.enum(['csv', 'excel', 'json']),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    categoryIds: z.array(z.string()).optional(),
    includeCategories: z.boolean().default(true),
    includeVendors: z.boolean().default(true)
  });

  const { format } = exportSchema.parse(req.params);
  const filters = exportSchema.omit({ format: true }).parse(req.query);

  // Build where clause for export
  const where: any = { userId: req.user!.id };
  
  if (filters.startDate || filters.endDate) {
    where.date = {};
    if (filters.startDate) where.date.gte = new Date(filters.startDate);
    if (filters.endDate) where.date.lte = new Date(filters.endDate);
  }

  if (filters.categoryIds && filters.categoryIds.length > 0) {
    where.categoryId = { in: filters.categoryIds };
  }

  // Get transactions for export
  const transactions = await prisma.transaction.findMany({
    where,
    orderBy: { date: 'desc' },
    include: {
      category: filters.includeCategories ? { select: { name: true } } : false,
      vendor: filters.includeVendors ? { select: { name: true } } : false
    }
  });

  if (transactions.length === 0) {
    throw new AppError('No transactions found for export', 404);
  }

  // Prepare data for export
  const exportData = transactions.map(t => ({
    date: t.date.toISOString().split('T')[0],
    description: t.description,
    amount: t.amount,
    category: t.category?.name || '',
    vendor: t.vendor?.name || '',
    notes: t.notes || ''
  }));

  // Generate file based on format
  let fileContent: Buffer;
  let contentType: string;
  let filename: string;

  switch (format) {
    case 'csv':
      fileContent = await generateCsvExport(exportData);
      contentType = 'text/csv';
      filename = `transactions-${new Date().toISOString().split('T')[0]}.csv`;
      break;

    case 'excel':
      fileContent = await generateExcelExport(exportData);
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      filename = `transactions-${new Date().toISOString().split('T')[0]}.xlsx`;
      break;

    case 'json':
      fileContent = Buffer.from(JSON.stringify(exportData, null, 2));
      contentType = 'application/json';
      filename = `transactions-${new Date().toISOString().split('T')[0]}.json`;
      break;

    default:
      throw new AppError('Invalid export format', 400);
  }

  res.set({
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': fileContent.length.toString()
  });

  res.send(fileContent);
}));

// Helper functions for export
async function generateCsvExport(data: any[]): Promise<Buffer> {
  const Papa = require('papaparse');
  const csv = Papa.unparse(data);
  return Buffer.from(csv, 'utf8');
}

async function generateExcelExport(data: any[]): Promise<Buffer> {
  const XLSX = require('xlsx');
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(data);
  
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Transactions');
  
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

export default router;