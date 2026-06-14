/**
 * Daily log / vitals domain — "Biomonitor".
 *
 * Owns MetricDef (the configurable metric set: weight, sleepHours, mood,
 * water, workHours, steps, bpSys, bpDia, restingHr + any user-defined) and
 * DailyMetric (one value per metric per local day, keyed by
 * @@unique([userId, date, key])). Water lives here now (moved out of habits).
 *
 * Submitting the day's log (PUT /) upserts each metric value and
 * auto-completes the pending vitals check-in quest (closed loop:
 * "log your vitals → the quest clears + XP/eddies land"). Vitals quests
 * carry no sourceId (one generic check-in), so the quest match is on
 * source + questDate + status.
 *
 * Exports buildVitalsCandidates(), consumed by QuestEngine: emits ONE
 * low-XP "log your daily vitals" candidate when today's log is empty.
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
import { config } from '../config';
import { pullNow } from '../services/healthSync';

const router = express.Router();

let _game: GamificationService | null = null;
const game = () => (_game ??= new GamificationService(prisma));

const KIND = z.enum(['number', 'scale', 'integer']);

/** A safe metric key: lowercase letters/numbers, camelCase-ish. */
const KEY = z.string().min(1).max(48).regex(
  /^[a-zA-Z][a-zA-Z0-9_]*$/,
  'key must start with a letter and contain only letters, numbers, or underscores',
);

const createDefSchema = z.object({
  key:   KEY,
  label: z.string().min(1).max(80),
  unit:  z.string().max(20).nullable().optional(),
  kind:  KIND.default('number'),
  min:   z.number().nullable().optional(),
  max:   z.number().nullable().optional(),
});

const updateDefSchema = z.object({
  label:     z.string().min(1).max(80).optional(),
  unit:      z.string().max(20).nullable().optional(),
  enabled:   z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
  min:       z.number().nullable().optional(),
  max:       z.number().nullable().optional(),
});

const upsertSchema = z.object({
  date:   z.string().datetime().optional(),
  // Reject non-finite (Infinity/NaN) and absurd magnitudes — these land
  // straight in a Float column and would poison trend charts.
  values: z.record(z.number().finite().min(-1e9).max(1e9)),
});

/** Parse a YYYY-MM-DD or ISO string into a local-midnight day key. */
function dayFromQuery(raw: unknown): Date {
  if (typeof raw === 'string' && raw.length > 0) {
    const parsed = new Date(raw);
    if (!isNaN(parsed.getTime())) return startOfLocalDay(parsed);
  }
  return startOfLocalDay();
}

// ---------------------------------------------------------------------
// Metric definitions (the configurable metric set)
// ---------------------------------------------------------------------

/** GET /api/metrics/defs — enabled first, then by sortOrder, then key. */
router.get('/defs', asyncHandler(async (req: AuthRequest, res) => {
  const defs = await prisma.metricDef.findMany({
    where: { userId: req.user!.id },
    orderBy: [{ enabled: 'desc' }, { sortOrder: 'asc' }, { key: 'asc' }],
  });
  res.json({ defs });
}));

/** POST /api/metrics/defs — create a custom metric. */
router.post('/defs', asyncHandler(async (req: AuthRequest, res) => {
  const data = createDefSchema.parse(req.body);
  const userId = req.user!.id;

  const dupe = await prisma.metricDef.findUnique({
    where: { userId_key: { userId, key: data.key } },
    select: { id: true },
  });
  if (dupe) throw new AppError('A metric with that key already exists', 409);

  // Append after the current max sortOrder so new metrics land at the end.
  const last = await prisma.metricDef.findFirst({
    where: { userId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });

  const def = await prisma.metricDef.create({
    data: {
      userId,
      key: data.key,
      label: data.label,
      unit: data.unit ?? null,
      kind: data.kind,
      enabled: true,
      sortOrder: (last?.sortOrder ?? 0) + 1,
      min: data.min ?? null,
      max: data.max ?? null,
    },
  });
  res.status(201).json({ def });
}));

/** PUT /api/metrics/defs/:id — update label/unit/enabled/sortOrder/min/max. */
router.put('/defs/:id', asyncHandler(async (req: AuthRequest, res) => {
  const data = updateDefSchema.parse(req.body);
  const existing = await prisma.metricDef.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
    select: { id: true },
  });
  if (!existing) throw new AppError('Metric not found', 404);

  const def = await prisma.metricDef.update({
    where: { id: existing.id },
    data: {
      label:     data.label,
      unit:      data.unit,
      enabled:   data.enabled,
      sortOrder: data.sortOrder,
      min:       data.min,
      max:       data.max,
    },
  });
  res.json({ def });
}));

// ---------------------------------------------------------------------
// Daily log values
// ---------------------------------------------------------------------

/**
 * GET /api/metrics?date=YYYY-MM-DD
 *
 * All DailyMetric rows for the day (default today), keyed by metric key.
 * `submitted` is true once any value exists for the day — that's what
 * the vitals candidate builder and the UI use to know the log is "in".
 */
router.get('/', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const day = dayFromQuery(req.query.date);

  const rows = await prisma.dailyMetric.findMany({
    where: { userId, date: day },
  });

  const values: Record<string, number> = {};
  for (const r of rows) values[r.key] = r.value;

  res.json({
    date: day.toISOString(),
    submitted: rows.length > 0,
    values,
    metrics: rows,
  });
}));

/**
 * GET /api/metrics/history?key=&days=30
 *
 * Time series for one metric key, oldest→newest, for the trend chart.
 */
