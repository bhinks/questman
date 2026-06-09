/**
 * GamificationService — the single point of truth for XP, streaks, and
 * level changes. Routes call into this; they never write XP themselves.
 *
 * Why centralized:
 *   - One place where the XP economy is enforced (the AI quest engine
 *     proposes quests but the server assigns rewards, see QuestEngine).
 *   - Idempotency: completing the same quest twice awards XP once.
 *   - Atomicity: XP + streak + level transitions happen inside a
 *     single $transaction so a crash can't desync them.
 *   - One place to fire socket broadcasts (player-updated,
 *     quest-completed) so the frontend HUD animates without a refetch.
 */

import { Prisma, PrismaClient } from '@prisma/client';
import { levelFromXp, levelInfo } from '../utils/leveling';
import { isSameLocalDay, isYesterdayLocal, startOfLocalDay } from '../utils/dates';

type Tx = Prisma.TransactionClient;

export interface AwardOptions {
  amount: number;
  reason: string;     // "quest_complete" | "habit_log" | "workout_log" | "streak_bonus" | "level_up"
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
  currentStreak: number;
  longestStreak: number;
  lastActiveOn: Date | null;
  domainXp: Record<string, number>;
  title: string | null;
  leveledUp?: boolean;
  previousLevel?: number;
}

/** Parse the JSON-as-String domain rollup safely. */
function parseDomainXp(raw: string | null | undefined): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
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

  /**
   * Project the player profile into the shape the API and the
   * frontend HUD consume. Pure read; safe outside a transaction.
   */
  async getSnapshot(userId: string): Promise<PlayerSnapshot> {
    await this.ensurePlayer(userId);
    const p = await this.prisma.playerProfile.findUniqueOrThrow({
      where: { userId },
    });
    const info = levelInfo(p.totalXp);
    return {
      level: info.level,
      totalXp: info.totalXp,
      xpIntoLevel: info.xpIntoLevel,
      xpForNextLevel: info.xpForNextLevel,
      progress: info.progress,
      currentStreak: p.currentStreak,
      longestStreak: p.longestStreak,
      lastActiveOn: p.lastActiveOn,
      domainXp: parseDomainXp(p.domainXp),
      title: p.title,
    };
  }

  /**
   * Award XP, update streak, recompute level. Use this from any
   * "user did something XP-worthy" path (quest complete, habit check,
   * workout log). Append-only XpLedger entry for audit.
   *
   * Streak rule: the global daily-activity streak ticks once per local
   * day. Activity yesterday → +1. Activity today (already counted) →
   * unchanged. Older / never → reset to 1.
   *
   * Returns a snapshot of the player after the change, with
   * `leveledUp`/`previousLevel` set when crossing a level boundary.
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

      const previousLevel = levelFromXp(before.totalXp);
      const nextTotal = before.totalXp + opts.amount;
      const nextLevel = levelFromXp(nextTotal);

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

      // Domain rollup.
      const domainXp = parseDomainXp(before.domainXp);
      if (opts.module) {
        domainXp[opts.module] = (domainXp[opts.module] ?? 0) + opts.amount;
      }

      // Append the ledger entry FIRST so a partial write at least
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

      const updated = await t.playerProfile.update({
        where: { userId },
        data: {
          totalXp: nextTotal,
          level: nextLevel,
          xpIntoLevel: levelInfo(nextTotal).xpIntoLevel,
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

      const info = levelInfo(updated.totalXp);
      return {
        level: info.level,
        totalXp: info.totalXp,
        xpIntoLevel: info.xpIntoLevel,
        xpForNextLevel: info.xpForNextLevel,
        progress: info.progress,
        currentStreak: updated.currentStreak,
        longestStreak: updated.longestStreak,
        lastActiveOn: updated.lastActiveOn,
        domainXp: parseDomainXp(updated.domainXp),
        title: updated.title,
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
