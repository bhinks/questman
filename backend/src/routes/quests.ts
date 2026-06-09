import express from 'express';
import { z } from 'zod';
import { prisma } from '../server';
import { AuthRequest } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { QuestEngine } from '../services/QuestEngine';
import { GamificationService } from '../services/GamificationService';
import { startOfLocalDay, daysAgoLocal } from '../utils/dates';
import { config } from '../config';

const router = express.Router();
let _engine: QuestEngine | null = null;
let _game: GamificationService | null = null;
const engine = () => (_engine ??= new QuestEngine(prisma));
const game = () => (_game ??= new GamificationService(prisma));

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

/**
 * GET /api/quests/today
 *
 * Lazy generator: first call of the day for this user generates the
 * day's quest set; subsequent calls just read. The atomic create on
 * DailyQuestRun is the cross-process lock.
 *
 * Returns quests grouped by module + summary stats for the HUD.
 */
router.get('/today', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const today = startOfLocalDay();

  const result = await engine().ensureToday(userId);

  const quests = await prisma.quest.findMany({
    where: { userId, questDate: today },
    orderBy: [{ status: 'asc' }, { difficulty: 'asc' }, { createdAt: 'asc' }],
    include: { module: { select: { key: true, name: true, color: true, icon: true } } },
  });

  // Group by module.key for the HUD.
  const grouped: Record<string, any[]> = {};
  let xpAvailable = 0;
  let xpEarned = 0;
  let completedCount = 0;
  for (const q of quests) {
    const key = q.module.key;
    (grouped[key] ??= []).push({
      ...q,
      meta: parseJson(q.meta),
    });
    if (q.status === 'completed') {
      completedCount += 1;
      xpEarned += q.xpReward;
    } else if (q.status === 'pending') {
      xpAvailable += q.xpReward;
    }
  }

  res.json({
    questDate: today,
    generated: result.generated,
    generator: result.generator,
    totalCount: quests.length,
    completedCount,
    xpAvailable,
    xpEarned,
    byModule: grouped,
  });
}));

/**
 * POST /api/quests/:id/complete
 *
 * Manual completion (i.e. user clicked the button on the quest card).
 * Idempotent: completing twice awards XP once. Side effects (atomic):
 *   - quest.status = "completed"
 *   - QuestCompletion row
 *   - if source="habit", upsert HabitCompletion for today + bump habit streak
 *   - Award XP via GamificationService
 *   - Broadcast quest-completed + player-updated
 */
router.post('/:id/complete', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const quest = await prisma.quest.findFirst({
    where: { id: req.params.id, userId },
  });
  if (!quest) throw new AppError('Quest not found', 404);

  // Idempotent: short-circuit if already completed.
  if (quest.status === 'completed') {
    const existing = await prisma.questCompletion.findUnique({
      where: { questId: quest.id },
    });
    const player = await game().getSnapshot(userId);
    res.json({ quest, completion: existing, player, leveledUp: false, alreadyCompleted: true });
    return;
  }
  if (quest.status !== 'pending') {
    throw new AppError(`Cannot complete a ${quest.status} quest`, 400);
  }

  const today = startOfLocalDay();
  let questCompletion;
  let player: Awaited<ReturnType<GamificationService['awardXp']>> | null = null;

  await prisma.$transaction(async (tx) => {
    const updated = await tx.quest.update({
      where: { id: quest.id },
      data: { status: 'completed', progress: quest.target },
    });

    questCompletion = await tx.questCompletion.create({
      data: {
        userId,
        questId: quest.id,
        xpAwarded: quest.xpReward,
      },
    });

    // If this quest tracks a habit, also write a HabitCompletion for
    // today (idempotent via @@unique) and bump the habit streak.
    if (quest.source === 'habit' && quest.sourceId) {
      try {
        await tx.habitCompletion.create({
          data: {
            userId,
            habitId: quest.sourceId,
            completedOn: today,
            xpAwarded: 0,    // quest carries the XP; avoid double-payment
            source: 'quest',
          },
        });
      } catch (err: any) {
        if (err?.code !== 'P2002') throw err; // already completed today; fine.
      }
      await game().bumpHabitStreak(quest.sourceId, today, tx);
    }

    // Award XP via central service.
    const moduleKey = await tx.module.findUnique({
      where: { id: quest.moduleId },
      select: { key: true },
    });
    player = await game().awardXp(userId, {
      amount: quest.xpReward,
      reason: 'quest_complete',
      module: moduleKey?.key,
      refType: 'quest',
      refId: quest.id,
    }, tx);

    // Stamp the completion's meta with the level transition.
    if (player.leveledUp) {
      await tx.questCompletion.update({
        where: { id: (questCompletion as any).id },
        data: {
          meta: JSON.stringify({
            leveledUp: true,
            from: player.previousLevel,
            to: player.level,
          }),
        },
      });
    }
  });

  const ws = (global as any).wsService;
  if (ws?.broadcastGameEvent) {
    ws.broadcastGameEvent(userId, 'quest-completed', {
      questId: quest.id,
      xpAwarded: quest.xpReward,
      leveledUp: player?.leveledUp ?? false,
    });
  }

  res.json({
    quest: { ...quest, status: 'completed', progress: quest.target },
    completion: questCompletion,
    player,
    leveledUp: player?.leveledUp ?? false,
  });
}));

/** POST /api/quests/:id/skip — mark skipped, no XP. */
router.post('/:id/skip', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const quest = await prisma.quest.findFirst({
    where: { id: req.params.id, userId },
  });
  if (!quest) throw new AppError('Quest not found', 404);
  if (quest.status !== 'pending') {
    throw new AppError(`Cannot skip a ${quest.status} quest`, 400);
  }

  const updated = await prisma.quest.update({
    where: { id: quest.id },
    data: { status: 'skipped' },
  });
  res.json({ quest: updated });
}));

/**
 * GET /api/quests/history?from=&to=
 * Past quests + completions for the streak calendar.
 */
router.get('/history', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const q = z.object({
    from:  z.string().datetime().optional(),
    to:    z.string().datetime().optional(),
    limit: z.string().transform(Number).pipe(z.number().int().positive().max(500)).default('200'),
  }).parse(req.query);

  const from = q.from ? new Date(q.from) : daysAgoLocal(30);
  const to   = q.to   ? new Date(q.to)   : startOfLocalDay();

  const quests = await prisma.quest.findMany({
    where: { userId, questDate: { gte: from, lte: to } },
    orderBy: { questDate: 'desc' },
    take: q.limit,
    include: { module: { select: { key: true, name: true } } },
  });

  res.json({ from, to, quests: quests.map(qq => ({ ...qq, meta: parseJson(qq.meta) })) });
}));

/**
 * POST /api/quests/regenerate
 * Dev/admin-only: blow away today's quests and run generation again.
 * Useful for iterating on the engine. Guarded by NODE_ENV.
 */
router.post('/regenerate', asyncHandler(async (req: AuthRequest, res) => {
  if (config.nodeEnv !== 'development') {
    throw new AppError('Regenerate is only available in development', 403);
  }
  const result = await engine().regenerateToday(req.user!.id);
  res.json(result);
}));

export default router;
