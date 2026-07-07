/**
 * healthSync.ts — Health Connect payload mapping + the pull-mode poller.
 *
 * One mapper, two transports:
 *   - PUSH: POST /api/ingest/health-connect (routes/ingest.ts) — the
 *     health-connect-webhook app delivers its payload to us. Blocked in
 *     practice by Android's cleartext policy for plain-HTTP LAN hubs.
 *   - PULL: startHealthPull() — the same app's "Local HTTP Server" mode
 *     (GET-only, trusted-LAN) serves the identical JSON on the phone;
 *     we poll it on an interval (HEALTH_PULL_URL / HEALTH_PULL_MINUTES).
 *     The phone serving HTTP sidesteps the cleartext restriction.
 *
 * Payload spec: github.com/mcnaveen/health-connect-webhook docs/webhook.md
 * (snake_case arrays, ISO-8601 UTC instants). Mapping rules:
 *   - steps / hydration: summed per local day, intervals bucketed by their
 *     midpoint so UTC-expressed day aggregates land on the right local day.
 *   - sleep: credited to the local day the session ENDED (the wake-up day).
 *     Alongside the summed hours, the night's BEDTIME is stored as
 *     'sleepStart': signed hours relative to the wake day's local midnight
 *     (22:30 → -1.5, 00:45 → +0.75), so the series is continuous across
 *     midnight. Longest session of the day wins (a nap never sets bedtime).
 *   - weight / blood pressure / resting HR: latest reading of the day wins.
 *   - weight + water are converted to the user's MetricDef units so synced
 *     values match hand-logged ones. Raw heart_rate samples are ignored.
 * Upserts on (userId, date, key) — re-ingesting any window is idempotent.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { config } from '../config';
import { logger } from '../utils/logger';
import { startOfLocalDay } from '../utils/dates';
import { DEMO_EMAIL } from '../utils/demoSeed';

type Db = PrismaClient | Prisma.TransactionClient;

const isoTime = z.string().min(10).max(40);
export const healthConnectSchema = z.object({
  steps: z.array(z.object({ count: z.number().finite(), start_time: isoTime, end_time: isoTime }).passthrough()).optional(),
  sleep: z.array(z.object({ session_end_time: isoTime, duration_seconds: z.number().finite(), session_start_time: isoTime.optional() }).passthrough()).optional(),
  resting_heart_rate: z.array(z.object({ bpm: z.number().finite(), time: isoTime }).passthrough()).optional(),
  weight: z.array(z.object({ kilograms: z.number().finite(), time: isoTime }).passthrough()).optional(),
  blood_pressure: z.array(z.object({ systolic: z.number().finite(), diastolic: z.number().finite(), time: isoTime }).passthrough()).optional(),
  hydration: z.array(z.object({ liters: z.number().finite(), start_time: isoTime, end_time: isoTime }).passthrough()).optional(),
}).passthrough(); // raw heart_rate samples etc. arrive too — ignored below

export type HealthConnectPayload = z.infer<typeof healthConnectSchema>;

/** Hub user for tokened/pulled ingestion (single-user system):
 *  HUB_USER_EMAIL when set, else the oldest NON-demo account. The demo
 *  sandbox is explicitly excluded so it can never silently become the
 *  AI/ingest identity. */
