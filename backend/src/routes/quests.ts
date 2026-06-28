import express from 'express';
import { z } from 'zod';
import { prisma } from '../server';
import { AuthRequest } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { QuestEngine } from '../services/QuestEngine';
import { GamificationService, type PlayerSnapshot } from '../services/GamificationService';
import { WeatherService } from '../services/WeatherService';
import { CalendarService, calendarService } from '../services/CalendarService';
import { eddiesForReward } from '../utils/economy';
import { startOfLocalDay, daysAgoLocal } from '../utils/dates';
import { config } from '../config';
import { completeProjectTaskAfterQuest } from '../routes/projects';
import { markBillPaid } from '../routes/recurring';

const router = express.Router();
let _engine: QuestEngine | null = null;
let _game: GamificationService | null = null;
const engine = () => (_engine ??= new QuestEngine(prisma));
const game = () => (_game ??= new GamificationService(prisma));
const weather = new WeatherService();

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

/**
 * GET /api/quests/today
 *
 * Lazy generator: first call of the day for this user generates the
 * day's quest set; subsequent calls just read. The atomic create on
 * DailyQuestRun is the cross-process lock.
 *
 * Returns quests grouped by module + summary stats for the HUD.
 */
router.get('/today', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const today = startOfLocalDay();

  const result = await engine().ensureToday(userId);
  // Intelligence layer: lazily build last week's debrief on the first app-open
  // of a new ISO week. FIRE-AND-FORGET — it may make 1-2 Claude calls (insights
  // + debrief narration) and must not block the Today page. Idempotent (the
  // WeeklyReview unique create is the guard) and never throws (fully wrapped),
  // so the detached promise is safe; the Debrief view picks it up via socket +
  // react-query refetch.
  void engine().ensureWeeklyReview(userId);

  const quests = await prisma.quest.findMany({
    where: { userId, questDate: today },
    orderBy: [{ status: 'asc' }, { difficulty: 'asc' }, { createdAt: 'asc' }],
    include: { module: { select: { key: true, name: true, color: true, icon: true } } },
  });

  // Group by module.key for the HUD.
  const grouped: Record<string, any[]> = {};
  let xpAvailable = 0;
  let xpEarned = 0;
  let completedCount = 0;
  let plannedCount = 0;
  for (const q of quests) {
    const key = q.module.key;
    (grouped[key] ??= []).push({
      ...q,
      meta: parseJson(q.meta),
    });
    // Ad-hoc captures still render, but they don't gate the day's clear or the
    // on-the-table HUD — they're bonus, not part of the generated plan.
    if (q.adhoc) continue;
    plannedCount += 1;
    if (q.status === 'completed') {
      completedCount += 1;
      xpEarned += q.xpReward;
    } else if (q.status === 'pending') {
      // Counter quests drip XP per check-in (floor(xpReward·count/target),
      // mirrored from /progress). The dripped portion is already banked in the
      // ledger, so count only the UNEARNED remainder as "on the table", and the
      // dripped portion as earned — otherwise the HUD over-promises XP and the
      // BANKED bar reads low for a half-done counter. One-shots are unchanged.
      const target = Math.max(1, q.targetCount);
      if (target > 1 && q.currentCount > 0) {
        const dripped = Math.floor((q.xpReward * q.currentCount) / target);
        xpEarned += dripped;
        xpAvailable += q.xpReward - dripped;
      } else {
        xpAvailable += q.xpReward;
      }
    }
  }

  res.json({
    questDate: today,
    generated: result.generated,
    generator: result.generator,
    totalCount: plannedCount,
    completedCount,
    xpAvailable,
    xpEarned,
    byModule: grouped,
  });
}));

/**
 * POST /api/quests/:id/complete
 *
 * Manual completion (i.e. user clicked the button on the quest card).
 * Idempotent: completing twice awards XP once. Side effects (atomic):
 *   - quest.status = "completed"
 *   - QuestCompletion row
 *   - if source="habit", upsert HabitCompletion for today + bump habit streak
 *   - Award XP via GamificationService
 *   - Broadcast quest-completed + player-updated
 */
