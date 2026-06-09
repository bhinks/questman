/**
 * Projects domain — "Operations" pool.
 *
 * A Project bundles ProjectTasks (the day-to-day grind, each worth a
 * quest) and Milestones (boss clears — a chunky bonusXp on completion).
 *
 * Closed-loop linkage: when a task flips done false→true we auto-complete
 * any pending quest tied to that task today (source='project', sourceId=
 * task.id) and land its XP/eddies, mirroring the habit /check pattern.
 *
 * Candidate builder: each active project contributes its top incomplete
 * task as a quest candidate (capped at 2 across all projects).
 */
import express from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../server';
import { AuthRequest } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { GamificationService } from '../services/GamificationService';
import { eddiesForReward } from '../utils/economy';
import { startOfLocalDay } from '../utils/dates';
import { QuestCandidate } from '../services/anthropic';

const router = express.Router();

let _game: GamificationService | null = null;
const game = () => (_game ??= new GamificationService(prisma));

const STATUS = z.enum(['active', 'paused', 'done', 'archived']);

// Order active projects first, then paused, then done, then archived.
const STATUS_RANK: Record<string, number> = {
  active: 0, paused: 1, done: 2, archived: 3,
};

const projectCreateSchema = z.object({
  name:        z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  color:       z.string().max(40).nullable().optional(),
  status:      STATUS.default('active'),
});
const projectUpdateSchema = z.object({
  name:        z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  color:       z.string().max(40).nullable().optional(),
  status:      STATUS.optional(),
});

const taskCreateSchema = z.object({
  title:      z.string().min(1).max(300),
  estMinutes: z.number().int().min(1).max(1440).nullable().optional(),
  priority:   z.number().int().min(0).max(100).optional(),
});
const taskUpdateSchema = z.object({
  title:      z.string().min(1).max(300).optional(),
  estMinutes: z.number().int().min(1).max(1440).nullable().optional(),
  priority:   z.number().int().min(0).max(100).optional(),
  sortOrder:  z.number().int().min(0).max(100000).optional(),
  done:       z.boolean().optional(),
});

const milestoneCreateSchema = z.object({
  title:   z.string().min(1).max(300),
  dueDate: z.string().datetime().nullable().optional(),
  bonusXp: z.number().int().min(0).max(2000).optional(),
});
const milestoneUpdateSchema = z.object({
  title:     z.string().min(1).max(300).optional(),
  dueDate:   z.string().datetime().nullable().optional(),
  bonusXp:   z.number().int().min(0).max(2000).optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  done:      z.boolean().optional(),
});

/** Resolve the user's "projects" module (throws if seed missing). */
async function projectsModuleId(userId: string): Promise<string> {
  const mod = await prisma.module.findUnique({
    where: { userId_key: { userId, key: 'projects' } },
    select: { id: true },
  });
  if (!mod) throw new AppError('module missing — re-run seed', 500);
  return mod.id;
}

/** GET /api/projects?status= — projects with tasks + milestones, active first. */
router.get('/', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const status = STATUS.optional().parse(req.query.status);

  const projects = await prisma.project.findMany({
    where: { userId, ...(status && { status }) },
    include: {
      tasks: { orderBy: [{ done: 'asc' }, { priority: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }] },
      milestones: { orderBy: [{ done: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }] },
    },
  });

  // Status rank first (active → archived), then most-recently-updated.
  projects.sort((a, b) => {
    const r = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
    if (r !== 0) return r;
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });

  res.json({ projects });
}));

/** POST /api/projects */
router.post('/', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const data = projectCreateSchema.parse(req.body);
  const moduleId = await projectsModuleId(userId);

  const project = await prisma.project.create({
    data: {
      userId,
      moduleId,
      name: data.name,
      description: data.description ?? null,
      color: data.color ?? null,
      status: data.status,
    },
    include: { tasks: true, milestones: true },
  });
  res.status(201).json({ project });
}));

/** PUT /api/projects/:id */
router.put('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const data = projectUpdateSchema.parse(req.body);

  const existing = await prisma.project.findFirst({
    where: { id: req.params.id, userId },
    select: { id: true },
  });
  if (!existing) throw new AppError('Project not found', 404);

  const project = await prisma.project.update({
    where: { id: existing.id },
    data: {
      name: data.name,
      description: data.description === undefined ? undefined : data.description,
      color: data.color === undefined ? undefined : data.color,
      status: data.status,
    },
    include: {
      tasks: { orderBy: [{ done: 'asc' }, { priority: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }] },
      milestones: { orderBy: [{ done: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }] },
    },
  });
  res.json({ project });
}));

/** DELETE /api/projects/:id — cascades tasks + milestones. */
router.delete('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const existing = await prisma.project.findFirst({
    where: { id: req.params.id, userId },
    select: { id: true },
  });
  if (!existing) throw new AppError('Project not found', 404);
  await prisma.project.delete({ where: { id: existing.id } });
  res.status(204).end();
}));

