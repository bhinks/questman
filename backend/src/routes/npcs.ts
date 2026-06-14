/**
 * Social / NPCs domain — "crew / street contacts".
 *
 * Design (per Brent):
 *   - Contact cadence is OPTIONAL. We track time-since-last-contact for
 *     EVERYONE and surface the most-neglected contact.
 *   - Quests are NOT person-specific: a single generic
 *     source:'npc', sourceId:null quest fires when ANY contact is overdue.
 *   - Logging an interaction is the closed-loop action: the first contact
 *     logged today auto-completes the pending generic social quest.
 *
 * Exports a candidate builder consumed by QuestEngine + a router.
 */
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../server';
import { emitHandlerEvent } from '../services/handlerEvents';
import { AuthRequest } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { GamificationService } from '../services/GamificationService';
import { eddiesForReward } from '../utils/economy';
import { startOfLocalDay } from '../utils/dates';
import { QuestCandidate } from '../services/anthropic';

const router = express.Router();

let _game: GamificationService | null = null;
const game = () => (_game ??= new GamificationService(prisma));

/** Days with no cadence set before we consider a contact "overdue". */
const DEFAULT_OVERDUE_DAYS = 21;

const createSchema = z.object({
  name:         z.string().min(1).max(200),
  relationship: z.string().max(200).nullable().optional(),
  cadenceDays:  z.number().int().min(1).max(3650).nullable().optional(),
  notes:        z.string().max(2000).nullable().optional(),
});

const updateSchema = z.object({
  name:         z.string().min(1).max(200).optional(),
  relationship: z.string().max(200).nullable().optional(),
  cadenceDays:  z.number().int().min(1).max(3650).nullable().optional(),
  notes:        z.string().max(2000).nullable().optional(),
});

const interactionSchema = z.object({
  date:        z.string().datetime().optional(), // defaults to now
  minutes:     z.number().int().min(0).max(1440).nullable().optional(),
  planned:     z.boolean().optional(),
  note:        z.string().max(2000).nullable().optional(),
  // Redesign: how contact was made + who reached out (both optional).
  channel:     z.enum(['irl', 'call', 'text', 'video']).nullable().optional(),
  initiatedBy: z.enum(['me', 'them']).nullable().optional(),
});

/** Resolve the "social" module for the user (throws if seed missing). */
async function socialModuleId(userId: string): Promise<string> {
  const mod = await prisma.module.findUnique({
    where: { userId_key: { userId, key: 'social' } },
    select: { id: true },
  });
  if (!mod) throw new AppError('module missing — re-run seed', 500);
  return mod.id;
}

/** Whole local days elapsed since `lastContactOn`. null if never contacted. */
function daysSince(lastContactOn: Date | null, today: Date): number | null {
  if (!lastContactOn) return null;
  const last = startOfLocalDay(new Date(lastContactOn));
  const ms = today.getTime() - last.getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/** A contact is overdue when it exceeds its cadence (or the default), or
 *  has never been contacted. */
function isOverdue(
  npc: { lastContactOn: Date | null; cadenceDays: number | null },
  today: Date,
): boolean {
  const since = daysSince(npc.lastContactOn, today);
  if (since === null) return true; // never contacted
  const threshold = npc.cadenceDays ?? DEFAULT_OVERDUE_DAYS;
  return since > threshold;
}

/**
 * GET /api/npcs
 *
 * List NPCs with a computed `daysSinceContact` (null if never contacted)
 * and recent interactions. Ordered most-overdue first (never-contacted
 * sorts to the very top, then longest-since-contact).
 */
router.get('/', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const today = startOfLocalDay();

  const npcs = await prisma.npc.findMany({
    where: { userId },
    include: {
      interactions: { orderBy: { date: 'desc' }, take: 10 },
    },
  });

  const shaped = npcs.map(n => ({
    ...n,
    daysSinceContact: daysSince(n.lastContactOn, today),
  }));

  // Most-overdue first: never-contacted (null) ranks above everyone,
  // then by descending days-since-contact, then by name for stability.
  shaped.sort((a, b) => {
    const av = a.daysSinceContact === null ? Number.POSITIVE_INFINITY : a.daysSinceContact;
    const bv = b.daysSinceContact === null ? Number.POSITIVE_INFINITY : b.daysSinceContact;
    if (av !== bv) return bv - av;
    return a.name.localeCompare(b.name);
  });

  res.json({ npcs: shaped });
}));

/** POST /api/npcs */
router.post('/', asyncHandler(async (req: AuthRequest, res) => {
  const data = createSchema.parse(req.body);
  const userId = req.user!.id;
  const moduleId = await socialModuleId(userId);

  const npc = await prisma.npc.create({
    data: {
      userId,
      moduleId,
      name: data.name,
      relationship: data.relationship ?? null,
      cadenceDays: data.cadenceDays ?? null,
      notes: data.notes ?? null,
    },
  });
  res.status(201).json({ npc: { ...npc, daysSinceContact: null, interactions: [] } });
}));

/** PUT /api/npcs/:id */
router.put('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const data = updateSchema.parse(req.body);
  const userId = req.user!.id;

  const existing = await prisma.npc.findFirst({
    where: { id: req.params.id, userId },
    select: { id: true },
  });
  if (!existing) throw new AppError('Contact not found', 404);

  const npc = await prisma.npc.update({
    where: { id: existing.id },
    data: {
      name:         data.name ?? undefined,
      relationship: data.relationship === undefined ? undefined : data.relationship,
      cadenceDays:  data.cadenceDays === undefined ? undefined : data.cadenceDays,
      notes:        data.notes === undefined ? undefined : data.notes,
    },
    include: { interactions: { orderBy: { date: 'desc' }, take: 10 } },
  });

  res.json({
    npc: { ...npc, daysSinceContact: daysSince(npc.lastContactOn, startOfLocalDay()) },
  });
}));

/** DELETE /api/npcs/:id — cascades interactions. */
router.delete('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const existing = await prisma.npc.findFirst({
    where: { id: req.params.id, userId },
    select: { id: true },
  });
  if (!existing) throw new AppError('Contact not found', 404);
  await prisma.npc.delete({ where: { id: existing.id } });
  res.status(204).end();
}));

/** GET /api/npcs/:id/interactions — history for one NPC. */
router.get('/:id/interactions', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const npc = await prisma.npc.findFirst({
    where: { id: req.params.id, userId },
    select: { id: true },
  });
  if (!npc) throw new AppError('Contact not found', 404);

  const interactions = await prisma.interaction.findMany({
    where: { npcId: npc.id, userId },
    orderBy: { date: 'desc' },
  });
  res.json({ interactions });
}));

/**
 * POST /api/npcs/:id/interactions
 *
 * Log an interaction. The NPC's `lastContactOn` advances to the
 * interaction date UNLESS the interaction is planned (future intent) or
 * its date is in the future — those don't count as "made contact".
 *
 * Closed loop: if this is the FIRST real contact logged today (across all
 * contacts), auto-complete the pending generic social quest
 * (source:'npc', sourceId:null, questDate:today, status:'pending') and
 * award its XP/eddies — same pattern as habits.ts/workouts.ts.
 */