router.post('/:id/complete', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const quest = await prisma.quest.findFirst({
    where: { id: req.params.id, userId },
  });
  if (!quest) throw new AppError('Quest not found', 404);

  // Idempotent: short-circuit if already completed.
  if (quest.status === 'completed') {
    const existing = await prisma.questCompletion.findUnique({
      where: { questId: quest.id },
    });
    const player = await game().getSnapshot(userId);
    res.json({ quest, completion: existing, player, leveledUp: false, alreadyCompleted: true });
    return;
  }
  if (quest.status !== 'pending') {
    throw new AppError(`Cannot complete a ${quest.status} quest`, 400);
  }
  // Counter quests drip XP through /progress; completing them here would
  // pay the full reward again on top of the dripped ticks. Route them to
  // /progress (the UI already does this off targetCount).
  if (quest.targetCount > 1) {
    throw new AppError('Use /progress to advance a counter quest', 400);
  }

  const today = startOfLocalDay();

  const { player, questCompletion } = await prisma.$transaction(async (tx) => {
    const updated = await tx.quest.update({
      where: { id: quest.id },
      data: { status: 'completed', progress: quest.target },
    });

    const questCompletion = await tx.questCompletion.create({
      data: {
        userId,
        questId: quest.id,
        xpAwarded: quest.xpReward,
      },
    });

    // If this quest tracks a habit, also write a HabitCompletion for
    // today (idempotent via @@unique) and bump the habit streak.
    if (quest.source === 'habit' && quest.sourceId) {
      try {
        await tx.habitCompletion.create({
          data: {
            userId,
            habitId: quest.sourceId,
            completedOn: today,
            xpAwarded: 0,    // quest carries the XP; avoid double-payment
            source: 'quest',
          },
        });
      } catch (err: any) {
        if (err?.code !== 'P2002') throw err; // already completed today; fine.
      }
      await game().bumpHabitStreak(quest.sourceId, today, tx);
      // A one-off chore (ad-hoc capture or a 'once' habit) retires on
      // completion so it stops surfacing — mirrors the habit /check path.
      await tx.habit.updateMany({
        where: { id: quest.sourceId, userId, cadence: 'once' },
        data: { isActive: false },
      });
    }

    // If this quest tracks a project task, mark the task done inside the
    // same tx (closed loop both ways; advances sequenced projects).
    if (quest.source === 'project' && quest.sourceId) {
      await completeProjectTaskAfterQuest(tx, userId, quest.sourceId);
    }

    // If this quest is a recurring-bill reminder, stamp the bill paid.
    if (quest.source === 'bill' && quest.sourceId) {
      await markBillPaid(tx, userId, quest.sourceId);
    }

    // Award XP via central service.
    const moduleKey = await tx.module.findUnique({
      where: { id: quest.moduleId },
      select: { key: true },
    });
    const player = await game().awardXp(userId, {
      amount: quest.xpReward,
      eddies: eddiesForReward(quest.xpReward, quest.difficulty),
      reason: 'quest_complete',
      module: moduleKey?.key,
      refType: 'quest',
      refId: quest.id,
    }, tx);

    // Stamp the completion's meta with the level transition.
    if (player.leveledUp) {
      await tx.questCompletion.update({
        where: { id: questCompletion.id },
        data: {
          meta: JSON.stringify({
            leveledUp: true,
            from: player.previousLevel,
            to: player.level,
          }),
        },
      });
    }

    return { player, questCompletion };
  });

  const ws = (global as any).wsService;
  if (ws?.broadcastGameEvent) {
    ws.broadcastGameEvent(userId, 'quest-completed', {
      questId: quest.id,
      xpAwarded: quest.xpReward,
      leveledUp: player?.leveledUp ?? false,
    });
  }

  res.json({
    quest: { ...quest, status: 'completed', progress: quest.target },
    completion: questCompletion,
    player,
    leveledUp: player?.leveledUp ?? false,
  });
}));

/**
 * POST /api/quests/:id/skip — drop a quest with no penalty, no XP.
 * Consumes a SKIP TOKEN (3 free/week + buyable). Skipped quests are
 * neutral (not a miss), so they don't break the overclock streak.
 */
