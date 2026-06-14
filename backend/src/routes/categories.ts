import express from 'express';
import { z } from 'zod';
import { prisma } from '../server';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import { CategorizationEngine } from '../services/CategorizationEngine';

const router = express.Router();

// Validation schemas
const createCategorySchema = z.object({
  name: z.string().min(1, 'Category name is required'),
  description: z.string().optional(),
  color: z.string().regex(/^#[0-9A-F]{6}$/i, 'Color must be a valid hex color').optional(),
  icon: z.string().optional(),
  parentId: z.string().optional(),
  budget: z.number().min(0).optional()
});

const updateCategorySchema = createCategorySchema.partial();

const categoryRuleSchema = z.object({
  name: z.string().min(1, 'Rule name is required'),
  conditions: z.object({
    descriptionContains: z.array(z.string()).optional(),
    descriptionMatches: z.string().optional(),
    amountRange: z.object({
      min: z.number().optional(),
      max: z.number().optional()
    }).optional(),
    vendor: z.string().optional()
  }),
  actions: z.object({
    categoryId: z.string().optional(),
    vendorId: z.string().optional(),
    addTag: z.string().optional()
  }),
  priority: z.number().int().min(1).default(100),
  isActive: z.boolean().default(true)
});

// Get all categories for user
router.get('/', asyncHandler(async (req: AuthRequest, res) => {
  const categories = await prisma.category.findMany({
    where: { userId: req.user!.id },
    include: {
      parent: { select: { id: true, name: true } },
      children: { select: { id: true, name: true } },
      _count: {
        select: { transactions: true }
      }
    },
    orderBy: [
      { parentId: 'asc' },
      { name: 'asc' }
    ]
  });

  // Surface the transaction count under the name the client reads.
  res.json({
    categories: categories.map(c => ({ ...c, transactionCount: c._count?.transactions ?? 0 })),
  });
}));

// Get category by ID with transactions
router.get('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const category = await prisma.category.findFirst({
    where: {
      id: req.params.id,
      userId: req.user!.id
    },
    include: {
      parent: true,
      children: true,
      transactions: {
        orderBy: { date: 'desc' },
        take: 100,
        include: {
          vendor: { select: { id: true, name: true } }
        }
      },
      _count: {
        select: { transactions: true }
      }
    }
  });

  if (!category) {
    throw new AppError('Category not found', 404);
  }

  // Calculate spending statistics
  const totalSpent = Math.abs(
    category.transactions
      .filter(t => t.amount < 0)
      .reduce((sum, t) => sum + t.amount, 0)
  );

  const thisMonthSpent = Math.abs(
    category.transactions
      .filter(t => {
        const transactionDate = new Date(t.date);
        const now = new Date();
        return t.amount < 0 && 
               transactionDate.getMonth() === now.getMonth() &&
               transactionDate.getFullYear() === now.getFullYear();
      })
      .reduce((sum, t) => sum + t.amount, 0)
  );

  res.json({
    category: {
      ...category,
      stats: {
        totalSpent,
        thisMonthSpent,
        budgetUsed: category.budget ? (thisMonthSpent / category.budget) * 100 : null
      }
    }
  });
}));

// Create new category
router.post('/', asyncHandler(async (req: AuthRequest, res) => {
  const data = createCategorySchema.parse(req.body);

  // Check if category name already exists for this user
  const existing = await prisma.category.findFirst({
    where: {
      name: data.name,
      userId: req.user!.id
    }
  });

  if (existing) {
    throw new AppError('Category with this name already exists', 400);
  }

  // Verify parent category belongs to user
  if (data.parentId) {
    const parent = await prisma.category.findFirst({
      where: {
        id: data.parentId,
        userId: req.user!.id
      }
    });

    if (!parent) {
      throw new AppError('Parent category not found', 404);
    }
  }

  const category = await prisma.category.create({
    data: {
      ...data,
      userId: req.user!.id,
      color: data.color || generateRandomColor()
    },
    include: {
      parent: true,
      _count: {
        select: { transactions: true }
      }
    }
  });

  // Broadcast update
  global.io.to(`user-${req.user!.id}`).emit('category-created', category);

  res.status(201).json({
    message: 'Category created successfully',
    category
  });
}));

