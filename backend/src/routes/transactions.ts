import express from 'express';
import { z } from 'zod';
import { prisma } from '../server';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import { AnalyticsEngine } from '../services/AnalyticsEngine';
import { CategorizationEngine } from '../services/CategorizationEngine';
import { DescriptionNormalizer } from '../services/DescriptionNormalizer';

const router = express.Router();

// Validation schemas
const createTransactionSchema = z.object({
  date: z.string().datetime(),
  description: z.string().min(1, 'Description is required'),
  amount: z.number(),
  categoryId: z.string().nullable().optional(),
  vendorId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  // Finance depth: edit flags + links persist through the PUT now. nullable so
  // the editor can UNlink a project/chore by sending null.
  isWasteful: z.boolean().optional(),
  excluded: z.boolean().optional(),
  projectId: z.string().nullable().optional(),
  choreId: z.string().nullable().optional(),
  // Source-account label (plain string dimension; null clears it).
  account: z.string().nullable().optional()
});

const updateTransactionSchema = createTransactionSchema.partial();

const querySchema = z.object({
  page: z.string().transform(Number).default('1'),
  limit: z.string().transform(Number).default('50'),
  sortBy: z.enum(['date', 'amount', 'description', 'descriptionNormalized', 'category']).default('date'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  categoryId: z.string().optional(),
  minAmount: z.string().transform(Number).optional(),
  maxAmount: z.string().transform(Number).optional(),
  search: z.string().optional(),
  isWasteful: z.enum(['true', 'false']).transform(Boolean).optional(),
  // Finance depth: filter by exclusion state ("true" = only excluded,
  // "false" = only included). Omit to get everything (the client greys
  // excluded rows in-place).
  excluded: z.enum(['true', 'false']).transform(v => v === 'true').optional(),
  projectId: z.string().optional(),
  choreId: z.string().optional(),
  // Exact-match filter on the source-account label.
  account: z.string().optional()
});

const bulkOperationSchema = z.object({
  transactionIds: z.array(z.string()).min(1, 'At least one transaction ID required'),
  operation: z.enum(['delete', 'categorize', 'tag', 'exclude', 'link']),
  data: z.object({
    categoryId: z.string().optional(),
    tags: z.array(z.string()).optional(),
    excluded: z.boolean().optional(),
    projectId: z.string().nullable().optional(),
    choreId: z.string().nullable().optional()
  }).optional()
});

// Get transactions with advanced filtering
router.get('/', asyncHandler(async (req: AuthRequest, res) => {
  const {
    page,
    limit,
    sortBy,
    sortOrder,
    startDate,
    endDate,
    categoryId,
    minAmount,
    maxAmount,
    search,
    isWasteful,
    excluded,
    projectId,
    choreId,
    account
  } = querySchema.parse(req.query);

  const offset = (page - 1) * limit;

  // Build where clause
  const where: any = {
    userId: req.user!.id
  };

  if (startDate || endDate) {
    where.date = {};
    if (startDate) where.date.gte = new Date(startDate);
    if (endDate) where.date.lte = new Date(endDate);
  }

  if (categoryId) where.categoryId = categoryId;
  if (minAmount !== undefined) where.amount = { ...where.amount, gte: minAmount };
  if (maxAmount !== undefined) where.amount = { ...where.amount, lte: maxAmount };
  if (isWasteful !== undefined) where.isWasteful = isWasteful;
  if (excluded !== undefined) where.excluded = excluded;
  if (projectId) where.projectId = projectId;
  if (choreId) where.choreId = choreId;
  if (account) where.account = account;

  if (search) {
    // SQLite has no `mode: 'insensitive'` (Postgres-only); `contains`
    // compiles to LIKE, already case-insensitive for ASCII.
    where.OR = [
      { description: { contains: search } },
      { notes: { contains: search } },
      { vendor: { name: { contains: search } } }
    ];
  }

  // Execute query with pagination
  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      skip: offset,
      take: limit,
      orderBy: { [sortBy]: sortOrder },
      include: {
        category: { select: { id: true, name: true, color: true, icon: true } },
        vendor: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
        chore: { select: { id: true, title: true } },
        import: { select: { id: true, filename: true } }
      }
    }),
    prisma.transaction.count({ where })
  ]);

  const totalPages = Math.ceil(total / limit);

  res.json({
    transactions,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1
    }
  });
}));

