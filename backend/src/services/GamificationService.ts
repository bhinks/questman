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

type Tx = Prisma.TransactionClient;

export interface AwardOptions {
  amount: number;     // XP delta (+ve earn, -ve correction)
  eddies?: number;    // eddie delta (+ve earn, -ve spend/correction). 0/undefined = none.
  reason: string;     // "quest_complete" | "habit_log" | "workout_log" | "streak_bonus" | ...
  module?: string;    // e.g. "fitness" for domainXp rollups
  refType?: string;   // "quest" | "habit" | "workout"
  refId?: string;
  meta?: Record<string, unknown>;
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
  leveledUp?: boolean;
  previousLevel?: number;
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
    const [p, totalXp, eddies, domainXp] = await Promise.all([
      this.prisma.playerProfile.findUniqueOrThrow({ where: { userId } }),
      this.sumXp(userId, this.prisma),
      this.sumEddies(userId, this.prisma),
      this.domainXpFromLedger(userId, this.prisma),
    ]);
    const info = levelInfo(totalXp);
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
    };
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
      const eddiesDelta = opts.eddies ?? 0;

      const previousLevel = levelFromXp(prevTotalXp);
      const nextTotalXp = prevTotalXp + opts.amount;
      const nextEddies = prevEddies + eddiesDelta;
      const nextLevel = levelFromXp(nextTotalXp);

      // Streak math (against local day, server tz).
      const today = startOfLocalDay();
      let currentStreak = before.currentStreak;
      let longestStreak = before.longestStreak;
      const last = before.lastActiveOn;
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

      // Append the XP ledger entry FIRST so a partial write at least
      // leaves an audit trail that can be replayed.
      await t.xpLedger.create({
        data: {
          userId,
          amount: opts.amount,
          reason: opts.reason,
          module: opts.module ?? null,
          refType: opts.refType ?? null,
          refId: opts.refId ?? null,
          meta: opts.meta ? JSON.stringify(opts.meta) : null,
        },
      });

      // Parallel eddie ledger entry, when this award moves the wallet.
      if (eddiesDelta !== 0) {
        await t.walletLedger.create({
          data: {
            userId,
            amount: eddiesDelta,
            reason: opts.reason,
            module: opts.module ?? null,
            refType: opts.refType ?? null,
            refId: opts.refId ?? null,
            meta: opts.meta ? JSON.stringify(opts.meta) : null,
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
          lastActiveOn: today,
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
        lastActiveOn: today,
        domainXp,
        title: before.title,
        leveledUp: nextLevel > previousLevel,
        previousLevel,
      } satisfies PlayerSnapshot;
    };

    const snapshot = tx ? await run(tx) : await this.prisma.$transaction(run);
    this.broadcastPlayer(userId, snapshot);
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
