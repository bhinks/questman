import express from 'express';
import { z } from 'zod';
import { prisma } from '../server';
import { AuthRequest } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { GamificationService } from '../services/GamificationService';
import { eddiesForReward } from '../utils/economy';
import { startOfLocalDay } from '../utils/dates';
import type { PrismaClient } from '@prisma/client';
import type { QuestCandidate } from '../services/anthropic';

const router = express.Router();
let _game: GamificationService | null = null;
const game = () => (_game ??= new GamificationService(prisma));

/**
 * XP for a workout = base + small bonus for duration. Tunable later;
 * the goal is "logging anything is worthwhile, longer/harder gets more".
 */
const BASE_WORKOUT_XP = 25;
function xpForWorkout(durationMin?: number | null, intensity?: string | null): number {
  let xp = BASE_WORKOUT_XP;
  if (durationMin && durationMin > 0) xp += Math.min(50, Math.floor(durationMin / 5) * 3);
  if (intensity === 'high') xp += 15;
  else if (intensity === 'moderate') xp += 8;
  return xp;
}

const TYPE = z.enum(['strength', 'cardio', 'mobility', 'sport', 'other']);
const INTENSITY = z.enum(['low', 'moderate', 'high']);

// `exercises` is free-form JSON: each app version can evolve the shape.
// We keep validation light here (any object[]) and let the UI enforce
// structure. SQLite-friendly: stored as JSON string.
const exerciseSetSchema = z.object({
  reps: z.number().int().optional(),
  weight: z.number().optional(),
  durationSec: z.number().int().optional(),
  distanceM: z.number().optional(),
}).passthrough();

const exerciseSchema = z.object({
  exercise: z.string().min(1),
  sets: z.array(exerciseSetSchema).optional(),
}).passthrough();

const createSchema = z.object({
  moduleId:    z.string().optional(), // fall back to user's `fitness` module
  title:       z.string().max(200).nullable().optional(),
  type:        TYPE,
  performedAt: z.string().datetime().optional(), // defaults to now
  durationMin: z.number().int().min(0).max(720).nullable().optional(),
  intensity:   INTENSITY.nullable().optional(),
  caloriesEst: z.number().int().min(0).nullable().optional(),
  notes:       z.string().max(2000).nullable().optional(),
  exercises:   z.array(exerciseSchema).optional(),
  metrics:     z.record(z.unknown()).optional(),
  // Client-generated idempotency key (one per Log-Workout form). A double-
  // submit/retry reuses it → deduped server-side (no second payout).
  clientRequestId: z.string().min(1).max(100).optional(),
});

const updateSchema = createSchema.partial();

/** Resolve "fitness" module for the user. */
async function fitnessModuleId(userId: string): Promise<string> {
  const mod = await prisma.module.findUnique({
    where: { userId_key: { userId, key: 'fitness' } },
    select: { id: true },
  });
  if (!mod) throw new AppError('Fitness module missing — re-run seed', 500);
  return mod.id;
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

/** GET /api/workouts?from=&to= */
router.get('/', asyncHandler(async (req: AuthRequest, res) => {
  const querySchema = z.object({
    from: z.string().datetime().optional(),
    to:   z.string().datetime().optional(),
    limit: z.string().transform(Number).pipe(z.number().int().positive().max(500)).default('100'),
  });
  const { from, to, limit } = querySchema.parse(req.query);

  const workouts = await prisma.workoutSession.findMany({
    where: {
      userId: req.user!.id,
      ...(from || to ? {
        performedAt: {
          ...(from && { gte: new Date(from) }),
          ...(to && { lte: new Date(to) }),
        },
      } : {}),
    },
    orderBy: { performedAt: 'desc' },
    take: limit,
  });

  res.json({
    workouts: workouts.map(w => ({
      ...w,
      exercises: parseJson(w.exercises),
      metrics: parseJson(w.metrics),
    })),
  });
}));

// ---------------------------------------------------------------------
// Weekly workout plan ("push day every Monday"). NOTE: these routes MUST
// be registered before '/:id' so 'plan' isn't captured as a workout id.
// ---------------------------------------------------------------------

const planCreateSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6), // 0=Sunday .. 6=Saturday (JS getDay)
  title:     z.string().min(1).max(200),
  type:      TYPE,
  targetMin: z.number().int().min(1).max(720).nullable().optional(),
  notes:     z.string().max(2000).nullable().optional(),
});