router.post('/:id/skip', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const quest = await prisma.quest.findFirst({
    where: { id: req.params.id, userId },
  });
  if (!quest) throw new AppError('Quest not found', 404);
  if (quest.status !== 'pending') {
    throw new AppError(`Cannot skip a ${quest.status} quest`, 400);
  }

  const updated = await prisma.$transaction(async (tx) => {
    // The quest's pending->skipped transition is the idempotency guard: only
    // the request that actually flips the row spends a token. On a double-
    // submit the second pass matches 0 rows here and the whole tx rolls back,
    // so it burns no token (the status read above is outside the tx and can't
    // be the guard). Mirrors the guarded-write pattern in /progress.
    const flip = await tx.quest.updateMany({
      where: { id: quest.id, userId, status: 'pending' },
      data: { status: 'skipped' },
    });
    if (flip.count !== 1) throw new AppError('Quest already resolved', 409);
    // Guarded token spend: the WHERE pins skipTokens > 0 so it can't underflow.
    const dec = await tx.playerProfile.updateMany({
      where: { userId, skipTokens: { gt: 0 } },
      data: { skipTokens: { decrement: 1 } },
    });
    if (dec.count !== 1) throw new AppError('No skip tokens left — buy more in the Shop', 400);
    return tx.quest.findUniqueOrThrow({ where: { id: quest.id } });
  });

  const player = await game().getSnapshot(userId);
  res.json({ quest: updated, player });
}));

/**
 * POST /api/quests/:id/reroll — swap a quest for a different one.
 * Consumes a REROLL TOKEN, but only if a fresh alternative exists (else
 * the token is NOT spent and we say so).
 */
router.post('/:id/reroll', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const quest = await prisma.quest.findFirst({
    where: { id: req.params.id, userId },
  });
  if (!quest) throw new AppError('Quest not found', 404);
  if (quest.status !== 'pending') {
    throw new AppError(`Cannot reroll a ${quest.status} quest`, 400);
  }

  // Fast-path UX check; the AUTHORITATIVE guarded token spend happens inside
  // rerollQuest's transaction (atomic with the swap), so a double-submit can't
  // spend twice or leave a quest skipped without a replacement.
  const profile = await prisma.playerProfile.findUnique({
    where: { userId }, select: { rerollTokens: true },
  });
  if (!profile || profile.rerollTokens <= 0) {
    throw new AppError('No reroll tokens left — buy more in the Shop', 400);
  }

  const result = await engine().rerollQuest(userId, quest.id);
  if (!result.replaced) {
    res.json({ replaced: false, message: 'No alternative quests available to reroll into right now.' });
    return;
  }

  const player = await game().getSnapshot(userId);
  res.json({ replaced: true, newQuestId: result.newQuestId, player });
}));

/**
 * POST /api/quests/:id/progress  { delta?: number = 1 }
 *
 * Check-in counter for progress quests (roadmap §5: "5/8 → tap +1").
 * XP drips proportionally per check-in; reaching the target completes
 * the quest and pays the remainder + a completion bonus (Brent: "partial
 * reward + bonus"). Eddies are pegged to the XP awarded in each call.
 * Idempotent at the cap: extra +1s past the target are no-ops.
 */
