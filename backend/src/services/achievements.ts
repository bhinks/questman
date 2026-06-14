/**
 * Street Cred — achievements.
 *
 * The catalog is fixed code; UserAchievement rows record what a user has
 * unlocked. `evaluateAchievements` is called lazily (e.g. on GET
 * /api/player) — it builds a single stats snapshot of the user's current
 * state, checks every not-yet-unlocked achievement's criteria, unlocks any
 * newly-met ones (idempotent via UserAchievement @@unique([userId,key])),
 * and banks their rewards through GamificationService. Returns the
 * newly-unlocked entries so the HUD can pop a toast.
 *
 * SQLite has no JSON columns — PlayerProfile.cosmetics is a JSON-string
 * array of owned cosmetic keys, parsed by hand (guarded with try/catch).
 *
 * Idempotency: rewards are granted ONLY inside the create transaction, and
 * the create is guarded by the unique constraint (P2002 swallowed). The
 * not-already-unlocked filter plus the constraint guarantee repeated calls
 * never double-award.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { GamificationService } from './GamificationService';
import { emitHandlerEvent } from './handlerEvents';
import { overclockMultiplier } from '../utils/economy';

export interface UnlockedAchievement {
  key: string;
  name: string;
  icon?: string;
  xpReward?: number;
  eddieReward?: number;
}

export type AchievementTier = 'bronze' | 'silver' | 'gold' | 'platinum';

/**
 * The denormalized snapshot of everything the catalog's criteria need,
 * built ONCE per evaluation via a single Promise.all of cheap
 * counts/aggregates (no full table scans).
 */
export interface AchievementStats {
  level: number;
  currentStreak: number;
  longestStreak: number;
  overclockStreak: number;
  overclockMultiplier: number;
  cosmeticsCount: number;
  questCompletions: number;
  workouts: number;
  mediaDone: number;
  interactions: number;
  milestonesDone: number;
  transactions: number;
  lifetimeEddiesEarned: number;
  purchasesCount: number;
  purchaseCategories: Set<string>;
}

export interface AchievementDef {
  key: string;
  name: string;
  description: string;
  /** An Icon component name (see web/src/components/Icon.tsx). */
  icon: string;
  tier: AchievementTier;
  xpReward: number;
  eddieReward: number;
  /** True when the user currently satisfies this achievement. */
  criteria: (s: AchievementStats) => boolean;
  /** Optional 0..1 progress toward unlock, for locked-card progress bars. */
  progress?: (s: AchievementStats) => number;
  /** Optional human label, e.g. "7 / 14 days". */
  progressLabel?: (s: AchievementStats) => string;
}

/** Reward scale per tier — bronze cheapest, platinum richest. */
const REWARD: Record<AchievementTier, { xp: number; eddies: number }> = {
  bronze:   { xp: 25,  eddies: 10 },
  silver:   { xp: 75,  eddies: 40 },
  gold:     { xp: 200, eddies: 100 },
  platinum: { xp: 500, eddies: 250 },
};

/** clamp helper for progress fns. */
const ratio = (have: number, need: number): number =>
  need <= 0 ? 1 : Math.max(0, Math.min(1, have / need));

/**
 * A threshold achievement on a single numeric stat. Builds the criteria +
 * progress + label so the bulk of the catalog stays declarative.
 */
function threshold(
  key: string,
  name: string,
  description: string,
  icon: string,
  tier: AchievementTier,
  pick: (s: AchievementStats) => number,
  need: number,
  unit: string,
): AchievementDef {
  return {
    key,
    name,
    description,
    icon,
    tier,
    xpReward: REWARD[tier].xp,
    eddieReward: REWARD[tier].eddies,
    criteria: (s) => pick(s) >= need,
    progress: (s) => ratio(pick(s), need),
    progressLabel: (s) => `${Math.min(pick(s), need).toLocaleString()} / ${need.toLocaleString()} ${unit}`,
  };
}

// ---------------------------------------------------------------------------
// CATALOG — the fixed "Street Cred" set. ~30 achievements across the spine.
// ---------------------------------------------------------------------------