// ---- Tasks ----------------------------------------------------------

/** POST /api/projects/:id/tasks */
router.post('/:id/tasks', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const data = taskCreateSchema.parse(req.body);

  const project = await prisma.project.findFirst({
    where: { id: req.params.id, userId },
    select: { id: true },
  });
  if (!project) throw new AppError('Project not found', 404);

  const task = await prisma.projectTask.create({
    data: {
      userId,
      projectId: project.id,
      title: data.title,
      estMinutes: data.estMinutes ?? null,
      priority: data.priority ?? 0,
    },
  });
  res.status(201).json({ task });
}));

/**
 * PUT /api/projects/tasks/:taskId
 *
 * The XP-bearing edge: when `done` flips false→true we stamp completedAt
 * and, inside one transaction, auto-complete the pending quest for this
 * task today (closed loop → XP + eddies land). Flipping true→false clears
 * completedAt but never reverses earned XP (XP-integrity rule).
 */
router.put('/tasks/:taskId', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const data = taskUpdateSchema.parse(req.body);

  const existing = await prisma.projectTask.findFirst({
    where: { id: req.params.taskId, userId },
  });
  if (!existing) throw new AppError('Task not found', 404);

  const flippingToDone = data.done === true && !existing.done;
  const flippingToOpen = data.done === false && existing.done;
  const today = startOfLocalDay();

  let task = existing;
  let player: Awaited<ReturnType<GamificationService['awardXp']>> | null = null;
  let questAutoCompleted: { id: string; xpReward: number } | null = null;

  await prisma.$transaction(async (tx) => {
    task = await tx.projectTask.update({
      where: { id: existing.id },
      data: {
        title:      data.title,
        estMinutes: data.estMinutes === undefined ? undefined : data.estMinutes,
        priority:   data.priority,
        sortOrder:  data.sortOrder,
        done:       data.done,
        completedAt: flippingToDone ? new Date()
          : flippingToOpen ? null
          : undefined,
      },
    });

    if (flippingToDone) {
      const q = await tx.quest.findFirst({
        where: {
          userId, source: 'project', sourceId: existing.id,
          questDate: today, status: 'pending',
        },
      });
      if (q) {
        await tx.quest.update({
          where: { id: q.id },
          data: { status: 'completed', progress: 1, currentCount: q.targetCount },
        });
        await tx.questCompletion.create({
          data: {
            userId, questId: q.id, xpAwarded: q.xpReward,
            meta: JSON.stringify({ trigger: 'project-task-done', taskId: existing.id }),
          },
        });
        player = await game().awardXp(userId, {
          amount: q.xpReward,
          eddies: eddiesForReward(q.xpReward, q.difficulty),
          reason: 'quest_complete',
          module: 'projects',
          refType: 'quest',
          refId: q.id,
        }, tx);
        questAutoCompleted = { id: q.id, xpReward: q.xpReward };
      }
    }
  });

  const ws = (global as any).wsService;
  const completed = questAutoCompleted as { id: string; xpReward: number } | null;
  if (ws?.broadcastGameEvent && completed) {
    ws.broadcastGameEvent(userId, 'quest-completed', {
      questId: completed.id, source: 'project', questAutoCompleted: completed,
    });
  }

  res.json({ task, player, questAutoCompleted });
}));

/** DELETE /api/projects/tasks/:taskId */
router.delete('/tasks/:taskId', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const existing = await prisma.projectTask.findFirst({
    where: { id: req.params.taskId, userId },
    select: { id: true },
  });
  if (!existing) throw new AppError('Task not found', 404);
  await prisma.projectTask.delete({ where: { id: existing.id } });
  res.status(204).end();
}));

// ---- Milestones -----------------------------------------------------

/** POST /api/projects/:id/milestones */
router.post('/:id/milestones', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const data = milestoneCreateSchema.parse(req.body);

  const project = await prisma.project.findFirst({
    where: { id: req.params.id, userId },
    select: { id: true },
  });
  if (!project) throw new AppError('Project not found', 404);

  const milestone = await prisma.milestone.create({
    data: {
      userId,
      projectId: project.id,
      title: data.title,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      bonusXp: data.bonusXp ?? 50,
    },
  });
  res.status(201).json({ milestone });
}));

/**
 * PUT /api/projects/milestones/:mId
 *
 * A milestone is a "boss clear": when `done` flips false→true we stamp
 * completedAt and award its bonusXp (+ pegged eddies) via GamificationService
 * inside one transaction. Flipping back clears completedAt; earned XP persists.
 */
