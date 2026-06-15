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
  sleep: z.array(z.object({ session_end_time: isoTime, duration_seconds: z.number().finite() }).passthrough()).optional(),
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
  // Sleep belongs to the day you WOKE UP — bucket by session end.
  for (const s of body.sleep ?? []) add(dayOf(s.session_end_time), 'sleepHours', s.duration_seconds / 3600);
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

/** In-memory poll state for catch-up sizing + transition-based logging. */
let lastOkAt: number | null = null;
let lastFailLogged = false;
// Whether a deep historic pull has succeeded this process. The first
// successful pull after boot backfills a wide window to fill trend charts;
// every poll after that stays incremental. Resets on restart, so a reboot
// re-backfills once (idempotent upserts — it just refills any downtime gap).
let hasBackfilled = false;

export interface PullResult {
  configured: boolean;
  ok: boolean;
  written: number;
  days: number;
  error?: string;
}

/**
 * One pull from the phone, shared by the interval poller and the Vitals
 * page's on-demand SYNC button (POST /api/metrics/pull). Never throws.
 */
export async function pullNow(
  prisma: PrismaClient,
  opts: { backfill?: boolean } = {},
): Promise<PullResult> {
  const baseUrl = config.health.pullUrl;
  if (!baseUrl) return { configured: false, ok: false, written: 0, days: 0 };

  // Two request shapes:
  //  - Backfill: the first successful pull of the process (or an explicit
  //    request) grabs a deep historic window so the trend charts fill with
  //    as much past data as the phone holds.
  //  - Incremental: steady-state polls request only a small catch-up window,
  //    floored at 2 days so yesterday's finalised step/HR totals always land,
  //    and widened if the phone has been away so the gap backfills on return.
  // The app's `/` endpoint reads Health Connect on demand; ?days=N asks for
  // N full days. A deep scan can be slow, so backfills get a longer timeout.
  const wantBackfill = opts.backfill || !hasBackfilled;
  const hoursSinceOk = lastOkAt ? (Date.now() - lastOkAt) / 3_600_000 : 48;
  const incrementalDays = Math.min(14, Math.max(2, Math.ceil(hoursSinceOk / 24) + 1));
  const days = wantBackfill ? config.health.backfillDays : incrementalDays;
  const url = `${baseUrl.replace(/\/+$/, '')}/?days=${days}`;
  const timeout = wantBackfill ? 30_000 : FETCH_TIMEOUT_MS;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeout),
      // The app's "Local HTTP auth" toggle: Authorization: Bearer <token>,
      // 401 without it. Optional — omitted when no token is configured.
      headers: config.health.pullToken
        ? { authorization: `Bearer ${config.health.pullToken}` }
        : undefined,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = healthConnectSchema.safeParse(await res.json());
    if (!parsed.success) throw new Error('payload failed validation');

    const userId = await resolveHubUserId(prisma);
    if (!userId) return { configured: true, ok: false, written: 0, days: 0, error: 'no hub user' };

    const { written, days: dayCount } = await ingestHealthConnectPayload(prisma, userId, parsed.data);
    if (lastFailLogged || lastOkAt === null) {
      logger.info('[healthSync] phone reachable — pull sync active');
    }
    lastOkAt = Date.now();
    lastFailLogged = false;
    if (wantBackfill) {
      hasBackfilled = true;
      logger.info(`[healthSync] historic backfill: requested ${days}d, wrote ${written} value(s) across ${dayCount} day(s)`);
    } else if (written > 0) {
      logger.info(`[healthSync] pulled ${written} value(s) across ${dayCount} day(s)`);
    }
    return { configured: true, ok: true, written, days: dayCount };
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    // A phone that's out of the house is normal life, not an incident —
    // log the transition once, then stay quiet until it's back.
    if (!lastFailLogged) {
      logger.warn(`[healthSync] pull failed (phone away?): ${msg} — will keep retrying quietly`);
      lastFailLogged = true;
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
  sleepHours: 'SLEEP', weight: 'WEIGHT', water: 'WATER', workHours: 'FOCUS', mood: 'MOOD',
};

export interface SyncStatus {
  configured: boolean;
  lastSyncedAt: string | null;
  lastSyncMins: number | null;
  backfillDays: number;
  readings: number;
  streams: Array<{ label: string; days: number }>;
}

/** Reach of the stored daily history for the hub user: total rows, the
 *  oldest-to-today span, and per-stream day counts. Cheap groupBy. */
export async function getSyncStatus(prisma: PrismaClient): Promise<SyncStatus> {
  const configured = !!config.health.pullUrl;
  const lastSyncedAt = lastOkAt ? new Date(lastOkAt).toISOString() : null;
  const lastSyncMins = lastOkAt ? Math.max(0, Math.round((Date.now() - lastOkAt) / 60_000)) : null;

  const userId = await resolveHubUserId(prisma);
  if (!userId) return { configured, lastSyncedAt, lastSyncMins, backfillDays: 0, readings: 0, streams: [] };

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
 * Start the background poller. No-op unless HEALTH_PULL_URL is set.
 * Interval clamps to ≥5 min; first poll runs shortly after boot.
 */
export function startHealthPull(prisma: PrismaClient): void {
  const url = config.health.pullUrl;
  if (!url || config.nodeEnv === 'test') return;
  const everyMs = Math.max(5, config.health.pullMinutes) * 60_000;
  logger.info(`[healthSync] pull mode armed: ${url} every ${Math.round(everyMs / 60_000)}min`);
  setTimeout(() => void pullNow(prisma), 15_000);
  setInterval(() => void pullNow(prisma), everyMs);
}
