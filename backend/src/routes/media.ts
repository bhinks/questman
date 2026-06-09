/**
 * Media backlog domain — "Braindance queue".
 *
 * A stash of movies/shows/games/books with auto-estimated time
 * commitments (via MediaEstimator) and a consumption loop. Logging an
 * item to "done" auto-completes a matching pending media quest for the
 * day (closed loop), awarding XP + eddies through the shared economy.
 *
 * Conventions mirror routes/habits.ts & routes/workouts.ts:
 *   - userId-scoped queries (req.user!.id), router is auth-mounted.
 *   - SQLite has no JSON column: metaJson is stored as a String and
 *     parsed back into a `meta` object on the way out.
 *   - XP/eddies are server-owned via GamificationService inside a tx.
 *
 * Exports buildMediaCandidates() consumed by QuestEngine.
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
import { estimateMedia, DEFAULT_READING_MIN_PER_PAGE, MediaType } from '../services/MediaEstimator';

const router = express.Router();

let _game: GamificationService | null = null;
const game = () => (_game ??= new GamificationService(prisma));

const TYPE = z.enum(['movie', 'show', 'game', 'book']);
const STATUS = z.enum(['backlog', 'active', 'done', 'dropped']);

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

/** Shape a MediaItem row for the API: metaJson string → `meta` object. */
function serialize<T extends { metaJson: string | null }>(item: T) {
  const { metaJson, ...rest } = item;
  return { ...rest, meta: parseJson<Record<string, unknown>>(metaJson) };
}

/** Resolve the 'media' module id for this user (throws if seed missing). */
async function mediaModuleId(userId: string): Promise<string> {
  const mod = await prisma.module.findUnique({
    where: { userId_key: { userId, key: 'media' } },
    select: { id: true },
  });
  if (!mod) throw new AppError('module missing — re-run seed', 500);
  return mod.id;
}

// --- schemas ------------------------------------------------------------

const metaSchema = z.record(z.unknown());

const createSchema = z.object({
  type:           TYPE,
  title:          z.string().min(1).max(300),
  status:         STATUS.optional(),
  estMinutes:     z.number().int().min(0).max(100000).nullable().optional(),
  totalUnits:     z.number().int().min(0).max(100000).nullable().optional(),
  unitsDone:      z.number().int().min(0).max(100000).optional(),
  coverUrl:       z.string().max(1000).nullable().optional(),
  externalId:     z.string().max(200).nullable().optional(),
  externalSource: z.string().max(100).nullable().optional(),
  meta:           metaSchema.nullable().optional(),
});

const updateSchema = z.object({
  title:          z.string().min(1).max(300).optional(),
  status:         STATUS.optional(),
  estMinutes:     z.number().int().min(0).max(100000).nullable().optional(),
  totalUnits:     z.number().int().min(0).max(100000).nullable().optional(),
  unitsDone:      z.number().int().min(0).max(100000).optional(),
  coverUrl:       z.string().max(1000).nullable().optional(),
  externalId:     z.string().max(200).nullable().optional(),
  externalSource: z.string().max(100).nullable().optional(),
  meta:           metaSchema.nullable().optional(),
  // For books: when unitsDone advances, the UI may report the reading
  // session so we can refine a rolling minutes-per-page estimate.
  pagesReadDelta: z.number().int().min(1).max(100000).optional(),
  minutesSpent:   z.number().min(0).max(100000).optional(),
});

const lookupSchema = z.object({
  type:  TYPE,
  title: z.string().min(1).max(300),
});

const progressSchema = z.object({
  unitsDone: z.number().int().min(0).max(100000).optional(),
  status:    STATUS.optional(),
});

// --- list ---------------------------------------------------------------

/** GET /api/media?status=&type= */
router.get('/', asyncHandler(async (req: AuthRequest, res) => {
  const status = STATUS.optional().parse(req.query.status);
  const type = TYPE.optional().parse(req.query.type);

  const items = await prisma.mediaItem.findMany({
    where: {
      userId: req.user!.id,
      ...(status && { status }),
      ...(type && { type }),
    },
    orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
  });

  res.json({ items: items.map(serialize) });
}));

// --- lookup (estimate only, does NOT persist) ---------------------------

/**
 * POST /api/media/lookup  { type, title }
 * Calls the estimator and returns the estimate for the create form's
 * "AUTO-ESTIMATE" button. Returns { estimate: null } if nothing found.
 */
