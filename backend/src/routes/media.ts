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
import { emitHandlerEvent } from '../services/handlerEvents';
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

// --- R&R "earn your leisure" budget helpers -----------------------------

/** Day-of-week R&R allowance fallback (JS getDay() Sun..Sat): weekends get more. */
const DEFAULT_RR_BUDGET = [2, 1, 1, 1, 1, 2, 3];

/** Parse the stored rrBudgetByDay JSON → 7 non-negative ints (fallback default). */
function parseRrBudget(raw: string | null | undefined): number[] {
  const arr = parseJson<unknown[]>(raw ?? null);
  if (!Array.isArray(arr) || arr.length !== 7) return DEFAULT_RR_BUDGET;
  return arr.map(n => {
    const v = Math.round(Number(n));
    return Number.isFinite(v) && v >= 0 ? v : 0;
  });
}

/** Read the user's R&R settings (budget array + soft-gate target id). */
async function rrSettings(userId: string): Promise<{ budget: number[]; overrunAntiGoalId: string | null }> {
  const s = await prisma.userSettings.findUnique({
    where: { userId },
    select: { rrBudgetByDay: true, rrOverrunAntiGoalId: true },
  });
  return { budget: parseRrBudget(s?.rrBudgetByDay), overrunAntiGoalId: s?.rrOverrunAntiGoalId ?? null };
}

// Default per-medium pace, used when the ledger is too sparse to derive a rate.
// minutes-per-page mirrors the estimator's DEFAULT_READING_MIN_PER_PAGE.
const PACE_FALLBACK = {
  book:  { minPerPage: DEFAULT_READING_MIN_PER_PAGE, pagesPerDay: 20, minPerDay: 60 },
  show:  { epsPerDay: 1, minPerDay: 45 },
  game:  { minPerDay: 26, minPerWeek: 180 },
  movie: { perWeek: 2 },
  refEpisodeMin: 45,
};
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

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

