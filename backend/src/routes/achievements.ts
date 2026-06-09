/**
 * Achievements / Street Cred route.
 *
 * GET / → the full trophy wall: every catalog achievement merged with the
 * user's UserAchievement unlock rows. Runs a lazy evaluate first (so a
 * just-met criterion is reflected on this very fetch), then loads the
 * unlock rows, and computes per-entry progress for the locked ones.
 *
 * Mirrors the conventions in routes/media.ts: auth-mounted router scoped to
 * req.user!.id, a lazy GamificationService singleton, and a single stats
 * build reused across the merge.
 */
import express from 'express';
import { prisma } from '../server';
import { AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { GamificationService } from '../services/GamificationService';
import {
  ACHIEVEMENTS,
  AchievementTier,
  buildStats,
  evaluateAchievements,
} from '../services/achievements';

const router = express.Router();

let _game: GamificationService | null = null;
const game = () => (_game ??= new GamificationService(prisma));

/** Stable rank for grouping locked cards (and tie-breaking) by tier. */
const TIER_RANK: Record<AchievementTier, number> = {
  bronze: 0, silver: 1, gold: 2, platinum: 3,
};

/**
 * GET /api/achievements
 * Evaluate → load unlock rows → merge with the fixed catalog. Unlocked
 * entries carry `unlockedAt`; locked entries that are measurable carry
 * `progress` (0..1) + `progressLabel`. Sorted unlocked-first, then locked
 * by descending progress (closest-to-unlock surfaces first).
 */
router.get('/', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;

  // Lazy unlock pass first so this fetch reflects anything just earned.
  await evaluateAchievements(prisma, game(), userId);

  const [rows, stats] = await Promise.all([
    prisma.userAchievement.findMany({
      where: { userId },
      select: { key: true, unlockedAt: true },
    }),
    buildStats(prisma, userId),
  ]);

  const unlockedAt = new Map(rows.map(r => [r.key, r.unlockedAt] as const));

  const achievements = ACHIEVEMENTS.map((def) => {
    const isUnlocked = unlockedAt.has(def.key);
    const progress = def.progress ? Math.max(0, Math.min(1, def.progress(stats))) : undefined;
    const progressLabel = def.progressLabel ? def.progressLabel(stats) : undefined;
    return {
      key: def.key,
      name: def.name,
      description: def.description,
      icon: def.icon,
      tier: def.tier,
      xpReward: def.xpReward,
      eddieReward: def.eddieReward,
      unlocked: isUnlocked,
      unlockedAt: isUnlocked ? unlockedAt.get(def.key)!.toISOString() : null,
      // Only attach progress for locked cards (unlocked is implicitly 100%).
      progress: isUnlocked ? undefined : progress,
      progressLabel: isUnlocked ? undefined : progressLabel,
    };
  });

  // Unlocked first (newest unlock first); then locked by closest-to-unlock,
  // tie-broken by tier then catalog order.
  const order = new Map(ACHIEVEMENTS.map((a, i) => [a.key, i] as const));
  achievements.sort((a, b) => {
    if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
    if (a.unlocked && b.unlocked) {
      // Both unlocked: newest first.
      return (b.unlockedAt ?? '').localeCompare(a.unlockedAt ?? '');
    }
    // Both locked: higher progress first.
    const pa = a.progress ?? 0;
    const pb = b.progress ?? 0;
    if (pb !== pa) return pb - pa;
    const ta = TIER_RANK[a.tier];
    const tb = TIER_RANK[b.tier];
    if (ta !== tb) return ta - tb;
    return (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0);
  });

  res.json({
    achievements,
    unlockedCount: rows.length,
    totalCount: ACHIEVEMENTS.length,
  });
}));

export default router;
