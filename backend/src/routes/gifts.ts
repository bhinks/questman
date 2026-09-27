/**
 * /api/gifts — send a quest to someone else in the family (2026-09-27).
 *
 *   GET  /api/gifts/crew   the other members you can send to: [{ id, name }]
 *   POST /api/gifts        { toUserId, title, note?, size: "small"|"medium"|"big" }
 *
 * A gift lands on the recipient's board as a one-off chore for today, built exactly
 * like a quick-capture (POST /api/habits/quick): a `cadence: once` Habit in their
 * chores module plus an ad-hoc, carry-over Quest. So completing it runs the normal
 * habit completion path (XP, eddies, streaks) with no special cases, and it rolls
 * over until done instead of expiring at midnight. The server owns the reward: the
 * sender only picks a size. meta carries { gift: { fromId, fromName } } so the card
 * can say who sent it. Capped per sender per day so it stays a fun nudge, not spam.
 */
import express from 'express';
import { z } from 'zod';
import { prisma } from '../server';
import { AuthRequest } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { startOfLocalDay } from '../utils/dates';
import { DEMO_EMAIL } from '../utils/demoSeed';

const router = express.Router();

const GIFT_SIZES = {
  small: { xp: 8, difficulty: 'easy', minutes: 15 },
  medium: { xp: 15, difficulty: 'medium', minutes: 30 },
  big: { xp: 25, difficulty: 'hard', minutes: 60 },
} as const;
const GIFTS_PER_DAY = 10;

const giftSchema = z.object({
  toUserId: z.string().min(1).max(60),
  title: z.string().trim().min(1).max(120),
  note: z.string().trim().max(300).optional(),
  size: z.enum(['small', 'medium', 'big']).default('small'),
});

/** GET /api/gifts/crew — everyone else you could send a quest to (names only). */
router.get('/crew', asyncHandler(async (req: AuthRequest, res) => {
  const crew = await prisma.user.findMany({
    where: { id: { not: req.user!.id }, email: { not: DEMO_EMAIL } },
    select: { id: true, name: true, email: true },
    orderBy: { name: 'asc' },
  });
  res.json({ crew: crew.map(u => ({ id: u.id, name: u.name || u.email.split('@')[0] })) });
}));

/** POST /api/gifts — put a quest on someone else's board for today. */
router.post('/', asyncHandler(async (req: AuthRequest, res) => {
  const { toUserId, title, note, size } = giftSchema.parse(req.body ?? {});
  const from = req.user!;
  if (toUserId === from.id) throw new AppError('Send it to someone else! (Quick capture is for your own.)', 400);

  const to = await prisma.user.findUnique({ where: { id: toUserId }, select: { id: true, email: true, name: true } });
  if (!to || to.email === DEMO_EMAIL) throw new AppError('No one by that name here', 404);

  const today = startOfLocalDay();
  const fromName = from.name || from.email.split('@')[0];
  const sentToday = await prisma.quest.count({
    where: { createdAt: { gte: today }, meta: { contains: `"fromId":"${from.id}"` } },
  });
  if (sentToday >= GIFTS_PER_DAY) throw new AppError(`That's ${GIFTS_PER_DAY} quests sent today. Save some for tomorrow!`, 429);

  const mod = await prisma.module.findUnique({
    where: { userId_key: { userId: to.id, key: 'chores' } },
    select: { id: true },
  });
  if (!mod) throw new AppError(`${to.name || 'They'} can't take quests yet (no chores board)`, 409);

  const spec = GIFT_SIZES[size];
  const description = note ? `From ${fromName}: ${note}` : `A quest from ${fromName}`;
  const meta = JSON.stringify({ emoji: '🎁', gift: { fromId: from.id, fromName } });

  const quest = await prisma.$transaction(async (tx) => {
    const habit = await tx.habit.create({
      data: {
        userId: to.id, moduleId: mod.id, kind: 'chore', title, description,
        cadence: 'once', dueDate: today, baseXp: spec.xp, difficulty: spec.difficulty,
        estMinutes: spec.minutes,
      },
    });
    return tx.quest.create({
      data: {
        userId: to.id, moduleId: mod.id, questDate: today, title, description,
        difficulty: spec.difficulty, xpReward: spec.xp, source: 'habit', sourceId: habit.id,
        habitId: habit.id, estMinutes: spec.minutes, carryOver: true, adhoc: true,
        originDate: today, meta,
      },
    });
  });

  const ws = (global as any).wsService;
  if (ws?.broadcastGameEvent) {
    ws.broadcastGameEvent(to.id, 'quest-created', { questId: quest.id, gift: { fromName } });
  }
  res.status(201).json({ ok: true, to: { id: to.id, name: to.name }, questId: quest.id, xp: spec.xp });
}));

export default router;