const planUpdateSchema = planCreateSchema.partial().extend({
  isActive:  z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

/** GET /api/workouts/plan — the user's weekly protocol, day-ordered. */
router.get('/plan', asyncHandler(async (req: AuthRequest, res) => {
  const plans = await prisma.workoutPlan.findMany({
    where: { userId: req.user!.id },
    orderBy: [{ dayOfWeek: 'asc' }, { sortOrder: 'asc' }],
  });
  res.json({ plans });
}));

/** POST /api/workouts/plan — add a planned slot to a weekday. */
router.post('/plan', asyncHandler(async (req: AuthRequest, res) => {
  const data = planCreateSchema.parse(req.body);
  const userId = req.user!.id;

  // Append within the day: next sortOrder after the day's existing slots.
  const last = await prisma.workoutPlan.findFirst({
    where: { userId, dayOfWeek: data.dayOfWeek },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });

  const plan = await prisma.workoutPlan.create({
    data: {
      userId,
      dayOfWeek: data.dayOfWeek,
      title: data.title,
      type: data.type,
      targetMin: data.targetMin ?? null,
      notes: data.notes ?? null,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
  });
  res.status(201).json({ plan });
}));

/** PUT /api/workouts/plan/:id — partial edit (incl. isActive toggle). */
router.put('/plan/:id', asyncHandler(async (req: AuthRequest, res) => {
  const data = planUpdateSchema.parse(req.body);
  const existing = await prisma.workoutPlan.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
    select: { id: true },
  });
  if (!existing) throw new AppError('Plan slot not found', 404);

  const plan = await prisma.workoutPlan.update({
    where: { id: existing.id },
    data: {
      ...(data.dayOfWeek !== undefined ? { dayOfWeek: data.dayOfWeek } : {}),
      ...(data.title     !== undefined ? { title: data.title } : {}),
      ...(data.type      !== undefined ? { type: data.type } : {}),
      ...(data.targetMin !== undefined ? { targetMin: data.targetMin } : {}),
      ...(data.notes     !== undefined ? { notes: data.notes } : {}),
      ...(data.isActive  !== undefined ? { isActive: data.isActive } : {}),
      ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
    },
  });
  res.json({ plan });
}));

/** DELETE /api/workouts/plan/:id */
router.delete('/plan/:id', asyncHandler(async (req: AuthRequest, res) => {
  const result = await prisma.workoutPlan.deleteMany({
    where: { id: req.params.id, userId: req.user!.id },
  });
  if (result.count === 0) throw new AppError('Plan slot not found', 404);
  res.json({ deleted: true });
}));

/** GET /api/workouts/:id */
router.get('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const w = await prisma.workoutSession.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
  });
  if (!w) throw new AppError('Workout not found', 404);
  res.json({ workout: { ...w, exercises: parseJson(w.exercises), metrics: parseJson(w.metrics) } });
}));

/**
 * POST /api/workouts
 *
 * Awards XP and auto-completes any pending "log a workout today" quest.
 * Same-day double-logs are allowed (sometimes you do AM + PM workouts);
 * XP is awarded per session.
 */
router.post('/', asyncHandler(async (req: AuthRequest, res) => {
  const data = createSchema.parse(req.body);
  const userId = req.user!.id;
  const moduleId = data.moduleId ?? (await fitnessModuleId(userId));

  // Verify ownership if user supplied moduleId.
  if (data.moduleId) {
    const owns = await prisma.module.findFirst({
      where: { id: data.moduleId, userId }, select: { id: true },
    });
    if (!owns) throw new AppError('Module not found', 404);
  }

  const performedAt = data.performedAt ? new Date(data.performedAt) : new Date();
  const xp = xpForWorkout(data.durationMin, data.intensity);

  let workout: any;
  let player: Awaited<ReturnType<GamificationService['awardXp']>> | null = null;
  let questAutoCompleted: { id: string; xpReward: number } | null = null;
  let deduped = false;

  try {
    await prisma.$transaction(async (tx) => {
      workout = await tx.workoutSession.create({
        data: {
          userId,
          moduleId,
          title: data.title ?? null,
          type: data.type,
          performedAt,
          durationMin: data.durationMin ?? null,
          intensity: data.intensity ?? null,
          caloriesEst: data.caloriesEst ?? null,
          notes: data.notes ?? null,
          exercises: data.exercises ? JSON.stringify(data.exercises) : null,
          metrics: data.metrics ? JSON.stringify(data.metrics) : null,
          xpAwarded: xp,
          clientRequestId: data.clientRequestId ?? null,
        },
      });

      player = await game().awardXp(userId, {
        amount: xp,
        eddies: eddiesForReward(xp),
        reason: 'workout_log',
        module: 'fitness',
        refType: 'workout',
        refId: workout.id,
      }, tx);

      // Auto-complete a "log a workout today" quest if pending.
      const today = startOfLocalDay(performedAt);
      const pending = await tx.quest.findFirst({
        where: {
          userId, source: 'workout', questDate: today, status: 'pending',
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
            meta: JSON.stringify({ trigger: 'workout-log', workoutId: workout.id }),
          },
        });
        questAutoCompleted = { id: pending.id, xpReward: pending.xpReward };
      }
    });
  } catch (e: any) {
    // Idempotency: a double-submit/retry reusing the same clientRequestId
    // collides on the unique index. Treat it as a no-op — return the
    // already-logged session WITHOUT a second XP/eddie payout.
    if (data.clientRequestId && e?.code === 'P2002') {
      workout = await prisma.workoutSession.findFirst({
        where: { userId, clientRequestId: data.clientRequestId },
      });
      deduped = true;
    } else {
      throw e;
    }
  }

  const ws = (global as any).wsService;
  if (ws?.broadcastGameEvent && workout && !deduped) {
    ws.broadcastGameEvent(userId, 'workout-logged', {
      workoutId: workout.id, xpAwarded: xp, questAutoCompleted,
    });
  }

  res.status(deduped ? 200 : 201).json({
    workout: workout && {
      ...workout,
      exercises: parseJson(workout.exercises),
      metrics: parseJson(workout.metrics),
    },
    xpAwarded: deduped ? (workout?.xpAwarded ?? 0) : xp,
    player,
    questAutoCompleted,
    deduped,
  });
}));

