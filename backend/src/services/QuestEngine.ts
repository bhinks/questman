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
import { startOfLocalDay, daysAgoLocal, isSameLocalDay, startOfIsoWeek } from '../utils/dates';
import { isoWeekKey, eddiesForReward } from '../utils/economy';
import { AppError } from '../middleware/errorHandler';
import { GamificationService } from './GamificationService';
import { generateThemedQuests, QuestCandidate, ThemedQuest } from './anthropic';
import { WeatherService, WeatherSnapshot } from './WeatherService';
// Intelligence layer (phase 6): the Handler narrates the day + the weekly
// debrief; insights surface honest cross-domain patterns. All best-effort.
import { buildDailyDigest, buildWeeklyDigest } from './digest';
import { narrateDailyRundown, narrateWeeklyDebrief, asPersona } from './handler';
import { generateInsightsForWeek } from './insights';
import { isHabitDueToday } from '../routes/habits';
// Pluggable per-pool candidate builders (phase 2+). Each is owned by its
// domain route; the engine just concatenates their output.
import { buildProjectCandidates } from '../routes/projects';
import { buildMediaCandidates } from '../routes/media';
import { buildChainCandidates } from '../routes/chains';
import { buildVitalsCandidates } from '../routes/metrics';
import { buildNpcCandidates } from '../routes/npcs';
import { buildBudgetCandidates } from '../routes/budgets';
import { buildBillCandidates } from '../routes/recurring';

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
  // Lazy GamificationService for the once-per-day economy roll-over awards
  // (anti-goal clean-day credits). Lazy so we never instantiate it twice and
  // avoid any field-init ordering concerns with the prisma parameter prop.
  private _game: GamificationService | null = null;
  private get game(): GamificationService {
    return this._game ??= new GamificationService(this.prisma);
  }

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

    // Economy roll-over (overclock streak + weekly tokens + R&R credit).
    // MUST run before the carry-over/expire mutations below, because it
    // judges whether yesterday was a "full clear" from the quests' current
    // (pre-expiry) statuses.
    const yesterday = daysAgoLocal(1);
    // Daily roll-over: overclock/tokens/R&R, then anti-goal clean-day credit.
    // Both run here so they fire exactly once per local day (gated by the
    // DailyQuestRun claim above). Defensive: that run row is ALREADY committed,
    // so an unhandled throw here would strand the whole day (every later
    // request hits the P2002 read branch and returns 0 quests). Isolate it —
    // a roll-over hiccup must never block today's quest generation. Mirrors the
    // per-pool-builder guard below.
    try {
      await this.updateEconomyForNewDay(userId, today, yesterday);
      await this.processAntiGoalsForNewDay(userId, today, yesterday);
    } catch (err: any) {
      logger.warn(`[QuestEngine] daily roll-over failed for user ${userId}: ${err?.message ?? err}`);
    }

    // Carry-over + expiry of yesterday's pending quests (roadmap §5).
    // Quests flagged carryOver (or mustDo, which always carries) roll
    // forward to today by moving their questDate; everything else
    // expires. Carrying happens BEFORE generation so today's fresh
    // candidates that dup a carried source get skipped by the Quest
    // @@unique([userId, questDate, source, sourceId]) guard.
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

    // Intelligence layer: the Handler's daily rundown. FIRE-AND-FORGET — it
    // runs AFTER the quest tx commits and must not add a Claude call to the
    // /today response latency. It persists a HandlerMessage + broadcasts over
    // the socket, and the HUD ticker live-refreshes on that event, so the line
    // surfaces without blocking the page. generateDailyRundown swallows all
    // errors internally, so the detached promise never rejects. Gated once/day
    // by the DailyQuestRun claim above.
    void this.generateDailyRundown(userId, today);

    return { generated: true, generator, questCount: chosen.length };
  }

  /**
   * Persist the Handler's daily rundown (sardonic rogue-AI voice) for today.
   * Best-effort: any failure (feature off, no key, narration error) is
   * swallowed — the rundown is flavor, never load-bearing. The Handler only
   * NARRATES a server-computed digest; it never touches the economy.
   */
  private async generateDailyRundown(userId: string, today: Date): Promise<void> {
    if (!config.features.handler || !config.anthropic.apiKey) return;
    try {
      const settings = await this.prisma.userSettings.findUnique({
        where: { userId },
        select: { handlerEnabled: true, handlerPersona: true },
      });
      if (settings && settings.handlerEnabled === false) return;
      const persona = asPersona(settings?.handlerPersona);

      const digest = await buildDailyDigest(this.prisma, userId, today);
      const text = await narrateDailyRundown(digest, persona);
      if (!text) return;

      const msg = await this.prisma.handlerMessage.create({
        data: { userId, kind: 'daily_rundown', text, persona, refType: 'dailyQuestRun' },
      });
      const ws = (globalThis as any).wsService;
      ws?.broadcastGameEvent?.(userId, 'handler-message', { id: msg.id, kind: 'daily_rundown', text });
    } catch (err: any) {
      logger.warn(`[QuestEngine] daily rundown failed for user ${userId}: ${err?.message ?? err}`);
    }
  }

  /**
   * Generate the weekly debrief for the PREVIOUS complete ISO week, once.
   * Idempotent via WeeklyReview @@unique([userId, weekOf]) — the create is the
   * cross-process lock (mirrors DailyQuestRun). Called lazily from the today
   * route, so the first app-open of a new week produces last week's review.
   * Skips weeks with zero activity (no empty debriefs, no wasted Claude call).
   * Best-effort: never throws into the caller.
   */
  async ensureWeeklyReview(userId: string): Promise<void> {
    try {
      const thisWeekMonday = startOfIsoWeek();
      const weekStart = daysAgoLocal(7, thisWeekMonday); // previous Monday
      const weekEnd = thisWeekMonday;                     // exclusive

      // Already built? Cheap pre-check before the heavier digest work.
      const existing = await this.prisma.weeklyReview.findUnique({
        where: { userId_weekOf: { userId, weekOf: weekStart } },
        select: { id: true },
      });
      if (existing) return;

      // Activity gate: don't manufacture a debrief for a dead week.
      const activity = await this.prisma.xpLedger.count({
        where: { userId, createdAt: { gte: weekStart, lt: weekEnd } },
      });
      if (activity === 0) return;

      const digest = await buildWeeklyDigest(this.prisma, userId, weekStart, weekEnd);

      // The create is the idempotency guard. Loser of a race hits P2002.
      let review;
      try {
        review = await this.prisma.weeklyReview.create({
          data: { userId, weekOf: weekStart, statsJson: JSON.stringify(digest), status: 'draft' },
        });
      } catch (err: any) {
        if (err?.code === 'P2002') return; // another request already built it
        throw err;
      }

      // Insights (honest, deterministic) + the Handler's debrief narration.
      const findings = await generateInsightsForWeek(this.prisma, userId, weekStart);

      const settings = await this.prisma.userSettings.findUnique({
        where: { userId },
        select: { handlerEnabled: true, handlerPersona: true },
      });
      const handlerOn = config.features.handler && !!config.anthropic.apiKey && settings?.handlerEnabled !== false;
      const persona = asPersona(settings?.handlerPersona);
      const text = handlerOn ? await narrateWeeklyDebrief(digest, findings, persona) : null;

      if (text) {
        await this.prisma.weeklyReview.update({ where: { id: review.id }, data: { handlerText: text } });
        await this.prisma.handlerMessage.create({
          data: { userId, kind: 'weekly_debrief', text, persona, refType: 'weeklyReview', refId: review.id },
        });
        const ws = (globalThis as any).wsService;
        ws?.broadcastGameEvent?.(userId, 'handler-message', { id: review.id, kind: 'weekly_debrief', text });
      }
    } catch (err: any) {
      logger.warn(`[QuestEngine] weekly review failed for user ${userId}: ${err?.message ?? err}`);
    }
  }

  /**
   * Once-per-day economy roll-over (roadmap §"overclock" + skip/reroll
   * tokens + R&R credits). Called from ensureToday before carry-over/expiry.
   *
   *  - Overclock streak: a "full clear" of yesterday (≥1 completed quest,
   *    and nothing left pending that wasn't carried/must-do → i.e. no
   *    impending miss) bumps the streak and banks 1 R&R downtime credit.
   *    Any impending miss resets the streak ("cooling unstable"). A day of
   *    only skips/carries is neutral. The streak drives the eddie multiplier.
   *  - Weekly token allowance: once per ISO week, top up skip (+3, cap 10)
   *    and reroll (+1, cap 5) tokens. Idempotent via lastTokenGrantWeek.
   */
  private async updateEconomyForNewDay(userId: string, today: Date, yesterday: Date): Promise<void> {
    const profile = await this.prisma.playerProfile.findUnique({
      where: { userId },
      select: { overclockStreak: true, skipTokens: true, rerollTokens: true, lastTokenGrantWeek: true, streakShields: true },
    });
    if (!profile) return;

    const yQuests = await this.prisma.quest.findMany({
      where: { userId, questDate: yesterday },
      select: { status: true, carryOver: true, mustDo: true },
    });
    // Quests still pending that WON'T carry are about to expire = misses.
    const willExpire = yQuests.filter(q => q.status === 'pending' && !q.carryOver && !q.mustDo);
    const completed = yQuests.filter(q => q.status === 'completed');

    let overclockStreak = profile.overclockStreak;
    let rrGrant = 0;
    let shieldBurned = false;
    if (willExpire.length > 0) {
      // A miss breaks the overclock — UNLESS a Streak Shield absorbs it.
      // The shield auto-fires (handoff: "One missed day forgiven") but only
      // when there's a streak worth saving; it preserves the chain without
      // counting the day as a clear (no +1, no R&R credit).
      if (profile.streakShields > 0 && profile.overclockStreak > 0) {
        shieldBurned = true;
      } else {
        overclockStreak = 0;
      }
    } else if (completed.length > 0) {
      overclockStreak += 1; // full clear
      rrGrant = 1;          // bank a downtime credit
    } // else: nothing to clear / all skipped or carried → unchanged

    const week = isoWeekKey(today);
    const grantWeek = profile.lastTokenGrantWeek !== week;

    await this.prisma.playerProfile.update({
      where: { userId },
      data: {
        overclockStreak,
        ...(shieldBurned ? { streakShields: { decrement: 1 } } : {}),
        ...(rrGrant > 0 ? { rrCredits: { increment: rrGrant } } : {}),
        ...(grantWeek
          ? {
              skipTokens: Math.min(10, profile.skipTokens + 3),
              rerollTokens: Math.min(5, profile.rerollTokens + 1),
              lastTokenGrantWeek: week,
            }
          : {}),
      },
    });
    if (shieldBurned) {
      logger.info(`[QuestEngine] streak shield absorbed a missed day for user ${userId} (overclock ${overclockStreak} preserved)`);
    }
  }

  /**
   * Anti-goals ("ICE") clean-day credit. For each active avoid-habit that
   * was NOT breached yesterday, award its clean-day reward (XP + eddies via
   * the single economy mutation point) and bump the avoidance streak; a
   * breach yesterday leaves the streak broken. Runs once per local day (same
   * gate as the economy roll-over), so credits are not duplicated.
   *
   * touchStreak:false — a clean day is passive (the user took no action), so
   * it must not maintain the GLOBAL daily-activity streak; the per-habit
   * avoidance streak is tracked separately on the habit.
   */
  private async processAntiGoalsForNewDay(userId: string, today: Date, yesterday: Date): Promise<void> {
    const avoids = await this.prisma.habit.findMany({
      where: { userId, isActive: true, polarity: 'avoid' },
    });
    if (avoids.length === 0) return;

    const avoidIds = avoids.map(h => h.id);
    const breached = new Set(
      (await this.prisma.habitCompletion.findMany({
        where: { userId, completedOn: yesterday, habitId: { in: avoidIds } },
        select: { habitId: true },
      })).map(c => c.habitId),
    );

    for (const h of avoids) {
      // Only credit a day the anti-goal existed for in FULL — i.e. it was
      // created on a strictly earlier calendar day than `yesterday`. (Comparing
      // the raw createdAt timestamp to `today` would over-credit an anti-goal
      // made partway through yesterday for that whole day.) And never double-
      // credit the same day (defensive — the daily gate already ensures once).
      if (startOfLocalDay(h.createdAt) >= yesterday) continue;
      if (h.lastCompletedOn && isSameLocalDay(h.lastCompletedOn, yesterday)) continue;

      if (breached.has(h.id)) {
        // A slip yesterday — make sure the avoidance streak is broken.
        if (h.currentStreak !== 0) {
          await this.prisma.habit.update({ where: { id: h.id }, data: { currentStreak: 0 } });
        }
        continue;
      }

      // Clean day → reward + extend the avoidance streak, atomically.
      const mod = await this.prisma.module.findUnique({
        where: { id: h.moduleId }, select: { key: true },
      });
      const nextStreak = h.currentStreak + 1;
      await this.prisma.$transaction(async (tx) => {
        await this.game.awardXp(userId, {
          amount: h.baseXp,
          eddies: eddiesForReward(h.baseXp, h.difficulty),
          reason: 'anti_goal_clean',
          module: mod?.key,
          refType: 'habit',
          refId: h.id,
          touchStreak: false,
        }, tx);
        await tx.habit.update({
          where: { id: h.id },
          data: {
            currentStreak: nextStreak,
            longestStreak: Math.max(h.longestStreak, nextStreak),
            lastCompletedOn: yesterday,
          },
        });
      });
    }
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

  /**
   * Reroll a single pending quest: spend a reroll token, mark the old quest
   * skipped, and swap in a DIFFERENT candidate not already represented in
   * today's set. Returns replaced:false (token NOT spent) when there's no
   * fresh alternative. Uses the deterministic fallback title (no AI call —
   * must be snappy).
   *
   * Atomicity: the slow reads (candidate build) happen first, OUTSIDE the tx.
   * The mutation tx then (1) flips old pending->skipped as the idempotency
   * guard — a double-submit's loser matches 0 rows and rolls back, spending
   * nothing; (2) spends the reroll token guarded so it can't underflow; (3)
   * creates the replacement. All three share one tx, so a committed swap is
   * always paid for and any failure leaves the token + quests untouched. A
   * P2002 (a concurrent reroll already created the same candidate) degrades
   * to replaced:false rather than a 500.
   */
  async rerollQuest(userId: string, oldQuestId: string): Promise<{ replaced: boolean; newQuestId?: string }> {
    const today = startOfLocalDay();
    const old = await this.prisma.quest.findFirst({
      where: { id: oldQuestId, userId, questDate: today },
    });
    if (!old || old.status !== 'pending') return { replaced: false };

    // Source:sourceId keys already present today (any status) — avoid dups
    // (this also excludes the quest being rerolled, so we get a NEW one).
    const todays = await this.prisma.quest.findMany({
      where: { userId, questDate: today },
      select: { source: true, sourceId: true },
    });
    const existingKeys = new Set(todays.map(q => `${q.source}:${q.sourceId ?? ''}`));

    const candidates = await this.buildCandidates(userId, today);
    const pick = candidates.find(c => !existingKeys.has(`${c.source}:${c.sourceId ?? ''}`));
    if (!pick) return { replaced: false };

    try {
      const newId = await this.prisma.$transaction(async (tx) => {
        // (1) Idempotency guard: only the request that actually flips the old
        // quest proceeds. A double-submit's second pass matches 0 rows here.
        const flip = await tx.quest.updateMany({
          where: { id: old.id, userId, status: 'pending' },
          data: { status: 'skipped' },
        });
        if (flip.count !== 1) return null; // lost the race — already rerolled
        // (2) Guarded token spend (can't underflow). If the pre-check passed
        // but a concurrent spend drained tokens, this rolls the swap back.
        const dec = await tx.playerProfile.updateMany({
          where: { userId, rerollTokens: { gt: 0 } },
          data: { rerollTokens: { decrement: 1 } },
        });
        if (dec.count !== 1) throw new AppError('No reroll tokens left — buy more in the Shop', 400);
        // (3) Create the replacement.
        const created = await tx.quest.create({
          data: {
            userId,
            moduleId: await this.moduleIdFor(tx, userId, pick.moduleKey),
            questDate: today,
            title: this.fallbackTitle(pick),
            description: pick.baseTitle,
            difficulty: pick.difficulty,
            xpReward: pick.xpReward,
            source: pick.source,
            sourceId: pick.sourceId,
            habitId: pick.source === 'habit' ? pick.sourceId : null,
            goalId: pick.source === 'goal' ? pick.sourceId : null,
            status: 'pending',
            target: 1,
            progress: 0,
            isAiThemed: false,
            meta: this.buildMeta(pick, null, undefined),
            estMinutes: pick.estMinutes ?? null,
            targetCount: pick.targetCount ?? 1,
            currentCount: 0,
            carryOver: pick.carryOver ?? false,
            mustDo: pick.mustDo ?? false,
            originDate: today,
          },
          select: { id: true },
        });
        return created.id;
      });
      if (newId == null) return { replaced: false };
      return { replaced: true, newQuestId: newId };
    } catch (e: any) {
      if (e?.code === 'P2002') return { replaced: false };
      throw e;
    }
  }

  // -------------------------------------------------------------------
  // Candidate assembly
  // -------------------------------------------------------------------

  async buildCandidates(userId: string, date: Date): Promise<QuestCandidate[]> {
    const out: QuestCandidate[] = [];
    let counter = 0;
    const nextId = () => `cand_${date.getTime()}_${counter++}`;

    // --- Habits & chores due today, not yet completed ---
    // Only positive ("do") trackables generate quests; anti-goals
    // (polarity:"avoid") are tracked passively and credited at roll-over.
    const habits = await this.prisma.habit.findMany({
      where: { userId, isActive: true, polarity: 'do' },
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
      buildChainCandidates,   // phase 5: linear questlines
      buildBudgetCandidates,  // phase 7: budget-breach reminders
      buildBillCandidates,    // phase 7: recurring-bill reminders
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
