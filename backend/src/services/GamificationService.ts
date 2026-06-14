/**
 * GamificationService — the single point of truth for XP, eddies,
 * streaks, and level changes. Routes call into this; they never write
 * the economy themselves.
 *
 * Why centralized:
 *   - One place where the XP/eddie economy is enforced (the AI quest
 *     engine proposes quests but the server assigns rewards).
 *   - Idempotency: completing the same quest twice awards once.
 *   - Atomicity: ledger + cache + streak + level transitions happen
 *     inside a single $transaction so a crash can't desync them.
 *   - One place to fire socket broadcasts so the HUD animates.
 *
 * Source of truth: the **ledgers are authoritative**. A player's XP/level
 * and eddie balance are derived from SUM(XpLedger) / SUM(WalletLedger),
 * not from the cached counters on PlayerProfile. The cached counters are
 * a denormalization kept in lockstep for convenience, but every read
 * goes back to the ledger — so an earned grant survives the deletion of
 * whatever task produced it (roadmap: "level comes from XpLedger always").
 */

import { Prisma, PrismaClient } from '@prisma/client';
import { levelFromXp, levelInfo } from '../utils/leveling';
import { isSameLocalDay, isYesterdayLocal, startOfLocalDay } from '../utils/dates';
import {
  overclockMultiplier, xpStreakBonus,
  energyTierFromSleep, energyPctForTier, energyPctFromSleep, EnergyTier,
} from '../utils/economy';
import { emitHandlerEvent, STREAK_MILESTONES } from './handlerEvents';

/** Reasons that are NOT subject to the overclock multiplier: spends and
 *  corrections (must pass through raw), plus achievement payouts (one-time
 *  fixed rewards — the amount in the catalog is exactly what you get,
 *  regardless of your current overclock streak). */
const NON_EARN_REASONS = new Set(['shop_purchase', 'rr_redeem', 'achievement']);
function isEddieEarn(reason: string, eddies: number): boolean {
  return eddies > 0 && !reason.endsWith('_undo') && !NON_EARN_REASONS.has(reason);
}

