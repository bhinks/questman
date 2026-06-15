/**
 * Demo-mode seed — a self-contained, Night-City-flavored sandbox.
 *
 * The DEMO button (POST /api/auth/demo) calls seedDemoUser(): it wipes the
 * dedicated demo account and rebuilds a fresh, on-brand dataset every time, so
 * a walkthrough always looks pristine (Brent: "re-seed for a consistent look")
 * and any visitor edits vanish on the next visit. The account is kept strictly
 * separate from the real hub user — it never becomes the AI/ingest identity
 * (see resolveHubUserId) and is never created by the prod boot seed.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { provisionLifeHub } from './provision';

/** The dedicated demo account. Login is via the DEMO button (a minted token),
 *  not a password, so the stored hash is throwaway. */
export const DEMO_EMAIL = 'demo@questman.app';
export const DEMO_NAME = 'V';

const d = (daysAgo: number): Date => {
  const x = new Date();
  x.setDate(x.getDate() - daysAgo);
  return x;
};

export async function seedDemoUser(prisma: PrismaClient): Promise<{ id: string; email: string; name: string | null }> {
  // Full reset: deleting the account cascades every owned row (all User
  // relations are onDelete: Cascade), so we always rebuild from a clean slate.
  await prisma.user.deleteMany({ where: { email: DEMO_EMAIL } });

  const password = await bcrypt.hash(`demo-${Date.now()}-${Math.round(Math.random() * 1e9)}`, 10);
  const user = await prisma.user.create({
    data: {
      email: DEMO_EMAIL,
      password,
      name: DEMO_NAME,
      settings: {
        create: { currency: 'USD', dateFormat: 'MM/dd/yyyy', theme: 'cyberpunk', autoCategoriztion: true, notifications: true },
      },
    },
    select: { id: true, email: true, name: true },
  });
  const userId = user.id;

  const modules = await provisionLifeHub(prisma, userId);

  // ---- Finance: the Vault ------------------------------------------------
  const categorySeeds = [
    { name: 'Housing', icon: 'lock', color: '#7c5cff', budget: 1800 },
    { name: 'Food & Dining', icon: 'food', color: '#ff2e88', budget: 650 },
    { name: 'Transportation', icon: 'car', color: '#00e5ff', budget: 300 },
    { name: 'Cyberware', icon: 'bolt', color: '#43ffa6', budget: 700 },
    { name: 'Entertainment', icon: 'tv', color: '#ffb000', budget: 250 },
    { name: 'Subscriptions', icon: 'repeat', color: '#ff5a5a', budget: 120 },
    { name: 'Income', icon: 'wallet', color: '#43ffa6', budget: null as number | null },
  ];
  const categories: Record<string, string> = {};
  for (const c of categorySeeds) {
    const cat = await prisma.category.create({ data: { userId, name: c.name, icon: c.icon, color: c.color, budget: c.budget, isSystem: true } });
    categories[c.name] = cat.id;
  }

  const tx: Array<{ date: Date; description: string; amount: number; category: string }> = [
    { date: d(2), description: 'Gig payout — corpo extraction', amount: 4200, category: 'Income' },
    { date: d(17), description: 'Gig payout — data courier run', amount: 3600, category: 'Income' },
    { date: d(1), description: 'Megabuilding H10 rent', amount: -1750, category: 'Housing' },
    { date: d(3), description: "Tom's Diner — synth-noodles", amount: -28.5, category: 'Food & Dining' },
    { date: d(5), description: 'Ripperdoc — reflex tune-up', amount: -480, category: 'Cyberware' },
    { date: d(6), description: 'Delamain cab fare', amount: -34.0, category: 'Transportation' },
    { date: d(8), description: 'Braindance subscription', amount: -19.99, category: 'Subscriptions' },
    { date: d(8), description: 'Netwatch news feed', amount: -9.99, category: 'Subscriptions' },
    { date: d(9), description: 'Afterlife — drinks with Jackie', amount: -76.0, category: 'Entertainment' },
    { date: d(11), description: 'Misty’s Esoterica', amount: -22.0, category: 'Food & Dining' },
    { date: d(12), description: 'Ammo + grenades (2nd Amendment)', amount: -140.0, category: 'Cyberware' },
    { date: d(14), description: 'Street vendor — gurke', amount: -9.5, category: 'Food & Dining' },
    { date: d(18), description: 'Power grid surcharge', amount: -88.0, category: 'Housing' },
    { date: d(21), description: 'Wakako’s cut', amount: -150.0, category: 'Entertainment' },
    { date: d(24), description: 'Fast-travel metro pass', amount: -42.0, category: 'Transportation' },
  ];
  await prisma.transaction.createMany({
    data: tx.map(t => ({ userId, date: t.date, description: t.description, amount: t.amount, categoryId: categories[t.category], isManual: false })),
  });

  // ---- Habits + chores ---------------------------------------------------
  await prisma.habit.createMany({
    data: [
      { userId, moduleId: modules.habits.id, kind: 'habit', title: 'Calibrate cyberware', description: 'Keep the chrome in sync.', icon: 'bolt', cadence: 'daily', baseXp: 12, difficulty: 'easy', currentStreak: 4, longestStreak: 9, lastCompletedOn: d(1) },
      { userId, moduleId: modules.habits.id, kind: 'habit', title: 'Hydrate the meatbody', description: '8 glasses, choom.', icon: 'spark', cadence: 'daily', baseXp: 8, difficulty: 'easy', currentStreak: 2, longestStreak: 6, lastCompletedOn: d(1) },
      { userId, moduleId: modules.habits.id, kind: 'habit', title: 'Read 20 pages', description: 'Off the Net for a bit.', icon: 'book', cadence: 'daily', baseXp: 15, difficulty: 'easy' },
      { userId, moduleId: modules.chores.id, kind: 'chore', title: 'Clean the iron sights', description: 'Maintenance day.', icon: 'list', cadence: 'weekly', schedule: JSON.stringify({ daysOfWeek: [0] }), baseXp: 20, difficulty: 'medium' },
      // Anti-goal (ICE) — a thing to avoid.
      { userId, moduleId: modules.habits.id, kind: 'habit', polarity: 'avoid', title: 'No black-market BDs', description: 'Stay off the bad braindances.', icon: 'shield', cadence: 'daily', baseXp: 14, difficulty: 'medium', currentStreak: 11, longestStreak: 11 },
    ],
  });

  // ---- Operations: projects ----------------------------------------------
  const heist = await prisma.project.create({
    data: { userId, moduleId: modules.projects.id, name: 'Pull the Konpeki job', description: 'Get in, grab the Relic, get out clean.', color: '#ff2e88', ordered: true },
  });
  await prisma.projectTask.createMany({
    data: [
      { userId, projectId: heist.id, title: 'Recon the penthouse floor', done: true, sortOrder: 0, estMinutes: 60, completedAt: d(3) },
      { userId, projectId: heist.id, title: 'Source the flathead bot', done: true, sortOrder: 1, estMinutes: 90, completedAt: d(1) },
      { userId, projectId: heist.id, title: 'Breach the Arasaka server', done: false, sortOrder: 2, estMinutes: 120 },
      { userId, projectId: heist.id, title: 'Exfil through the parking garage', done: false, sortOrder: 3, estMinutes: 45 },
    ],
  });
  const apt = await prisma.project.create({
    data: { userId, moduleId: modules.projects.id, name: 'Upgrade the apartment', description: 'Make H10 livable.', color: '#00e5ff', ordered: false },
  });
  await prisma.projectTask.createMany({
    data: [
      { userId, projectId: apt.id, title: 'Mount the new monitor array', done: false, priority: 2, estMinutes: 40 },
      { userId, projectId: apt.id, title: 'Wire the netrunning rig', done: false, priority: 1, estMinutes: 75 },
    ],
  });

  // ---- Bosses ------------------------------------------------------------
  await prisma.boss.create({
    data: { userId, name: 'Ripperdoc debt', kind: 'debt', direction: 'grind_down', targetValue: 6000, currentValue: 3800, unit: '$', color: '#ff5a5a', xpReward: 300, eddieReward: 150 },
  });
  await prisma.boss.create({
    data: { userId, name: 'Cyberarm fund', kind: 'savings', direction: 'charge_up', targetValue: 12000, currentValue: 4200, unit: '$', color: '#43ffa6', xpReward: 400, eddieReward: 200 },
  });

  // ---- Crew (NPCs) -------------------------------------------------------
  await prisma.npc.createMany({
    data: [
      { userId, moduleId: modules.social.id, name: 'Jackie Welles', relationship: 'friend', cadenceDays: 7, lastContactOn: d(2), notes: 'Best choom. Owes a drink.' },
      { userId, moduleId: modules.social.id, name: 'Judy Alvarez', relationship: 'friend', cadenceDays: 14, lastContactOn: d(20), notes: 'BD tech. Overdue for a catch-up.' },
      { userId, moduleId: modules.social.id, name: 'Viktor Vektor', relationship: 'colleague', cadenceDays: 30, lastContactOn: d(40), notes: 'Ripperdoc. Check the new arm.' },
      { userId, moduleId: modules.social.id, name: 'Panam Palmer', relationship: 'friend', cadenceDays: 21, lastContactOn: d(33) },
      { userId, moduleId: modules.social.id, name: 'Rogue Amendiares', relationship: 'colleague', cadenceDays: null },
    ],
  });

  // ---- Braindance queue (media) -----------------------------------------
  await prisma.mediaItem.createMany({
    data: [
      { userId, moduleId: modules.media.id, type: 'show', title: 'Cyberpunk: Edgerunners', status: 'active', totalUnits: 10, unitsDone: 4, externalSource: 'manual', metaJson: JSON.stringify({ episodeCount: 10, runtime: 25 }) },
      { userId, moduleId: modules.media.id, type: 'movie', title: 'Blade Runner 2049', status: 'backlog', estMinutes: 164, externalSource: 'manual' },
      { userId, moduleId: modules.media.id, type: 'game', title: 'Cyberpunk 2077: Phantom Liberty', status: 'backlog', estMinutes: 1500, externalSource: 'manual', metaJson: JSON.stringify({ endless: false }) },
      { userId, moduleId: modules.media.id, type: 'book', title: 'Neuromancer', status: 'backlog', totalUnits: 271, unitsDone: 0, externalSource: 'manual', metaJson: JSON.stringify({ pageCount: 271, readingMinPerPage: 2 }) },
      { userId, moduleId: modules.media.id, type: 'movie', title: 'Ghost in the Shell', status: 'done', estMinutes: 83, externalSource: 'manual' },
    ],
  });

  // ---- A logged workout + a few days of vitals ---------------------------
  await prisma.workoutSession.create({
    data: {
      userId, moduleId: modules.fitness.id, title: 'Combat drills', type: 'strength', performedAt: d(1),
      durationMin: 50, intensity: 'high', xpAwarded: 35,
      exercises: JSON.stringify([
        { exercise: 'Deadlift', sets: [{ reps: 5, weight: 100 }, { reps: 5, weight: 110 }, { reps: 3, weight: 120 }] },
        { exercise: 'Pull-ups', sets: [{ reps: 10 }, { reps: 8 }, { reps: 6 }] },
      ]),
    },
  });
  const vitals: Array<{ key: string; vals: number[] }> = [
    { key: 'sleepHours', vals: [7.5, 6, 8, 7, 6.5] },
    { key: 'mood', vals: [4, 3, 5, 4, 4] },
    { key: 'steps', vals: [8200, 5400, 11000, 9300, 7600] },
  ];
  const metricRows = vitals.flatMap(m => m.vals.map((value, i) => ({ userId, date: d(i + 1), key: m.key, value })));
  await prisma.dailyMetric.createMany({ data: metricRows });

  return user;
}
