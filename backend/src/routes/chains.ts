/**
 * Quest chains route — linear questlines.
 *
 * A QuestChain is an ordered list of ChainSteps where finishing one unlocks
 * the next. Step 0 starts "available"; the rest are "locked". The single
 * "available" not-done step is the CURRENT step — it enters the daily
 * candidate pool (source:"chain", sourceId=ChainStep.id, moduleKey="projects").
 * Completing that quest marks the step "done" and unlocks the next; finishing
 * the last step flips the chain to "done".
 *
 * Conventions mirror routes/projects.ts & routes/media.ts:
 *   - userId-scoped queries (req.user!.id), router is auth-mounted.
 *   - XP is server-owned — chains NEVER mint XP here. The daily quest's
 *     /complete handler awards XP and then calls advanceChainAfterComplete().
 *
 * Exports consumed by the spine:
 *   - buildChainCandidates(): hooked into QuestEngine.buildCandidates.
 *   - advanceChainAfterComplete(): called by routes/quests.ts /complete when
 *     a quest with source:"chain" is completed (inside that tx).
 */
import express from 'express';
import { z } from 'zod';
import { PrismaClient, Prisma } from '@prisma/client';
import { prisma } from '../server';
import { AuthRequest } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { startOfLocalDay } from '../utils/dates';
import { QuestCandidate } from '../services/anthropic';

const router = express.Router();

const DIFFICULTY = z.enum(['easy', 'medium', 'hard']);
const CHAIN_STATUS = z.enum(['active', 'done', 'abandoned']);

// Active chains first, then done, then abandoned.
const STATUS_RANK: Record<string, number> = { active: 0, done: 1, abandoned: 2 };

const DIFFICULTY_XP: Record<'easy' | 'medium' | 'hard', number> = {
  easy: 15, medium: 30, hard: 50,
};

const stepCreateSchema = z.object({
  title:       z.string().min(1).max(300),
  description: z.string().max(2000).nullable().optional(),
  difficulty:  DIFFICULTY.optional(),
  xpReward:    z.number().int().min(0).max(2000).optional(),
  estMinutes:  z.number().int().min(1).max(1440).nullable().optional(),
});

const chainCreateSchema = z.object({
  name:        z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  color:       z.string().max(40).nullable().optional(),
  steps:       z.array(stepCreateSchema).min(1).max(50),
});

const chainUpdateSchema = z.object({
  name:        z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  color:       z.string().max(40).nullable().optional(),
  status:      CHAIN_STATUS.optional(),
});

const stepUpdateSchema = z.object({
  title:       z.string().min(1).max(300).optional(),
  description: z.string().max(2000).nullable().optional(),
  difficulty:  DIFFICULTY.optional(),
  xpReward:    z.number().int().min(0).max(2000).optional(),
  estMinutes:  z.number().int().min(1).max(1440).nullable().optional(),
});

const STEP_INCLUDE = {
  steps: { orderBy: { order: 'asc' as const } },
};

// --- list ---------------------------------------------------------------

/** GET /api/chains — chains with steps ordered by `order`, active first. */
router.get('/', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;

  const chains = await prisma.questChain.findMany({
    where: { userId },
    include: STEP_INCLUDE,
  });

  chains.sort((a, b) => {
    const r = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
    if (r !== 0) return r;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  res.json({ chains });
}));

// --- create -------------------------------------------------------------

/**
 * POST /api/chains
 * Create a chain with its ordered steps. order = array index; step 0 is
 * "available" (the current step), the rest "locked".
 */
router.post('/', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const data = chainCreateSchema.parse(req.body);

  const chain = await prisma.questChain.create({
    data: {
      userId,
      name: data.name,
      description: data.description ?? null,
      color: data.color ?? null,
      status: 'active',
      steps: {
        create: data.steps.map((s, i) => ({
          order:       i,
          title:       s.title,
          description: s.description ?? null,
          difficulty:  s.difficulty ?? 'medium',
          xpReward:    s.xpReward ?? DIFFICULTY_XP[s.difficulty ?? 'medium'],
          estMinutes:  s.estMinutes ?? null,
          status:      i === 0 ? 'available' : 'locked',
        })),
      },
    },
    include: STEP_INCLUDE,
  });

  res.status(201).json({ chain });
}));

// --- read one -----------------------------------------------------------

/** GET /api/chains/:id */
router.get('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const chain = await prisma.questChain.findFirst({
    where: { id: req.params.id, userId },
    include: STEP_INCLUDE,
  });
  if (!chain) throw new AppError('Chain not found', 404);
  res.json({ chain });
}));

// --- update (rename / status, e.g. abandon) -----------------------------