export const ACHIEVEMENTS: AchievementDef[] = [
  // --- Leveling ----------------------------------------------------------
  threshold('level_2',  'Booting Up',     'Reach level 2.',  'arrowUp', 'bronze',   s => s.level, 2,  'lvl'),
  threshold('level_5',  'Street Rookie',  'Reach level 5.',  'arrowUp', 'bronze',   s => s.level, 5,  'lvl'),
  threshold('level_10', 'Up & Coming',    'Reach level 10.', 'trend',   'silver',   s => s.level, 10, 'lvl'),
  threshold('level_25', 'Legend Rising',  'Reach level 25.', 'trend',   'gold',     s => s.level, 25, 'lvl'),
  threshold('level_50', 'Maximum Cred',   'Reach level 50.', 'spark',   'platinum', s => s.level, 50, 'lvl'),

  // --- Daily activity streak --------------------------------------------
  threshold('streak_3',   'Warming Up',      'Hit a 3-day activity streak.',   'flame', 'bronze',   s => s.longestStreak, 3,   'days'),
  threshold('streak_7',   'Week of Heat',    'Hit a 7-day activity streak.',   'flame', 'silver',   s => s.longestStreak, 7,   'days'),
  threshold('streak_14',  'Fortnight Burn',  'Hit a 14-day activity streak.',  'flame', 'silver',   s => s.longestStreak, 14,  'days'),
  threshold('streak_30',  'Month on Fire',   'Hit a 30-day activity streak.',  'flame', 'gold',     s => s.longestStreak, 30,  'days'),
  threshold('streak_100', 'Unbreakable',     'Hit a 100-day activity streak.', 'flame', 'platinum', s => s.longestStreak, 100, 'days'),

  // --- Overclock (full-clear chain) -------------------------------------
  threshold('overclock_3',  'Spinning Up',     'Full-clear 3 days in a row.',  'bolt', 'bronze', s => s.overclockStreak, 3,  'days'),
  threshold('overclock_7',  'Running Hot',     'Full-clear 7 days in a row.',  'bolt', 'silver', s => s.overclockStreak, 7,  'days'),
  threshold('overclock_14', 'Thermal Runaway', 'Full-clear 14 days in a row.', 'bolt', 'gold',   s => s.overclockStreak, 14, 'days'),
  {
    key: 'overclock_max',
    name: 'Redlined',
    description: 'Push the overclock multiplier to its ×2.0 cap.',
    icon: 'zap',
    tier: 'platinum',
    xpReward: REWARD.platinum.xp,
    eddieReward: REWARD.platinum.eddies,
    criteria: (s) => s.overclockMultiplier >= 2.0,
    progress: (s) => ratio(s.overclockMultiplier - 1, 1),
    progressLabel: (s) => `×${s.overclockMultiplier.toFixed(1)} / ×2.0`,
  },

  // --- Quests completed (lifetime) --------------------------------------
  threshold('quests_10',  'First Contracts',  'Complete 10 quests.',  'check', 'bronze',   s => s.questCompletions, 10,  'quests'),
  threshold('quests_50',  'Fixer',            'Complete 50 quests.',  'check', 'silver',   s => s.questCompletions, 50,  'quests'),
  threshold('quests_100', 'Veteran Runner',   'Complete 100 quests.', 'check', 'gold',     s => s.questCompletions, 100, 'quests'),
  threshold('quests_500', 'Living Legend',    'Complete 500 quests.', 'check', 'platinum', s => s.questCompletions, 500, 'quests'),

  // --- Eddies earned (lifetime) -----------------------------------------
  threshold('eddies_500',   'Pocket Change',  'Earn 500 eddies lifetime.',    'wallet', 'bronze',   s => s.lifetimeEddiesEarned, 500,   '€$'),
  threshold('eddies_5000',  'Cred Stick',     'Earn 5,000 eddies lifetime.',  'wallet', 'silver',   s => s.lifetimeEddiesEarned, 5000,  '€$'),
  threshold('eddies_25000', 'High Roller',    'Earn 25,000 eddies lifetime.', 'wallet', 'platinum', s => s.lifetimeEddiesEarned, 25000, '€$'),

  // --- Domain: fitness ---------------------------------------------------
  threshold('workout_1',  'First Sweat',  'Log your first workout.', 'heart', 'bronze', s => s.workouts, 1,  'workouts'),
  threshold('workout_10', 'Gym Rat',      'Log 10 workouts.',        'heart', 'silver', s => s.workouts, 10, 'workouts'),

  // --- Domain: media -----------------------------------------------------
  threshold('media_1',  'Braindance',    'Finish your first media item.', 'play', 'bronze', s => s.mediaDone, 1,  'items'),
  threshold('media_10', 'Binge Complete','Finish 10 media items.',        'play', 'silver', s => s.mediaDone, 10, 'items'),

  // --- Domain: social ----------------------------------------------------
  threshold('social_1', 'Reach Out', 'Log a social interaction with a contact.', 'bell', 'bronze', s => s.interactions, 1, 'logged'),

  // --- Domain: projects --------------------------------------------------
  threshold('milestone_1', 'Mission Accomplished', 'Complete a project milestone.', 'flag', 'silver', s => s.milestonesDone, 1, 'milestones'),

  // --- Domain: finance ---------------------------------------------------
  threshold('transaction_1', 'Follow the Money', 'Import your first transaction.', 'file', 'bronze', s => s.transactions, 1, 'imported'),

  // --- Economy: the Shop -------------------------------------------------
  {
    key: 'shop_first',
    name: 'Open for Business',
    description: 'Make your first purchase in the Shop.',
    icon: 'cart',
    tier: 'bronze',
    xpReward: REWARD.bronze.xp,
    eddieReward: REWARD.bronze.eddies,
    criteria: (s) => s.purchasesCount >= 1,
    progress: (s) => ratio(s.purchasesCount, 1),
    progressLabel: (s) => `${Math.min(s.purchasesCount, 1)} / 1 purchase`,
  },
  {
    key: 'cosmetic_owned',
    name: 'Drip',
    description: 'Own a cosmetic HUD theme.',
    icon: 'spark',
    tier: 'silver',
    xpReward: REWARD.silver.xp,
    eddieReward: REWARD.silver.eddies,
    // Own via either the profile cosmetics list or a recorded cosmetic buy.
    criteria: (s) => s.cosmeticsCount >= 1 || s.purchaseCategories.has('cosmetic'),
    progress: (s) => ratio(s.cosmeticsCount + (s.purchaseCategories.has('cosmetic') ? 1 : 0), 1),
    progressLabel: (s) => `${Math.min(s.cosmeticsCount + (s.purchaseCategories.has('cosmetic') ? 1 : 0), 1)} / 1 owned`,
  },
  {
    key: 'loot_crate',
    name: 'Lucky Pull',
    description: 'Crack open a loot crate.',
    icon: 'bag',
    tier: 'silver',
    xpReward: REWARD.silver.xp,
    eddieReward: REWARD.silver.eddies,
    criteria: (s) => s.purchaseCategories.has('loot_crate'),
    progress: (s) => (s.purchaseCategories.has('loot_crate') ? 1 : 0),
    progressLabel: (s) => `${s.purchaseCategories.has('loot_crate') ? 1 : 0} / 1 cracked`,
  },
];