const sessionSchema = z.object({
  kind:    z.enum(['start', 'progress', 'finish']).default('progress'),
  minutes: z.number().int().min(0).max(100000).optional(),   // time consumed this session
  units:   z.number().int().min(0).max(100000).optional(),   // eps/pages advanced (show/book)
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

// --- pace + R&R status (drives the planner's ETAs, chunks, this-week) ----

/**
 * GET /api/media/pace
 *
 * Returns history-derived consumption PACE (per medium), the trailing-7-day
 * minutes consumed ("this week"), and the R&R "earn your leisure" status:
 * today's day-of-week budget, how much is used, the banked stockpile, what's
 * left, and the configured soft-gate anti-goal. Rates fall back to sensible
 * defaults when the session ledger is too sparse to derive one.
 */
router.get('/pace', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const today = startOfLocalDay();

  const since28 = startOfLocalDay();
  since28.setDate(since28.getDate() - 27);
  const since7 = startOfLocalDay();
  since7.setDate(since7.getDate() - 6);

  const [sessions, player, { budget, overrunAntiGoalId }] = await Promise.all([
    prisma.mediaSession.findMany({
      where: { userId, createdAt: { gte: since28 } },
      select: { mediaItemId: true, type: true, minutes: true, units: true, createdAt: true, charged: true, chargeSource: true },
    }),
    prisma.playerProfile.findUnique({ where: { userId }, select: { rrCredits: true } }),
    rrSettings(userId),
  ]);

  // Per-type 28-day rollups.
  const agg: Record<string, { min: number; units: number; count: number }> = {
    book: { min: 0, units: 0, count: 0 }, show: { min: 0, units: 0, count: 0 },
    game: { min: 0, units: 0, count: 0 }, movie: { min: 0, units: 0, count: 0 },
  };
  let weekMinutes = 0;
  let budgetUsedToday = 0;
  // Titles already charged today → the planner skips the soft-gate confirm for
  // them (per-title-per-day: they're free for the rest of the day).
  const chargedTodayItemIds = new Set<string>();
  for (const s of sessions) {
    const a = agg[s.type];
    if (a) { a.min += s.minutes; a.units += s.units ?? 0; a.count += 1; }
    if (s.createdAt >= since7) weekMinutes += s.minutes;
    if (s.charged && s.createdAt >= today) chargedTodayItemIds.add(s.mediaItemId);
    if (s.charged && s.chargeSource === 'budget' && s.createdAt >= today) budgetUsedToday += 1;
  }
  const DAYS = 28;

  const book = agg.book.units > 0
    ? { minPerPage: r2(agg.book.min / agg.book.units), pagesPerDay: Math.round(agg.book.units / DAYS), minPerDay: Math.round(agg.book.min / DAYS) }
    : PACE_FALLBACK.book;
  const show = agg.show.units > 0
    ? { epsPerDay: r1(agg.show.units / DAYS), minPerDay: Math.round(agg.show.min / DAYS) }
    : PACE_FALLBACK.show;
  const game = agg.game.min > 0
    ? { minPerDay: Math.round(agg.game.min / DAYS), minPerWeek: Math.round(agg.game.min / 4) }
    : PACE_FALLBACK.game;
  const movie = agg.movie.count > 0
    ? { perWeek: r1(agg.movie.count / 4) }
    : PACE_FALLBACK.movie;

  const dow = today.getDay();
  const dayBudget = budget[dow] ?? 0;
  const banked = player?.rrCredits ?? 0;
  const remaining = Math.max(0, dayBudget - budgetUsedToday) + banked;

  let overrunTargetName: string | null = null;
  if (overrunAntiGoalId) {
    const h = await prisma.habit.findFirst({
      where: { id: overrunAntiGoalId, userId, polarity: 'avoid' },
      select: { title: true },
    });
    overrunTargetName = h?.title ?? null;
  }

  res.json({
    pace: { book, show, game, movie, refEpisodeMin: PACE_FALLBACK.refEpisodeMin },
    weekMinutes,
    chargedTodayItemIds: [...chargedTodayItemIds],
    rr: {
      dayBudget, usedToday: budgetUsedToday, banked, remaining,
      overrunTargetId: overrunAntiGoalId, overrunTargetName,
    },
  });
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

  // Endless games (fighting/roguelike/multiplayer) have no finish line — no
  // estimate, no total. They track lifetime minutes via unitsDone.
  const endless = data.type === 'game' && (data.meta as Record<string, unknown> | undefined)?.endless === true;

  // Auto-estimate to fill gaps only when the client didn't provide a time
  // (and never for endless games).
  let est = null as Awaited<ReturnType<typeof estimateMedia>>;
  if (data.estMinutes == null && !endless) {
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
      estMinutes: endless ? null : (data.estMinutes ?? est?.estMinutes ?? null),
      totalUnits: endless ? null : (data.totalUnits ?? est?.totalUnits ?? null),
      unitsDone: data.unitsDone ?? 0,
      coverUrl: data.coverUrl ?? null, // cover art intentionally not fetched anymore

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

  if (questAutoCompleted) {
    void emitHandlerEvent(prisma, userId, { type: 'media_completed', title: existing.title, mediaId: existing.id });
  }

  res.json({ item: serialize(item), player, questAutoCompleted });
}));

// --- session log (consumption + the soft R&R charge) --------------------

/**
 * POST /api/media/:id/session  { kind, minutes?, units? }
 *
 * The unified consumption logger — every JACK IN (kind:'start') and every
 * time/units log goes through here. In one transaction it:
 *   1. advances the item's progress (unitsDone in its natural unit: eps/pages
 *      for show/book, minutes for movie/game/endless) and flips a 'start' to
 *      status:'active';
 *   2. writes a MediaSession ledger row (powers PACE + "this week"); and
 *   3. runs the SOFT R&R charge, PER TITLE PER DAY: the first charged session
 *      on this item today spends one credit — today's day-of-week budget
 *      first, then the banked/bought stockpile, else a SOFT GATE (always
 *      allowed) that logs a breach on the user's configured anti-goal. Further
 *      logging on the same title the same day is free.
 *
 * Status transitions to done/dropped stay on /progress (the quest closed-loop).
 */
router.post('/:id/session', asyncHandler(async (req: AuthRequest, res) => {
  const data = sessionSchema.parse(req.body ?? {});
  const userId = req.user!.id;

  const existing = await prisma.mediaItem.findFirst({ where: { id: req.params.id, userId } });
  if (!existing) throw new AppError('Media item not found', 404);
  // Activation is the R&R redemption loop: a backlog title must be pulled onto
  // the active shelf with a credit (/rr-session) before its time can be logged.
  if (existing.status === 'backlog') {
    throw new AppError('Activate this title with an R&R credit before logging time', 400);
  }

  const meta = parseJson<Record<string, unknown>>(existing.metaJson) ?? {};
  const endless = meta.endless === true;
  const today = startOfLocalDay();
  const { budget, overrunAntiGoalId } = await rrSettings(userId);

  const minutes = data.minutes ?? 0;
  const units = data.units ?? 0;

  // Advance progress in the item's natural unit.
  let nextUnitsDone = existing.unitsDone;
  if (existing.type === 'show' || existing.type === 'book') {
    const cap = existing.totalUnits ?? Number.MAX_SAFE_INTEGER;
    nextUnitsDone = Math.max(0, Math.min(cap, existing.unitsDone + units));
  } else {
    // movie / game: progress is minutes. Finite items cap at estMinutes.
    const cap = !endless && existing.estMinutes != null ? existing.estMinutes : Number.MAX_SAFE_INTEGER;
    nextUnitsDone = Math.max(0, Math.min(cap, existing.unitsDone + minutes));
  }

  let charged = false;
  let chargeSource: 'budget' | 'banked' | 'overrun' | null = null;
  let overran = false;
  let overrunTargetName: string | null = null;
  let breachedHabitId: string | null = null;

  const item = await prisma.$transaction(async (tx) => {
    // Has this title already taken its daily R&R charge?
    const priorCharged = await tx.mediaSession.count({
      where: { mediaItemId: existing.id, charged: true, createdAt: { gte: today } },
    });

    if (priorCharged === 0) {
      const dayBudget = budget[today.getDay()] ?? 0;
      const budgetUsedToday = await tx.mediaSession.count({
        where: { userId, charged: true, chargeSource: 'budget', createdAt: { gte: today } },
      });
      if (budgetUsedToday < dayBudget) {
        charged = true; chargeSource = 'budget';                 // within today's free allowance
      } else {
        const dec = await tx.playerProfile.updateMany({
          where: { userId, rrCredits: { gt: 0 } },
          data: { rrCredits: { decrement: 1 } },
        });
        if (dec.count === 1) {
          charged = true; chargeSource = 'banked';               // spend a bought/banked credit
        } else {
          // Soft gate: allowed, but it logs a breach on the chosen anti-goal.
          charged = true; chargeSource = 'overrun'; overran = true;
          if (overrunAntiGoalId) {
            const habit = await tx.habit.findFirst({
              where: { id: overrunAntiGoalId, userId, polarity: 'avoid' },
              select: { id: true, title: true },
            });
            if (habit) {
              overrunTargetName = habit.title;
              try {
                await tx.habitCompletion.create({
                  data: { userId, habitId: habit.id, completedOn: today, xpAwarded: 0, source: 'media-overrun' },
                });
              } catch (err: any) {
                if (err?.code !== 'P2002') throw err;             // already breached today — no-op
              }
              await tx.habit.update({ where: { id: habit.id }, data: { currentStreak: 0 } });
              breachedHabitId = habit.id;
            }
          }
        }
      }
    }

    await tx.mediaSession.create({
      data: {
        userId, mediaItemId: existing.id, type: existing.type,
        minutes, units: (existing.type === 'show' || existing.type === 'book') ? units : null,
        kind: data.kind, charged, chargeSource,
      },
    });

    return tx.mediaItem.update({
      where: { id: existing.id },
      data: { unitsDone: nextUnitsDone },
    });
  });

  // Fire breach side-effects outside the tx (mirrors /antigoals breach).
  if (breachedHabitId) {
    const ws = (global as any).wsService;
    if (ws?.broadcastGameEvent) ws.broadcastGameEvent(userId, 'antigoal-breached', { antigoalId: breachedHabitId });
    void emitHandlerEvent(prisma, userId, { type: 'antigoal_breached', name: overrunTargetName ?? 'leisure', antigoalId: breachedHabitId });
  }

  res.json({
    item: serialize(item),
    charged,
    chargeSource,
    overran,
    overrunTargetName,
  });
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
