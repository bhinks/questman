/**
 * QuestEngine — daily quest generation.
 *
 * Flow:
 *   1. buildCandidates(): deterministic scan of habits/chores/goals/
 *      workouts/finance → array of QuestCandidates. Each candidate
 *      carries a server-assigned xpReward.
 *   2. generateDaily(): if config.anthropic.apiKey is set, ask Claude
 *      to SELECT and THEME candidates. Validate the response; on any
 *      failure, fall back to a deterministic rule-based pick.
 *   3. persist(): create Quest rows inside one $transaction, guarded
 *      by DailyQuestRun's @@unique([userId, runDate]).
 *
 * Idempotency:
 *   - ensureToday(): only one (userId, today) DailyQuestRun ever exists.
 *     If we lose the race (P2002 on the run), we just read existing.
 *   - Quest @@unique([userId, questDate, source, sourceId]) is a second
 *     safety net against duplicates.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { config } from '../config';
import { logger } from '../utils/logger';
import { startOfLocalDay, daysAgoLocal } from '../utils/dates';
import { generateThemedQuests, QuestCandidate, ThemedQuest } from './anthropic';
import { WeatherService, WeatherSnapshot } from './WeatherService';
import { isHabitDueToday } from '../routes/habits';
// Pluggable per-pool candidate builders (phase 2). Each is owned by its
// domain route; the engine just concatenates their output.
import { buildProjectCandidates } from '../routes/projects';
import { buildMediaCandidates } from '../routes/media';
import { buildVitalsCandidates } from '../routes/metrics';
import { buildNpcCandidates } from '../routes/npcs';

type Tx = Prisma.TransactionClient;

// Difficulty → XP. Easy fall-back values for non-habit candidates that
// don't carry their own baseXp.
const XP_BY_DIFFICULTY: Record<'easy' | 'medium' | 'hard', number> = {
  easy: 15,
  medium: 30,
  hard: 50,
};

const FALLBACK_NAMES: Record<string, string[]> = {
  habits:  ['Daily Ritual', 'Routine Check', 'Habit Loop', 'Signal Boost'],
  chores:  ['Domestic Ops', 'Maintenance Cycle', 'Housekeeping Sweep'],
  fitness: ['Iron Tempo', 'Pulse Protocol', 'Cardio Run', 'Strength Set'],
  finance: ['Capital Review', 'Spend Audit', 'Budget Patrol', 'Ledger Sweep'],
};

function pick<T>(arr: T[], seed: number): T {
  return arr[Math.abs(seed) % arr.length];
}

export interface GenerateResult {
  generated: boolean;       // true = freshly created, false = already existed
  generator: 'ai' | 'rule' | 'ai-fallback';
  questCount: number;
}

export class QuestEngine {
  private weather = new WeatherService();

  constructor(private prisma: PrismaClient) {}

  /**
   * Lazy entry point: caller is the first request hitting `today`.
   * Atomic create-or-noop guarded by DailyQuestRun's unique constraint.
   */
  async ensureToday(userId: string): Promise<GenerateResult> {
    const today = startOfLocalDay();

    // Race: try to claim "this user generated today's run". P2002 = lost.
    try {
      await this.prisma.dailyQuestRun.create({
        data: { userId, runDate: today, generator: 'rule' },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        // Another request already generated. Return existing count.
        const count = await this.prisma.quest.count({
          where: { userId, questDate: today },
        });
        return { generated: false, generator: 'rule', questCount: count };
      }
      throw err;
    }

    // Carry-over + expiry of yesterday's pending quests (roadmap §5).
    // Quests flagged carryOver (or mustDo, which always carries) roll
    // forward to today by moving their questDate; everything else
    // expires. Carrying happens BEFORE generation so today's fresh
    // candidates that dup a carried source get skipped by the Quest
    // @@unique([userId, questDate, source, sourceId]) guard.
    const yesterday = daysAgoLocal(1);
    await this.prisma.quest.updateMany({
      where: {
        userId, questDate: yesterday, status: 'pending',
        OR: [{ carryOver: true }, { mustDo: true }],
      },
      data: { questDate: today },
    });
    await this.prisma.quest.updateMany({
      where: { userId, questDate: yesterday, status: 'pending' },
      data: { status: 'expired' },
    });

    // Build candidates, theme, persist.
    const candidates = await this.buildCandidates(userId, today);
    if (candidates.length === 0) {
      logger.info(`[QuestEngine] no candidates for user ${userId} today`);
      return { generated: true, generator: 'rule', questCount: 0 };
    }

    const player = await this.prisma.playerProfile.findUnique({
      where: { userId },
      select: { level: true, currentStreak: true },
    });

    const themed = await generateThemedQuests(candidates, {
      level: player?.level ?? 1,
      currentStreak: player?.currentStreak ?? 0,
      date: today,
    });

    let generator: GenerateResult['generator'];
    let chosen: { candidate: QuestCandidate; theme: ThemedQuest | null }[];

    if (themed && themed.quests.length > 0) {
      generator = 'ai';
      const byId = new Map(candidates.map(c => [c.candidateId, c]));
      chosen = themed.quests
        .map(q => ({ candidate: byId.get(q.candidateId)!, theme: q }))
        .filter(p => p.candidate);
    } else {
      // Fallback: pick top N candidates by a fixed priority.
      generator = config.anthropic.apiKey ? 'ai-fallback' : 'rule';
      chosen = this.pickFallback(candidates).map(c => ({ candidate: c, theme: null }));
    }

    // Persist inside one transaction.
    await this.prisma.$transaction(async (tx) => {
      for (const { candidate, theme } of chosen) {
        try {
          await tx.quest.create({
            data: {
              userId,
              moduleId: await this.moduleIdFor(tx, userId, candidate.moduleKey),
              questDate: today,
              title: theme?.title ?? this.fallbackTitle(candidate),
              description: theme?.description ?? candidate.baseTitle,
              difficulty: candidate.difficulty,
              xpReward: candidate.xpReward,
              source: candidate.source,
              sourceId: candidate.sourceId,
              habitId: candidate.source === 'habit' ? candidate.sourceId : null,
              goalId: candidate.source === 'goal' ? candidate.sourceId : null,
              status: 'pending',
              target: 1,
              progress: 0,
              isAiThemed: !!theme,
              meta: this.buildMeta(candidate, theme, themed?.flavor),
              // Planner fields (roadmap §5).
              estMinutes: candidate.estMinutes ?? null,
              targetCount: candidate.targetCount ?? 1,
              currentCount: 0,
              carryOver: candidate.carryOver ?? false,
              mustDo: candidate.mustDo ?? false,
              originDate: today,
            },
          });
        } catch (err: any) {
          // Duplicate (same source/sourceId already in another quest) — skip.
          if (err?.code !== 'P2002') throw err;
        }
      }
      // Update the run row with the generator + count.
      await tx.dailyQuestRun.update({
        where: { userId_runDate: { userId, runDate: today } },
        data: {
          generator,
          questCount: chosen.length,
          meta: themed ? JSON.stringify({ flavor: themed.flavor, model: config.anthropic.model }) : null,
        },
      });
    });

    return { generated: true, generator, questCount: chosen.length };
  }

  /** Force-regenerate today (dev only; the route guards this). */
  async regenerateToday(userId: string): Promise<GenerateResult> {
    const today = startOfLocalDay();
    await this.prisma.$transaction([
      this.prisma.quest.deleteMany({ where: { userId, questDate: today } }),
      this.prisma.dailyQuestRun.deleteMany({ where: { userId, runDate: today } }),
    ]);
    return this.ensureToday(userId);
  }

  // -------------------------------------------------------------------
  // Candidate assembly
  // -------------------------------------------------------------------

  async buildCandidates(userId: string, date: Date): Promise<QuestCandidate[]> {
    const out: QuestCandidate[] = [];
    let counter = 0;
    const nextId = () => `cand_${date.getTime()}_${counter++}`;

    // --- Habits & chores due today, not yet completed ---
    const habits = await this.prisma.habit.findMany({
      where: { userId, isActive: true },
    });
    const completedToday = new Set(
      (await this.prisma.habitCompletion.findMany({
        where: { userId, completedOn: date },
        select: { habitId: true },
      })).map(c => c.habitId),
    );

    // Fetch one weather snapshot for the whole batch, but only if some
    // habit actually has an outdoor rule (avoids a needless API call).
    const anyOutdoor = habits.some(h => WeatherService.parseRule(h.weatherRule) !== null);
    const snapshot: WeatherSnapshot | null = anyOutdoor
      ? await this.weather.getSnapshot()
      : null;

    for (const h of habits) {
      if (completedToday.has(h.id)) continue;
      if (!isHabitDueToday(h as any, date)) continue;
      // Min-interval throttle: skip if it was done too recently.
      if (!this.intervalOk(h, date)) continue;

      // Outdoor habits: gate on weather, and capture the best window so
      // Claude can theme the timing into the quest.
      let bestWindow: string | undefined;
      const rule = WeatherService.parseRule(h.weatherRule);
      if (rule) {
        const verdict = this.weather.evaluate(rule, snapshot);
        if (!verdict.ok) continue;
        bestWindow = verdict.bestWindow;
      }

      const moduleKey = h.kind === 'chore' ? 'chores' : 'habits';
      out.push({
        candidateId: nextId(),
        source: 'habit',
        sourceId: h.id,
        moduleKey,
        baseTitle: h.title,
        difficulty: h.difficulty as 'easy' | 'medium' | 'hard',
        xpReward: h.baseXp,
        context: h.currentStreak >= 3
          ? `${h.currentStreak}-day streak at risk`
          : undefined,
        bestWindow,
        // Planner attributes: time estimate + per-day target as a check-in
        // counter. Chores are punt-able (carry over); daily habits aren't
        // (a missed day is a missed day).
        estMinutes: h.estMinutes ?? undefined,
        targetCount: h.targetPerDay > 1 ? h.targetPerDay : undefined,
        carryOver: h.kind === 'chore',
      });
    }

    // Goals are retired (Brent chose: Projects supersede Goals). The Goal
    // table is kept for data safety but no longer generates candidates.

    // --- New quest pools (phase 2): projects, media, vitals, social. ---
    // Each builder is owned by its domain route; the engine just merges.
    const poolBuilders = [
      buildProjectCandidates,
      buildMediaCandidates,
      buildVitalsCandidates,
      buildNpcCandidates,
    ];
    for (const build of poolBuilders) {
      try {
        const poolCands = await build(this.prisma, userId, date, nextId);
        out.push(...poolCands);
      } catch (err: any) {
        // A misbehaving pool builder must never block quest generation.
        logger.warn(`[QuestEngine] pool builder failed: ${err?.message ?? err}`);
      }
    }

    // --- Fitness: "log a workout today" if none yet ---
    const workoutToday = await this.prisma.workoutSession.findFirst({
      where: { userId, performedAt: { gte: date } },
      select: { id: true },
    });
    if (!workoutToday) {
      out.push({
        candidateId: nextId(),
        source: 'workout',
        sourceId: null,
        moduleKey: 'fitness',
        baseTitle: 'Log a workout',
        difficulty: 'medium',
        xpReward: XP_BY_DIFFICULTY.medium,
      });
    }

    // --- Finance: top 1-2 active WastefulPattern rows, if any. ---
    const wasteful = await this.prisma.wastefulPattern.findMany({
      where: { userId, isActive: true, isAcknowledged: false },
      orderBy: { amount: 'desc' },
      take: 2,
    });
    for (const w of wasteful) {
      const diff: 'easy' | 'medium' | 'hard' =
        w.amount > 100 ? 'hard' : w.amount > 30 ? 'medium' : 'easy';
      out.push({
        candidateId: nextId(),
        source: 'finance',
        sourceId: w.id,
        moduleKey: 'finance',
        baseTitle: w.description,
        difficulty: diff,
        xpReward: XP_BY_DIFFICULTY[diff],
        context: `pattern: ${w.type}, ~$${w.amount.toFixed(2)}`,
      });
    }
    // Generic finance fallback if no wasteful patterns recorded.
    if (wasteful.length === 0) {
      const hasFinanceModule = await this.prisma.module.findUnique({
        where: { userId_key: { userId, key: 'finance' } },
        select: { id: true, isEnabled: true },
      });
      if (hasFinanceModule?.isEnabled) {
        const hasTransactions = await this.prisma.transaction.count({
          where: { userId },
        });
        if (hasTransactions > 0) {
          out.push({
            candidateId: nextId(),
            source: 'finance',
            sourceId: null,
            moduleKey: 'finance',
            baseTitle: 'Review the day\'s spending',
            difficulty: 'easy',
            xpReward: XP_BY_DIFFICULTY.easy,
          });
        }
      }
    }

    return out;
  }

  // -------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------

  /**
   * Fallback selection when the AI path is unavailable. Picks for
   * VARIETY: round-robin across modules so no single domain (projects,
   * media, vitals, social, …) gets starved by the cap — the bug the old
   * flat "score then slice(0,5)" had once we added pools. Within a
   * module, streak-at-risk and must-do candidates come first. Must-do
   * candidates are always included, even past the cap.
   */
  private pickFallback(cands: QuestCandidate[]): QuestCandidate[] {
    const CAP = 8;
    const within = (c: QuestCandidate): number => {
      if (c.mustDo) return 0;
      if (c.source === 'habit' && c.context?.includes('streak at risk')) return 0;
      return 1;
    };

    // Group by module, ordered within each module by priority.
    const byModule = new Map<string, QuestCandidate[]>();
    for (const c of cands) {
      const arr = byModule.get(c.moduleKey) ?? [];
      arr.push(c);
      byModule.set(c.moduleKey, arr);
    }
    for (const arr of byModule.values()) arr.sort((a, b) => within(a) - within(b));

    // Round-robin one per module until the cap is reached.
    const queues = [...byModule.values()];
    const out: QuestCandidate[] = [];
    let i = 0;
    while (out.length < CAP && queues.some(q => q.length > 0)) {
      const q = queues[i % queues.length];
      if (q.length > 0) out.push(q.shift()!);
      i++;
    }

    // Guarantee must-do candidates make the cut.
    for (const c of cands) {
      if (c.mustDo && !out.includes(c)) out.push(c);
    }
    return out;
  }

  /**
   * Min-interval throttle. True when the habit may fire today: either it
   * has no interval set, was never completed, or enough whole local days
   * have elapsed since the last completion.
   */
  private intervalOk(
    h: { minIntervalDays: number | null; lastCompletedOn: Date | null },
    today: Date,
  ): boolean {
    if (!h.minIntervalDays || !h.lastCompletedOn) return true;
    const last = startOfLocalDay(new Date(h.lastCompletedOn));
    const daysSince = Math.round((today.getTime() - last.getTime()) / 86_400_000);
    return daysSince >= h.minIntervalDays;
  }

  private fallbackTitle(c: QuestCandidate): string {
    const names = FALLBACK_NAMES[c.moduleKey] ?? FALLBACK_NAMES.habits;
    return pick(names, c.candidateId.length);
  }

  /**
   * Build the Quest.meta JSON. Carries theming (emoji/flavor) when the
   * AI path ran, plus the weather window for outdoor habits regardless
   * of theming so the UI can show the "🌤 2pm" pill either way.
   */
  private buildMeta(
    candidate: QuestCandidate,
    theme: ThemedQuest | null,
    flavor: string | undefined,
  ): string | null {
    const meta: Record<string, unknown> = {};
    if (theme) {
      meta.emoji = theme.emoji;
      if (flavor) meta.flavor = flavor;
    }
    if (candidate.bestWindow) meta.bestWindow = candidate.bestWindow;
    return Object.keys(meta).length > 0 ? JSON.stringify(meta) : null;
  }

  private async moduleIdFor(tx: Tx, userId: string, key: string): Promise<string> {
    const mod = await tx.module.findUnique({
      where: { userId_key: { userId, key } },
      select: { id: true },
    });
    if (!mod) {
      throw new Error(`Module "${key}" missing for user ${userId} — re-run seed`);
    }
    return mod.id;
  }
}