export const ACHIEVEMENTS_BY_KEY: Record<string, AchievementDef> =
  Object.fromEntries(ACHIEVEMENTS.map(a => [a.key, a]));

function parseCosmeticsCount(raw: string | null | undefined): number {
  if (!raw) return 0;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter(x => typeof x === 'string').length : 0;
  } catch {
    return 0;
  }
}

/**
 * Build the stats snapshot ONCE from cheap counts/aggregates. Every value a
 * catalog criterion can read lives here so each evaluation is a single
 * parallel round-trip, not a query per achievement.
 */
export async function buildStats(
  prisma: PrismaClient,
  userId: string,
): Promise<AchievementStats> {
  const [
    profile,
    questCompletions,
    workouts,
    mediaDone,
    interactions,
    milestonesDone,
    transactions,
    eddiesAgg,
    purchases,
  ] = await Promise.all([
    prisma.playerProfile.findUnique({
      where: { userId },
      select: {
        level: true,
        currentStreak: true,
        longestStreak: true,
        overclockStreak: true,
        cosmetics: true,
      },
    }),
    prisma.questCompletion.count({ where: { userId } }),
    prisma.workoutSession.count({ where: { userId } }),
    prisma.mediaItem.count({ where: { userId, status: 'done' } }),
    prisma.interaction.count({ where: { userId } }),
    prisma.milestone.count({ where: { userId, done: true } }),
    prisma.transaction.count({ where: { userId } }),
    prisma.walletLedger.aggregate({
      where: { userId, amount: { gt: 0 } },
      _sum: { amount: true },
    }),
    prisma.purchase.findMany({ where: { userId }, select: { category: true } }),
  ]);

  const overclockStreak = profile?.overclockStreak ?? 0;

  return {
    level: profile?.level ?? 1,
    currentStreak: profile?.currentStreak ?? 0,
    longestStreak: profile?.longestStreak ?? 0,
    overclockStreak,
    overclockMultiplier: overclockMultiplier(overclockStreak),
    cosmeticsCount: parseCosmeticsCount(profile?.cosmetics),
    questCompletions,
    workouts,
    mediaDone,
    interactions,
    milestonesDone,
    transactions,
    lifetimeEddiesEarned: eddiesAgg._sum.amount ?? 0,
    purchasesCount: purchases.length,
    purchaseCategories: new Set(purchases.map(p => p.category)),
  };
}