router.post('/:id/interactions', asyncHandler(async (req: AuthRequest, res) => {
  const data = interactionSchema.parse(req.body);
  const userId = req.user!.id;

  const npc = await prisma.npc.findFirst({
    where: { id: req.params.id, userId },
  });
  if (!npc) throw new AppError('Contact not found', 404);

  const today = startOfLocalDay();
  const when = data.date ? new Date(data.date) : new Date();
  const planned = data.planned ?? false;
  // A logged interaction "counts" as real contact when it isn't a planned
  // (future-intent) entry and its day is today-or-earlier.
  const countsAsContact = !planned && startOfLocalDay(when).getTime() <= today.getTime();

  let interaction;
  let player: Awaited<ReturnType<GamificationService['awardXp']>> | null = null;
  let questAutoCompleted: { id: string; xpReward: number } | null = null;

  await prisma.$transaction(async (tx) => {
    interaction = await tx.interaction.create({
      data: {
        userId,
        npcId: npc.id,
        date: when,
        minutes: data.minutes ?? null,
        planned,
        note: data.note ?? null,
        channel: data.channel ?? null,
        initiatedBy: data.initiatedBy ?? null,
      },
    });

    if (countsAsContact) {
      // Advance lastContactOn only if this contact is more recent than the
      // stored one (logging an older backfill shouldn't roll the clock back).
      if (!npc.lastContactOn || when.getTime() > new Date(npc.lastContactOn).getTime()) {
        await tx.npc.update({
          where: { id: npc.id },
          data: { lastContactOn: when },
        });
      }

      // First real contact today → auto-complete the generic social quest.
      // sourceId is null for this pool, so match on source + questDate + status.
      const pending = await tx.quest.findFirst({
        where: {
          userId, source: 'npc', sourceId: null,
          questDate: today, status: 'pending',
        },
      });
      if (pending) {
        await tx.quest.update({
          where: { id: pending.id },
          data: {
            status: 'completed',
            progress: pending.target,
            currentCount: pending.targetCount,
          },
        });
        await tx.questCompletion.create({
          data: {
            userId, questId: pending.id, xpAwarded: pending.xpReward,
            meta: JSON.stringify({ trigger: 'npc-interaction', npcId: npc.id }),
          },
        });
        player = await game().awardXp(userId, {
          amount: pending.xpReward,
          eddies: eddiesForReward(pending.xpReward, pending.difficulty),
          reason: 'quest_complete',
          module: 'social',
          refType: 'quest',
          refId: pending.id,
        }, tx);
        questAutoCompleted = { id: pending.id, xpReward: pending.xpReward };
      }
    }
  });

  const ws = (global as any).wsService;
  if (ws?.broadcastGameEvent && questAutoCompleted) {
    ws.broadcastGameEvent(userId, 'npc-interaction', {
      npcId: npc.id, questAutoCompleted,
    });
  }

  void emitHandlerEvent(prisma, userId, { type: 'npc_interaction', name: npc.name, npcId: npc.id });

  res.status(201).json({ interaction, player, questAutoCompleted });
}));

/**
 * buildNpcCandidates — generic "reach out to a neglected contact" quest.
 *
 * Overdue = (cadenceDays set AND daysSince > cadenceDays)
 *         OR (no cadence AND daysSince > 21)
 *         OR never contacted.
 *
 * If ANY contact is overdue, emit ONE candidate naming the most-overdue
 * contact as a nudge. Otherwise return [] (never throws on empty data).
 */
export async function buildNpcCandidates(
  prisma: PrismaClient,
  userId: string,
  date: Date,
  nextId: () => string,
): Promise<QuestCandidate[]> {
  const today = startOfLocalDay(date);

  const npcs = await prisma.npc.findMany({
    where: { userId },
    select: { name: true, lastContactOn: true, cadenceDays: true },
  });
  if (npcs.length === 0) return [];

  const overdue = npcs.filter(n => isOverdue(n, today));
  if (overdue.length === 0) return [];

  // This candidate has a null sourceId, so the Quest @@unique guard can't
  // dedupe it (NULLs are distinct in SQLite unique indexes). If a pending
  // social quest already exists for today — including one carried over
  // from yesterday — don't emit a second one.
  const existing = await prisma.quest.count({
    where: { userId, source: 'npc', sourceId: null, questDate: today, status: 'pending' },
  });
  if (existing > 0) return [];

  // Pick the most-overdue: never-contacted (null) outranks everyone, then
  // longest-since-contact. Used purely for flavor in the candidate context.
  let most = overdue[0];
  let mostSince = daysSince(most.lastContactOn, today);
  for (const n of overdue) {
    const since = daysSince(n.lastContactOn, today);
    const a = since === null ? Number.POSITIVE_INFINITY : since;
    const b = mostSince === null ? Number.POSITIVE_INFINITY : mostSince;
    if (a > b) { most = n; mostSince = since; }
  }

  const context = mostSince === null
    ? `e.g. ${most.name} — never contacted`
    : `e.g. ${most.name} — ${mostSince} days`;

  return [{
    candidateId: nextId(),
    source: 'npc',
    sourceId: null,
    moduleKey: 'social',
    baseTitle: 'Reach out to someone you have not talked to in a while',
    difficulty: 'easy',
    xpReward: 12,
    estMinutes: 15,
    carryOver: true,
    context,
  }];
}

export default router;
