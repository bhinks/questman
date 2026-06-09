/**
 * /api/insights — the cross-domain insights feed.
 *
 * Insights are honest "possible pattern" findings computed server-side (see
 * services/digest.ts + services/insights.ts) and surfaced for the user to
 * ACCEPT (spawn a constrained server-owned quest) or DISMISS. The economy
 * stays server-owned: accepting never lets the AI set a reward.
 */
import express from 'express';
import { z } from 'zod';
import { prisma } from '../server';
import { AuthRequest } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { acceptInsight } from '../services/insights';
import { GamificationService } from '../services/GamificationService';

const router = express.Router();
let _game: GamificationService | null = null;
const game = () => (_game ??= new GamificationService(prisma));

/**
 * GET /api/insights?status=&limit=
 * The feed, newest first. Defaults to the actionable ones (new + accepted).
 */
router.get('/', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const q = z.object({
    status: z.enum(['new', 'accepted', 'dismissed', 'spawned', 'all']).default('all'),
    limit: z.string().transform(Number).pipe(z.number().int().positive().max(100)).default('40'),
  }).parse(req.query);

  const insights = await prisma.insight.findMany({
    where: { userId, ...(q.status !== 'all' ? { status: q.status } : {}) },
    orderBy: { createdAt: 'desc' },
    take: q.limit,
  });
  res.json({
    insights,
    newCount: await prisma.insight.count({ where: { userId, status: 'new' } }),
  });
}));

/**
 * POST /api/insights/:id/accept
 * Spawn the insight's suggested action as a small, server-owned quest for
 * today. Idempotent (guarded status transition). Returns the new questId.
 */
router.post('/:id/accept', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const result = await acceptInsight(prisma, userId, req.params.id);
  if (result.reason === 'not_found') throw new AppError('Insight not found', 404);
  if (result.reason === 'no_action') throw new AppError('This insight has no actionable quest', 400);
  if (result.reason === 'module_unavailable') {
    throw new AppError('The module for this action is disabled', 409);
  }
  const player = await game().getSnapshot(userId);
  res.json({
    spawned: result.spawned,
    questId: result.questId,
    alreadySpawned: result.reason === 'already_spawned',
    player,
  });
}));

/**
 * POST /api/insights/:id/dismiss — file it away, no quest.
 */
router.post('/:id/dismiss', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  // Guarded: only flip rows the user actually owns and that aren't already
  // spawned (don't undo a spawned action).
  const result = await prisma.insight.updateMany({
    where: { id: req.params.id, userId, status: { in: ['new', 'accepted'] } },
    data: { status: 'dismissed' },
  });
  if (result.count === 0) {
    const exists = await prisma.insight.findFirst({ where: { id: req.params.id, userId }, select: { status: true } });
    if (!exists) throw new AppError('Insight not found', 404);
    // Already dismissed/spawned — idempotent success.
  }
  res.json({ dismissed: true });
}));

export default router;
