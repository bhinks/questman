/**
 * Boot seed (docker-entrypoint). Provisions ONLY the real hub user from env
 * (HUB_USER_EMAIL / HUB_USER_PASSWORD): the modules + player profile + vitals
 * metric set, plus a few starter habits/workout on a fresh account.
 *
 * The demo account is NOT created here — it's built on demand (and re-seeded
 * each visit) by the DEMO button via seedDemoUser (utils/demoSeed.ts), so a
 * prod instance never carries a throwaway demo login as its fallback identity.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { logger } from '../utils/logger';
import { provisionLifeHub } from '../utils/provision';

const prisma = new PrismaClient();

async function main() {
  logger.info('🌱 Provisioning the life-hub…');

  const hubEmail = process.env.HUB_USER_EMAIL;
  const hubPassword = process.env.HUB_USER_PASSWORD;
  const hubName = process.env.HUB_USER_NAME || 'You';

  if (!hubEmail || !hubPassword) {
    logger.info('ℹ️  No HUB_USER_EMAIL/HUB_USER_PASSWORD set — nothing to provision.');
    logger.info('    Set them to create your hub account, or use the DEMO button to explore.');
    return;
  }
  if (hubPassword.length < 8) {
    throw new Error('HUB_USER_PASSWORD must be at least 8 characters');
  }

  let hub = await prisma.user.findUnique({ where: { email: hubEmail }, select: { id: true, role: true } });
  if (hub) {
    logger.info(`✅ Hub user already exists: ${hubEmail}`);
    // Ensure the hub user is admin if no admin exists yet (migration safety net).
    if (hub.role !== 'admin') {
      const adminCount = await prisma.user.count({ where: { role: 'admin' } });
      if (adminCount === 0) {
        await prisma.user.update({ where: { id: hub.id }, data: { role: 'admin' } });
        logger.info(`✅ Granted admin role to hub user: ${hubEmail}`);
      }
    }
  } else {
    // New install: first user is always admin.
    const hashed = await bcrypt.hash(hubPassword, 12);
    hub = await prisma.user.create({
      data: {
        email: hubEmail,
        password: hashed,
        name: hubName,
        role: 'admin',
        settings: {
          create: {
            currency: 'USD',
            dateFormat: 'MM/dd/yyyy',
            theme: 'cyberpunk',
            autoCategoriztion: true,
            notifications: true,
          },
        },
      },
      select: { id: true, role: true },
    });
    logger.info(`✅ Created hub user (admin): ${hubEmail}`);
  }

  // Modules + player profile + default vitals metric set (shared with the
  // /register route via provisionLifeHub).
  const modules = await provisionLifeHub(prisma, hub.id);

  // Starter habits + chores + a workout, only on a brand-new account so a
  // re-run never doubles up after the user has built their own.
  const existingHabits = await prisma.habit.count({ where: { userId: hub.id } });
  if (existingHabits === 0) {
    await prisma.habit.createMany({
      data: [
        {
          userId: hub.id, moduleId: modules.habits.id, kind: 'habit',
          title: 'Drink 8 glasses of water', description: 'Stay hydrated.',
          icon: 'spark', cadence: 'daily', targetPerDay: 1, baseXp: 10, difficulty: 'easy',
        },
        {
          userId: hub.id, moduleId: modules.habits.id, kind: 'habit',
          title: 'Read for 20 minutes', description: 'Anything counts.',
          icon: 'book', cadence: 'daily', targetPerDay: 1, baseXp: 15, difficulty: 'easy',
        },
        {
          userId: hub.id, moduleId: modules.chores.id, kind: 'chore',
          title: 'Take out the trash', description: 'Mondays and Thursdays.',
          icon: 'list', cadence: 'custom', schedule: JSON.stringify({ daysOfWeek: [1, 4] }),
          baseXp: 15, difficulty: 'easy',
        },
        {
          userId: hub.id, moduleId: modules.chores.id, kind: 'chore',
          title: 'Clean the kitchen', description: 'Counters + sink + floor.',
          icon: 'spark', cadence: 'weekly', schedule: JSON.stringify({ daysOfWeek: [0] }),
          baseXp: 25, difficulty: 'medium',
        },
      ],
    });
  }

  const existingWorkouts = await prisma.workoutSession.count({ where: { userId: hub.id } });
  if (existingWorkouts === 0) {
    await prisma.workoutSession.create({
      data: {
        userId: hub.id, moduleId: modules.fitness.id,
        title: 'Sample push day', type: 'strength', performedAt: new Date(),
        durationMin: 45, intensity: 'moderate', xpAwarded: 30,
        exercises: JSON.stringify([
          { exercise: 'Bench press', sets: [{ reps: 8, weight: 60 }, { reps: 8, weight: 60 }, { reps: 6, weight: 65 }] },
          { exercise: 'Overhead press', sets: [{ reps: 10, weight: 35 }, { reps: 10, weight: 35 }] },
        ]),
      },
    });
  }

  logger.info(`🎉 Provisioned life-hub for ${hubEmail}.`);
}

main()
  .catch((e) => {
    logger.error('❌ Provisioning failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