router.post('/:id/progress', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const { delta } = z.object({ delta: z.number().int().min(1).max(100).default(1) }).parse(req.body ?? {});

  const quest = await prisma.quest.findFirst({ where: { id: req.params.id, userId } });
  if (!quest) throw new AppError('Quest not found', 404);
  if (quest.status === 'completed') {
    const player = await game().getSnapshot(userId);
    res.json({ quest, player, alreadyCompleted: true });
    return;
  }
  if (quest.status !== 'pending') {
    throw new AppError(`Cannot advance a ${quest.status} quest`, 400);
  }

  const target = Math.max(1, quest.targetCount);
  const before = Math.min(quest.currentCount, target);
  const after = Math.min(before + delta, target);
  if (after === before) {
    const player = await game().getSnapshot(userId);
    res.json({ quest, player, noop: true });
    return;
  }

  // Proportional XP: what should be credited at `after` ticks minus what
  // was credited at `before` ticks. Completion pays out the full reward
  // plus a 20% bonus (counter quests only; one-shots match /complete).
  const creditedAt = (count: number) => Math.floor((quest.xpReward * count) / target);
  const willComplete = after >= target;
  const completionBonus = target > 1 && willComplete ? Math.round(quest.xpReward * 0.2) : 0;
  const baseXp = willComplete ? quest.xpReward - creditedAt(before) : creditedAt(after) - creditedAt(before);
  const xpAward = baseXp + completionBonus;
  // Eddies: intermediate ticks are pegged 1:1 to the tick XP with NO flat
  // difficulty bonus — otherwise an 8-tick counter quest would pay the
  // bonus 8×. The flat bonus is applied ONCE, on the completing tick.
  const eddieAward = willComplete
    ? eddiesForReward(xpAward, quest.difficulty)
    : Math.max(0, baseXp);

  const today = startOfLocalDay();

  const { player, raced } = await prisma.$transaction(async (tx) => {
    // Guarded update: the WHERE pins currentCount to the value we read.
    // Under a concurrent +1 (double-click / retry) only the first commit
    // matches; the loser updates 0 rows and bails WITHOUT awarding, so a
    // tick's XP/eddies are never paid twice (the count read happened
    // outside the tx, so this conditional write is the integrity guard).
    const upd = await tx.quest.updateMany({
      where: { id: quest.id, userId, currentCount: before, status: 'pending' },
      data: {
        currentCount: after,
        progress: after / target,
        status: willComplete ? 'completed' : 'pending',
      },
    });
    if (upd.count !== 1) return { player: null as PlayerSnapshot | null, raced: true };

    if (willComplete) {
      await tx.questCompletion.create({
        data: { userId, questId: quest.id, xpAwarded: quest.xpReward, meta: JSON.stringify({ via: 'progress', completionBonus }) },
      });
      // Habit linkage (mirror /complete): write today's HabitCompletion + bump streak.
      if (quest.source === 'habit' && quest.sourceId) {
        try {
          await tx.habitCompletion.create({
            data: { userId, habitId: quest.sourceId, completedOn: today, xpAwarded: 0, source: 'quest' },
          });
        } catch (err: any) {
          if (err?.code !== 'P2002') throw err;
        }
        await game().bumpHabitStreak(quest.sourceId, today, tx);
        // Retire a one-off chore on completion (mirror /complete).
        await tx.habit.updateMany({
          where: { id: quest.sourceId, userId, cadence: 'once' },
          data: { isActive: false },
        });
      }
      // Mirror the project-task + bill side effects from /complete on the completing tick.
      if (quest.source === 'project' && quest.sourceId) {
        await completeProjectTaskAfterQuest(tx, userId, quest.sourceId);
      }
      if (quest.source === 'bill' && quest.sourceId) {
        await markBillPaid(tx, userId, quest.sourceId);
      }
    }

    const moduleKey = await tx.module.findUnique({
      where: { id: quest.moduleId }, select: { key: true },
    });
    const player = await game().awardXp(userId, {
      amount: xpAward,
      eddies: eddieAward,
      reason: willComplete ? 'quest_complete' : 'quest_progress',
      module: moduleKey?.key,
      refType: 'quest',
      refId: quest.id,
    }, tx);
    return { player, raced: false };
  });

  // Lost a concurrent race — another +1 already advanced the counter. Return
  // the fresh state without awarding anything again.
  if (raced) {
    const [fresh, snap] = await Promise.all([
      prisma.quest.findFirst({ where: { id: quest.id, userId } }),
      game().getSnapshot(userId),
    ]);
    res.json({ quest: fresh, player: snap, noop: true });
    return;
  }

  const ws = (global as any).wsService;
  if (ws?.broadcastGameEvent) {
    ws.broadcastGameEvent(userId, willComplete ? 'quest-completed' : 'quest-progress', {
      questId: quest.id, xpAwarded: xpAward, count: after, target,
      leveledUp: player?.leveledUp ?? false,
    });
  }

  res.json({
    quest: { ...quest, currentCount: after, progress: after / target, status: willComplete ? 'completed' : 'pending' },
    xpAwarded: xpAward,
    eddiesAwarded: eddieAward,
    completed: willComplete,
    player,
  });
}));

/**
 * POST /api/quests/:id/focus  { actualMinutes: number }
 *
 * Focus-timer "JACK OUT": logs real time spent on a quest (count-up or
 * timeboxed). Accumulates across sessions. Feeds estimate accuracy so
 * the planner gets smarter; does not itself complete the quest or award
 * XP. No hard stops (Brent: stopping the timer ≠ stopping the activity).
 */
router.post('/:id/focus', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const { actualMinutes } = z.object({
    actualMinutes: z.number().int().min(0).max(1440),
  }).parse(req.body);

  // Atomic accumulate: actualMinutes is also written by POST /api/focus/:id/stop,
  // so a read-modify-write here would lose updates when both fire close together.
  // updateMany with userId in the WHERE is both the ownership check and the
  // atomic increment in one statement.
  const upd = await prisma.quest.updateMany({
    where: { id: req.params.id, userId },
    data: { actualMinutes: { increment: actualMinutes } },
  });
  if (upd.count === 0) throw new AppError('Quest not found', 404);
  const updated = await prisma.quest.findFirst({ where: { id: req.params.id, userId } });
  res.json({ quest: updated });
}));

/**
 * GET /api/quests/plan?budget=<minutes>
 *
 * The day planner (roadmap §5). Ranks today's pending quests and greedily
 * fits a subset inside the time budget (default: 4h weekdays / 10h
 * weekends, from UserSettings). Returns a RANKED LIST with each quest
 * flagged inPlan/overflow — the app suggests WHAT to do, never WHEN.
 * Ranking: must-do first, then outdoor quests on their LAST CLEAR DAY
 * (doable today, blocked by tomorrow's forecast), then — when it's a
 * genuinely NICE day — outdoor quests in general (don't waste it), then
 * quests whose best weather window is open now, then higher reward, then
 * shorter (so more fit).
 */
router.get('/plan', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const today = startOfLocalDay();
  const DEFAULT_EST = 20; // assumed minutes for quests with no estimate

  const settings = await prisma.userSettings.findUnique({ where: { userId } });
  const isWeekend = [0, 6].includes(today.getDay());
  const defaultBudget = isWeekend
    ? (settings?.weekendBudgetMin ?? 600)
    : (settings?.weekdayBudgetMin ?? 240);
  // Time Dilation (Shop consumable): +2h planner budget for the day it was
  // bought; ignored once the day rolls over.
  const profile = await prisma.playerProfile.findUnique({
    where: { userId }, select: { budgetBoostOn: true },
  });
  const boostActive = profile?.budgetBoostOn != null
    && startOfLocalDay(profile.budgetBoostOn).getTime() === today.getTime();
  // Calendar uplink (roadmap §integrations): real commitments shrink the
  // day's "go" budget. Applied only to the DEFAULT budget — an explicit
  // ?budget= override is the user saying "I know my day"; leave it alone.
  // Best-effort: unconfigured / feed down → 0 and the planner behaves as
  // before.
  let calendarBusyMin = 0;
  if (!req.query.budget) {
    const calUrls = CalendarService.parseUrls(settings?.calendarIcsUrls);
    const cal = calUrls.length > 0
      ? await calendarService.getToday(calUrls).catch(() => null)
      : null;
    if (cal) calendarBusyMin = Math.min(cal.busyMin, defaultBudget);
  }
  const budgetMin = (req.query.budget
    ? Math.max(0, Number(req.query.budget))
    : defaultBudget - calendarBusyMin) + (boostActive ? 120 : 0);

  const quests = await prisma.quest.findMany({
    where: { userId, questDate: today, status: 'pending' },
    include: {
      module: { select: { key: true, name: true, color: true, icon: true } },
      habit: { select: { weatherRule: true } },
    },
  });

  // LAST CLEAR DAY: an outdoor quest that passes its weather rule today
  // (it generated, so it did) but would FAIL tomorrow gets boosted —
  // "tomorrow will be rainy/hot, do it while you can". One cached
  // snapshot covers every check; no snapshot → no boosts.
  const lastClearIds = new Set<string>();
  const outdoorIds = new Set<string>();   // quests gated on an outdoor weather rule
  let niceToday = false;                   // genuinely pleasant out → don't waste it
  const outdoorRules = quests
    .map(q => ({ id: q.id, rule: WeatherService.parseRule(q.habit?.weatherRule ?? null) }))
    .filter((x): x is { id: string; rule: NonNullable<ReturnType<typeof WeatherService.parseRule>> } => x.rule !== null);
  if (outdoorRules.length > 0) {
    const snap = await weather.getSnapshot(settings?.weatherLat ?? null, settings?.weatherLon ?? null);
    niceToday = WeatherService.isNiceDay(snap);
    for (const { id, rule } of outdoorRules) {
      outdoorIds.add(id);
      if (!weather.passesTomorrow(rule, snap)) lastClearIds.add(id);
    }
  }

  const nowHour = new Date().getHours();
  const windowOpenNow = (meta: any): boolean => {
    const w: string | undefined = meta?.bestWindow;
    if (!w) return false;
    // Parse a label like "1–3pm" / "7-9am" loosely; boost if `now` is inside.
    const m = w.match(/(\d+)\D+(\d+)\s*(am|pm)?/i);
    if (!m) return false;
    const to24 = (h: number, ap?: string) => ap?.toLowerCase() === 'pm' && h < 12 ? h + 12 : (ap?.toLowerCase() === 'am' && h === 12 ? 0 : h);
    const start = to24(parseInt(m[1], 10), m[3]);
    const end = to24(parseInt(m[2], 10), m[3]);
    return nowHour >= start && nowHour <= end;
  };

  const score = (q: typeof quests[number]): number => {
    const meta = parseJson<any>(q.meta);
    let s = 0;
    if (q.mustDo) s += 10_000;
    // Neglect: carried-over quests climb the board ~one tier per day stuck
    // ("something that has been neglected for several days").
    if (q.originDate) {
      const carriedDays = Math.max(0, Math.round((today.getTime() - startOfLocalDay(q.originDate).getTime()) / 86_400_000));
      s += Math.min(4, carriedDays) * 600;
    }
    // Hard deadlines rank above nice-to-haves: bill reminders are due-dated.
    if (q.source === 'bill') s += 800;
    // Tomorrow's forecast blocks this outdoor quest → today's the day.
    if (lastClearIds.has(q.id)) s += 1_200;
    // It's a genuinely nice day out — float outdoor tasks up so we don't waste it.
    if (niceToday && outdoorIds.has(q.id)) s += 800;
    if (windowOpenNow(meta)) s += 1_000;
    s += q.xpReward; // higher reward ranks higher
    // The GENERIC "log a workout" filler (source workout, no sourceId) is a
    // fallback, not a commitment — it shouldn't permanently squat the top
    // slot. Scheduled/specific workouts (with a sourceId) are unaffected.
    if (q.source === 'workout' && !q.sourceId) s -= 200;
    return s;
  };

  const ranked = [...quests].sort((a, b) => {
    const ds = score(b) - score(a);
    if (ds !== 0) return ds;
    // Tie-break: shorter first, so more quests fit the budget.
    return (a.estMinutes ?? DEFAULT_EST) - (b.estMinutes ?? DEFAULT_EST);
  });

  let plannedMin = 0;
  let totalEstMin = 0;
  const out = ranked.map((q) => {
    const est = q.estMinutes ?? DEFAULT_EST;
    totalEstMin += est;
    // must-do always makes the plan even if it blows the budget.
    const fits = q.mustDo || plannedMin + est <= budgetMin;
    if (fits) plannedMin += est;
    return {
      id: q.id,
      title: q.title,
      description: q.description,
      difficulty: q.difficulty,
      xpReward: q.xpReward,
      estMinutes: q.estMinutes,
      assumedMinutes: est,
      mustDo: q.mustDo,
      carryOver: q.carryOver,
      targetCount: q.targetCount,
      currentCount: q.currentCount,
      source: q.source,
      module: q.module,
      meta: parseJson(q.meta),
      inPlan: fits,
      lastClearDay: lastClearIds.has(q.id),
      niceDay: niceToday && outdoorIds.has(q.id),
    };
  });

  res.json({
    budgetMin,
    budgetBoostMin: boostActive ? 120 : 0,
    calendarBusyMin,
    isWeekend,
    plannedMin,
    totalEstMin,
    estimatedMissing: out.filter(q => q.estMinutes == null).length,
    quests: out,
  });
}));

