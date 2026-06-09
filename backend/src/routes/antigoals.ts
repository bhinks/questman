/**
 * Anti-goals ("ICE") route.
 *
 * Anti-goals are Habit rows with polarity:"avoid". The model is "assumed
 * clean, log only slips": days are clean by default and the clean-day
 * REWARDS + the avoidance streak (currentStreak) are credited AUTOMATICALLY
 * at the daily roll-over by QuestEngine.processAntiGoalsForNewDay (owned by
 * the spine). This route ONLY does CRUD + breach logging — it never mints
 * currency.
 *
 * A "breach" is a slip for today: a HabitCompletion stamped at
 * startOfLocalDay() acts as the breach marker (idempotent via
 * @@unique([habitId, completedOn])) and resets the avoidance streak to 0. A
 * slip pays nothing.
 *
 * Conventions mirror routes/habits.ts & routes/projects.ts:
 *   - userId-scoped queries (req.user!.id), router is auth-mounted.
 *   - everything guarded to polarity:"avoid" + the requesting user.
 */
import express from 'express';
import { z } from 'zod';
import { prisma } from '../server';
import { AuthRequest } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { GamificationService } from '../services/GamificationService';
import { startOfLocalDay } from '../utils/dates';

const router = express.Router();

let _game: GamificationService | null = null;
// Kept for parity with sibling routes; this slice mints no currency itself
// (clean-day rewards are credited at roll-over by the spine).
const game = () => (_game ??= new GamificationService(prisma));
void game;

const DIFFICULTY = z.enum(['easy', 'medium', 'hard']);

const createSchema = z.object({
  title:       z.string().min(1).max(300),
  description: z.string().max(2000).nullable().optional(),
  icon:        z.string().max(100).nullable().optional(),
  color:       z.string().max(40).nullable().optional(),
  difficulty:  DIFFICULTY.optional(),
  baseXp:      z.number().int().min(0).max(2000).optional(),
});

const updateSchema = z.object({
  title:      z.string().min(1).max(300).optional(),
  difficulty: DIFFICULTY.optional(),
  baseXp:     z.number().int().min(0).max(2000).optional(),
  isActive:   z.boolean().optional(),
});

/** Resolve the user's "habits" module id (throws if seed missing). */
async function habitsModuleId(userId: string): Promise<string> {
  const mod = await prisma.module.findUnique({
    where: { userId_key: { userId, key: 'habits' } },
    select: { id: true },
  });
  if (!mod) throw new AppError('module missing — re-run seed', 500);
  return mod.id;
}

/** Minimal Habit shape we need to shape an AntiGoal API row. */
type AntiGoalHabit = {
  id: string;
  moduleId: string;
  title: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  baseXp: number;
  difficulty: string;
  isActive: boolean;
  currentStreak: number;
  longestStreak: number;
  lastCompletedOn: Date | null;
};

const ANTIGOAL_SELECT = {
  id: true, moduleId: true, title: true, description: true,
  icon: true, color: true, baseXp: true, difficulty: true,
  isActive: true, currentStreak: true, longestStreak: true,
  lastCompletedOn: true,
} as const;

/** Shape a Habit (polarity:"avoid") + its today-breach flag into an AntiGoal. */
function serialize(habit: AntiGoalHabit, breachedToday: boolean) {
  return {
    id: habit.id,
    moduleId: habit.moduleId,
    title: habit.title,
    description: habit.description,
    icon: habit.icon,
    color: habit.color,
    baseXp: habit.baseXp,
    difficulty: habit.difficulty as 'easy' | 'medium' | 'hard',
    isActive: habit.isActive,
    currentStreak: habit.currentStreak,
    longestStreak: habit.longestStreak,
    breachedToday,
    lastCompletedOn: habit.lastCompletedOn ? habit.lastCompletedOn.toISOString() : null,
  };
}

/**
 * Fetch one anti-goal owned by the user (polarity:"avoid") and resolve its
 * breachedToday flag. Returns null when not found / wrong polarity / not the
 * user's.
 */
async function findAntiGoal(userId: string, id: string) {
  const habit = await prisma.habit.findFirst({
    where: { id, userId, polarity: 'avoid' },
    select: ANTIGOAL_SELECT,
  });
  if (!habit) return null;
  const breach = await prisma.habitCompletion.findUnique({
    where: { habitId_completedOn: { habitId: habit.id, completedOn: startOfLocalDay() } },
    select: { id: true },
  });
  return serialize(habit, breach !== null);
}

// --- list ---------------------------------------------------------------

