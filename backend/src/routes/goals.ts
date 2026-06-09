/**
 * Goals are cross-domain targets ("save $500 this month", "run 50km",
 * "stretch 30 days"). They're consumed by the QuestEngine (Phase 3),
 * which turns active goals into daily quest candidates.
 *
 * Goal progress is recorded explicitly via POST /:id/progress. We don't
 * award XP on goal progress — XP is paid when the underlying entity is
 * logged (habit checked / workout logged / quest completed), and the
 * goal completion itself is an XP-worthy moment if you want it later.
 */
import express from 'express';
import { z } from 'zod';
import { prisma } from '../server';
import { AuthRequest } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';

const router = express.Router();

const METRIC = z.enum(['count', 'minutes', 'currency', 'boolean', 'distance']);
const PERIOD = z.enum(['daily', 'weekly', 'monthly', 'ongoing']);
const STATUS = z.enum(['active', 'completed', 'archived']);
const SOURCE_TYPE = z.enum(['habit', 'category', 'wastefulPattern']);

const createSchema = z.object({
  moduleId:     z.string(),
  title:        z.string().min(1).max(200),
  description:  z.string().max(1000).nullable().optional(),
  metric:       METRIC,
  targetValue:  z.number().nullable().optional(),
  currentValue: z.number().default(0),
  unit:         z.string().max(20).nullable().optional(),
  period:       PERIOD.default('ongoing'),
  status:       STATUS.default('active'),
  dueDate:      z.string().datetime().nullable().optional(),
  sourceType:   SOURCE_TYPE.nullable().optional(),
  sourceId:     z.string().nullable().optional(),
});

const updateSchema = createSchema.partial();

const progressSchema = z.object({
  delta:    z.number().optional(), // increment by this amount
  value:    z.number().optional(), // OR set absolute value
}).refine(d => d.delta !== undefined || d.value !== undefined, {
  message: 'either delta or value is required',
});

/** GET /api/goals?status=active&moduleId=... */
router.get('/', asyncHandler(async (req: AuthRequest, res) => {
  const q = z.object({
    status:   STATUS.optional(),
    moduleId: z.string().optional(),
  }).parse(req.query);

  const goals = await prisma.goal.findMany({
    where: {
      userId: req.user!.id,
      ...(q.status && { status: q.status }),
      ...(q.moduleId && { moduleId: q.moduleId }),
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
  });
  res.json({ goals });
}));

/** GET /api/goals/:id */
router.get('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const goal = await prisma.goal.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
  });
  if (!goal) throw new AppError('Goal not found', 404);
  res.json({ goal });
}));

/** POST /api/goals */
router.post('/', asyncHandler(async (req: AuthRequest, res) => {
  const data = createSchema.parse(req.body);
  const userId = req.user!.id;

  const mod = await prisma.module.findFirst({
    where: { id: data.moduleId, userId }, select: { id: true },
  });
  if (!mod) throw new AppError('Module not found', 404);

  const goal = await prisma.goal.create({
    data: {
      userId,
      moduleId: data.moduleId,
      title: data.title,
      description: data.description ?? null,
      metric: data.metric,
      targetValue: data.targetValue ?? null,
      currentValue: data.currentValue,
      unit: data.unit ?? null,
      period: data.period,
      status: data.status,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      sourceType: data.sourceType ?? null,
      sourceId: data.sourceId ?? null,
    },
  });
  res.status(201).json({ goal });
}));

/** PUT /api/goals/:id */
router.put('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const data = updateSchema.parse(req.body);
  const existing = await prisma.goal.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
  });
  if (!existing) throw new AppError('Goal not found', 404);

  const goal = await prisma.goal.update({
    where: { id: existing.id },
    data: {
      ...data,
      dueDate: data.dueDate === undefined
        ? undefined
        : data.dueDate === null
          ? null
          : new Date(data.dueDate),
    },
  });
  res.json({ goal });
}));

/** DELETE /api/goals/:id */
router.delete('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const existing = await prisma.goal.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
    select: { id: true },
  });
  if (!existing) throw new AppError('Goal not found', 404);
  await prisma.goal.delete({ where: { id: existing.id } });
  res.status(204).end();
}));

/**
 * POST /api/goals/:id/progress
 * Either `{delta: N}` increments currentValue by N, or `{value: V}`
 * sets it absolutely. Auto-marks `status:"completed"` when currentValue
 * meets/exceeds targetValue (if a target is set).
 */
router.post('/:id/progress', asyncHandler(async (req: AuthRequest, res) => {
  const { delta, value } = progressSchema.parse(req.body);
  const existing = await prisma.goal.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
  });
  if (!existing) throw new AppError('Goal not found', 404);

  const next = value !== undefined
    ? value
    : existing.currentValue + (delta ?? 0);

  const completed =
    existing.targetValue !== null &&
    existing.targetValue !== undefined &&
    next >= existing.targetValue;

  const goal = await prisma.goal.update({
    where: { id: existing.id },
    data: {
      currentValue: next,
      ...(completed && existing.status === 'active' && { status: 'completed' }),
    },
  });
  res.json({ goal, completed });
}));

export default router;
