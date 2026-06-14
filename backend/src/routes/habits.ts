/**
 * Habits + Chores share this model: `kind` discriminates ("habit" |
 * "chore"). All cross-cutting behavior (XP on check, streak bump,
 * idempotent daily completion, quest auto-complete) lives here so we
 * only implement it once.
 */
import express from 'express';
import { z } from 'zod';
import { prisma } from '../server';
import { AuthRequest } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { GamificationService } from '../services/GamificationService';
import { eddiesForReward } from '../utils/economy';
import { startOfLocalDay } from '../utils/dates';

const router = express.Router();

let _game: GamificationService | null = null;
const game = () => (_game ??= new GamificationService(prisma));

const KIND = z.enum(['habit', 'chore']);
const CADENCE = z.enum(['daily', 'weekly', 'custom', 'once']);
const DIFFICULTY = z.enum(['easy', 'medium', 'hard']);

// Outdoor weather gating (see WeatherService). `outdoor` is the switch;
// the rest are optional thresholds evaluated against Open-Meteo.
const WEATHER_RULE = z.object({
  outdoor:         z.literal(true),
  dryDaysRequired: z.number().int().min(0).max(14).optional(),
  maxRainTodayIn:  z.number().min(0).max(4).optional(),
  minTempF:        z.number().min(-40).max(140).optional(),
  maxTempF:        z.number().min(-40).max(140).optional(),
  maxWindMph:      z.number().min(0).max(120).optional(),
});

const createSchema = z.object({
  moduleId:     z.string(),
  kind:         KIND.default('habit'),
  title:        z.string().min(1).max(200),
  description:  z.string().max(1000).nullable().optional(),
  icon:         z.string().nullable().optional(),
  color:        z.string().nullable().optional(),
  cadence:      CADENCE.default('daily'),
  schedule:     z.record(z.unknown()).nullable().optional(), // {daysOfWeek:[1,3,5]} | {everyN:2}
  dueDate:      z.string().datetime().nullable().optional(),
  targetPerDay: z.number().int().min(1).max(20).default(1),
  baseXp:       z.number().int().min(0).max(500).default(10),
  difficulty:   DIFFICULTY.default('easy'),
  estMinutes:   z.number().int().min(1).max(1440).nullable().optional(),
  minIntervalDays: z.number().int().min(1).max(365).nullable().optional(),
  weatherRule:  WEATHER_RULE.nullable().optional(),
  // "Operations" consolidation: attach this chore to a project (rotation).
  // null = Uncategorized. Ownership is verified in the handlers.
  projectId:    z.string().nullable().optional(),
});

/** Verify a projectId (if given & non-null) belongs to the user. */
async function assertProjectOwned(userId: string, projectId: string | null | undefined): Promise<void> {
  if (!projectId) return;
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
    select: { id: true },
  });
  if (!project) throw new AppError('Project not found', 404);
}

const updateSchema = createSchema.partial().extend({
  isActive: z.boolean().optional(),
});

// "What habits should fire today" — encodes the cadence semantics in
// one place so the QuestEngine (Phase 3) can reuse it.
export function isHabitDueToday(
  habit: { cadence: string; schedule: string | null; dueDate: Date | null },
  today: Date = startOfLocalDay(),
): boolean {
  switch (habit.cadence) {
    case 'daily':
      return true;
    case 'weekly': {
      const sched = parseJson<{ daysOfWeek?: number[] }>(habit.schedule);
      // Default to Mondays if unspecified.
      const days = sched?.daysOfWeek ?? [1];
      return days.includes(today.getDay());
    }
    case 'custom': {
      const sched = parseJson<{ daysOfWeek?: number[]; everyN?: number }>(habit.schedule);
      if (sched?.daysOfWeek?.includes(today.getDay())) return true;
      return false;
    }
    case 'once': {
      if (!habit.dueDate) return false;
      const due = startOfLocalDay(new Date(habit.dueDate));
      return due.getTime() === today.getTime();
    }
    default:
      return false;
  }
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

/**
 * Shape a Habit row for the API: the JSON-string columns (`schedule`,
 * `weatherRule`) are parsed back to objects. Extra included relations
 * (e.g. `completions`) pass through untouched.
 */
function serialize<T extends { schedule: string | null; weatherRule: string | null }>(habit: T) {
  return {
    ...habit,
    schedule: parseJson(habit.schedule),
    weatherRule: parseJson(habit.weatherRule),
  };
}

/** GET /api/habits?kind=habit|chore&active=true */
router.get('/', asyncHandler(async (req: AuthRequest, res) => {
  const kind = KIND.optional().parse(req.query.kind);
  const active = req.query.active === undefined
    ? undefined
    : req.query.active === 'true';

  const habits = await prisma.habit.findMany({
    where: {
      userId: req.user!.id,
      // Anti-goals (polarity:"avoid") are managed in the ICE view, not here.
      polarity: 'do',
      ...(kind && { kind }),
      ...(active !== undefined && { isActive: active }),
    },
    orderBy: [{ kind: 'asc' }, { title: 'asc' }],
  });

  // Annotate with today's completion state so the UI can render a
  // checked / unchecked toggle without a second round-trip.
  const today = startOfLocalDay();
  const completedToday = new Set(
    (await prisma.habitCompletion.findMany({
      where: { userId: req.user!.id, completedOn: today },
      select: { habitId: true },
    })).map(c => c.habitId),
  );

  res.json({
    habits: habits.map(h => ({
      ...serialize(h),
      isCompletedToday: completedToday.has(h.id),
      isDueToday: isHabitDueToday(h, today),
    })),
  });
}));

/** GET /api/habits/:id */
router.get('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const habit = await prisma.habit.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
    include: {
      completions: { orderBy: { completedOn: 'desc' }, take: 60 },
    },
  });
  if (!habit) throw new AppError('Habit not found', 404);
  res.json({ habit: serialize(habit) });
}));

