/**
 * digest.ts — the SERVER-SIDE computation layer for the intelligence layer.
 *
 * Everything here is pure data crunching over the user's own tables: no
 * Claude calls, no raw-data dumps. The AI Handler (handler.ts) and the
 * insights engine (insights.ts) consume these compact, factual digests and
 * merely *phrase* them. That division is deliberate — the numbers stay
 * honest and server-owned; the LLM only adds voice.
 *
 * Three products:
 *   - buildDailyDigest()    → facts for the Handler's daily rundown.
 *   - buildWeeklyDigest()   → numbers for the weekly debrief / after-action.
 *   - computeCorrelations() → honest "possible pattern" findings for insights.
 *
 * The correlation finder is intentionally conservative: it requires a
 * minimum sample in each group and a meaningful effect size before it will
 * surface anything, and it never states causation — only "possible pattern".
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { startOfLocalDay } from '../utils/dates';
import {
  overclockMultiplier, energyTierFromSleep, EnergyTier,
} from '../utils/economy';

type Db = PrismaClient | Prisma.TransactionClient;

// Local YYYY-MM-DD key for day bucketing (server-local, matches the rest of
// the app's "day = local midnight" convention).
function dayKey(d: Date): string {
  const x = startOfLocalDay(new Date(d));
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round1 = (n: number) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------------------
// Daily digest — what's on the plate today (for the rundown)
// ---------------------------------------------------------------------------

export interface DailyDigest {
  date: string;
  /** Explicit local weekday + date label ("Wednesday, June 10") so the
   *  Handler NEVER has to guess the day — it was confabulating weekdays. */
  dayLabel: string;
  isWeekend: boolean;
  streak: number;
  overclockStreak: number;
  overclockMultiplier: number;
  energyTier: EnergyTier;
  questCount: number;
  mustDoCount: number;
  carriedOverCount: number;
  questTitles: string[];
  rrCredits: number;
  topBoss: { name: string; pct: number } | null;
  neglectedContact: { name: string; days: number } | null;
  breachedYesterday: string[];
}

export async function buildDailyDigest(db: Db, userId: string, day: Date): Promise<DailyDigest> {
  const yesterday = startOfLocalDay(new Date(day.getTime() - 86_400_000));

  const [profile, quests, sleepMetric, bosses, npcs, avoidBreaches] = await Promise.all([
    db.playerProfile.findUnique({
      where: { userId },
      select: { currentStreak: true, overclockStreak: true, rrCredits: true, energyOverride: true, energyOverrideOn: true },
    }),
    db.quest.findMany({
      where: { userId, questDate: day },
      select: { title: true, status: true, mustDo: true, originDate: true, questDate: true, xpReward: true },
      orderBy: [{ mustDo: 'desc' }, { xpReward: 'desc' }],
    }),
    db.dailyMetric.findFirst({ where: { userId, key: 'sleepHours', date: day }, select: { value: true } }),
    db.boss.findMany({ where: { userId, status: 'active' }, select: { name: true, direction: true, targetValue: true, currentValue: true } }),
    db.npc.findMany({ where: { userId, lastContactOn: { not: null } }, select: { name: true, lastContactOn: true, cadenceDays: true } }),
    db.habit.findMany({
      where: { userId, polarity: 'avoid', isActive: true, completions: { some: { completedOn: yesterday } } },
      select: { title: true },
    }),
  ]);

  // Energy tier (light recompute — override pinned to today wins, else sleep).
  let energyTier: EnergyTier = 'med';
  if (profile?.energyOverride && profile.energyOverrideOn &&
      startOfLocalDay(profile.energyOverrideOn).getTime() === startOfLocalDay(day).getTime()) {
    energyTier = profile.energyOverride as EnergyTier;
  } else if (sleepMetric?.value != null) {
    energyTier = energyTierFromSleep(sleepMetric.value);
  }

  const pending = quests.filter(q => q.status === 'pending');

  // Most-progressed active boss (closest to a kill, but not done).
  let topBoss: DailyDigest['topBoss'] = null;
  for (const b of bosses) {
    const pct = bossPct(b.direction, b.targetValue, b.currentValue);
    if (pct < 100 && (!topBoss || pct > topBoss.pct)) topBoss = { name: b.name, pct };
  }

  // Most-overdue contact past its cadence (or 21d default when no cadence).
  let neglectedContact: DailyDigest['neglectedContact'] = null;
  for (const n of npcs) {
    if (!n.lastContactOn) continue;
    const days = Math.floor((day.getTime() - startOfLocalDay(n.lastContactOn).getTime()) / 86_400_000);
    const threshold = n.cadenceDays ?? 21;
    if (days >= threshold && (!neglectedContact || days > neglectedContact.days)) {
      neglectedContact = { name: n.name, days };
    }
  }

  return {
    date: dayKey(day),
    dayLabel: day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
    isWeekend: [0, 6].includes(day.getDay()),
    streak: profile?.currentStreak ?? 0,
    overclockStreak: profile?.overclockStreak ?? 0,
    overclockMultiplier: overclockMultiplier(profile?.overclockStreak ?? 0),
    energyTier,
    questCount: pending.length,
    mustDoCount: pending.filter(q => q.mustDo).length,
    carriedOverCount: pending.filter(q => q.originDate && startOfLocalDay(q.originDate).getTime() !== startOfLocalDay(q.questDate).getTime()).length,
    questTitles: pending.slice(0, 8).map(q => q.title),
    rrCredits: profile?.rrCredits ?? 0,
    topBoss,
    neglectedContact,
    breachedYesterday: avoidBreaches.map(h => h.title),
  };
}

