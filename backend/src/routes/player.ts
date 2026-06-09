import express from 'express';
import { prisma } from '../server';
import { AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { GamificationService } from '../services/GamificationService';
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
 * currentStreak, longestStreak, domainXp.
 */
router.get('/', asyncHandler(async (req: AuthRequest, res) => {
  const snapshot = await game().getSnapshot(req.user!.id);
  res.json({ player: snapshot });
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

export default router;