/** POST /api/habits */
router.post('/', asyncHandler(async (req: AuthRequest, res) => {
  const data = createSchema.parse(req.body);
  const userId = req.user!.id;

  // Verify the module belongs to this user (and exists).
  const mod = await prisma.module.findFirst({
    where: { id: data.moduleId, userId },
    select: { id: true },
  });
  if (!mod) throw new AppError('Module not found', 404);
  await assertProjectOwned(userId, data.projectId);

  const habit = await prisma.habit.create({
    data: {
      userId,
      moduleId: data.moduleId,
      kind: data.kind,
      title: data.title,
      description: data.description ?? null,
      icon: data.icon ?? null,
      color: data.color ?? null,
      cadence: data.cadence,
      schedule: data.schedule ? JSON.stringify(data.schedule) : null,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      targetPerDay: data.targetPerDay,
      baseXp: data.baseXp,
      difficulty: data.difficulty,
      estMinutes: data.estMinutes ?? null,
      minIntervalDays: data.minIntervalDays ?? null,
      weatherRule: data.weatherRule ? JSON.stringify(data.weatherRule) : null,
      projectId: data.projectId ?? null,
    },
  });
  res.status(201).json({ habit: serialize(habit) });
}));

/** PUT /api/habits/:id */
router.put('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const data = updateSchema.parse(req.body);
  const existing = await prisma.habit.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
  });
  if (!existing) throw new AppError('Habit not found', 404);
  await assertProjectOwned(req.user!.id, data.projectId);

  const habit = await prisma.habit.update({
    where: { id: existing.id },
    data: {
      ...data,
      schedule: data.schedule === undefined
        ? undefined
        : data.schedule === null
          ? null
          : JSON.stringify(data.schedule),
      weatherRule: data.weatherRule === undefined
        ? undefined
        : data.weatherRule === null
          ? null
          : JSON.stringify(data.weatherRule),
      dueDate: data.dueDate === undefined
        ? undefined
        : data.dueDate === null
          ? null
          : new Date(data.dueDate),
    },
  });
  res.json({ habit: serialize(habit) });
}));

/** DELETE /api/habits/:id */
router.delete('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const existing = await prisma.habit.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
    select: { id: true },
  });
  if (!existing) throw new AppError('Habit not found', 404);
  await prisma.habit.delete({ where: { id: existing.id } });
  res.status(204).end();
}));

/**
 * POST /api/habits/:id/check
 *
 * Idempotent daily check: re-checking the same habit on the same local
 * day returns the existing completion and awards no further XP. The
 * `@@unique([habitId, completedOn])` constraint enforces this.
 *
 * Side effects (all inside a single transaction):
 *   - HabitCompletion row with `xpAwarded`.
 *   - Habit streak bumped via GamificationService.bumpHabitStreak.
 *   - XP awarded to PlayerProfile + XpLedger entry.
 *   - Auto-completes a pending quest with source="habit", sourceId=habit.id
 *     for today, if any (future-proof: written before Phase 3 quests exist).
 *   - Broadcasts `habit-checked` over socket.
 */
router.post('/:id/check', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const habit = await prisma.habit.findFirst({
    where: { id: req.params.id, userId },
  });
  if (!habit) throw new AppError('Habit not found', 404);

  const today = startOfLocalDay();

  // Race-safe idempotent insert: catch P2002 → existing.
  let completion;
  let xpAwarded = 0;
  let player: Awaited<ReturnType<GamificationService['awardXp']>> | null = null;
  let questAutoCompleted: { id: string; xpReward: number } | null = null;

  try {
    completion = await prisma.$transaction(async (tx) => {
      const created = await tx.habitCompletion.create({
        data: {
          userId,
          habitId: habit.id,
          completedOn: today,
          xpAwarded: habit.baseXp,
          source: 'manual',
        },
      });

      await game().bumpHabitStreak(habit.id, today, tx);

      const moduleKey = await tx.module.findUnique({
        where: { id: habit.moduleId }, select: { key: true },
      });
      const snap = await game().awardXp(userId, {
        amount: habit.baseXp,
        eddies: eddiesForReward(habit.baseXp, habit.difficulty),
        reason: 'habit_log',
        module: moduleKey?.key,
        refType: 'habit',
        refId: habit.id,
      }, tx);
      player = snap;
      xpAwarded = habit.baseXp;

      // Record the ACTUAL eddies banked so an undo reverses exactly this — not a
      // recomputed value. snap.eddiesDelta is the precise wallet write and
      // already includes BOTH the overclock multiplier AND the Overdrive ×2
      // booster; the old recompute used eddieMultiplierApplied (overclock only),
      // so a check+undo cycle under an active booster minted free eddies.
      await tx.habitCompletion.update({
        where: { id: created.id },
        data: { eddiesAwarded: snap.eddiesDelta ?? 0 },
      });

      // A 'once' habit is a one-shot to-do: deactivate it on completion so it
      // stops surfacing as a live daemon (and stops re-generating a quest). The
      // row stays for history / the Offline archive.
      if (habit.cadence === 'once') {
        await tx.habit.update({ where: { id: habit.id }, data: { isActive: false } });
      }

      // Auto-complete any pending quest tied to this habit today.
      const pending = await tx.quest.findFirst({
        where: {
          userId, source: 'habit', sourceId: habit.id,
          questDate: today, status: 'pending',
        },
      });
      if (pending) {
        await tx.quest.update({
          where: { id: pending.id },
          data: { status: 'completed', progress: pending.target },
        });
        await tx.questCompletion.create({
          data: {
            userId, questId: pending.id, xpAwarded: 0,
            meta: JSON.stringify({ trigger: 'habit-check' }),
          },
        });
        questAutoCompleted = { id: pending.id, xpReward: pending.xpReward };
      }

      return created;
    });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      // Already completed today — idempotent no-op.
      completion = await prisma.habitCompletion.findUnique({
        where: { habitId_completedOn: { habitId: habit.id, completedOn: today } },
      });
    } else {
      throw err;
    }
  }

  const ws = (global as any).wsService;
  if (ws?.broadcastGameEvent) {
    ws.broadcastGameEvent(userId, 'habit-checked', {
      habitId: habit.id, xpAwarded, questAutoCompleted,
    });
  }

  res.json({
    completion,
    xpAwarded,
    player,
    questAutoCompleted,
  });
}));

/**
 * DELETE /api/habits/:id/check?date=YYYY-MM-DD
 *
 * Undo today's (or a specific day's) check. Removes the completion
 * and writes a compensating XpLedger entry (so the audit shows the
 * reversal). Habit streak is NOT auto-rolled-back — too easy to get
 * wrong; the user can re-check tomorrow to resume their streak.
 */
router.delete('/:id/check', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const habit = await prisma.habit.findFirst({
    where: { id: req.params.id, userId },
  });
  if (!habit) throw new AppError('Habit not found', 404);

  const day = req.query.date
    ? startOfLocalDay(new Date(String(req.query.date)))
    : startOfLocalDay();

  const completion = await prisma.habitCompletion.findUnique({
    where: { habitId_completedOn: { habitId: habit.id, completedOn: day } },
  });
  if (!completion) {
    res.json({ undone: false });
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.habitCompletion.delete({ where: { id: completion.id } });
    // Compensating ledger entry — audit-friendly negative.
    const moduleKey = await tx.module.findUnique({
      where: { id: habit.moduleId }, select: { key: true },
    });
    if (completion.xpAwarded > 0 || completion.eddiesAwarded > 0) {
      // Un-checking is a legitimate "undo completion" — reverse both the
      // XP and the eddies that the check granted (roadmap: undo reverses;
      // deleting the task definition does not). Reverse the EXACT eddies
      // banked at check time (overclock multiplier included); the `||`
      // fallback covers legacy rows created before eddiesAwarded existed.
      await game().awardXp(userId, {
        amount: -completion.xpAwarded,
        eddies: -(completion.eddiesAwarded || eddiesForReward(completion.xpAwarded, habit.difficulty)),
        reason: 'habit_log_undo',
        module: moduleKey?.key,
        refType: 'habit', refId: habit.id,
      }, tx);
    }
  });

  res.json({ undone: true });
}));

export default router;