// Get distinct source-account labels for filter dropdowns.
// NOTE: must be registered before GET /:id or "accounts" matches as an id.
router.get('/accounts', asyncHandler(async (req: AuthRequest, res) => {
  const rows = await prisma.transaction.findMany({
    where: { userId: req.user!.id, account: { not: null } },
    distinct: ['account'],
    select: { account: true },
    orderBy: { account: 'asc' }
  });

  res.json({ accounts: rows.map(r => r.account as string) });
}));

// Get transaction by ID
router.get('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const transaction = await prisma.transaction.findFirst({
    where: {
      id: req.params.id,
      userId: req.user!.id
    },
    include: {
      category: true,
      vendor: true,
      project: { select: { id: true, name: true } },
      chore: { select: { id: true, title: true } },
      import: true
    }
  });

  if (!transaction) {
    throw new AppError('Transaction not found', 404);
  }

  res.json({ transaction });
}));

// Create new transaction
router.post('/', asyncHandler(async (req: AuthRequest, res) => {
  const data = createTransactionSchema.parse(req.body);
  
  // Auto-categorize if no category provided
  let categoryId = data.categoryId;
  let vendorId = data.vendorId;
  
  if (!categoryId) {
    const categorization = await CategorizationEngine.categorizeTransaction(
      req.user!.id,
      data.description,
      data.amount
    );
    categoryId = categorization.categoryId;
    vendorId = categorization.vendorId;
  }

  const transaction = await prisma.transaction.create({
    data: {
      ...data,
      date: new Date(data.date),
      categoryId,
      vendorId,
      userId: req.user!.id,
      tags: data.tags ? JSON.stringify(data.tags) : null,
      descriptionNormalized: DescriptionNormalizer.normalizeOne(data.description),
      isManual: true
    },
    include: {
      category: true,
      vendor: true
    }
  });

  // Broadcast update to user's connected clients
  global.io.to(`user-${req.user!.id}`).emit('transaction-created', transaction);

  // Trigger analytics update
  AnalyticsEngine.updateUserAnalytics(req.user!.id);

  res.status(201).json({
    message: 'Transaction created successfully',
    transaction
  });
}));

// Update transaction
router.put('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const data = updateTransactionSchema.parse(req.body);

  // Verify ownership
  const existing = await prisma.transaction.findFirst({
    where: {
      id: req.params.id,
      userId: req.user!.id
    }
  });

  if (!existing) {
    throw new AppError('Transaction not found', 404);
  }

  const updateData: any = { ...data, isManual: true };
  if (data.date) updateData.date = new Date(data.date);
  if (data.tags) updateData.tags = JSON.stringify(data.tags);
  if (data.description) updateData.descriptionNormalized = DescriptionNormalizer.normalizeOne(data.description);

  const transaction = await prisma.transaction.update({
    where: { id: req.params.id },
    data: updateData,
    include: {
      category: true,
      vendor: true
    }
  });

  // Broadcast update
  global.io.to(`user-${req.user!.id}`).emit('transaction-updated', transaction);

  // Trigger analytics update
  AnalyticsEngine.updateUserAnalytics(req.user!.id);

  res.json({
    message: 'Transaction updated successfully',
    transaction
  });
}));

// Delete transaction
router.delete('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const transaction = await prisma.transaction.findFirst({
    where: {
      id: req.params.id,
      userId: req.user!.id
    }
  });

  if (!transaction) {
    throw new AppError('Transaction not found', 404);
  }

  await prisma.transaction.delete({
    where: { id: req.params.id }
  });

  // Broadcast update
  global.io.to(`user-${req.user!.id}`).emit('transaction-deleted', { id: req.params.id });

  // Trigger analytics update
  AnalyticsEngine.updateUserAnalytics(req.user!.id);

  res.json({ message: 'Transaction deleted successfully' });
}));