/**
 * Lazy unlock pass. For every catalog entry whose key is not already
 * unlocked and whose criteria now hold, create the UserAchievement row and
 * bank its reward — both inside one transaction so the award only happens
 * when the row is genuinely new. Idempotent across concurrent/repeated
 * calls via the @@unique([userId,key]) constraint (P2002 swallowed).
 */
export async function evaluateAchievements(
  prisma: PrismaClient,
  game: GamificationService,
  userId: string,
): Promise<UnlockedAchievement[]> {
  const existing = await prisma.userAchievement.findMany({
    where: { userId },
    select: { key: true },
  });
  const unlocked = new Set(existing.map(r => r.key));

  // Nothing left to earn — skip the (potentially expensive) stats build.
  if (unlocked.size >= ACHIEVEMENTS.length) return [];

  const stats = await buildStats(prisma, userId);
  const newlyUnlocked: UnlockedAchievement[] = [];

  for (const def of ACHIEVEMENTS) {
    if (unlocked.has(def.key)) continue;
    if (!def.criteria(stats)) continue;

    let created = true;
    try {
      await prisma.$transaction(async (tx) => {
        try {
          await tx.userAchievement.create({
            data: {
              userId,
              key: def.key,
              meta: JSON.stringify({ achievement: def.key, tier: def.tier }),
            },
          });
        } catch (err) {
          // Already unlocked (race / concurrent evaluate) — swallow and skip
          // the award so we never double-grant.
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            created = false;
            return;
          }
          throw err;
        }

        await game.awardXp(
          userId,
          {
            amount: def.xpReward ?? 0,
            eddies: def.eddieReward ?? 0,
            reason: 'achievement',
            module: 'achievements',
            refType: 'achievement',
            refId: def.key,
            touchStreak: false,
            meta: { achievement: def.key },
          },
          tx,
        );
      });
    } catch {
      // Defensive: a unique-violation surfaced from the outer tx boundary
      // (rare). Treat as already-unlocked and skip without double-awarding.
      created = false;
    }

    if (created) {
      newlyUnlocked.push({
        key: def.key,
        name: def.name,
        icon: def.icon,
        xpReward: def.xpReward,
        eddieReward: def.eddieReward,
      });
    }
  }

  // Handler reacts to each fresh badge (after-commit, fire-and-forget).
  for (const a of newlyUnlocked) {
    void emitHandlerEvent(prisma, userId, { type: 'achievement_unlocked', name: a.name, key: a.key });
  }

  return newlyUnlocked;
}