export async function resolveHubUserId(db: Db): Promise<string | null> {
  const email = process.env.HUB_USER_EMAIL;
  const user = email
    ? await db.user.findUnique({ where: { email }, select: { id: true } })
    : await db.user.findFirst({ where: { email: { not: DEMO_EMAIL } }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  return user?.id ?? null;
}

/** Local day a point-in-time sample belongs to. */
function dayOf(iso: string): Date | null {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : startOfLocalDay(d);
}
/** Local day of an interval — bucketed by its midpoint. */
function dayOfInterval(startIso: string, endIso: string): Date | null {
  const s = new Date(startIso).getTime(), e = new Date(endIso).getTime();
  if (isNaN(s) || isNaN(e)) return null;
  return startOfLocalDay(new Date(s + Math.max(0, e - s) / 2));
}

/** Map a validated payload onto DailyMetric upserts for one user. */
export async function ingestHealthConnectPayload(
  prisma: PrismaClient,
  userId: string,
  body: HealthConnectPayload,
): Promise<{ written: number; days: number }> {
  // Per-user units so converted values match what the user logs by hand.
  const defs = await prisma.metricDef.findMany({
    where: { userId, key: { in: ['weight', 'water'] } },
    select: { key: true, unit: true },
  });
  const unitOf = (key: string) => (defs.find(d => d.key === key)?.unit ?? '').toLowerCase();
  const weightFromKg = (kg: number) => unitOf('weight').includes('lb') ? kg * 2.20462 : kg;
  const waterFromLiters = (l: number) => {
    const u = unitOf('water');
    if (u.includes('oz')) return l * 33.814;
    if (u.includes('ml')) return l * 1000;
    if (u.includes('glass') || u.includes('cup')) return l * 4.22675;
    return l;
  };
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const r2 = (n: number) => Math.round(n * 100) / 100;

  // Reduce records → one value per (local day, metric key).
  const values = new Map<number, Record<string, number>>();
  const latestAt = new Map<string, number>();
  const put = (day: Date | null, key: string, value: number) => {
    if (!day) return;
    const rec = values.get(day.getTime()) ?? {};
    rec[key] = value;
    values.set(day.getTime(), rec);
  };
  const add = (day: Date | null, key: string, delta: number) => {
    if (!day) return;
    const rec = values.get(day.getTime()) ?? {};
    rec[key] = (rec[key] ?? 0) + delta;
    values.set(day.getTime(), rec);
  };
  const putLatest = (day: Date | null, key: string, value: number, atIso: string) => {
    if (!day) return;
    const at = new Date(atIso).getTime();
    const id = `${day.getTime()}:${key}`;
    if (isNaN(at) || at < (latestAt.get(id) ?? -Infinity)) return;
    latestAt.set(id, at);
    put(day, key, value);
  };

  for (const s of body.steps ?? []) add(dayOfInterval(s.start_time, s.end_time), 'steps', s.count);
  // Sleep belongs to the day you WOKE UP — bucket by session end. Each night
  // also records its bedtime ('sleepStart', signed hours vs the wake day's
  // local midnight); with several sessions on one day the longest one sets
  // the bedtime, so a nap never masquerades as the night's start.
  const longestSleep = new Map<number, number>(); // wake dayMs → duration_seconds
  for (const s of body.sleep ?? []) {
    const day = dayOf(s.session_end_time);
    add(day, 'sleepHours', s.duration_seconds / 3600);
    if (!day || s.duration_seconds <= 0 || s.duration_seconds > 24 * 3600) continue;
    const endMs = new Date(s.session_end_time).getTime();
    const startExplicit = s.session_start_time ? new Date(s.session_start_time).getTime() : NaN;
    const startMs = !isNaN(startExplicit) ? startExplicit : endMs - s.duration_seconds * 1000;
    if ((longestSleep.get(day.getTime()) ?? 0) >= s.duration_seconds) continue;
    longestSleep.set(day.getTime(), s.duration_seconds);
    put(day, 'sleepStart', (startMs - day.getTime()) / 3_600_000);
  }
  for (const s of body.resting_heart_rate ?? []) putLatest(dayOf(s.time), 'restingHr', Math.round(s.bpm), s.time);
  for (const s of body.weight ?? []) putLatest(dayOf(s.time), 'weight', r1(weightFromKg(s.kilograms)), s.time);
  for (const s of body.blood_pressure ?? []) {
    putLatest(dayOf(s.time), 'bpSys', Math.round(s.systolic), s.time);
    putLatest(dayOf(s.time), 'bpDia', Math.round(s.diastolic), s.time);
  }
  for (const s of body.hydration ?? []) add(dayOfInterval(s.start_time, s.end_time), 'water', waterFromLiters(s.liters));

  // Round summed floats once, after accumulation.
  for (const rec of values.values()) {
    if (rec.sleepHours != null) rec.sleepHours = r2(rec.sleepHours);
    if (rec.sleepStart != null) rec.sleepStart = r2(rec.sleepStart);
    if (rec.water != null) rec.water = r1(rec.water);
    if (rec.steps != null) rec.steps = Math.round(rec.steps);
  }

  let written = 0;
  await prisma.$transaction(async (tx) => {
    for (const [dayMs, rec] of values) {
      for (const [key, value] of Object.entries(rec)) {
        await tx.dailyMetric.upsert({
          where: { userId_date_key: { userId, date: new Date(dayMs), key } },
          update: { value },
          create: { userId, date: new Date(dayMs), key, value },
        });
        written++;
      }
    }
  });

  return { written, days: values.size };
}

// ---------------------------------------------------------------------
// Pull mode: poll the phone's local HTTP server
// ---------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 10_000;

/**
 * Per-user in-memory poll state for catch-up sizing + transition-based
 * logging. Health pull config is now PER-USER (UserSettings.healthPull*), so
 * the process tracks each user's reachability independently — one user's
 * phone being away never affects another's backfill/incremental decision.
 *   - lastOkAt: last successful pull (drives the catch-up window width).
 *   - lastFailLogged: whether the "phone away" warning was already emitted.
 *   - hasBackfilled: whether a deep historic pull has succeeded this process
 *     for this user. The first success after boot backfills a wide window to
 *     fill trend charts; every poll after stays incremental. Resets on
 *     restart (idempotent upserts just refill any downtime gap).
 *   - lastAttemptAt: last poll attempt (success OR failure) — the scheduler
 *     uses this, not lastOkAt, so the cadence holds while the phone is away.
 */
interface PollState {
  lastOkAt: number | null;
  lastFailLogged: boolean;
  hasBackfilled: boolean;
  lastAttemptAt: number | null;
}
const pollStateByUser = new Map<string, PollState>();
function pollState(userId: string): PollState {
  let s = pollStateByUser.get(userId);
  if (!s) {
    s = { lastOkAt: null, lastFailLogged: false, hasBackfilled: false, lastAttemptAt: null };
    pollStateByUser.set(userId, s);
  }
  return s;
}

/** The caller's health-pull config (from their UserSettings row). */
export interface HealthPullConfig {
  pullUrl?: string | null;
  pullToken?: string | null;
  backfillDays?: number | null;
}

export interface PullResult {
  configured: boolean;
  ok: boolean;
  written: number;
  days: number;
  error?: string;
}

/**
 * One pull from a specific user's phone, shared by the background poller and
 * the Vitals page's on-demand SYNC button (POST /api/metrics/pull). Acts only
 * on the GIVEN user's data using the GIVEN user's config — never the hub user
 * regardless of caller. Never throws.
 */
export async function pullNow(
  prisma: PrismaClient,
  userId: string,
  cfg: HealthPullConfig,
  opts: { backfill?: boolean } = {},
): Promise<PullResult> {
  const baseUrl = cfg.pullUrl;
  if (!baseUrl) return { configured: false, ok: false, written: 0, days: 0 };

  const state = pollState(userId);

  // Two request shapes:
  //  - Backfill: the first successful pull of the process (or an explicit
  //    request) grabs a deep historic window so the trend charts fill with
  //    as much past data as the phone holds.
  //  - Incremental: steady-state polls request only a small catch-up window,
  //    floored at 2 days so yesterday's finalised step/HR totals always land,
  //    and widened if the phone has been away so the gap backfills on return.
  // The app's `/` endpoint reads Health Connect on demand; ?days=N asks for
  // N full days. A deep scan can be slow, so backfills get a longer timeout.
  const wantBackfill = opts.backfill || !state.hasBackfilled;
  const hoursSinceOk = state.lastOkAt ? (Date.now() - state.lastOkAt) / 3_600_000 : 48;
  const incrementalDays = Math.min(14, Math.max(2, Math.ceil(hoursSinceOk / 24) + 1));
  const days = wantBackfill ? (cfg.backfillDays ?? 365) : incrementalDays;
  const url = `${baseUrl.replace(/\/+$/, '')}/?days=${days}`;
  const timeout = wantBackfill ? 30_000 : FETCH_TIMEOUT_MS;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeout),
      // The app's "Local HTTP auth" toggle: Authorization: Bearer <token>,
      // 401 without it. Optional — omitted when no token is configured.
      headers: cfg.pullToken
        ? { authorization: `Bearer ${cfg.pullToken}` }
        : undefined,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = healthConnectSchema.safeParse(await res.json());
    if (!parsed.success) throw new Error('payload failed validation');

    const { written, days: dayCount } = await ingestHealthConnectPayload(prisma, userId, parsed.data);
    if (state.lastFailLogged || state.lastOkAt === null) {
      logger.info(`[healthSync] phone reachable — pull sync active (user ${userId})`);
    }
    state.lastOkAt = Date.now();
    state.lastFailLogged = false;
    if (wantBackfill) {
      state.hasBackfilled = true;
      logger.info(`[healthSync] historic backfill (user ${userId}): requested ${days}d, wrote ${written} value(s) across ${dayCount} day(s)`);
    } else if (written > 0) {
      logger.info(`[healthSync] pulled ${written} value(s) across ${dayCount} day(s) (user ${userId})`);
    }
    return { configured: true, ok: true, written, days: dayCount };
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    // A phone that's out of the house is normal life, not an incident —
    // log the transition once, then stay quiet until it's back.
    if (!state.lastFailLogged) {
      logger.warn(`[healthSync] pull failed for user ${userId} (phone away?): ${msg} — will keep retrying quietly`);
      state.lastFailLogged = true;
    }
    return { configured: true, ok: false, written: 0, days: 0, error: msg };
  }
}

