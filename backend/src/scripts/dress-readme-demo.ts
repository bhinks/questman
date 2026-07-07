/**
 * Dress the seeded demo account (demo@daymon.app) with a lived-in
 * history so README screenshots look like a real runner's hub: XP/eddie
 * ledgers, streaks, owned cosmetics, projects, media, a workout plan,
 * focus sessions, a boss, and today's sleep metric.
 *
 * Idempotent-ish: safe to re-run against a fresh `db:seed` database.
 * Run against a THROWAWAY db, never a live one:
 *   DATABASE_URL="file:./readme-demo.db" npx tsx src/scripts/dress-readme-demo.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function daysAgo(n: number, hour = 12, min = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, min, 0, 0);
  return d;
}

function localMidnight(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

async function main() {
  const user = await prisma.user.findUniqueOrThrow({ where: { email: 'demo@daymon.app' } });
  const userId = user.id;
  const modules = Object.fromEntries(
    (await prisma.module.findMany({ where: { userId } })).map(m => [m.key, m.id]),
  );

  // ---- player profile: streaks, tokens, cosmetics ----------------------
  await prisma.playerProfile.update({
    where: { userId },
    data: {
      currentStreak: 14,
      longestStreak: 23,
      overclockStreak: 5,
      skipTokens: 3,
      rerollTokens: 2,
      rrCredits: 2,
      streakShields: 2,
      cosmetics: JSON.stringify([
        'synthwave', 'ultraviolet', 'edgerunner',
        'font_orbitron', 'fx_aurora', 'timer_ring',
      ]),
      equippedTimer: 'ring',
      lastActiveOn: new Date(),
    },
  });

  // ---- XP + eddie history (ledgers are the source of truth) ------------
  await prisma.xpLedger.deleteMany({ where: { userId } });
  await prisma.walletLedger.deleteMany({ where: { userId } });

  const xpRows: Array<{ amount: number; reason: string; module: string; createdAt: Date }> = [];
  const reasons: Array<[string, string, number]> = [
    ['quest_complete', 'habits', 18], ['quest_complete', 'chores', 22],
    ['quest_complete', 'projects', 30], ['workout_log', 'fitness', 35],
    ['habit_log', 'habits', 12], ['quest_complete', 'media', 20],
    ['streak_bonus', 'habits', 6], ['quest_complete', 'finance', 15],
  ];
  // ~3 weeks of activity, 4-6 grants/day → a believable level curve.
  for (let day = 21; day >= 1; day--) {
    const grants = 4 + ((day * 7) % 3);
    for (let g = 0; g < grants; g++) {
      const [reason, module, base] = reasons[(day + g) % reasons.length];
      xpRows.push({
        amount: base + ((day + g) % 9),
        reason,
        module,
        createdAt: daysAgo(day, 8 + g * 2, (day * 13) % 60),
      });
    }
  }
  // Today's pre-completion activity for the SESSION LOG terminal.
  xpRows.push({ amount: 12, reason: 'habit_log', module: 'habits', createdAt: daysAgo(0, 7, 42) });
  xpRows.push({ amount: 35, reason: 'workout_log', module: 'fitness', createdAt: daysAgo(0, 8, 15) });
  await prisma.xpLedger.createMany({
    data: xpRows.map(r => ({ userId, ...r, refType: 'demo', refId: null })),
  });

  // Eddies: earned alongside XP, minus a couple of shop sprees.
  await prisma.walletLedger.createMany({
    data: [
      ...xpRows.filter((_, i) => i % 2 === 0).map(r => ({
        userId, amount: r.amount + 4, reason: r.reason, module: r.module, createdAt: r.createdAt,
      })),
      { userId, amount: -300, reason: 'shop_purchase', module: 'shop', createdAt: daysAgo(9, 20, 5) },
      { userId, amount: -450, reason: 'shop_purchase', module: 'shop', createdAt: daysAgo(3, 21, 30) },
    ],
  });

  // ---- projects with open tasks (quest fodder + focus targets) ---------
  await prisma.project.deleteMany({ where: { userId } });
  const proj1 = await prisma.project.create({
    data: {
      userId, moduleId: modules.projects, name: 'Workshop Rebuild', status: 'active', color: '#1ce2ff',
      tasks: { create: [
        { userId, title: 'Clear the east wall', done: true, estMinutes: 60, sortOrder: 0, completedAt: daysAgo(2) },
        { userId, title: 'Hang pegboard + rails', done: false, estMinutes: 45, priority: 2, sortOrder: 1 },
        { userId, title: 'Wire the bench lighting', done: false, estMinutes: 40, sortOrder: 2 },
      ] },
      milestones: { create: [
        { userId, title: 'Bench operational', bonusXp: 80, sortOrder: 0 },
      ] },
    },
  });
  await prisma.project.create({
    data: {
      userId, moduleId: modules.projects, name: 'Side Gig: Portfolio Site', status: 'active', color: '#9d6bff',
      tasks: { create: [
        { userId, title: 'Draft the case studies', done: false, estMinutes: 50, priority: 1, sortOrder: 0 },
        { userId, title: 'Ship the contact form', done: false, estMinutes: 30, sortOrder: 1 },
      ] },
    },
  });

  // ---- media backlog (braindance queue) ---------------------------------
  await prisma.mediaItem.deleteMany({ where: { userId } });
  await prisma.mediaItem.createMany({
    data: [
      { userId, moduleId: modules.media, type: 'book', title: 'Neuromancer', status: 'active', totalUnits: 271, unitsDone: 142, estMinutes: 400 },
      { userId, moduleId: modules.media, type: 'game', title: 'Hades II', status: 'backlog', estMinutes: 2400 },
      { userId, moduleId: modules.media, type: 'movie', title: 'Blade Runner 2049', status: 'backlog', estMinutes: 164 },
    ],
  });

  // ---- weekly workout plan (today gets a specific slot) ------------------
  await prisma.workoutPlan.deleteMany({ where: { userId } });
  const todayDow = new Date().getDay();
  await prisma.workoutPlan.createMany({
    data: [
      { userId, dayOfWeek: todayDow, title: 'Push Day — chest/shoulders', type: 'strength', targetMin: 45, sortOrder: 0 },
      { userId, dayOfWeek: (todayDow + 2) % 7, title: 'Pull Day — back/arms', type: 'strength', targetMin: 45, sortOrder: 1 },
      { userId, dayOfWeek: (todayDow + 4) % 7, title: '5K easy run', type: 'cardio', targetMin: 30, sortOrder: 2 },
    ],
  });

  // ---- focus sessions (the JACK IN log + per-object actuals) ------------
  await prisma.focusSession.deleteMany({ where: { userId } });
  await prisma.focusSession.createMany({
    data: [
      { userId, targetType: 'project', targetId: proj1.id, label: 'Workshop Rebuild', startedAt: daysAgo(0, 9, 5), endedAt: daysAgo(0, 9, 45), minutes: 40, limitMinutes: 40 },
      { userId, targetType: 'other', targetId: null, label: 'Deep work — quarterly report', startedAt: daysAgo(0, 10, 30), endedAt: daysAgo(0, 10, 55), minutes: 25, limitMinutes: 25 },
      { userId, targetType: 'project', targetId: proj1.id, label: 'Workshop Rebuild', startedAt: daysAgo(1, 19, 0), endedAt: daysAgo(1, 19, 55), minutes: 55, limitMinutes: 55 },
      { userId, targetType: 'habit', targetId: null, label: 'Reading — Neuromancer', startedAt: daysAgo(2, 21, 10), endedAt: daysAgo(2, 21, 40), minutes: 30, limitMinutes: null },
    ],
  });

  // ---- an active boss for the topbar target + boss board -----------------
  await prisma.boss.deleteMany({ where: { userId } });
  await prisma.boss.create({
    data: {
      userId, name: 'Vault Run: 5K Buffer', kind: 'savings', direction: 'charge_up',
      targetValue: 5000, currentValue: 3250, unit: '$', status: 'active',
      xpReward: 300, eddieReward: 250,
      logs: { create: [
        { userId, amount: 500, note: 'Payday sweep', source: 'manual', createdAt: daysAgo(7) },
        { userId, amount: 250, note: 'Sold old GPU', source: 'manual', createdAt: daysAgo(2) },
      ] },
    },
  });

  // ---- today's sleep → POWER CELL high -----------------------------------
  await prisma.dailyMetric.upsert({
    where: { userId_date_key: { userId, date: localMidnight(), key: 'sleepHours' } },
    update: { value: 7.5 },
    create: { userId, date: localMidnight(), key: 'sleepHours', value: 7.5 },
  });

  console.log('Demo account dressed for screenshots.');
}

main().finally(() => prisma.$disconnect());