router.put('/milestones/:mId', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const data = milestoneUpdateSchema.parse(req.body);

  const existing = await prisma.milestone.findFirst({
    where: { id: req.params.mId, userId },
  });
  if (!existing) throw new AppError('Milestone not found', 404);

  const flippingToDone = data.done === true && !existing.done;
  const flippingToOpen = data.done === false && existing.done;

  let milestone = existing;
  let player: Awaited<ReturnType<GamificationService['awardXp']>> | null = null;
  let xpAwarded = 0;

  await prisma.$transaction(async (tx) => {
    milestone = await tx.milestone.update({
      where: { id: existing.id },
      data: {
        title:     data.title,
        dueDate:   data.dueDate === undefined ? undefined
          : data.dueDate === null ? null
          : new Date(data.dueDate),
        bonusXp:   data.bonusXp,
        sortOrder: data.sortOrder,
        done:      data.done,
        completedAt: flippingToDone ? new Date()
          : flippingToOpen ? null
          : undefined,
      },
    });

    if (flippingToDone && existing.bonusXp > 0) {
      // Idempotency against the immutable ledger: a milestone's bonus is
      // paid exactly ONCE, ever. `done`/`completedAt` get cleared on
      // reopen, so they can't guard this — without the ledger check a user
      // could farm XP/eddies by toggling the milestone off/on repeatedly.
      const alreadyPaid = await tx.xpLedger.findFirst({
        where: { userId, reason: 'milestone_complete', refType: 'milestone', refId: existing.id },
        select: { id: true },
      });
      if (!alreadyPaid) {
        // Difficulty 'hard' — milestones are chunky boss clears.
        player = await game().awardXp(userId, {
          amount: existing.bonusXp,
          eddies: eddiesForReward(existing.bonusXp, 'hard'),
          reason: 'milestone_complete',
          module: 'projects',
          refType: 'milestone',
          refId: existing.id,
        }, tx);
        xpAwarded = existing.bonusXp;
      }
    }
  });

  const ws = (global as any).wsService;
  if (ws?.broadcastGameEvent && xpAwarded > 0) {
    ws.broadcastGameEvent(userId, 'milestone-cleared', {
      milestoneId: existing.id, xpAwarded,
    });
  }

  res.json({ milestone, player, xpAwarded });
}));

/** DELETE /api/projects/milestones/:mId */
router.delete('/milestones/:mId', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const existing = await prisma.milestone.findFirst({
    where: { id: req.params.mId, userId },
    select: { id: true },
  });
  if (!existing) throw new AppError('Milestone not found', 404);
  await prisma.milestone.delete({ where: { id: existing.id } });
  res.status(204).end();
}));

// ---- Candidate builder (consumed by QuestEngine) --------------------

const DIFFICULTY_XP: Record<'easy' | 'medium' | 'hard', number> = {
  easy: 15, medium: 30, hard: 50,
};

/** Bucket a task's estMinutes into a difficulty tier (null → medium). */
function difficultyForEst(estMinutes: number | null): 'easy' | 'medium' | 'hard' {
  if (estMinutes == null) return 'medium';
  if (estMinutes <= 20) return 'easy';
  if (estMinutes <= 60) return 'medium';
  return 'hard';
}

/**
 * For each ACTIVE project, take its top incomplete task (highest priority,
 * then sortOrder). Emit a project candidate per project, then cap at the
 * 2 projects whose top task has the highest priority. Carry-over=true:
 * project work is punt-able. Never throws on empty data.
 */
export async function buildProjectCandidates(
  prisma: PrismaClient,
  userId: string,
  _date: Date,
  nextId: () => string,
): Promise<QuestCandidate[]> {
  const projects = await prisma.project.findMany({
    where: { userId, status: 'active' },
    include: {
      tasks: {
        where: { done: false },
        orderBy: [{ priority: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
        take: 1,
      },
      milestones: {
        where: { done: false },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        take: 1,
      },
    },
  });

  type Picked = { candidate: QuestCandidate; priority: number };
  const picked: Picked[] = [];

  for (const project of projects) {
    const task = project.tasks[0];
    if (!task) continue; // no actionable task in this project

    const difficulty = difficultyForEst(task.estMinutes);
    const nextMilestone = project.milestones[0];

    picked.push({
      priority: task.priority,
      candidate: {
        candidateId: nextId(),
        source: 'project',
        sourceId: task.id,
        moduleKey: 'projects',
        baseTitle: `Advance ${project.name}: ${task.title}`,
        difficulty,
        xpReward: DIFFICULTY_XP[difficulty],
        estMinutes: task.estMinutes ?? undefined,
        carryOver: true,
        ...(nextMilestone && { context: `milestone: ${nextMilestone.title}` }),
      },
    });
  }

  // Cap at the 2 projects with the highest-priority pending task.
  picked.sort((a, b) => b.priority - a.priority);
  return picked.slice(0, 2).map(p => p.candidate);
}

export default router;