router.get('/history', asyncHandler(async (req: AuthRequest, res) => {
  const q = z.object({
    key:  KEY,
    days: z.string().transform(Number).pipe(z.number().int().positive().max(365)).default('30'),
  }).parse(req.query);
  const userId = req.user!.id;

  const since = startOfLocalDay();
  since.setDate(since.getDate() - (q.days - 1));

  const rows = await prisma.dailyMetric.findMany({
    where: { userId, key: q.key, date: { gte: since } },
    orderBy: { date: 'asc' },
    select: { date: true, value: true },
  });

  res.json({
    key: q.key,
    series: rows.map(r => ({ date: r.date.toISOString(), value: r.value })),
  });
}));

/**
 * PUT /api/metrics
 *
 * Upsert today's (or a given day's) log: body { date?, values: {<key>:number} }.
 * Each value is upserted via @@unique([userId, date, key]). After persisting,
 * auto-completes the pending vitals check-in quest for the day (closed loop —
 * sourceId is null so we match on source + questDate + status) and awards its
 * XP/eddies. Re-submitting the same day re-upserts values but only awards the
 * quest once (it's already "completed" after the first submit).
 */
router.put('/', asyncHandler(async (req: AuthRequest, res) => {
  const data = upsertSchema.parse(req.body);
  const userId = req.user!.id;
  const day = data.date ? startOfLocalDay(new Date(data.date)) : startOfLocalDay();

  // Only accept values for metrics this user actually owns (ignore unknown
  // keys rather than failing the whole submit).
  const defs = await prisma.metricDef.findMany({
    where: { userId },
    select: { key: true },
  });
  const known = new Set(defs.map(d => d.key));
  const entries = Object.entries(data.values).filter(([k]) => known.has(k));

  let player: Awaited<ReturnType<GamificationService['awardXp']>> | null = null;
  let questAutoCompleted: { id: string; xpReward: number } | null = null;

  await prisma.$transaction(async (tx) => {
    for (const [key, value] of entries) {
      await tx.dailyMetric.upsert({
        where: { userId_date_key: { userId, date: day, key } },
        update: { value },
        create: { userId, date: day, key, value },
      });
    }

    // Closed loop: clear the pending "log your daily vitals" quest. Generic
    // check-in → no sourceId, so match on source + questDate + status only.
    const q = await tx.quest.findFirst({
      where: { userId, source: 'vitals', sourceId: null, questDate: day, status: 'pending' },
    });
    if (q) {
      await tx.quest.update({
        where: { id: q.id },
        data: { status: 'completed', progress: 1, currentCount: q.targetCount },
      });
      await tx.questCompletion.create({
        data: {
          userId, questId: q.id, xpAwarded: q.xpReward,
          meta: JSON.stringify({ trigger: 'vitals-log' }),
        },
      });
      player = await game().awardXp(userId, {
        amount: q.xpReward,
        eddies: eddiesForReward(q.xpReward, q.difficulty),
        reason: 'quest_complete',
        module: 'vitals',
        refType: 'quest',
        refId: q.id,
      }, tx);
      questAutoCompleted = { id: q.id, xpReward: q.xpReward };
    }
  });

  const ws = (global as any).wsService;
  if (ws?.broadcastGameEvent && questAutoCompleted) {
    ws.broadcastGameEvent(userId, 'vitals-logged', { questAutoCompleted });
  }

  // Echo back the freshly persisted day so the client can re-key its form.
  const rows = await prisma.dailyMetric.findMany({ where: { userId, date: day } });
  const values: Record<string, number> = {};
  for (const r of rows) values[r.key] = r.value;

  res.json({
    date: day.toISOString(),
    submitted: rows.length > 0,
    values,
    metrics: rows,
    player,
    questAutoCompleted,
  });
}));

/**
 * Vitals candidate: if today has NO DailyMetric rows yet (log not
 * submitted), emit ONE low-XP same-day check-in. Otherwise return [].
 * Never throws on empty data — returns [] gracefully.
 */
export async function buildVitalsCandidates(
  prisma: PrismaClient,
  userId: string,
  date: Date,
  nextId: () => string,
): Promise<QuestCandidate[]> {
  const day = startOfLocalDay(date);
  const logged = await prisma.dailyMetric.count({
    where: { userId, date: day },
  });
  if (logged > 0) return [];

  return [{
    candidateId: nextId(),
    source: 'vitals',
    sourceId: null,
    moduleKey: 'vitals',
    baseTitle: 'Log your daily vitals',
    difficulty: 'easy',
    xpReward: 8,
    estMinutes: 3,
    carryOver: false, // same-day check-in; a missed day is a missed day
  }];
}

// ---------------------------------------------------------------------
// Phone pull — on-demand sync from the health-connect-webhook local
// server (services/healthSync.ts). The Biomonitor's SYNC button.
// ---------------------------------------------------------------------

/** GET /api/metrics/pull — pull-mode status (UI hides the button if off). */
router.get('/pull', asyncHandler(async (_req: AuthRequest, res) => {
  res.json({ configured: !!config.health.pullUrl });
}));

/** POST /api/metrics/pull[?full=1] — pull from the phone right now. Never
 *  throws: an unreachable phone reports { ok:false } rather than a 5xx.
 *  `full=1` forces a deep historic backfill instead of the incremental window. */
router.post('/pull', asyncHandler(async (req: AuthRequest, res) => {
  const backfill = req.query.full === '1' || req.query.full === 'true';
  res.json(await pullNow(prisma, { backfill }));
}));

export default router;
