/**
 * /api/ingest — bulk DailyMetric ingestion for external bridges.
 *
 * Health-sync groundwork (roadmap §Inputs & integrations): a deliberately
 * SOURCE-AGNOSTIC endpoint. Whatever ends up shipping Pixel-Watch data off
 * the phone (Health Connect bridge app, Tasker, an iOS-style shortcut, a
 * one-off export parser) just POSTs rows here:
 *
 *   POST /api/ingest/metrics
 *   { "entries": [ { "date": "2026-06-10", "key": "steps", "value": 9182 }, … ] }
 *
 * Auth is EITHER a normal JWT (manual/browser use) OR the long-lived
 * INGEST_TOKEN shared secret — via the X-Ingest-Token header, or as a
 * `?token=` query param for webhook apps that can't set custom headers
 * (secret-URL pattern, same trust model as the calendar ICS URL). Values
 * upsert on the (userId, date, key) unique, so re-sending a window is
 * idempotent. POST /metrics is bulk-historical by design: it does NOT
 * auto-complete today's vitals quest. POST /health-connect DOES — a phone
 * push that lands today's vitals clears the pending check-in
 * (services/vitalsQuest.ts), same as the interactive PUT /api/metrics.
 *
 * Two endpoints:
 *   POST /metrics         — generic {entries:[{date,key,value}]} rows.
 *   POST /health-connect  — native receiver for the health-connect-webhook
 *                           Android app (Pixel Watch → Health Connect →
 *                           this). Maps its snake_case payload onto
 *                           Daymon's DailyMetric keys.
 */
import express from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../server';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { config } from '../config';
import { startOfLocalDay } from '../utils/dates';

/** Constant-time secret compare — avoids leaking the token via response timing. */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
import { logger } from '../utils/logger';
import {
  healthConnectSchema, ingestHealthConnectPayload, resolveHubUserId,
} from '../services/healthSync';
import { completeVitalsQuestForToday } from '../services/vitalsQuest';

const router = express.Router();

const entrySchema = z.object({
  /** 'YYYY-MM-DD' (local day) or a full ISO datetime. */
  date: z.string().min(8).max(40),
  key: z.string().min(1).max(40),
  value: z.number().finite().min(-1e9).max(1e9),
});
const bodySchema = z.object({ entries: z.array(entrySchema).min(1).max(5000) });

/**
 * Resolve the target user from the ingest credentials.
 *
 * Token path (per-user secret-URL, the primary path now): the token is a
 * high-entropy, uniquely-indexed per-user secret (UserSettings.ingestToken),
 * so an exact-match lookup resolves the owning user directly — like an API
 * key. A request authenticates as, and writes only to, whoever owns the token.
 *
 * Legacy fallback: the old GLOBAL config.ingestToken still maps to the hub
 * user (constant-time compared), so a phone bridge configured before this
 * change keeps working until it's reissued a per-user URL.
 */
async function resolveUserId(req: express.Request): Promise<string> {
  // Header where possible; `?token=` for webhook apps with no header UI.
  const headerToken = req.headers['x-ingest-token'];
  const queryToken = typeof req.query.token === 'string' ? req.query.token : undefined;
  const token = typeof headerToken === 'string' ? headerToken : queryToken;
  if (typeof token === 'string' && token.length > 0) {
    // Per-user secret-URL token — exact-match lookup against the unique index.
    const owner = await prisma.userSettings.findFirst({
      where: { ingestToken: token }, select: { userId: true },
    });
    if (owner) return owner.userId;
    // Fallback: legacy global INGEST_TOKEN → hub user.
    if (config.ingestToken && tokenMatches(token, config.ingestToken)) {
      const userId = await resolveHubUserId(prisma);
      if (!userId) throw new AppError('No hub user to ingest for', 401);
      return userId;
    }
  }

  const bearer = req.headers.authorization?.replace('Bearer ', '');
  if (bearer) {
    try {
      const decoded = jwt.verify(bearer, config.jwt.secret) as { id: string; tokenVersion?: number };
      const user = await prisma.user.findUnique({ where: { id: decoded.id }, select: { id: true, tokenVersion: true } });
      // Honor tokenVersion revocation exactly like authMiddleware/verifyAuthToken,
      // so a logged-out / password-rotated token can't keep ingesting.
      if (user && (decoded.tokenVersion ?? 0) === user.tokenVersion) return user.id;
    } catch { /* fall through to the 401 */ }
  }
  throw new AppError('Ingest requires a JWT or a valid X-Ingest-Token', 401);
}

/**
 * A bare 'YYYY-MM-DD' must mean that LOCAL day. new Date('2026-06-10') is
 * UTC midnight — in any western timezone that's the evening of the 9th and
 * startOfLocalDay would file the metric under the wrong day.
 */
function parseLocalDay(raw: string): Date | null {
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : startOfLocalDay(d);
}

router.post('/metrics', asyncHandler(async (req, res) => {
  const userId = await resolveUserId(req);
  const { entries } = bodySchema.parse(req.body ?? {});

  let written = 0;
  // Chunked transactions: one giant tx over 5k rows would hold the SQLite
  // write lock for the whole import.
  const CHUNK = 200;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const chunk = entries.slice(i, i + CHUNK);
    await prisma.$transaction(async (tx) => {
      for (const e of chunk) {
        const day = parseLocalDay(e.date);
        if (!day) continue;
        await tx.dailyMetric.upsert({
          where: { userId_date_key: { userId, date: day, key: e.key } },
          update: { value: e.value },
          create: { userId, date: day, key: e.key, value: e.value },
        });
        written++;
      }
    });
  }

  logger.info(`[ingest] wrote ${written}/${entries.length} metric value(s) for user ${userId}`);
  res.json({ written, skipped: entries.length - written });
}));

// ---------------------------------------------------------------------
// POST /api/ingest/health-connect — native health-connect-webhook receiver.
// Mapping + payload schema live in services/healthSync.ts, shared with the
// pull-mode poller (startHealthPull) that GETs the same JSON from the
// phone's local HTTP server.
// ---------------------------------------------------------------------

router.post('/health-connect', asyncHandler(async (req, res) => {
  const userId = await resolveUserId(req);
  const body = healthConnectSchema.parse(req.body ?? {});
  const { written, days } = await ingestHealthConnectPayload(prisma, userId, body);
  // Phone-pushed vitals count as logged — clear today's pending vitals quest
  // (idempotent; historic-only payloads no-op inside the helper). Best-effort:
  // a quest/XP hiccup must never fail the ingest.
  await completeVitalsQuestForToday(prisma, userId).catch(() => {});
  logger.info(`[ingest] health-connect: ${written} value(s) across ${days} day(s) for user ${userId}`);
  res.json({ written, days });
}));

export default router;