/** GET /api/antigoals -> { antigoals: AntiGoal[] } */
router.get('/', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const today = startOfLocalDay();

  const habits = await prisma.habit.findMany({
    where: { userId, polarity: 'avoid' },
    select: ANTIGOAL_SELECT,
    orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
  });

  // One query for today's breach markers across all of this user's
  // anti-goals, then fan out into a set for O(1) lookup.
  const breaches = await prisma.habitCompletion.findMany({
    where: { userId, completedOn: today, habitId: { in: habits.map(h => h.id) } },
    select: { habitId: true },
  });
  const breached = new Set(breaches.map(b => b.habitId));

  res.json({ antigoals: habits.map(h => serialize(h, breached.has(h.id))) });
}));

// --- create -------------------------------------------------------------

/**
 * POST /api/antigoals
 * Create an anti-goal: a Habit with polarity:"avoid", kind:"habit",
 * cadence:"daily" under the user's "habits" module. Avoid-habits don't
 * generate "do this" quests — clean days auto-credit at the roll-over.
 */
router.post('/', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const data = createSchema.parse(req.body);
  const moduleId = await habitsModuleId(userId);

  const habit = await prisma.habit.create({
    data: {
      userId,
      moduleId,
      kind: 'habit',
      polarity: 'avoid',
      cadence: 'daily',
      title: data.title,
      description: data.description ?? null,
      icon: data.icon ?? null,
      color: data.color ?? null,
      difficulty: data.difficulty ?? 'easy',
      baseXp: data.baseXp ?? 10,
      isActive: true,
    },
    select: ANTIGOAL_SELECT,
  });

  // Freshly created — no breach can exist yet.
  res.status(201).json({ antigoal: serialize(habit, false) });
}));

// --- breach (log a slip for today) --------------------------------------

/**
 * POST /api/antigoals/:id/breach
 * Record a slip for TODAY. In one tx: stamp a HabitCompletion at
 * startOfLocalDay() as the breach marker (idempotent via the unique
 * constraint — a second breach the same day is a no-op) and reset the
 * avoidance streak to 0. A slip pays NOTHING — no XP, no eddies.
 */
router.post('/:id/breach', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;

  const habit = await prisma.habit.findFirst({
    where: { id: req.params.id, userId, polarity: 'avoid' },
    select: { id: true },
  });
  if (!habit) throw new AppError('Anti-goal not found', 404);

  const today = startOfLocalDay();

  await prisma.$transaction(async (tx) => {
    try {
      await tx.habitCompletion.create({
        data: {
          userId,
          habitId: habit.id,
          completedOn: today,
          xpAwarded: 0,
          source: 'manual',
        },
      });
    } catch (err: any) {
      // Already breached today — idempotent no-op (don't reset streak twice;
      // it's already 0 from the first breach).
      if (err?.code !== 'P2002') throw err;
    }
    // A slip breaks the avoidance streak. Safe to run on a repeat breach too.
    await tx.habit.update({
      where: { id: habit.id },
      data: { currentStreak: 0 },
    });
  });

  const antigoal = await findAntiGoal(userId, habit.id);
  if (!antigoal) throw new AppError('Anti-goal not found', 404);

  const ws = (global as any).wsService;
  if (ws?.broadcastGameEvent) {
    ws.broadcastGameEvent(userId, 'antigoal-breached', { antigoalId: habit.id });
  }

  res.json({ antigoal });
}));

// --- update -------------------------------------------------------------

/** PUT /api/antigoals/:id — edit title / difficulty / baseXp / isActive. */
router.put('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const data = updateSchema.parse(req.body);

  const existing = await prisma.habit.findFirst({
    where: { id: req.params.id, userId, polarity: 'avoid' },
    select: { id: true },
  });
  if (!existing) throw new AppError('Anti-goal not found', 404);

  await prisma.habit.update({
    where: { id: existing.id },
    data: {
      title:      data.title,
      difficulty: data.difficulty,
      baseXp:     data.baseXp,
      isActive:   data.isActive,
    },
  });

  const antigoal = await findAntiGoal(userId, existing.id);
  if (!antigoal) throw new AppError('Anti-goal not found', 404);
  res.json({ antigoal });
}));

// --- delete -------------------------------------------------------------

/**
 * DELETE /api/antigoals/:id
 * XP-integrity rule: earned XP/eddies persist when a source is removed —
 * deleting only drops the anti-goal record (cascades its breach markers).
 */
router.delete('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const existing = await prisma.habit.findFirst({
    where: { id: req.params.id, userId, polarity: 'avoid' },
    select: { id: true },
  });
  if (!existing) throw new AppError('Anti-goal not found', 404);

  await prisma.habit.delete({ where: { id: existing.id } });
  res.status(204).end();
}));

export default router;
