/**
 * Focus-timer routes — the JACK IN deep-work chamber.
 *
 *   GET  /targets   → everything a session can be logged against (today's
 *                     pending quests, active projects, habits, chores,
 *                     workout plans), flattened to { type, id, label }
 *                     options for the picker.
 *   POST /sessions  → persist a FINISHED session (the timer itself runs
 *                     client-side). Quest targets also accumulate
 *                     Quest.actualMinutes so estimate accuracy keeps
 *                     learning exactly like the old inline JACK IN did.
 *   GET  /sessions  → recent sessions, newest first (SESSION LOG feed).
 *   GET  /summary   → total minutes + session count grouped by target —
 *                     the "actual time spent" badges on linked objects.
 *
 * Conventions mirror routes/shop.ts: userId-scoped, auth-mounted, zod-parsed.
 * No XP/eddies are minted here — focus time is informational, not an earn.
 */
import express from 'express';
import { z } from 'zod';
import { prisma } from '../server';
import { AuthRequest } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { startOfLocalDay } from '../utils/dates';

const router = express.Router();

// --- targets --------------------------------------------------------------

/** GET /targets → { targets: [{ type, id, label }] } for the focus picker. */
router.get('/targets', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const [quests, projects, habits, plans] = await Promise.all([
    prisma.quest.findMany({
      // Today's open contracts — so a run can be attributed to the quest
      // it's actually burning down (and feed Quest.actualMinutes).
      where: { userId, questDate: startOfLocalDay(), status: 'pending' },
      select: { id: true, title: true },
      orderBy: { title: 'asc' },
    }),
    prisma.project.findMany({
      where: { userId, status: 'active' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.habit.findMany({
      // "do" trackables only — you can't spend focused time on avoiding.
      where: { userId, isActive: true, polarity: 'do' },
      select: { id: true, title: true, kind: true },
      orderBy: { title: 'asc' },
    }),
    prisma.workoutPlan.findMany({
      where: { userId, isActive: true },
      select: { id: true, title: true },
      orderBy: [{ dayOfWeek: 'asc' }, { sortOrder: 'asc' }],
    }),
  ]);

  res.json({
    targets: [
      ...quests.map(q => ({ type: 'quest' as const, id: q.id, label: q.title })),
      ...projects.map(p => ({ type: 'project' as const, id: p.id, label: p.name })),
      ...habits.map(h => ({ type: h.kind === 'chore' ? 'chore' as const : 'habit' as const, id: h.id, label: h.title })),
      ...plans.map(w => ({ type: 'workout' as const, id: w.id, label: w.title })),
    ],
  });
}));

// --- sessions ---------------------------------------------------------------

const TARGET_TYPES = ['quest', 'project', 'habit', 'chore', 'workout', 'other'] as const;

const createSchema = z.object({
  targetType: z.enum(TARGET_TYPES),
  targetId: z.string().min(1).max(100).nullable().optional(),
  /** Display label; required for 'other', ignored (re-resolved) otherwise. */
  label: z.string().max(200).optional(),
  startedAt: z.string().datetime(),
  minutes: z.number().int().min(1).max(1440),
  limitMinutes: z.number().int().min(1).max(1440).nullable().optional(),
});

/**
 * Resolve + verify the target row, returning its authoritative label.
 * Throws 404 if the id doesn't exist for this user (or kind mismatches),
 * so a session can never point at someone else's row.
 */
async function resolveTarget(
  userId: string,
  targetType: (typeof TARGET_TYPES)[number],
  targetId: string | null,
  fallbackLabel: string | undefined,
): Promise<{ targetId: string | null; label: string }> {
  if (targetType === 'other') {
    return { targetId: null, label: (fallbackLabel ?? '').trim() || 'Unlabeled run' };
  }
  if (!targetId) throw new AppError('targetId required for this target type', 400);

  switch (targetType) {
    case 'quest': {
      const q = await prisma.quest.findFirst({ where: { id: targetId, userId }, select: { title: true } });
      if (!q) throw new AppError('Quest not found', 404);
      return { targetId, label: q.title };
    }
    case 'project': {
      const p = await prisma.project.findFirst({ where: { id: targetId, userId }, select: { name: true } });
      if (!p) throw new AppError('Project not found', 404);
      return { targetId, label: p.name };
    }
    case 'habit':
    case 'chore': {
      const h = await prisma.habit.findFirst({ where: { id: targetId, userId }, select: { title: true, kind: true } });
      if (!h) throw new AppError('Habit not found', 404);
      // Store the row's REAL kind so summaries group correctly even if the
      // client sent the sibling type.
      return { targetId, label: h.title };
    }
    case 'workout': {
      const w = await prisma.workoutPlan.findFirst({ where: { id: targetId, userId }, select: { title: true } });
      if (!w) throw new AppError('Workout plan not found', 404);
      return { targetId, label: w.title };
    }
  }
  throw new AppError('Unknown target type', 400);
}

/**
 * POST /sessions — log a finished focus run.
 *
 * endedAt is server-stamped (now); startedAt comes from the client so the
 * log reads correctly, but is clamped to keep a fiddled clock from minting
 * absurd rows. Quest targets ALSO bump Quest.actualMinutes (same semantics
 * as POST /api/quests/:id/focus — accumulate, never complete, no XP).
 */
router.post('/sessions', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const body = createSchema.parse(req.body);

  const { targetId, label } = await resolveTarget(
    userId, body.targetType, body.targetId ?? null, body.label,
  );

  const endedAt = new Date();
  let startedAt = new Date(body.startedAt);
  // Clamp: startedAt must precede endedAt and lie within the last 48h.
  const floor = new Date(endedAt.getTime() - 48 * 60 * 60 * 1000);
  if (startedAt > endedAt) startedAt = new Date(endedAt.getTime() - body.minutes * 60_000);
  if (startedAt < floor) startedAt = floor;

  const session = await prisma.focusSession.create({
    data: {
      userId,
      targetType: body.targetType,
      targetId,
      label,
      startedAt,
      endedAt,
      minutes: body.minutes,
      limitMinutes: body.limitMinutes ?? null,
    },
  });

  // Quest focus keeps feeding estimate accuracy, same as the old inline timer.
  // Atomic increment (scoped by userId) — POST /api/quests/:id/focus writes the
  // same field, so a read-modify-write would lose updates when both fire.
  if (body.targetType === 'quest' && targetId) {
    await prisma.quest.updateMany({
      where: { id: targetId, userId },
      data: { actualMinutes: { increment: body.minutes } },
    });
  }

  res.status(201).json({ session });
}));

/** GET /sessions?limit=50 → { sessions } newest-first. */
router.get('/sessions', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const sessions = await prisma.focusSession.findMany({
    where: { userId },
    orderBy: { startedAt: 'desc' },
    take: limit,
  });
  res.json({ sessions });
}));

// --- summary ----------------------------------------------------------------

/**
 * GET /summary → { totals: [{ targetType, targetId, minutes, sessions }] }.
 * One grouped query; views filter to their own type client-side and join
 * on targetId to show "actual time spent" per object.
 */
router.get('/summary', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const rows = await prisma.focusSession.groupBy({
    by: ['targetType', 'targetId'],
    where: { userId },
    _sum: { minutes: true },
    _count: { _all: true },
  });
  res.json({
    totals: rows.map(r => ({
      targetType: r.targetType,
      targetId: r.targetId,
      minutes: r._sum.minutes ?? 0,
      sessions: r._count._all,
    })),
  });
}));

export default router;
