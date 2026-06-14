/**
 * Projects domain — "Operations" pool.
 *
 * A Project bundles ProjectTasks (the day-to-day grind, each worth a
 * quest) and Milestones (boss clears — a chunky bonusXp on completion).
 *
 * Closed-loop linkage runs BOTH ways: when a task flips done false→true we
 * auto-complete any pending quest tied to it today (source='project',
 * sourceId=task.id) and land its XP/eddies, mirroring the habit /check
 * pattern; and when that quest is completed from Today, /complete calls
 * completeProjectTaskAfterQuest to mark the task done (no extra XP).
 *
 * Sequenced projects (ordered=true — the absorbed questlines): tasks
 * unlock in sortOrder; only the first not-done task is the CURRENT one
 * and enters the candidate pool.
 *
 * Candidate builder: each active project contributes its top incomplete
 * task as a quest candidate (capped at 3 across all projects).
 */
import express from 'express';
import { z } from 'zod';
import { PrismaClient, Prisma } from '@prisma/client';
import { prisma } from '../server';
import { emitHandlerEvent } from '../services/handlerEvents';
import { AuthRequest } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { GamificationService } from '../services/GamificationService';
import { eddiesForReward } from '../utils/economy';
import { startOfLocalDay } from '../utils/dates';
import { QuestCandidate } from '../services/anthropic';
import { dealBossDamageForLinkedProject } from '../routes/bosses';

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
  ordered:     z.boolean().default(false),
});
const projectUpdateSchema = z.object({
  name:        z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  color:       z.string().max(40).nullable().optional(),
  status:      STATUS.optional(),
  ordered:     z.boolean().optional(),
});

const taskCreateSchema = z.object({
  title:       z.string().min(1).max(300),
  description: z.string().max(2000).nullable().optional(),
  estMinutes:  z.number().int().min(1).max(1440).nullable().optional(),
  priority:    z.number().int().min(0).max(100).optional(),
  xpReward:    z.number().int().min(0).max(2000).nullable().optional(),
});
const taskUpdateSchema = z.object({
  title:       z.string().min(1).max(300).optional(),
  description: z.string().max(2000).nullable().optional(),
  estMinutes:  z.number().int().min(1).max(1440).nullable().optional(),
  priority:    z.number().int().min(0).max(100).optional(),
  sortOrder:   z.number().int().min(0).max(100000).optional(),
  xpReward:    z.number().int().min(0).max(2000).nullable().optional(),
  done:        z.boolean().optional(),
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
      ordered: data.ordered,
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
      ordered: data.ordered,
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
    select: { id: true, ordered: true },
  });
  if (!project) throw new AppError('Project not found', 404);

  // Sequenced projects append: the new task slots after the current last
  // step so the unlock order stays stable.
  let sortOrder = 0;
  if (project.ordered) {
    const last = await prisma.projectTask.aggregate({
      where: { projectId: project.id },
      _max: { sortOrder: true },
    });
    sortOrder = (last._max.sortOrder ?? -1) + 1;
  }

  const task = await prisma.projectTask.create({
    data: {
      userId,
      projectId: project.id,
      title: data.title,
      description: data.description ?? null,
      estMinutes: data.estMinutes ?? null,
      priority: data.priority ?? 0,
      sortOrder,
      xpReward: data.xpReward ?? null,
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
        title:       data.title,
        description: data.description === undefined ? undefined : data.description,
        estMinutes:  data.estMinutes === undefined ? undefined : data.estMinutes,
        priority:    data.priority,
        sortOrder:   data.sortOrder,
        xpReward:    data.xpReward === undefined ? undefined : data.xpReward,
        done:        data.done,
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

    // Auto-damage any boss linked to this project when a milestone is
    // cleared (idempotent per milestone inside the hook). Runs on the
    // false->true transition regardless of bonusXp.
    if (flippingToDone) {
      await dealBossDamageForLinkedProject(tx, userId, existing.projectId, existing.id);
    }
  });

  const ws = (global as any).wsService;
  if (ws?.broadcastGameEvent && xpAwarded > 0) {
    ws.broadcastGameEvent(userId, 'milestone-cleared', {
      milestoneId: existing.id, xpAwarded,
    });
  }

  if (xpAwarded > 0) {
    void emitHandlerEvent(prisma, userId, { type: 'milestone_cleared', title: existing.title, projectId: existing.projectId });
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

// ---- Quest /complete hook (consumed by routes/quests.ts) ------------

/**
 * Mark the ProjectTask backing a just-completed quest done. Runs inside
 * the /complete (or completing /progress tick) transaction; `taskId` is
 * the quest's sourceId. This closes the loop in BOTH directions (checking
 * the task completes the quest, and vice versa) and is what advances a
 * SEQUENCED project — the next not-done task by sortOrder becomes current.
 *
 * Idempotent (no-op when already done); never mints XP — the quest pays.
 */
export async function completeProjectTaskAfterQuest(
  tx: Prisma.TransactionClient,
  userId: string,
  taskId: string,
): Promise<void> {
  const task = await tx.projectTask.findFirst({
    where: { id: taskId, userId },
    select: { id: true, done: true },
  });
  if (!task || task.done) return;
  await tx.projectTask.update({
    where: { id: task.id },
    data: { done: true, completedAt: new Date() },
  });
}

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

/** Bucket an authored xpReward back into the tier whose payout it matches —
 *  keeps the difficulty chip + eddie bonus consistent with the reward. */
function difficultyForXp(xp: number): 'easy' | 'medium' | 'hard' {
  if (xp >= DIFFICULTY_XP.hard) return 'hard';
  if (xp >= DIFFICULTY_XP.medium) return 'medium';
  return 'easy';
}

/**
 * For each ACTIVE project, take its top incomplete task — highest priority
 * for free-form projects, strictly next-in-sequence (sortOrder) for ordered
 * ones. Emit a candidate per project, then cap at the 3 projects whose top
 * task has the highest priority (3, not 2, since ordered projects absorbed
 * the formerly-uncapped questlines). Carry-over=true: project work is
 * punt-able. Never throws on empty data.
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
    // Ordered projects ignore priority — the sequence is the law. Tiebreak on
    // id (not createdAt) so this matches the OperationsView CURRENT badge
    // exactly: the step the quest advances is the step the UI marks current.
    const task = project.ordered
      ? [...project.tasks].sort(
          (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id),
        )[0]
      : project.tasks[0];
    if (!task) continue; // no actionable task in this project

    const difficulty = task.xpReward != null
      ? difficultyForXp(task.xpReward)
      : difficultyForEst(task.estMinutes);
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
        xpReward: task.xpReward ?? DIFFICULTY_XP[difficulty],
        estMinutes: task.estMinutes ?? undefined,
        carryOver: true,
        ...(nextMilestone && { context: `milestone: ${nextMilestone.title}` }),
      },
    });
  }

  // Cap at the 3 projects with the highest-priority pending task.
  picked.sort((a, b) => b.priority - a.priority);
  return picked.slice(0, 3).map(p => p.candidate);
}

export default router;