/**
 * GET /api/quests/history?from=&to=
 * Past quests + completions for the streak calendar.
 */
router.get('/history', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const q = z.object({
    from:  z.string().datetime().optional(),
    to:    z.string().datetime().optional(),
    limit: z.string().transform(Number).pipe(z.number().int().positive().max(500)).default('200'),
  }).parse(req.query);

  const from = q.from ? new Date(q.from) : daysAgoLocal(30);
  const to   = q.to   ? new Date(q.to)   : startOfLocalDay();

  const quests = await prisma.quest.findMany({
    where: { userId, questDate: { gte: from, lte: to } },
    orderBy: { questDate: 'desc' },
    take: q.limit,
    include: { module: { select: { key: true, name: true } } },
  });

  res.json({ from, to, quests: quests.map(qq => ({ ...qq, meta: parseJson(qq.meta) })) });
}));

/**
 * POST /api/quests/regenerate
 * Dev/admin-only: blow away today's quests and run generation again.
 * Useful for iterating on the engine. Guarded by NODE_ENV.
 */
router.post('/regenerate', asyncHandler(async (req: AuthRequest, res) => {
  if (config.nodeEnv !== 'development') {
    throw new AppError('Regenerate is only available in development', 403);
  }
  const result = await engine().regenerateToday(req.user!.id);
  res.json(result);
}));

export default router;
