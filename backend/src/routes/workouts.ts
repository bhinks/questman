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

  let workout;
  let player: Awaited<ReturnType<GamificationService['awardXp']>> | null = null;
  let questAutoCompleted: { id: string; xpReward: number } | null = null;

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

  const ws = (global as any).wsService;
  if (ws?.broadcastGameEvent && workout) {
    ws.broadcastGameEvent(userId, 'workout-logged', {
      workoutId: (workout as any).id, xpAwarded: xp, questAutoCompleted,
    });
  }

  res.status(201).json({
    workout: workout && {
      ...workout,
      exercises: parseJson((workout as any).exercises),
      metrics: parseJson((workout as any).metrics),
    },
    xpAwarded: xp,
    player,
    questAutoCompleted,
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

export default router;