router.post('/lookup', asyncHandler(async (req: AuthRequest, res) => {
  const { type, title } = lookupSchema.parse(req.body);
  const estimate = await estimateMedia(type as MediaType, title);
  res.json({ estimate });
}));

// --- create -------------------------------------------------------------

/**
 * POST /api/media
 * If estMinutes is not supplied, try the estimator to fill it (and cover
 * / external ids / meta). Manual overrides always win.
 */
router.post('/', asyncHandler(async (req: AuthRequest, res) => {
  const data = createSchema.parse(req.body);
  const userId = req.user!.id;
  const moduleId = await mediaModuleId(userId);

  // Auto-estimate to fill gaps only when the client didn't provide a time.
  let est = null as Awaited<ReturnType<typeof estimateMedia>>;
  if (data.estMinutes == null) {
    est = await estimateMedia(data.type as MediaType, data.title);
  }

  // Merge: explicit client value > estimator > null. Estimator only fills
  // fields the client left blank.
  const meta: Record<string, unknown> = {
    ...(est?.meta ?? {}),
    ...(data.meta ?? {}),
  };
  // Books carry a readingMinPerPage so the estimate can be recomputed and
  // refined over time. Seed a default if estimating wasn't conclusive.
  if (data.type === 'book' && meta.readingMinPerPage == null) {
    meta.readingMinPerPage = DEFAULT_READING_MIN_PER_PAGE;
  }

  const item = await prisma.mediaItem.create({
    data: {
      userId,
      moduleId,
      type: data.type,
      title: data.title,
      status: data.status ?? 'backlog',
      estMinutes: data.estMinutes ?? est?.estMinutes ?? null,
      totalUnits: data.totalUnits ?? est?.totalUnits ?? null,
      unitsDone: data.unitsDone ?? 0,
      coverUrl: data.coverUrl ?? est?.coverUrl ?? null,
      externalId: data.externalId ?? est?.externalId ?? null,
      externalSource: data.externalSource ?? est?.externalSource ?? null,
      metaJson: Object.keys(meta).length > 0 ? JSON.stringify(meta) : null,
    },
  });

  res.status(201).json({ item: serialize(item) });
}));

// --- update -------------------------------------------------------------

/**
 * PUT /api/media/:id
 * General field update. For books, when the caller reports a reading
 * session via { pagesReadDelta, minutesSpent }, fold that into a rolling
 * readingMinPerPage average stored in meta (tracks Brent's reading speed
 * and re-derives estMinutes from the remaining/total pages).
 *
 * Does NOT auto-complete quests — that is the /progress endpoint's job
 * (status→done). PUT is for plain edits.
 */
router.put('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const data = updateSchema.parse(req.body);
  const userId = req.user!.id;

  const existing = await prisma.mediaItem.findFirst({
    where: { id: req.params.id, userId },
  });
  if (!existing) throw new AppError('Media item not found', 404);

  // Build the next meta object, starting from what's stored.
  const meta: Record<string, unknown> = parseJson<Record<string, unknown>>(existing.metaJson) ?? {};
  if (data.meta !== undefined) {
    if (data.meta === null) {
      for (const k of Object.keys(meta)) delete meta[k];
    } else {
      Object.assign(meta, data.meta);
    }
  }

  // Rolling reading-speed tracker (books only).
  let derivedEstMinutes: number | undefined;
  if (existing.type === 'book' && data.pagesReadDelta && data.minutesSpent != null && data.minutesSpent > 0) {
    const sessionMinPerPage = data.minutesSpent / data.pagesReadDelta;
    const prior = typeof meta.readingMinPerPage === 'number'
      ? meta.readingMinPerPage
      : DEFAULT_READING_MIN_PER_PAGE;
    const samples = typeof meta.readingSpeedSamples === 'number' ? meta.readingSpeedSamples : 0;
    // Weighted rolling average: blend the new session with the running mean.
    const nextSamples = samples + 1;
    const rolling = (prior * samples + sessionMinPerPage) / nextSamples;
    const rounded = Math.round(rolling * 100) / 100;
    meta.readingMinPerPage = rounded;
    meta.readingSpeedSamples = nextSamples;

    // Re-derive estMinutes from total pages if we know them.
    const totalPages = data.totalUnits ?? existing.totalUnits ?? (typeof meta.pageCount === 'number' ? meta.pageCount : undefined);
    if (typeof totalPages === 'number') {
      derivedEstMinutes = Math.round(totalPages * rounded);
    }
  }

  const updated = await prisma.mediaItem.update({
    where: { id: existing.id },
    data: {
      title: data.title ?? undefined,
      status: data.status ?? undefined,
      estMinutes: data.estMinutes !== undefined ? data.estMinutes : (derivedEstMinutes ?? undefined),
      totalUnits: data.totalUnits !== undefined ? data.totalUnits : undefined,
      unitsDone: data.unitsDone !== undefined ? data.unitsDone : undefined,
      coverUrl: data.coverUrl !== undefined ? data.coverUrl : undefined,
      externalId: data.externalId !== undefined ? data.externalId : undefined,
      externalSource: data.externalSource !== undefined ? data.externalSource : undefined,
      metaJson: Object.keys(meta).length > 0 ? JSON.stringify(meta) : null,
    },
  });

  res.json({ item: serialize(updated) });
}));