function parseCosmetics(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

type Tx = Prisma.TransactionClient;

export interface AwardOptions {
  amount: number;     // XP delta (+ve earn, -ve correction)
  eddies?: number;    // eddie delta (+ve earn, -ve spend/correction). 0/undefined = none.
  reason: string;     // "quest_complete" | "habit_log" | "workout_log" | "streak_bonus" | ...
  module?: string;    // e.g. "fitness" for domainXp rollups
  refType?: string;   // "quest" | "habit" | "workout"
  refId?: string;
  meta?: Record<string, unknown>;
  /**
   * Whether this award counts as daily activity for the streak. Default
   * true. Set false for economy moves that aren't "doing something" —
   * shop purchases/spends and lazily-evaluated achievement grants — so
   * they never tick the streak or move lastActiveOn (otherwise merely
   * opening the HUD could maintain a streak).
   */
  touchStreak?: boolean;
}

export interface PlayerSnapshot {
  level: number;
  totalXp: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  progress: number;
  eddies: number;
  currentStreak: number;
  longestStreak: number;
  lastActiveOn: Date | null;
  domainXp: Record<string, number>;
  title: string | null;
  // Economy & rewards.
  overclockStreak: number;
  overclockMultiplier: number;
  skipTokens: number;
  rerollTokens: number;
  rrCredits: number;
  // Night Market consumables.
  streakShields: number;
  boosterUntil: Date | null;    // Overdrive Chip expiry (2× eddies while future)
  budgetBoostOn: Date | null;   // Time Dilation day (+2h planner budget)
  cosmetics: string[];
  equippedTheme: string | null;
  equippedFont: string | null;  // display-font pack (Night Market)
  equippedFx: string | null;    // LEGACY single-equip FX pack (superseded by fxActive)
  equippedTimer: string | null; // CHRONO session-timer style (Night Market)
  // Night Market v2 gear slots.
  equippedShell: string | null; // OS shell ('tty'|'outrun'; null = Night City)
  equippedTitle: string | null; // vanity title key on the runner ID
  equippedPet: string | null;   // data-pet key in the nav deck
  fxActive: string[];           // STACKABLE visual FX currently online
  focusStims: number;           // banked FOCUS STIMs (effect TBD)
  overclockChips: number;       // banked OVERCLOCK CHIPs (effect TBD)
  /** Daily capacity/battery (World Mechanics). Optional: only the read path
   *  (getSnapshot) computes it; awardXp leaves it undefined to avoid an extra
   *  per-award query — the HUD reads it from GET /api/player. */
  energy?: {
    tier: EnergyTier;
    pct: number;          // 0–100 for the battery bar
    source: 'override' | 'sleep' | 'default';
    sleepHours: number | null;
  };
  leveledUp?: boolean;
  previousLevel?: number;
  /** Set on awardXp when the overclock multiplier boosted this eddie earn. */
  eddieMultiplierApplied?: number;
  /** True when THIS award ticked the daily streak (first activity of the day).
   *  Lets callers fire a one-shot streak-milestone reaction without re-reading. */
  streakAdvanced?: boolean;
}

export class GamificationService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Get-or-create the player profile (one per user). Safe to call from
   * any code path; we never create the User here.
   */
  async ensurePlayer(userId: string, tx?: Tx): Promise<{ id: string }> {
    const db = tx ?? this.prisma;
    const existing = await db.playerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (existing) return existing;
    return db.playerProfile.create({
      data: { userId },
      select: { id: true },
    });
  }

  /** SUM(XpLedger.amount) — the authoritative total XP. */
  private async sumXp(userId: string, db: Tx | PrismaClient): Promise<number> {
    const agg = await db.xpLedger.aggregate({
      where: { userId },
      _sum: { amount: true },
    });
    return agg._sum.amount ?? 0;
  }

  /** SUM(WalletLedger.amount) — the authoritative eddie balance. */
  private async sumEddies(userId: string, db: Tx | PrismaClient): Promise<number> {
    const agg = await db.walletLedger.aggregate({
      where: { userId },
      _sum: { amount: true },
    });
    return agg._sum.amount ?? 0;
  }

  /** Per-domain XP rollup, derived from the ledger's `module` column. */
  private async domainXpFromLedger(
    userId: string,
    db: Tx | PrismaClient,
  ): Promise<Record<string, number>> {
    const rows = await db.xpLedger.groupBy({
      by: ['module'],
      where: { userId, module: { not: null } },
      _sum: { amount: true },
    });
    const out: Record<string, number> = {};
    for (const r of rows) {
      if (r.module) out[r.module] = r._sum.amount ?? 0;
    }
    return out;
  }

  /**
   * Project the player profile into the shape the API and the frontend
   * HUD consume. XP/level/eddies/domainXp are derived from the ledgers;
   * streak/title come from the profile. Pure read; safe outside a tx.
   */
  async getSnapshot(userId: string): Promise<PlayerSnapshot> {
    await this.ensurePlayer(userId);
    const today = startOfLocalDay();
    const [p, totalXp, eddies, domainXp, sleepMetric] = await Promise.all([
      this.prisma.playerProfile.findUniqueOrThrow({ where: { userId } }),
      this.sumXp(userId, this.prisma),
      this.sumEddies(userId, this.prisma),
      this.domainXpFromLedger(userId, this.prisma),
      this.prisma.dailyMetric.findFirst({
        where: { userId, key: 'sleepHours', date: today },
        select: { value: true },
      }),
    ]);
    const info = levelInfo(totalXp);
    const energy = this.computeEnergy(p, sleepMetric?.value ?? null, today);
    return {
      level: info.level,
      totalXp: info.totalXp,
      xpIntoLevel: info.xpIntoLevel,
      xpForNextLevel: info.xpForNextLevel,
      progress: info.progress,
      eddies,
      currentStreak: p.currentStreak,
      longestStreak: p.longestStreak,
      lastActiveOn: p.lastActiveOn,
      domainXp,
      title: p.title,
      overclockStreak: p.overclockStreak,
      overclockMultiplier: overclockMultiplier(p.overclockStreak),
      skipTokens: p.skipTokens,
      rerollTokens: p.rerollTokens,
      rrCredits: p.rrCredits,
      streakShields: p.streakShields,
      boosterUntil: p.boosterUntil,
      budgetBoostOn: p.budgetBoostOn,
      cosmetics: parseCosmetics(p.cosmetics),
      equippedTheme: p.equippedTheme,
      equippedFont: p.equippedFont,
      equippedFx: p.equippedFx,
      equippedTimer: p.equippedTimer,
      equippedShell: p.equippedShell,
      equippedTitle: p.equippedTitle,
      equippedPet: p.equippedPet,
      fxActive: parseCosmetics(p.fxActive),
      focusStims: p.focusStims,
      overclockChips: p.overclockChips,
      energy,
    };
  }

  /**
   * Derive the daily energy/battery (World Mechanics). A manual override
   * pinned to today wins; otherwise we map today's logged sleep to a tier;
   * with no data we sit at a neutral "med". Light by design — informational
   * + a soft planner nudge, never a hard gate.
   */
  private computeEnergy(
    p: { energyOverride: string | null; energyOverrideOn: Date | null },
    sleepHours: number | null,
    today: Date,
  ): PlayerSnapshot['energy'] {
    const override = p.energyOverride as EnergyTier | null;
    if (override && p.energyOverrideOn && isSameLocalDay(p.energyOverrideOn, today)) {
      return { tier: override, pct: energyPctForTier(override), source: 'override', sleepHours };
    }
    if (sleepHours != null) {
      const tier = energyTierFromSleep(sleepHours);
      return { tier, pct: energyPctFromSleep(sleepHours), source: 'sleep', sleepHours };
    }
    return { tier: 'med', pct: energyPctForTier('med'), source: 'default', sleepHours: null };
  }

  /**
   * Award XP (and optionally eddies), update streak, recompute level.
   * Use from any "user did something rewardable" path. Writes append-only
   * ledger entries for audit; the ledgers are the source of truth.
   *
   * Streak rule: the global daily-activity streak ticks once per local
   * day. Activity yesterday → +1. Activity today (already counted) →
   * unchanged. Older / never → reset to 1.
   *
   * Returns a snapshot after the change, with `leveledUp`/`previousLevel`
   * set when crossing a level boundary.
   */
  async awardXp(
    userId: string,
    opts: AwardOptions,
    tx?: Tx,
  ): Promise<PlayerSnapshot> {
    const run = async (t: Tx) => {
      await this.ensurePlayer(userId, t);
      const before = await t.playerProfile.findUniqueOrThrow({
        where: { userId },
      });

      // Derive prior totals from the ledgers (authoritative), then apply
      // this award's deltas.
      const prevTotalXp = await this.sumXp(userId, t);
      const prevEddies = await this.sumEddies(userId, t);

      // XP streak bonus (quest completions only — Brent: no XP multiplier,
      // but a small streak bonus is fine).
      const streakBonus = opts.reason === 'quest_complete'
        ? xpStreakBonus(before.currentStreak) : 0;
      const xpDelta = opts.amount + streakBonus;

      // Overclock: boost positive eddie EARNS by the multiplier from the
      // full-clear-day streak. Spends/undos/corrections pass through raw.
      // The Overdrive Chip (Shop consumable) doubles eddie earns on top while
      // active — eddies only, XP stays honest (Brent's standing rule).
      const rawEddies = opts.eddies ?? 0;
      const mult = overclockMultiplier(before.overclockStreak);
      const earn = isEddieEarn(opts.reason, rawEddies);
      const boosted = earn && before.boosterUntil != null && before.boosterUntil > new Date();
      const eddiesDelta = earn ? Math.round(rawEddies * mult * (boosted ? 2 : 1)) : rawEddies;

      const previousLevel = levelFromXp(prevTotalXp);
      const nextTotalXp = prevTotalXp + xpDelta;
      const nextEddies = prevEddies + eddiesDelta;
      const nextLevel = levelFromXp(nextTotalXp);

      // Streak math (against local day, server tz). Economy moves that
      // aren't real activity (shop spends, lazy achievement grants) pass
      // touchStreak:false and leave the streak + lastActiveOn untouched.
      const today = startOfLocalDay();
      const touchStreak = opts.touchStreak !== false;
      let currentStreak = before.currentStreak;
      let longestStreak = before.longestStreak;
      const last = before.lastActiveOn;
      if (touchStreak) {
        if (!last) {
          currentStreak = 1;
        } else if (isSameLocalDay(last, today)) {
          // Already counted today; do nothing.
        } else if (isYesterdayLocal(last, today)) {
          currentStreak += 1;
        } else {
          currentStreak = 1;
        }
        if (currentStreak > longestStreak) longestStreak = currentStreak;
      }
      const nextLastActiveOn = touchStreak ? today : before.lastActiveOn;
      // First activity-bearing award of the local day → the streak ticked.
      const streakAdvanced = touchStreak && (!last || !isSameLocalDay(last, today));

      // Append the XP ledger entry FIRST so a partial write at least
      // leaves an audit trail that can be replayed.
      const xpMeta = { ...(opts.meta ?? {}), ...(streakBonus > 0 ? { streakBonus } : {}) };
      await t.xpLedger.create({
        data: {
          userId,
          amount: xpDelta,
          reason: opts.reason,
          module: opts.module ?? null,
          refType: opts.refType ?? null,
          refId: opts.refId ?? null,
          meta: Object.keys(xpMeta).length ? JSON.stringify(xpMeta) : null,
        },
      });

      // Parallel eddie ledger entry, when this award moves the wallet.
      if (eddiesDelta !== 0) {
        const edMeta = {
          ...(opts.meta ?? {}),
          ...(earn && mult > 1 ? { overclock: mult, base: rawEddies } : {}),
          ...(boosted ? { booster: 2, base: rawEddies } : {}),
        };
        await t.walletLedger.create({
          data: {
            userId,
            amount: eddiesDelta,
            reason: opts.reason,
            module: opts.module ?? null,
            refType: opts.refType ?? null,
            refId: opts.refId ?? null,
            meta: Object.keys(edMeta).length ? JSON.stringify(edMeta) : null,
          },
        });
      }

      // Keep the cached counters in lockstep with the ledgers.
      const domainXp = await this.domainXpFromLedger(userId, t);
      await t.playerProfile.update({
        where: { userId },
        data: {
          totalXp: nextTotalXp,
          level: nextLevel,
          xpIntoLevel: levelInfo(nextTotalXp).xpIntoLevel,
          eddies: nextEddies,
          currentStreak,
          longestStreak,
          lastActiveOn: nextLastActiveOn,
          domainXp: JSON.stringify(domainXp),
        },
      });

      // Emit a "level_up" audit row when the level changed.
      if (nextLevel > previousLevel) {
        await t.xpLedger.create({
          data: {
            userId,
            amount: 0,
            reason: 'level_up',
            meta: JSON.stringify({ from: previousLevel, to: nextLevel }),
          },
        });
      }

      const info = levelInfo(nextTotalXp);
      return {
        level: info.level,
        totalXp: info.totalXp,
        xpIntoLevel: info.xpIntoLevel,
        xpForNextLevel: info.xpForNextLevel,
        progress: info.progress,
        eddies: nextEddies,
        currentStreak,
        longestStreak,
        lastActiveOn: nextLastActiveOn,
        domainXp,
        title: before.title,
        overclockStreak: before.overclockStreak,
        overclockMultiplier: mult,
        skipTokens: before.skipTokens,
        rerollTokens: before.rerollTokens,
        rrCredits: before.rrCredits,
        streakShields: before.streakShields,
        boosterUntil: before.boosterUntil,
        budgetBoostOn: before.budgetBoostOn,
        cosmetics: parseCosmetics(before.cosmetics),
        equippedTheme: before.equippedTheme,
        equippedFont: before.equippedFont,
        equippedFx: before.equippedFx,
        equippedTimer: before.equippedTimer,
        equippedShell: before.equippedShell,
        equippedTitle: before.equippedTitle,
        equippedPet: before.equippedPet,
        fxActive: parseCosmetics(before.fxActive),
        focusStims: before.focusStims,
        overclockChips: before.overclockChips,
        leveledUp: nextLevel > previousLevel,
        previousLevel,
        eddieMultiplierApplied: earn && mult > 1 ? mult : undefined,
        streakAdvanced,
      } satisfies PlayerSnapshot;
    };

    const snapshot = tx ? await run(tx) : await this.prisma.$transaction(run);
    this.broadcastPlayer(userId, snapshot);

    // Handler reacts to progression milestones (after-commit, fire-and-forget;
    // gated/redacted inside emitHandlerEvent). One-shot per real transition.
    if (snapshot.leveledUp && snapshot.previousLevel != null) {
      void emitHandlerEvent(this.prisma, userId, { type: 'level_up', from: snapshot.previousLevel, to: snapshot.level });
    }
    if (snapshot.streakAdvanced && STREAK_MILESTONES.has(snapshot.currentStreak)) {
      void emitHandlerEvent(this.prisma, userId, { type: 'streak_milestone', days: snapshot.currentStreak });
    }

    return snapshot;
  }

  /**
   * Bump a habit's denormalized streak after a HabitCompletion is
   * recorded for `completedOn`. Same rules as the global streak.
   */
  async bumpHabitStreak(
    habitId: string,
    completedOn: Date,
    tx?: Tx,
  ): Promise<void> {
    const db = tx ?? this.prisma;
    const habit = await db.habit.findUnique({
      where: { id: habitId },
      select: {
        currentStreak: true,
        longestStreak: true,
        lastCompletedOn: true,
      },
    });
    if (!habit) return;

    let currentStreak = habit.currentStreak;
    let longestStreak = habit.longestStreak;
    const last = habit.lastCompletedOn;
    if (!last) {
      currentStreak = 1;
    } else if (isSameLocalDay(last, completedOn)) {
      // already incremented for today
    } else if (isYesterdayLocal(last, completedOn)) {
      currentStreak += 1;
    } else {
      currentStreak = 1;
    }
    if (currentStreak > longestStreak) longestStreak = currentStreak;

    await db.habit.update({
      where: { id: habitId },
      data: { currentStreak, longestStreak, lastCompletedOn: completedOn },
    });
  }

  /**
   * Broadcast the player snapshot via the global socket service. This
   * is a fire-and-forget call: the HTTP response is the source of
   * truth, the socket is just for live HUD animation.
   */
  private broadcastPlayer(userId: string, snapshot: PlayerSnapshot) {
    const ws = (globalThis as any).wsService;
    if (ws?.broadcastPlayerUpdate) {
      ws.broadcastPlayerUpdate(userId, snapshot);
    }
  }
}