/** PUT /api/workouts/:id — does NOT re-award XP (edit-only). */
router.put('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const data = updateSchema.parse(req.body);
  const existing = await prisma.workoutSession.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
  });
  if (!existing) throw new AppError('Workout not found', 404);

  const updated = await prisma.workoutSession.update({
    where: { id: existing.id },
    data: {
      ...data,
      performedAt: data.performedAt ? new Date(data.performedAt) : undefined,
      exercises: data.exercises === undefined
        ? undefined
        : JSON.stringify(data.exercises),
      metrics: data.metrics === undefined
        ? undefined
        : JSON.stringify(data.metrics),
    },
  });

  res.json({
    workout: { ...updated, exercises: parseJson(updated.exercises), metrics: parseJson(updated.metrics) },
  });
}));

/**
 * DELETE /api/workouts/:id
 *
 * XP-integrity rule (roadmap §8): earned XP/eddies PERSIST when the
 * source is deleted. Deleting a workout removes the session record only
 * — it does NOT reverse the grant. The ledger entry stays, so the
 * player's level and wallet are unchanged. (The only legitimate reversal
 * is "undo completion", which workouts don't have — logging is the act.)
 * Typical reason to delete is to re-log a corrected session.
 */
router.delete('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const existing = await prisma.workoutSession.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
    select: { id: true },
  });
  if (!existing) throw new AppError('Workout not found', 404);

  await prisma.workoutSession.delete({ where: { id: existing.id } });

  res.status(204).end();
}));

/**
 * QuestEngine candidate builder for the fitness pool.
 *
 *  - A session already logged today → [] (the day's training is handled).
 *  - Active WorkoutPlan slots for today's weekday → one "Scheduled: <title>"
 *    candidate PER slot (sourceId = plan.id), so the day's protocol shows up
 *    as concrete quests and logging auto-completes the pending one.
 *  - No plan for today → the legacy generic "Log a workout" candidate
 *    (sourceId null), preserving pre-plan behavior.
 */
export async function buildWorkoutCandidates(
  prisma: PrismaClient,
  userId: string,
  date: Date,
  nextId: () => string,
): Promise<QuestCandidate[]> {
  const dayStart = startOfLocalDay(date);

  const session = await prisma.workoutSession.findFirst({
    where: { userId, performedAt: { gte: dayStart } },
    select: { id: true },
  });
  if (session) return [];

  const plans = await prisma.workoutPlan.findMany({
    where: { userId, isActive: true, dayOfWeek: dayStart.getDay() },
    orderBy: { sortOrder: 'asc' },
  });

  if (plans.length === 0) {
    return [{
      candidateId: nextId(),
      source: 'workout',
      sourceId: null,
      moduleKey: 'fitness',
      baseTitle: 'Log a workout',
      difficulty: 'medium',
      xpReward: 30,
    }];
  }

  return plans.map((plan): QuestCandidate => ({
    candidateId: nextId(),
    source: 'workout',
    sourceId: plan.id,
    moduleKey: 'fitness',
    baseTitle: `Scheduled: ${plan.title}`,
    difficulty: 'medium',
    xpReward: 30,
    context: plan.notes ?? plan.type,
    estMinutes: plan.targetMin ?? undefined,
    carryOver: false,
  }));
}

export default router;
