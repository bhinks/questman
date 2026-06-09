/**
 * /api/debrief — the weekly debrief ("after-action report") terminal.
 *
 * Reviews are generated lazily once per ISO week (QuestEngine.ensureWeeklyReview):
 * a server-computed stats digest + the Handler's narrative + that week's
 * insights. The user reads it, writes a reflection, and SUBMITS — a guarded
 * draft→submitted transition that pays a small fixed "ritual" reward exactly
 * once. Re-submitting just edits the reflection (no second payout).
 */
import express from 'express';
import { z } from 'zod';
import { prisma } from '../server';
import { AuthRequest } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { GamificationService } from '../services/GamificationService';

const router = express.Router();
let _game: GamificationService | null = null;
const game = () => (_game ??= new GamificationService(prisma));

// Fixed ritual reward for completing the weekly reflection (server-owned).
const REVIEW_XP = 40;
const REVIEW_EDDIES = 20;

function parseStats(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return null; }
}

async function withInsights(userId: string, review: { weekOf: Date } & Record<string, any>) {
  const insights = await prisma.insight.findMany({
    where: { userId, weekOf: review.weekOf },
    orderBy: { createdAt: 'asc' },
  });
  return { ...review, stats: parseStats(review.statsJson), insights };
}

/**
 * GET /api/debrief/latest — the most recent review (with its insights).
 */
router.get('/latest', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const review = await prisma.weeklyReview.findFirst({
    where: { userId }, orderBy: { weekOf: 'desc' },
  });
  res.json({ review: review ? await withInsights(userId, review) : null });
}));

/**
 * GET /api/debrief?limit= — the list of past reviews (newest first).
 */
router.get('/', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const q = z.object({
    limit: z.string().transform(Number).pipe(z.number().int().positive().max(52)).default('12'),
  }).parse(req.query);
  const reviews = await prisma.weeklyReview.findMany({
    where: { userId }, orderBy: { weekOf: 'desc' }, take: q.limit,
  });
  res.json({ reviews: reviews.map(r => ({ ...r, stats: parseStats(r.statsJson) })) });
}));

/**
 * GET /api/debrief/:id — one review with its insights.
 */
router.get('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const review = await prisma.weeklyReview.findFirst({ where: { id: req.params.id, userId } });
  if (!review) throw new AppError('Review not found', 404);
  res.json({ review: await withInsights(userId, review) });
}));

/**
 * POST /api/debrief/:id/submit  { notes?, focusForNext? }
 * Save the reflection. First submit (draft→submitted) pays the ritual reward
 * once; later edits just update the text.
 */
router.post('/:id/submit', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const body = z.object({
    notes: z.string().max(4000).optional(),
    focusForNext: z.string().max(1000).optional(),
  }).parse(req.body ?? {});

  const review = await prisma.weeklyReview.findFirst({ where: { id: req.params.id, userId } });
  if (!review) throw new AppError('Review not found', 404);

  let player: Awaited<ReturnType<GamificationService['awardXp']>> | null = null;
  let rewarded = false;

  await prisma.$transaction(async (tx) => {
    // Guarded first-submit: only the draft→submitted flip pays out, and only
    // once. A double-submit's second pass matches 0 rows here.
    const flip = await tx.weeklyReview.updateMany({
      where: { id: review.id, userId, status: 'draft' },
      data: {
        status: 'submitted',
        submittedAt: new Date(),
        notes: body.notes ?? null,
        focusForNext: body.focusForNext ?? null,
      },
    });
    if (flip.count === 1) {
      rewarded = true;
      player = await game().awardXp(userId, {
        amount: REVIEW_XP,
        eddies: REVIEW_EDDIES,
        reason: 'weekly_review',
        refType: 'weeklyReview',
        refId: review.id,
      }, tx);
    } else {
      // Already submitted — just persist the edited reflection, no payout.
      await tx.weeklyReview.update({
        where: { id: review.id },
        data: { notes: body.notes ?? review.notes, focusForNext: body.focusForNext ?? review.focusForNext },
      });
    }
  });

  const fresh = await prisma.weeklyReview.findUniqueOrThrow({ where: { id: review.id } });
  if (!player) player = await game().getSnapshot(userId) as any;
  res.json({ review: await withInsights(userId, fresh), rewarded, player });
}));

export default router;
