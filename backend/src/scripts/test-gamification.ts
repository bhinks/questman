/**
 * One-shot smoke test for GamificationService. Run with: tsx src/scripts/test-gamification.ts
 * Deletes any prior ledger / resets the demo player so it's repeatable.
 */
import { PrismaClient } from '@prisma/client';
import { GamificationService } from '../services/GamificationService';
import { xpForLevel, levelFromXp, levelInfo } from '../utils/leveling';

const prisma = new PrismaClient();

async function main() {
  // Pure-math sanity
  console.log('xpForLevel(1..5):', [1, 2, 3, 4, 5].map(xpForLevel));
  console.log('levelFromXp(0,50,99,100,250,500,1000):',
    [0, 50, 99, 100, 250, 500, 1000].map(levelFromXp));
  console.log('levelInfo(150):', levelInfo(150));
  console.log();

  // Resolve the demo user
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: 'demo@questman.app' },
    select: { id: true },
  });

  // Reset for a clean run
  await prisma.xpLedger.deleteMany({ where: { userId: user.id } });
  await prisma.playerProfile.update({
    where: { userId: user.id },
    data: {
      level: 1, totalXp: 0, xpIntoLevel: 0,
      currentStreak: 0, longestStreak: 0,
      lastActiveOn: null, domainXp: null,
    },
  });

  const game = new GamificationService(prisma);

  // Award 1: 25 XP, fitness module
  const a = await game.awardXp(user.id, {
    amount: 25, reason: 'quest_complete', module: 'fitness',
    refType: 'quest', refId: 'fake-quest-1',
  });
  console.log('After +25 fitness:', { level: a.level, totalXp: a.totalXp, streak: a.currentStreak, domain: a.domainXp });

  // Award 2: 80 XP, finance module — crosses to level 2 (threshold = 100)
  const b = await game.awardXp(user.id, {
    amount: 80, reason: 'quest_complete', module: 'finance',
  });
  console.log('After +80 finance:', { level: b.level, totalXp: b.totalXp, leveledUp: b.leveledUp, prev: b.previousLevel, domain: b.domainXp });

  // Same-day repeat — streak should stay at 1
  const c = await game.awardXp(user.id, {
    amount: 10, reason: 'habit_log', module: 'habits',
  });
  console.log('Same-day +10 habits:', { streak: c.currentStreak, total: c.totalXp });

  // Ledger sanity
  const ledger = await prisma.xpLedger.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'asc' },
  });
  console.log('Ledger rows:', ledger.map(r => ({ amount: r.amount, reason: r.reason, module: r.module })));

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