// ---------------------------------------------------------------------
// Uplink telemetry — backs the Biomonitor's PHONE UPLINK module
// (GET /api/metrics/sync-status). Reports how far back the stored history
// reaches per stream, so the UI can show the "backfill reach" readout.
// ---------------------------------------------------------------------

/** Short display labels for the uplink stream readout (bp* collapse to BP). */
const STREAM_LABELS: Record<string, string> = {
  steps: 'STEPS', restingHr: 'HEART', bpSys: 'BP', bpDia: 'BP',
  sleepHours: 'SLEEP', sleepStart: 'SLEEP', weight: 'WEIGHT', water: 'WATER', workHours: 'FOCUS', mood: 'MOOD',
};

export interface SyncStatus {
  configured: boolean;
  lastSyncedAt: string | null;
  lastSyncMins: number | null;
  backfillDays: number;
  readings: number;
  streams: Array<{ label: string; days: number }>;
}

/** Reach of the stored daily history for THIS user: total rows, the
 *  oldest-to-today span, and per-stream day counts. Cheap groupBy. Scoped to
 *  the caller (req.user.id) — never the hub user regardless of caller. */
export async function getSyncStatus(prisma: PrismaClient, userId: string): Promise<SyncStatus> {
  const settings = await prisma.userSettings.findUnique({
    where: { userId }, select: { healthPullUrl: true },
  });
  const configured = !!settings?.healthPullUrl;
  const state = pollState(userId);
  const lastSyncedAt = state.lastOkAt ? new Date(state.lastOkAt).toISOString() : null;
  const lastSyncMins = state.lastOkAt ? Math.max(0, Math.round((Date.now() - state.lastOkAt) / 60_000)) : null;

  const grouped = await prisma.dailyMetric.groupBy({
    by: ['key'],
    where: { userId },
    _count: { _all: true },
    _min: { date: true },
  });

  const todayMs = startOfLocalDay().getTime();
  const daysSince = (d: Date) =>
    Math.max(1, Math.round((todayMs - startOfLocalDay(d).getTime()) / 86_400_000) + 1);

  let readings = 0, backfillDays = 0;
  const byLabel = new Map<string, number>();
  for (const g of grouped) {
    readings += g._count._all;
    const days = g._min.date ? daysSince(g._min.date) : 0;
    backfillDays = Math.max(backfillDays, days);
    const label = STREAM_LABELS[g.key] ?? g.key.toUpperCase();
    byLabel.set(label, Math.max(byLabel.get(label) ?? 0, days));
  }

  const streams = [...byLabel.entries()]
    .map(([label, days]) => ({ label, days }))
    .sort((a, b) => b.days - a.days);

  return { configured, lastSyncedAt, lastSyncMins, backfillDays, readings, streams };
}

/**
 * Start the background poller. Health pull is now PER-USER: instead of
 * polling one global URL on a fixed timer, a single lightweight tick (every
 * minute) finds every user who has a healthPullUrl set and pulls each from
 * THEIR own URL/token whenever their personal cadence (healthPullMinutes,
 * clamped ≥5) has elapsed. Resilient by construction — pullNow never throws
 * and each user is fired independently, so one phone being away (or one
 * user's misconfig) never stalls the others. New/changed/removed config is
 * picked up on the next tick without a restart. No-op in test.
 */
const POLL_TICK_MS = 60_000;
export function startHealthPull(prisma: PrismaClient): void {
  if (config.nodeEnv === 'test') return;
  logger.info('[healthSync] per-user pull scheduler armed (tick 60s)');

  const tick = async () => {
    let users: Array<{
      userId: string; healthPullUrl: string | null; healthPullToken: string | null;
      healthPullMinutes: number; healthBackfillDays: number;
    }>;
    try {
      users = await prisma.userSettings.findMany({
        where: { healthPullUrl: { not: null } },
        select: {
          userId: true, healthPullUrl: true, healthPullToken: true,
          healthPullMinutes: true, healthBackfillDays: true,
        },
      });
    } catch (err: any) {
      logger.warn(`[healthSync] scheduler tick failed to read users: ${err?.message ?? err}`);
      return;
    }

    const now = Date.now();
    for (const u of users) {
      const state = pollState(u.userId);
      const everyMs = Math.max(5, u.healthPullMinutes) * 60_000;
      const due = state.lastAttemptAt === null || (now - state.lastAttemptAt) >= everyMs;
      if (!due) continue;
      state.lastAttemptAt = now;
      // Fire-and-forget; pullNow swallows its own errors, but guard anyway so a
      // single rejection can never bubble out of the detached promise.
      void pullNow(prisma, u.userId, {
        pullUrl: u.healthPullUrl, pullToken: u.healthPullToken, backfillDays: u.healthBackfillDays,
      }).catch(() => {});
    }
  };

  // First sweep shortly after boot, then once a minute.
  setTimeout(() => void tick(), 15_000);
  setInterval(() => void tick(), POLL_TICK_MS);
}