// Update category
router.put('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const data = updateCategorySchema.parse(req.body);

  const existing = await prisma.category.findFirst({
    where: {
      id: req.params.id,
      userId: req.user!.id
    }
  });

  if (!existing) {
    throw new AppError('Category not found', 404);
  }

  // Check name uniqueness if name is being changed
  if (data.name && data.name !== existing.name) {
    const nameExists = await prisma.category.findFirst({
      where: {
        name: data.name,
        userId: req.user!.id,
        id: { not: req.params.id }
      }
    });

    if (nameExists) {
      throw new AppError('Category with this name already exists', 400);
    }
  }

  // Verify parent category if being changed
  if (data.parentId && data.parentId !== existing.parentId) {
    const parent = await prisma.category.findFirst({
      where: {
        id: data.parentId,
        userId: req.user!.id
      }
    });

    if (!parent) {
      throw new AppError('Parent category not found', 404);
    }

    // Prevent circular references
    if (await wouldCreateCircularReference(req.params.id, data.parentId)) {
      throw new AppError('Cannot set parent: would create circular reference', 400);
    }
  }

  const category = await prisma.category.update({
    where: { id: req.params.id },
    data,
    include: {
      parent: true,
      children: true,
      _count: {
        select: { transactions: true }
      }
    }
  });

  // Broadcast update
  global.io.to(`user-${req.user!.id}`).emit('category-updated', category);

  res.json({
    message: 'Category updated successfully',
    category
  });
}));

// Delete category
router.delete('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const { moveTransactionsTo } = z.object({
    moveTransactionsTo: z.string().optional()
  }).parse(req.query);

  const category = await prisma.category.findFirst({
    where: {
      id: req.params.id,
      userId: req.user!.id
    },
    include: {
      _count: {
        select: { transactions: true }
      }
    }
  });

  if (!category) {
    throw new AppError('Category not found', 404);
  }

  // Handle transactions in this category
  if (category._count.transactions > 0) {
    if (moveTransactionsTo) {
      // Verify target category belongs to user
      const targetCategory = await prisma.category.findFirst({
        where: {
          id: moveTransactionsTo,
          userId: req.user!.id
        }
      });

      if (!targetCategory) {
        throw new AppError('Target category not found', 404);
      }

      // Move transactions to target category
      await prisma.transaction.updateMany({
        where: {
          categoryId: req.params.id,
          userId: req.user!.id
        },
        data: {
          categoryId: moveTransactionsTo
        }
      });
    } else {
      // Remove category from transactions (set to null)
      await prisma.transaction.updateMany({
        where: {
          categoryId: req.params.id,
          userId: req.user!.id
        },
        data: {
          categoryId: null
        }
      });
    }
  }

  // Update child categories to remove parent reference
  await prisma.category.updateMany({
    where: {
      parentId: req.params.id,
      userId: req.user!.id
    },
    data: {
      parentId: null
    }
  });

  // Delete the category
  await prisma.category.delete({
    where: { id: req.params.id }
  });

  // Broadcast update
  global.io.to(`user-${req.user!.id}`).emit('category-deleted', { id: req.params.id });

  res.json({ message: 'Category deleted successfully' });
}));