// --- progress (closed-loop quest completion on "done") ------------------

/**
 * POST /api/media/:id/progress  { unitsDone?, status? }
 *
 * Advance consumption. When the item transitions to status="done" we
 * auto-complete a matching pending quest (source:"media", sourceId=item.id,
 * today) and award its XP + eddies through the shared economy — mirrors
 * the habit /check closed loop. Re-marking an already-done item is a
 * no-op for XP (we only fire when the status actually flips to done).
 */
router.post('/:id/progress', asyncHandler(async (req: AuthRequest, res) => {
  const data = progressSchema.parse(req.body);
  const userId = req.user!.id;

  const existing = await prisma.mediaItem.findFirst({
    where: { id: req.params.id, userId },
  });
  if (!existing) throw new AppError('Media item not found', 404);

  const today = startOfLocalDay();
  const becomingDone = data.status === 'done' && existing.status !== 'done';

  let player: Awaited<ReturnType<GamificationService['awardXp']>> | null = null;
  let questAutoCompleted: { id: string; xpReward: number } | null = null;

  const item = await prisma.$transaction(async (tx) => {
    const next = await tx.mediaItem.update({
      where: { id: existing.id },
      data: {
        unitsDone: data.unitsDone !== undefined ? data.unitsDone : undefined,
        status: data.status !== undefined ? data.status : undefined,
      },
    });

    if (becomingDone) {
      const q = await tx.quest.findFirst({
        where: {
          userId, source: 'media', sourceId: existing.id,
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
            meta: JSON.stringify({ trigger: 'media-done', mediaId: existing.id }),
          },
        });
        player = await game().awardXp(userId, {
          amount: q.xpReward,
          eddies: eddiesForReward(q.xpReward, q.difficulty),
          reason: 'quest_complete',
          module: 'media',
          refType: 'quest',
          refId: q.id,
        }, tx);
        questAutoCompleted = { id: q.id, xpReward: q.xpReward };
      }
    }

    return next;
  });

  const ws = (global as any).wsService;
  if (ws?.broadcastGameEvent && questAutoCompleted) {
    ws.broadcastGameEvent(userId, 'media-progress', {
      mediaId: existing.id, questAutoCompleted,
    });
  }

  res.json({ item: serialize(item), player, questAutoCompleted });
}));

// --- R&R redemption (spend a downtime credit to activate a backlog item) -

/**
 * POST /api/media/:id/rr-session
 *
 * Spend one R&R credit — banked from full-clear days (QuestEngine) — to pull
 * a media item out of the backlog and onto the active shelf, where it starts
 * generating "braindance" quests. This is Brent's downtime loop: a full,
 * productive day earns the right to guilt-free leisure from the backlog.
 *
 * Atomic guarded decrement so the credit balance can never go negative.
 * Already-active / done / dropped items are rejected without spending.
 */