function bossPct(direction: string, target: number, current: number): number {
  if (target <= 0) return 0;
  const raw = direction === 'charge_up' ? current / target : (target - current) / target;
  return Math.max(0, Math.min(100, Math.round(raw * 100)));
}

// ---------------------------------------------------------------------------
// Weekly digest — the after-action numbers
// ---------------------------------------------------------------------------

export interface WeeklyDigest {
  weekOf: string;
  weekEnd: string;
  xpEarned: number;
  eddiesEarned: number;
  eddiesSpent: number;
  questsCompleted: number;
  questsSkipped: number;
  questsExpired: number;
  completionRate: number;
  currentStreak: number;
  overclockStreak: number;
  workouts: number;
  bossDamageEvents: number;
  bossesDefeated: number;
  achievementsUnlocked: number;
  spendTotal: number;
  topCategories: { name: string; amount: number }[];
  vitals: { sleepAvg: number | null; moodAvg: number | null; weightDelta: number | null };
  activeDays: number;
}

/** Build the weekly digest for [weekStart, weekEnd) — both local-midnight. */
export async function buildWeeklyDigest(db: Db, userId: string, weekStart: Date, weekEnd: Date): Promise<WeeklyDigest> {
  const range = { gte: weekStart, lt: weekEnd };

  const [xpRows, walletRows, quests, workouts, bossLogs, bossKills, achievements, txns, metrics, profile] = await Promise.all([
    db.xpLedger.findMany({ where: { userId, createdAt: range }, select: { amount: true, createdAt: true } }),
    db.walletLedger.findMany({ where: { userId, createdAt: range }, select: { amount: true } }),
    db.quest.findMany({ where: { userId, questDate: range }, select: { status: true } }),
    db.workoutSession.count({ where: { userId, performedAt: range } }),
    db.bossLog.count({ where: { userId, createdAt: range } }),
    db.boss.count({ where: { userId, status: 'defeated', defeatedAt: range } }),
    db.userAchievement.count({ where: { userId, unlockedAt: range } }),
    db.transaction.findMany({ where: { userId, date: range, amount: { lt: 0 }, excluded: false }, select: { amount: true, category: { select: { name: true } } } }),
    db.dailyMetric.findMany({ where: { userId, date: range, key: { in: ['sleepHours', 'mood', 'weight'] } }, select: { key: true, value: true, date: true } }),
    db.playerProfile.findUnique({ where: { userId }, select: { currentStreak: true, overclockStreak: true } }),
  ]);

  const xpEarned = xpRows.reduce((s, r) => s + Math.max(0, r.amount), 0);
  const eddiesEarned = walletRows.reduce((s, r) => s + Math.max(0, r.amount), 0);
  const eddiesSpent = walletRows.reduce((s, r) => s + Math.max(0, -r.amount), 0);
  const completed = quests.filter(q => q.status === 'completed').length;
  const skipped = quests.filter(q => q.status === 'skipped').length;
  const expired = quests.filter(q => q.status === 'expired').length;

  // Spend rollup by category.
  let spendTotal = 0;
  const byCat = new Map<string, number>();
  for (const t of txns) {
    const amt = Math.abs(t.amount);
    spendTotal += amt;
    const name = t.category?.name ?? 'Uncategorized';
    byCat.set(name, (byCat.get(name) ?? 0) + amt);
  }
  const topCategories = [...byCat.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([name, amount]) => ({ name, amount: Math.round(amount) }));

  // Vitals.
  const sleeps = metrics.filter(m => m.key === 'sleepHours').map(m => m.value);
  const moods = metrics.filter(m => m.key === 'mood').map(m => m.value);
  const weights = metrics.filter(m => m.key === 'weight').sort((a, b) => a.date.getTime() - b.date.getTime());
  const weightDelta = weights.length >= 2 ? round1(weights[weights.length - 1].value - weights[0].value) : null;

  const activeDays = new Set(xpRows.map(r => dayKey(r.createdAt))).size;

  return {
    weekOf: dayKey(weekStart),
    weekEnd: dayKey(new Date(weekEnd.getTime() - 86_400_000)),
    xpEarned,
    eddiesEarned,
    eddiesSpent,
    questsCompleted: completed,
    questsSkipped: skipped,
    questsExpired: expired,
    completionRate: completed + expired > 0 ? Math.round((completed / (completed + expired)) * 100) : 0,
    currentStreak: profile?.currentStreak ?? 0,
    overclockStreak: profile?.overclockStreak ?? 0,
    workouts,
    bossDamageEvents: bossLogs,
    bossesDefeated: bossKills,
    achievementsUnlocked: achievements,
    spendTotal: Math.round(spendTotal),
    topCategories,
    vitals: {
      sleepAvg: sleeps.length ? round1(avg(sleeps)) : null,
      moodAvg: moods.length ? round1(avg(moods)) : null,
      weightDelta,
    },
    activeDays,
  };
}