// Get category analytics
router.get('/:id/analytics', asyncHandler(async (req: AuthRequest, res) => {
  const { startDate, endDate } = z.object({
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional()
  }).parse(req.query);

  const category = await prisma.category.findFirst({
    where: {
      id: req.params.id,
      userId: req.user!.id
    }
  });

  if (!category) {
    throw new AppError('Category not found', 404);
  }

  const where: any = {
    categoryId: req.params.id,
    userId: req.user!.id
  };

  if (startDate || endDate) {
    where.date = {};
    if (startDate) where.date.gte = new Date(startDate);
    if (endDate) where.date.lte = new Date(endDate);
  }

  const [transactions, monthlySpending] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: { date: 'desc' }
    }),
    prisma.$queryRaw`
      SELECT 
        DATE_FORMAT(date, '%Y-%m') as month,
        SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as spending,
        COUNT(*) as transaction_count
      FROM transactions 
      WHERE categoryId = ${req.params.id} AND userId = ${req.user!.id}
      ${startDate ? `AND date >= ${new Date(startDate)}` : ''}
      ${endDate ? `AND date <= ${new Date(endDate)}` : ''}
      GROUP BY DATE_FORMAT(date, '%Y-%m')
      ORDER BY month
    `
  ]);

  const expenses = transactions.filter(t => t.amount < 0);
  const totalSpent = Math.abs(expenses.reduce((sum, t) => sum + t.amount, 0));
  const avgTransaction = expenses.length > 0 ? totalSpent / expenses.length : 0;

  res.json({
    analytics: {
      totalSpent,
      transactionCount: expenses.length,
      avgTransaction,
      monthlySpending,
      budgetComparison: category.budget ? {
        budget: category.budget,
        spent: totalSpent,
        remaining: Math.max(0, category.budget - totalSpent),
        percentage: (totalSpent / category.budget) * 100
      } : null
    }
  });
}));

// Get categorization rules
router.get('/rules/list', asyncHandler(async (req: AuthRequest, res) => {
  const rules = await CategorizationEngine.getUserRules(req.user!.id);
  res.json({ rules });
}));

// Create categorization rule
router.post('/rules', asyncHandler(async (req: AuthRequest, res) => {
  const data = categoryRuleSchema.parse(req.body);
  
  const rule = await CategorizationEngine.createRule(req.user!.id, data);
  
  res.status(201).json({
    message: 'Categorization rule created successfully',
    rule
  });
}));

// Suggest categorization rules based on user patterns
router.get('/rules/suggestions', asyncHandler(async (req: AuthRequest, res) => {
  const suggestions = await CategorizationEngine.suggestRules(req.user!.id);
  
  res.json({
    suggestions,
    message: `Found ${suggestions.length} rule suggestions based on your transaction patterns`
  });
}));

// Apply rules to uncategorized transactions
router.post('/rules/apply', asyncHandler(async (req: AuthRequest, res) => {
  const { ruleIds } = z.object({
    ruleIds: z.array(z.string()).optional()
  }).parse(req.body);

  // Get uncategorized transactions
  const uncategorized = await prisma.transaction.findMany({
    where: {
      userId: req.user!.id,
      categoryId: null
    }
  });

  let categorized = 0;
  
  for (const transaction of uncategorized) {
    const result = await CategorizationEngine.categorizeTransaction(
      req.user!.id,
      transaction.description,
      transaction.amount
    );

    if (result.categoryId) {
      await prisma.transaction.update({
        where: { id: transaction.id },
        data: {
          categoryId: result.categoryId,
          vendorId: result.vendorId,
          confidence: result.confidence
        }
      });
      categorized++;
    }
  }

  // Broadcast update
  global.io.to(`user-${req.user!.id}`).emit('transactions-categorized', { count: categorized });

  res.json({
    message: 'Categorization rules applied successfully',
    categorized,
    total: uncategorized.length
  });
}));

// Helper functions
function generateRandomColor(): string {
  const colors = [
    '#00ff9f', '#ff0080', '#0080ff', '#ff8000', 
    '#8000ff', '#ff4040', '#40ff40', '#4040ff',
    '#ffff40', '#ff40ff', '#40ffff', '#ff6040'
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

async function wouldCreateCircularReference(categoryId: string, parentId: string): Promise<boolean> {
  let currentId: string | null = parentId;

  while (currentId) {
    if (currentId === categoryId) {
      return true;
    }
    
    const parent: { parentId: string | null } | null = await prisma.category.findUnique({
      where: { id: currentId },
      select: { parentId: true }
    });

    currentId = parent?.parentId || null;
  }
  
  return false;
}

export default router;