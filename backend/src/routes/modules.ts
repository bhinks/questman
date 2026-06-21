import express from 'express';
import { z } from 'zod';
import { prisma } from '../server';
import { AuthRequest } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';

const router = express.Router();

// Update — small enough to inline. Created via seed, not the API.
const updateSchema = z.object({
  name:      z.string().min(1).max(50).optional(),
  icon:      z.string().nullable().optional(),
  color:     z.string().nullable().optional(),
  isEnabled: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  config:    z.record(z.unknown()).optional(),
});

/**
 * GET /api/modules
 * Drives the frontend nav. Ordered by sortOrder then name.
 * For non-admin users with a restricted allowedModuleKeys list, only the
 * permitted modules are returned — the nav filters itself automatically.
 */
router.get('/', asyncHandler(async (req: AuthRequest, res) => {
  const userMeta = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { role: true, allowedModuleKeys: true },
  });

  // Admins and users with null allowedModuleKeys get the full module list.
  let keyFilter: string[] | undefined;
  if (userMeta?.role !== 'admin' && userMeta?.allowedModuleKeys) {
    keyFilter = JSON.parse(userMeta.allowedModuleKeys) as string[];
  }

  const modules = await prisma.module.findMany({
    where: {
      userId: req.user!.id,
      ...(keyFilter ? { key: { in: keyFilter } } : {}),
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
  res.json({ modules });
}));

/**
 * PUT /api/modules/:id
 * Enable / disable, reorder, recolor. Cannot create modules via API
 * (seed-managed) and cannot change `key` (immutable identifier).
 */
router.put('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const data = updateSchema.parse(req.body);

  const existing = await prisma.module.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
  });
  if (!existing) throw new AppError('Module not found', 404);

  const updated = await prisma.module.update({
    where: { id: existing.id },
    data: {
      ...data,
      // JSON-as-String for SQLite parity with other models.
      config: data.config !== undefined ? JSON.stringify(data.config) : undefined,
    },
  });
  res.json({ module: updated });
}));

export default router;