// ---------------------------------------------------------------------------
// Correlations — honest "possible pattern" findings
// ---------------------------------------------------------------------------

export type InsightActionType = 'none' | 'reach_out' | 'review_budget' | 'log_sleep' | 'review_spend';

export interface CorrelationFinding {
  kind: string;
  title: string;
  body: string;       // deterministic, neutral wording (the Handler may re-voice it)
  evidence: string;   // the factual one-liner
  confidence: 'low' | 'medium';
  windowDays: number;
  suggestion: string;
  actionType: InsightActionType;
}

// Honesty gates: minimum days in each comparison group + a minimum effect.
const MIN_GROUP = 4;
const MIN_REL_EFFECT = 0.15; // 15% relative difference

/**
 * Compute conservative cross-domain correlations over the last `windowDays`.
 * Returns only findings that clear the sample + effect-size gates. Never
 * claims causation; wording is "possible pattern". Fully deterministic —
 * works with no API key (the insights service optionally adds voice).
 */
export async function computeCorrelations(db: Db, userId: string, windowDays = 28): Promise<CorrelationFinding[]> {
  const since = startOfLocalDay(new Date(Date.now() - windowDays * 86_400_000));
  const monthStart = startOfLocalDay(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  const [metrics, txns, workouts, categories, npcs] = await Promise.all([
    db.dailyMetric.findMany({ where: { userId, date: { gte: since }, key: { in: ['sleepHours', 'mood'] } }, select: { key: true, value: true, date: true } }),
    db.transaction.findMany({ where: { userId, date: { gte: since }, amount: { lt: 0 }, excluded: false }, select: { amount: true, date: true } }),
    db.workoutSession.findMany({ where: { userId, performedAt: { gte: since } }, select: { performedAt: true } }),
    db.category.findMany({ where: { userId, budget: { not: null } }, select: { name: true, budget: true } }),
    db.npc.findMany({ where: { userId }, select: { name: true, lastContactOn: true, cadenceDays: true } }),
  ]);

  // Bucket signals by day.
  const sleepByDay = new Map<string, number>();
  const moodByDay = new Map<string, number>();
  for (const m of metrics) {
    if (m.key === 'sleepHours') sleepByDay.set(dayKey(m.date), m.value);
    else if (m.key === 'mood') moodByDay.set(dayKey(m.date), m.value);
  }
  const spendByDay = new Map<string, number>();
  for (const t of txns) spendByDay.set(dayKey(t.date), (spendByDay.get(dayKey(t.date)) ?? 0) + Math.abs(t.amount));
  const workoutDays = new Set(workouts.map(w => dayKey(w.performedAt)));

  const out: CorrelationFinding[] = [];

  // 1) sleep ↔ spend: avg daily spend on low-sleep (<6h) vs other days.
  {
    const low: number[] = [], high: number[] = [];
    for (const [day, hrs] of sleepByDay) {
      const spend = spendByDay.get(day) ?? 0;
      (hrs < 6 ? low : high).push(spend);
    }
    if (low.length >= MIN_GROUP && high.length >= MIN_GROUP) {
      const lo = avg(low), hi = avg(high);
      if (hi > 0 && (lo - hi) / hi >= MIN_REL_EFFECT) {
        const pct = Math.round(((lo - hi) / hi) * 100);
        out.push({
          kind: 'sleep_spend',
          title: 'Short sleep, looser wallet?',
          body: `On days you logged under 6 hours of sleep, your spending that day ran about ${pct}% higher on average. Possible pattern — worth watching, not a verdict.`,
          evidence: `avg spend $${Math.round(lo)} on <6h-sleep days vs $${Math.round(hi)} otherwise (${low.length}+${high.length} days)`,
          confidence: low.length + high.length >= 14 ? 'medium' : 'low',
          windowDays,
          suggestion: 'On low-sleep days, give big purchases a 24-hour cooldown.',
          actionType: 'review_spend',
        });
      }
    }
  }

  // 2) sleep ↔ mood: avg mood on low-sleep vs other days.
  {
    const low: number[] = [], high: number[] = [];
    for (const [day, hrs] of sleepByDay) {
      const mood = moodByDay.get(day);
      if (mood == null) continue;
      (hrs < 6 ? low : high).push(mood);
    }
    if (low.length >= MIN_GROUP && high.length >= MIN_GROUP) {
      const lo = avg(low), hi = avg(high);
      if (hi > 0 && (hi - lo) / hi >= MIN_REL_EFFECT) {
        out.push({
          kind: 'sleep_mood',
          title: 'Mood tracks your sleep',
          body: `Your logged mood averaged ${round1(lo)} after short-sleep nights versus ${round1(hi)} otherwise. Possible pattern — the sample is still small.`,
          evidence: `avg mood ${round1(lo)} on <6h-sleep days vs ${round1(hi)} otherwise (${low.length}+${high.length} days)`,
          confidence: low.length + high.length >= 14 ? 'medium' : 'low',
          windowDays,
          suggestion: 'Protect a consistent bedtime this week and watch whether mood follows.',
          actionType: 'log_sleep',
        });
      }
    }
  }

  // 3) gym ↔ mood: avg mood on workout vs non-workout days.
  {
    const gym: number[] = [], rest: number[] = [];
    for (const [day, mood] of moodByDay) (workoutDays.has(day) ? gym : rest).push(mood);
    if (gym.length >= MIN_GROUP && rest.length >= MIN_GROUP) {
      const g = avg(gym), r = avg(rest);
      if (r > 0 && (g - r) / r >= MIN_REL_EFFECT) {
        out.push({
          kind: 'gym_mood',
          title: 'Training days read better',
          body: `On days you logged a workout, your mood averaged ${round1(g)} versus ${round1(r)} on rest days. Possible pattern worth a nudge.`,
          evidence: `avg mood ${round1(g)} on workout days vs ${round1(r)} otherwise (${gym.length}+${rest.length} days)`,
          confidence: gym.length + rest.length >= 14 ? 'medium' : 'low',
          windowDays,
          suggestion: 'Bank a short session on a low day — it may be the cheapest mood lever you have.',
          actionType: 'none',
        });
      }
    }
  }

  // 4) budget drift: any category with a budget that's ≥80% spent this month.
  {
    const spentThisMonth = await db.transaction.groupBy({
      by: ['categoryId'],
      where: { userId, date: { gte: monthStart }, amount: { lt: 0 }, excluded: false },
      _sum: { amount: true },
    }).catch(() => [] as any[]);
    const byCatId = new Map<string, number>();
    // groupBy returns categoryId; we need names — refetch ids.
    const catIdName = await db.category.findMany({ where: { userId, budget: { not: null } }, select: { id: true, name: true, budget: true } });
    const idToCat = new Map(catIdName.map(c => [c.id, c]));
    for (const row of spentThisMonth as any[]) {
      if (row.categoryId) byCatId.set(row.categoryId, Math.abs(row._sum.amount ?? 0));
    }
    let worst: { name: string; pct: number; spent: number; budget: number } | null = null;
    for (const [id, c] of idToCat) {
      if (!c.budget || c.budget <= 0) continue;
      const spent = byCatId.get(id) ?? 0;
      const pct = Math.round((spent / c.budget) * 100);
      if (pct >= 80 && (!worst || pct > worst.pct)) worst = { name: c.name, pct, spent: Math.round(spent), budget: Math.round(c.budget) };
    }
    if (worst) {
      out.push({
        kind: 'budget',
        title: `${worst.name} budget is running hot`,
        body: `You're at ${worst.pct}% of your ${worst.name} budget this month ($${worst.spent} of $${worst.budget}). ${worst.pct >= 100 ? 'Already over.' : 'Close to the cap.'}`,
        evidence: `${worst.name}: $${worst.spent} / $${worst.budget} month-to-date (${worst.pct}%)`,
        confidence: 'medium',
        windowDays,
        suggestion: worst.pct >= 100 ? 'Cap further spend here until next month resets.' : 'Ease off this category for the rest of the month.',
        actionType: 'review_budget',
      });
    }
    // categories param fetched above is unused on this branch but kept for clarity
    void categories;
  }

  // 5) social: the most-overdue contact past cadence (or 21d default).
  {
    let worst: { name: string; days: number } | null = null;
    for (const n of npcs) {
      if (!n.lastContactOn) continue;
      const days = Math.floor((Date.now() - startOfLocalDay(n.lastContactOn).getTime()) / 86_400_000);
      const threshold = n.cadenceDays ?? 21;
      if (days >= threshold && (!worst || days > worst.days)) worst = { name: n.name, days };
    }
    if (worst) {
      out.push({
        kind: 'social',
        title: 'A contact is going cold',
        body: `It's been ${worst.days} days since you logged contact with ${worst.name}. A two-minute ping resets the clock.`,
        evidence: `${worst.name}: ${worst.days} days since last contact`,
        confidence: 'medium',
        windowDays,
        suggestion: `Reach out to ${worst.name} this week.`,
        actionType: 'reach_out',
      });
    }
  }

  return out;
}