/** PUT /api/chains/:id */
router.put('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const data = chainUpdateSchema.parse(req.body);

  const existing = await prisma.questChain.findFirst({
    where: { id: req.params.id, userId },
    select: { id: true },
  });
  if (!existing) throw new AppError('Chain not found', 404);

  const chain = await prisma.questChain.update({
    where: { id: existing.id },
    data: {
      name:        data.name,
      description: data.description === undefined ? undefined : data.description,
      color:       data.color === undefined ? undefined : data.color,
      status:      data.status,
    },
    include: STEP_INCLUDE,
  });
  res.json({ chain });
}));

// --- delete (cascades steps) --------------------------------------------

/** DELETE /api/chains/:id — cascades steps via the schema relation. */
router.delete('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const existing = await prisma.questChain.findFirst({
    where: { id: req.params.id, userId },
    select: { id: true },
  });
  if (!existing) throw new AppError('Chain not found', 404);
  await prisma.questChain.delete({ where: { id: existing.id } });
  res.status(204).end();
}));

// --- step edit ----------------------------------------------------------

/**
 * PUT /api/chains/steps/:stepId — edit a step's authoring fields (title,
 * difficulty, xp, est, description). Does not touch step status/order.
 */
router.put('/steps/:stepId', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const data = stepUpdateSchema.parse(req.body);

  // Ownership via the parent chain.
  const existing = await prisma.chainStep.findFirst({
    where: { id: req.params.stepId, chain: { userId } },
    select: { id: true },
  });
  if (!existing) throw new AppError('Step not found', 404);

  const step = await prisma.chainStep.update({
    where: { id: existing.id },
    data: {
      title:       data.title,
      description: data.description === undefined ? undefined : data.description,
      difficulty:  data.difficulty,
      xpReward:    data.xpReward,
      estMinutes:  data.estMinutes === undefined ? undefined : data.estMinutes,
    },
  });
  res.json({ step });
}));

// --- candidate builder (consumed by QuestEngine) ------------------------

/**
 * For each ACTIVE chain, take its current "available" (not-done) step and,
 * IF no quest already exists today for it, emit ONE candidate. Reuses the
 * "projects" moduleKey (there is no chains module — moduleIdFor would throw
 * on an unknown key). carryOver:true — questline work is punt-able. Never
 * throws (returns [] on any issue).
 */
export async function buildChainCandidates(
  prismaClient: PrismaClient,
  userId: string,
  _date: Date,
  nextId: () => string,
): Promise<QuestCandidate[]> {
  try {
    const today = startOfLocalDay();

    const chains = await prismaClient.questChain.findMany({
      where: { userId, status: 'active' },
      include: {
        steps: {
          where: { status: 'available' },
          orderBy: { order: 'asc' },
        },
      },
    });

    const candidates: QuestCandidate[] = [];
    for (const chain of chains) {
      // The current step is the first "available" not-done step.
      const step = chain.steps.find(s => s.status === 'available');
      if (!step) continue;

      // Skip if a quest for this step already exists today (any status).
      const existing = await prismaClient.quest.findFirst({
        where: { userId, source: 'chain', sourceId: step.id, questDate: today },
        select: { id: true },
      });
      if (existing) continue;

      candidates.push({
        candidateId: nextId(),
        source: 'chain' as QuestCandidate['source'],
        sourceId: step.id,
        moduleKey: 'projects',
        baseTitle: step.title,
        difficulty: step.difficulty as 'easy' | 'medium' | 'hard',
        xpReward: step.xpReward,
        estMinutes: step.estMinutes ?? undefined,
        carryOver: true,
        context: chain.name,
      });
    }

    return candidates;
  } catch {
    return [];
  }
}

/**
 * Mark the chain step backing a just-completed quest "done", unlock the next
 * step, and finish the chain when the last step completes. Runs inside the
 * /complete transaction; `stepId` is the completed quest's sourceId.
 *
 * Idempotent: guards on the step not already being "done" so re-entry can't
 * double-advance. XP is awarded by /complete — never minted here.
 */
export async function advanceChainAfterComplete(
  tx: Prisma.TransactionClient,
  userId: string,
  stepId: string,
): Promise<void> {
  // Load the step + its parent chain, scoped to this user for safety.
  const step = await tx.chainStep.findFirst({
    where: { id: stepId, chain: { userId } },
  });
  if (!step) return;
  if (step.status === 'done') return; // already advanced — no-op.

  // Mark this step done.
  await tx.chainStep.update({
    where: { id: step.id },
    data: { status: 'done', completedAt: new Date(), questId: step.questId },
  });

  // Unlock the next step in order, if any.
  const next = await tx.chainStep.findFirst({
    where: { chainId: step.chainId, order: { gt: step.order } },
    orderBy: { order: 'asc' },
  });

  if (next) {
    // Only promote a still-locked step to available (don't clobber a done one).
    if (next.status === 'locked') {
      await tx.chainStep.update({
        where: { id: next.id },
        data: { status: 'available' },
      });
    }
  } else {
    // No next step — the chain is complete.
    await tx.questChain.update({
      where: { id: step.chainId },
      data: { status: 'done' },
    });
  }
}

export default router;
