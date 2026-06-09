import express from 'express';
import { z } from 'zod';
import { prisma } from '../server';
import { AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { GamificationService } from '../services/GamificationService';
import { evaluateAchievements } from '../services/achievements';
import { daysAgoLocal } from '../utils/dates';

const router = express.Router();

// Lazy: `prisma` is exported from server.ts, which imports this router.
// Instantiating GamificationService at module-top would hit a
// temporal dead zone on `prisma`. Build it on first use instead.
let _game: GamificationService | null = null;
function game(): GamificationService {
  return (_game ??= new GamificationService(prisma));
}

/**
 * GET /api/player
 * Player HUD: level, totalXp, xpIntoLevel, xpForNextLevel, progress,
 * currentStreak, longestStreak, domainXp, plus the economy fields
 * (overclock, tokens, R&R credits, cosmetics).
 *
 * Achievements are evaluated lazily here — the HUD is fetched constantly,
 * so this is the cheapest place to detect newly-met criteria, unlock them
 * (idempotent via UserAchievement @@unique), and bank their rewards. We
 * evaluate BEFORE snapshotting so any just-unlocked XP/eddies are already
 * reflected in the returned balances. `newAchievements` lets the client
 * pop a toast for anything unlocked on this fetch.
 */
router.get('/', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const newAchievements = await evaluateAchievements(prisma, game(), userId);
  const snapshot = await game().getSnapshot(userId);
  res.json({ player: snapshot, newAchievements });
}));

/**
 * GET /api/player/stats
 * Aggregate dashboard data: XP earned over the last 7 / 30 days,
 * completion counts per module, and the last 30 ledger entries.
 *
 * SQLite has no proper date_trunc; we bucket in JS after a single
 * scan of the ledger window — fine for personal-scale data.
 */
router.get('/stats', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const since30 = daysAgoLocal(30);
  const since7 = daysAgoLocal(7);

  const [ledger30, completions, snapshot] = await Promise.all([
    prisma.xpLedger.findMany({
      where: { userId, createdAt: { gte: since30 } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.questCompletion.count({
      where: { userId, completedAt: { gte: since30 } },
    }),
    game().getSnapshot(userId),
  ]);

  let xp30 = 0;
  let xp7 = 0;
  const byModule: Record<string, number> = {};
  for (const row of ledger30) {
    xp30 += row.amount;
    if (row.createdAt >= since7) xp7 += row.amount;
    if (row.module) {
      byModule[row.module] = (byModule[row.module] ?? 0) + row.amount;
    }
  }

  res.json({
    player: snapshot,
    xpLast7Days: xp7,
    xpLast30Days: xp30,
    completionsLast30Days: completions,
    xpByModule: byModule,
    recent: ledger30.slice(0, 30).map(r => ({
      id: r.id,
      amount: r.amount,
      reason: r.reason,
      module: r.module,
      refType: r.refType,
      refId: r.refId,
      createdAt: r.createdAt,
    })),
  });
}));

/**
 * GET /api/player/ledger?currency=xp|eddies|all&domain=&limit=
 *
 * Backs the Progress page (roadmap §8): the full chronological "data-shard
 * log" of every XP grant and eddie movement. Each row is the immutable
 * record of something earned/spent — it survives the deletion of whatever
 * task produced it, which is the whole point of the ledger-as-source-of-
 * truth model. Returns both ledgers tagged with a `currency` field so the
 * UI can render one combined feed or filter to one currency.
 */
router.get('/ledger', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const q = z.object({
    currency: z.enum(['xp', 'eddies', 'all']).default('all'),
    domain:   z.string().optional(),
    limit:    z.string().transform(Number).pipe(z.number().int().positive().max(1000)).default('200'),
  }).parse(req.query);

  const where = {
    userId,
    ...(q.domain ? { module: q.domain } : {}),
  };

  const [xp, wallet] = await Promise.all([
    q.currency === 'eddies'
      ? Promise.resolve([])
      : prisma.xpLedger.findMany({ where, orderBy: { createdAt: 'desc' }, take: q.limit }),
    q.currency === 'xp'
      ? Promise.resolve([])
      : prisma.walletLedger.findMany({ where, orderBy: { createdAt: 'desc' }, take: q.limit }),
  ]);

  const tag = (currency: 'xp' | 'eddies') => (r: any) => ({
    id: r.id,
    currency,
    amount: r.amount,
    reason: r.reason,
    module: r.module,
    refType: r.refType,
    refId: r.refId,
    createdAt: r.createdAt,
  });

  // Merge into one feed, newest first, capped at `limit`.
  const entries = [...xp.map(tag('xp')), ...wallet.map(tag('eddies'))]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, q.limit);

  res.json({ entries });
}));

export default router;