// Bulk operations
router.post('/bulk', asyncHandler(async (req: AuthRequest, res) => {
  const { transactionIds, operation, data } = bulkOperationSchema.parse(req.body);

  // Verify all transactions belong to user
  const transactions = await prisma.transaction.findMany({
    where: {
      id: { in: transactionIds },
      userId: req.user!.id
    }
  });

  if (transactions.length !== transactionIds.length) {
    throw new AppError('Some transactions not found or not owned by user', 404);
  }

  let result: any;

  switch (operation) {
    case 'delete':
      result = await prisma.transaction.deleteMany({
        where: {
          id: { in: transactionIds },
          userId: req.user!.id
        }
      });
      
      // Broadcast deletions
      global.io.to(`user-${req.user!.id}`).emit('transactions-deleted', { ids: transactionIds });
      break;

    case 'categorize':
      if (!data?.categoryId) {
        throw new AppError('Category ID is required for categorize operation', 400);
      }
      
      result = await prisma.transaction.updateMany({
        where: {
          id: { in: transactionIds },
          userId: req.user!.id
        },
        data: {
          categoryId: data.categoryId,
          isManual: true
        }
      });
      
      // Broadcast updates
      const updatedTransactions = await prisma.transaction.findMany({
        where: { id: { in: transactionIds } },
        include: { category: true, vendor: true }
      });
      
      global.io.to(`user-${req.user!.id}`).emit('transactions-updated', updatedTransactions);
      break;

    case 'tag':
      if (!data?.tags) {
        throw new AppError('Tags are required for tag operation', 400);
      }

      result = await prisma.transaction.updateMany({
        where: {
          id: { in: transactionIds },
          userId: req.user!.id
        },
        data: {
          tags: JSON.stringify(data.tags),
          isManual: true
        }
      });
      break;

    // Finance depth: mark a batch excluded/included (e.g. transfers). Reversible.
    case 'exclude':
      result = await prisma.transaction.updateMany({
        where: { id: { in: transactionIds }, userId: req.user!.id },
        data: { excluded: data?.excluded ?? true }
      });
      global.io.to(`user-${req.user!.id}`).emit('transactions-updated', { ids: transactionIds });
      break;

    // Finance depth: link a batch to a project and/or chore (null to unlink).
    case 'link':
      result = await prisma.transaction.updateMany({
        where: { id: { in: transactionIds }, userId: req.user!.id },
        data: {
          ...(data && 'projectId' in data ? { projectId: data.projectId ?? null } : {}),
          ...(data && 'choreId' in data ? { choreId: data.choreId ?? null } : {})
        }
      });
      global.io.to(`user-${req.user!.id}`).emit('transactions-updated', { ids: transactionIds });
      break;

    default:
      throw new AppError('Invalid bulk operation', 400);
  }

  // Trigger analytics update
  AnalyticsEngine.updateUserAnalytics(req.user!.id);

  res.json({
    message: `Bulk ${operation} completed successfully`,
    affected: result.count
  });
}));

// Get transaction statistics
router.get('/stats/summary', asyncHandler(async (req: AuthRequest, res) => {
  const stats = await AnalyticsEngine.getTransactionStats(req.user!.id);
  res.json({ stats });
}));

// Auto-categorize transactions
router.post('/categorize', asyncHandler(async (req: AuthRequest, res) => {
  const { transactionIds } = z.object({
    transactionIds: z.array(z.string()).optional()
  }).parse(req.body);

  const where: any = { userId: req.user!.id };
  if (transactionIds) {
    where.id = { in: transactionIds };
  } else {
    // Only auto-categorize uncategorized transactions
    where.categoryId = null;
  }

  const transactions = await prisma.transaction.findMany({ where });

  let categorized = 0;
  for (const transaction of transactions) {
    const categorization = await CategorizationEngine.categorizeTransaction(
      req.user!.id,
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
      categorized++;
    }
  }

  // Broadcast update
  global.io.to(`user-${req.user!.id}`).emit('transactions-categorized', { count: categorized });

  res.json({
    message: 'Auto-categorization completed',
    categorized,
    total: transactions.length
  });
}));

// Normalize descriptions — batch-cluster all unique descriptions for the user
// into consistent vendor names and persist as descriptionNormalized.
router.post('/normalize-descriptions', asyncHandler(async (req: AuthRequest, res) => {
  const updated = await DescriptionNormalizer.normalizeUserDescriptions(req.user!.id);

  global.io.to(`user-${req.user!.id}`).emit('descriptions-normalized', { updated });

  res.json({
    message: 'Description normalization completed',
    updated
  });
}));

export default router;