router.post('/:id/rr-session', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;

  const existing = await prisma.mediaItem.findFirst({
    where: { id: req.params.id, userId },
  });
  if (!existing) throw new AppError('Media item not found', 404);
  if (existing.status === 'active') {
    throw new AppError('That item is already on the active shelf', 400);
  }
  if (existing.status !== 'backlog') {
    throw new AppError('Only backlog items can be activated with an R&R credit', 400);
  }

  const item = await prisma.$transaction(async (tx) => {
    // The backlog->active transition is the idempotency guard: only the
    // request that actually flips the row spends a credit. A double-submit
    // matches 0 rows here and the whole tx rolls back, so it burns no credit
    // (the status read above is outside the tx and can't be the guard).
    const moved = await tx.mediaItem.updateMany({
      where: { id: existing.id, userId, status: 'backlog' },
      data: { status: 'active' },
    });
    if (moved.count !== 1) {
      throw new AppError('That item is no longer in the backlog', 400);
    }
    // Guarded decrement: only fires while the player actually has a credit.
    const dec = await tx.playerProfile.updateMany({
      where: { userId, rrCredits: { gt: 0 } },
      data: { rrCredits: { decrement: 1 } },
    });
    if (dec.count !== 1) {
      throw new AppError('No R&R credits — clear a full day to bank one', 400);
    }
    return tx.mediaItem.findUniqueOrThrow({ where: { id: existing.id } });
  });

  const player = await game().getSnapshot(userId);

  const ws = (global as any).wsService;
  if (ws?.broadcastGameEvent) {
    ws.broadcastGameEvent(userId, 'rr-session', { mediaId: existing.id });
  }

  res.json({ item: serialize(item), player });
}));

// --- delete -------------------------------------------------------------

/**
 * DELETE /api/media/:id
 * XP-integrity rule: earned XP/eddies persist when a source is deleted —
 * removing the item only drops the backlog record. Any prior quest grant
 * stays in the ledger.
 */
router.delete('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const existing = await prisma.mediaItem.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
    select: { id: true },
  });
  if (!existing) throw new AppError('Media item not found', 404);

  await prisma.mediaItem.delete({ where: { id: existing.id } });
  res.status(204).end();
}));

// --- candidate builder (consumed by QuestEngine) ------------------------

/**
 * Active media items → timeboxed "watch/play/read" quest candidates.
 * Caps at 2 so the daily set stays balanced. Only ACTIVE items are
 * actionable. Returns [] on empty/any data shape gracefully (never throws).
 *
 *   book  → "Read 20 pages of <title>"  (est ≈ 20 * readingMinPerPage)
 *   show  → "Watch one episode of <title>"
 *   game  → "Timeboxed play session: <title>"
 *   movie → "Watch <title>"
 *
 * source:'media', sourceId:item.id, moduleKey:'media', easy, xp 15,
 * carryOver:true (pairs with the future R&R credits loop).
 */
export async function buildMediaCandidates(
  prismaClient: PrismaClient,
  userId: string,
  _date: Date,
  nextId: () => string,
): Promise<QuestCandidate[]> {
  const active = await prismaClient.mediaItem.findMany({
    where: { userId, status: 'active' },
    orderBy: { updatedAt: 'desc' },
    take: 2,
  });

  const candidates: QuestCandidate[] = [];
  for (const item of active) {
    const meta = parseJson<Record<string, unknown>>(item.metaJson) ?? {};
    let baseTitle: string;
    let estMinutes: number;

    switch (item.type) {
      case 'book': {
        const mpp = typeof meta.readingMinPerPage === 'number' ? meta.readingMinPerPage : DEFAULT_READING_MIN_PER_PAGE;
        baseTitle = `Read 20 pages of ${item.title}`;
        estMinutes = Math.round(20 * mpp);
        break;
      }
      case 'show': {
        const avg = typeof meta.avgEpisodeRuntime === 'number' ? meta.avgEpisodeRuntime : undefined;
        baseTitle = `Watch one episode of ${item.title}`;
        estMinutes = avg ?? 45;
        break;
      }
      case 'game':
        baseTitle = `Timeboxed play session: ${item.title}`;
        estMinutes = 60;
        break;
      case 'movie':
      default:
        baseTitle = `Watch ${item.title}`;
        estMinutes = item.estMinutes ?? 120;
        break;
    }

    candidates.push({
      candidateId: nextId(),
      source: 'media',
      sourceId: item.id,
      moduleKey: 'media',
      baseTitle,
      difficulty: 'easy',
      xpReward: 15,
      estMinutes,
      carryOver: true,
      context: item.totalUnits != null ? `${item.unitsDone}/${item.totalUnits} done` : undefined,
    });
  }

  return candidates;
}

export default router;
