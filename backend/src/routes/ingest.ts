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
 * INGEST_TOKEN shared secret via the X-Ingest-Token header — phone
 * automations can't refresh a 7-day login token. Values upsert on the
 * (userId, date, key) unique, so re-sending a window is idempotent.
 * Bulk-historical by design: it does NOT auto-complete today's vitals
 * quest (PUT /api/metrics stays the interactive path that does).
 */
import express from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { prisma } from '../server';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { config } from '../config';
import { startOfLocalDay } from '../utils/dates';
import { logger } from '../utils/logger';

const router = express.Router();

const entrySchema = z.object({
  /** 'YYYY-MM-DD' (local day) or a full ISO datetime. */
  date: z.string().min(8).max(40),
  key: z.string().min(1).max(40),
  value: z.number().finite().min(-1e9).max(1e9),
});
const bodySchema = z.object({ entries: z.array(entrySchema).min(1).max(5000) });

/**
 * Resolve the target user. Token path maps to the hub user (single-user
 * system): HUB_USER_EMAIL when set, else the oldest account.
 */
async function resolveUserId(req: express.Request): Promise<string> {
  const token = req.headers['x-ingest-token'];
  if (typeof token === 'string' && config.ingestToken && token === config.ingestToken) {
    const email = process.env.HUB_USER_EMAIL;
    const user = email
      ? await prisma.user.findUnique({ where: { email }, select: { id: true } })
      : await prisma.user.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (!user) throw new AppError('No hub user to ingest for', 401);
    return user.id;
  }

  const bearer = req.headers.authorization?.replace('Bearer ', '');
  if (bearer) {
    try {
      const decoded = jwt.verify(bearer, config.jwt.secret) as { id: string };
      const user = await prisma.user.findUnique({ where: { id: decoded.id }, select: { id: true } });
      if (user) return user.id;
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

export default router;
