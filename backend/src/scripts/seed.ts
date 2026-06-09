import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { logger } from '../utils/logger';
import { provisionLifeHub } from '../utils/provision';

const prisma = new PrismaClient();

async function main() {
  logger.info('🌱 Starting database seeding...');

  // Create demo user
  const hashedPassword = await bcrypt.hash('demo123', 10);
  
  const demoUser = await prisma.user.upsert({
    where: { email: 'demo@questman.app' },
    update: {},
    create: {
      email: 'demo@questman.app',
      password: hashedPassword,
      name: 'Demo User'
    }
  });

  logger.info('✅ Created demo user');

  // Create user settings
  await prisma.userSettings.upsert({
    where: { userId: demoUser.id },
    update: {},
    create: {
      userId: demoUser.id,
      currency: 'USD',
      dateFormat: 'MM/dd/yyyy',
      theme: 'cyberpunk',
      autoCategoriztion: true,
      notifications: true
    }
  });

  logger.info('✅ Created user settings');

  // Create default categories
  const categories = [
    { name: 'Housing', icon: '🏠', color: '#00ff9f', budget: 1500 },
    { name: 'Food & Dining', icon: '🍽️', color: '#ff0080', budget: 800 },
    { name: 'Transportation', icon: '🚗', color: '#0080ff', budget: 600 },
    { name: 'Shopping', icon: '🛍️', color: '#ff8000', budget: 500 },
    { name: 'Entertainment', icon: '🎬', color: '#8000ff', budget: 300 },
    { name: 'Healthcare', icon: '🏥', color: '#ff4040', budget: 400 },
    { name: 'Income', icon: '💰', color: '#40ff40', budget: null },
    { name: 'Utilities', icon: '⚡', color: '#4040ff', budget: 200 },
    { name: 'Subscriptions', icon: '📱', color: '#ffff40', budget: 150 },
    { name: 'Investment', icon: '📈', color: '#ff40ff', budget: null }
  ];

  const createdCategories = [];
  for (const categoryData of categories) {
    const category = await prisma.category.upsert({
      where: { 
        userId_name: { 
          userId: demoUser.id, 
          name: categoryData.name 
        } 
      },
      update: {},
      create: {
        userId: demoUser.id,
        ...categoryData
      }
    });
    createdCategories.push(category);
  }

  logger.info('✅ Created default categories');

  // Create some demo vendors
  const vendors = [
    { name: 'Amazon', website: 'amazon.com' },
    { name: 'Walmart', website: 'walmart.com' },
    { name: 'Starbucks', website: 'starbucks.com' },
    { name: 'Shell', website: 'shell.com' },
    { name: 'Netflix', website: 'netflix.com' },
    { name: 'Spotify', website: 'spotify.com' },
    { name: 'Uber', website: 'uber.com' },
    { name: 'Target', website: 'target.com' }
  ];

  const createdVendors = [];
  for (const vendorData of vendors) {
    const vendor = await prisma.vendor.upsert({
      where: { 
        userId_name: { 
          userId: demoUser.id, 
          name: vendorData.name 
        } 
      },
      update: {},
      create: {
        userId: demoUser.id,
        ...vendorData
      }
    });
    createdVendors.push(vendor);
  }

  logger.info('✅ Created demo vendors');

  // Create demo transactions (last 3 months)
  const now = new Date();
  const transactions = [];
  
  // Income transactions
  for (let i = 0; i < 3; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 15);
    transactions.push({
      userId: demoUser.id,
      date,
      description: 'Salary Deposit',
      amount: 5500,
      categoryId: createdCategories.find(c => c.name === 'Income')?.id,
      isManual: false
    });
  }

  // Expense transactions
  const expenseData = [
    { desc: 'Rent Payment', amount: -1200, category: 'Housing', vendor: null },
    { desc: 'Grocery Shopping', amount: -85.43, category: 'Food & Dining', vendor: 'Walmart' },
    { desc: 'Gas Station', amount: -52.10, category: 'Transportation', vendor: 'Shell' },
    { desc: 'Coffee', amount: -4.75, category: 'Food & Dining', vendor: 'Starbucks' },
    { desc: 'Netflix Subscription', amount: -15.99, category: 'Subscriptions', vendor: 'Netflix' },
    { desc: 'Spotify Premium', amount: -9.99, category: 'Subscriptions', vendor: 'Spotify' },
    { desc: 'Amazon Purchase', amount: -42.99, category: 'Shopping', vendor: 'Amazon' },
    { desc: 'Uber Ride', amount: -18.50, category: 'Transportation', vendor: 'Uber' },
    { desc: 'Target Shopping', amount: -67.32, category: 'Shopping', vendor: 'Target' },
    { desc: 'Electric Bill', amount: -89.45, category: 'Utilities', vendor: null }
  ];

  for (let month = 0; month < 3; month++) {
    for (let i = 0; i < expenseData.length; i++) {
      const expense = expenseData[i];
      const randomDay = Math.floor(Math.random() * 28) + 1;
      const date = new Date(now.getFullYear(), now.getMonth() - month, randomDay);
      
      const vendor = expense.vendor ? createdVendors.find(v => v.name === expense.vendor) : null;
      const category = createdCategories.find(c => c.name === expense.category);
      
      // Add some randomness to amounts
      const amountVariation = 1 + (Math.random() - 0.5) * 0.3; // ±15% variation
      const amount = Math.round(expense.amount * amountVariation * 100) / 100;
      
      transactions.push({
        userId: demoUser.id,
        date,
        description: expense.desc,
        amount,
        categoryId: category?.id,
        vendorId: vendor?.id,
        isManual: false
      });
    }
  }

  // Add some random small transactions
  for (let i = 0; i < 20; i++) {
    const randomDay = Math.floor(Math.random() * 90); // Last 3 months
    const date = new Date(now);
    date.setDate(date.getDate() - randomDay);
    
    const smallExpenses = [
      'Coffee Shop', 'Fast Food', 'Parking', 'Snacks', 'Magazine',
      'Bus Fare', 'Tip', 'Vending Machine', 'Convenience Store'
    ];
    
    transactions.push({
      userId: demoUser.id,
      date,
      description: smallExpenses[Math.floor(Math.random() * smallExpenses.length)],
      amount: -(Math.random() * 25 + 5), // $5-$30
      categoryId: createdCategories.find(c => c.name === 'Food & Dining')?.id,
      isManual: false
    });
  }

  // Insert all transactions
  await prisma.transaction.createMany({
    data: transactions
  });

  logger.info(`✅ Created ${transactions.length} demo transactions`);

  // Create some categorization rules
  const rules = [
    {
      userId: demoUser.id,
      name: 'Auto-categorize Amazon purchases',
      conditions: JSON.stringify({
        descriptionContains: ['amazon', 'amzn']
      }),
      actions: JSON.stringify({
        categoryId: createdCategories.find(c => c.name === 'Shopping')?.id,
        vendorId: createdVendors.find(v => v.name === 'Amazon')?.id
      }),
      priority: 10,
      isActive: true
    },
    {
      userId: demoUser.id,
      name: 'Auto-categorize gas stations',
      conditions: JSON.stringify({
        descriptionContains: ['shell', 'exxon', 'bp', 'chevron', 'gas']
      }),
      actions: JSON.stringify({
        categoryId: createdCategories.find(c => c.name === 'Transportation')?.id
      }),
      priority: 20,
      isActive: true
    }
  ];

  await prisma.categorizationRule.createMany({
    data: rules
  });

  logger.info('✅ Created categorization rules');

  // Update analytics cache
  await prisma.analytics.create({
    data: {
      userId: demoUser.id,
      period: 'monthly',
      date: new Date(),
      metrics: JSON.stringify({
        totalSpent: transactions.filter(t => t.amount < 0).reduce((sum, t) => sum + Math.abs(t.amount), 0),
        totalIncome: transactions.filter(t => t.amount > 0).reduce((sum, t) => sum + t.amount, 0),
        transactionCount: transactions.length,
        lastUpdated: new Date()
      })
    }
  });

  logger.info('✅ Created analytics cache');

  // =====================================================================
  // Life-hub provisioning
  //
  // 1. Optionally provision a real hub user from env (HUB_USER_EMAIL +
  //    HUB_USER_PASSWORD). Idempotent: re-running the seed doesn't reset
  //    the password if the account already exists. Used by Docker.
  // 2. For every user that needs it, ensure the 4 modules + a player
  //    profile + a few demo habits/chores + a workout exist. Idempotent.
  // =====================================================================

  const hubEmail = process.env.HUB_USER_EMAIL;
  const hubPassword = process.env.HUB_USER_PASSWORD;
  const hubName = process.env.HUB_USER_NAME || 'You';

  const usersToProvision: { id: string }[] = [{ id: demoUser.id }];

  if (hubEmail && hubPassword) {
    if (hubPassword.length < 8) {
      throw new Error('HUB_USER_PASSWORD must be at least 8 characters');
    }
    const existing = await prisma.user.findUnique({
      where: { email: hubEmail },
      select: { id: true },
    });
    if (existing) {
      logger.info(`✅ Hub user already exists: ${hubEmail}`);
      usersToProvision.push(existing);
    } else {
      const hashed = await bcrypt.hash(hubPassword, 12);
      const created = await prisma.user.create({
        data: {
          email: hubEmail,
          password: hashed,
          name: hubName,
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
        select: { id: true },
      });
      logger.info(`✅ Created hub user: ${hubEmail}`);
      usersToProvision.push(created);
    }
  }

  for (const u of usersToProvision) {
    // Modules + player profile + default vitals metric set (shared with
    // the /register route via provisionLifeHub — keeps the two in sync).
    const modules = await provisionLifeHub(prisma, u.id);

    // Demo habits + chores + a workout. Only seed if the user has no
    // habits yet, so re-runs don't double up after the user has built
    // their own.
    const existingHabits = await prisma.habit.count({ where: { userId: u.id } });
    if (existingHabits === 0) {
      await prisma.habit.createMany({
        data: [
          {
            userId: u.id, moduleId: modules.habits.id, kind: 'habit',
            title: 'Drink 8 glasses of water', description: 'Stay hydrated.',
            icon: 'spark', cadence: 'daily', targetPerDay: 1,
            baseXp: 10, difficulty: 'easy',
          },
          {
            userId: u.id, moduleId: modules.habits.id, kind: 'habit',
            title: 'Read for 20 minutes', description: 'Anything counts.',
            icon: 'book', cadence: 'daily', targetPerDay: 1,
            baseXp: 15, difficulty: 'easy',
          },
          {
            userId: u.id, moduleId: modules.chores.id, kind: 'chore',
            title: 'Take out the trash', description: 'Mondays and Thursdays.',
            icon: 'list', cadence: 'custom',
            schedule: JSON.stringify({ daysOfWeek: [1, 4] }),
            baseXp: 15, difficulty: 'easy',
          },
          {
            userId: u.id, moduleId: modules.chores.id, kind: 'chore',
            title: 'Clean the kitchen', description: 'Counters + sink + floor.',
            icon: 'spark', cadence: 'weekly',
            schedule: JSON.stringify({ daysOfWeek: [0] }),
            baseXp: 25, difficulty: 'medium',
          },
        ],
      });
    }

    const existingWorkouts = await prisma.workoutSession.count({
      where: { userId: u.id },
    });
    if (existingWorkouts === 0) {
      await prisma.workoutSession.create({
        data: {
          userId: u.id, moduleId: modules.fitness.id,
          title: 'Sample push day', type: 'strength',
          performedAt: new Date(),
          durationMin: 45, intensity: 'moderate', xpAwarded: 30,
          exercises: JSON.stringify([
            { exercise: 'Bench press', sets: [{ reps: 8, weight: 60 }, { reps: 8, weight: 60 }, { reps: 6, weight: 65 }] },
            { exercise: 'Overhead press', sets: [{ reps: 10, weight: 35 }, { reps: 10, weight: 35 }] },
          ]),
        },
      });
    }
  }

  logger.info('✅ Provisioned life-hub modules / player / demo habits');

  logger.info('🎉 Database seeding completed successfully!');
  logger.info('📧 Demo user: demo@questman.app');
  logger.info('🔑 Password: demo123');
  if (hubEmail) {
    logger.info(`👤 Hub user: ${hubEmail}`);
  }
}

main()
  .catch((e) => {
    logger.error('❌ Database seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });