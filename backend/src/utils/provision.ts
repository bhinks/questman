/**
 * Life-hub provisioning — the idempotent core that every user needs to
 * use the app: the module set (nav + quest attribution), a PlayerProfile,
 * and the default vitals metric set. Shared by the seed script AND the
 * /register route, so a newly-registered user isn't missing modules
 * (without these, QuestEngine.moduleIdFor throws on quest generation).
 *
 * Demo content (sample habits/workouts) is NOT here — that belongs to the
 * seed only.
 */
import { PrismaClient } from '@prisma/client';

export const MODULE_SEEDS = [
  { key: 'finance',  name: 'Finance',  icon: 'layers', color: 'var(--cyan)',    sortOrder: 0 },
  { key: 'fitness',  name: 'Fitness',  icon: 'target', color: 'var(--lime)',    sortOrder: 1 },
  { key: 'habits',   name: 'Habits',   icon: 'check',  color: 'var(--violet)',  sortOrder: 2 },
  { key: 'chores',   name: 'Chores',   icon: 'list',   color: 'var(--magenta)', sortOrder: 3 },
  { key: 'projects', name: 'Projects', icon: 'grid',   color: 'var(--cyan)',    sortOrder: 4 },
  { key: 'media',    name: 'Media',    icon: 'play',   color: 'var(--violet)',  sortOrder: 5 },
  { key: 'vitals',   name: 'Vitals',   icon: 'heart',  color: 'var(--lime)',    sortOrder: 6 },
  { key: 'social',   name: 'Social',   icon: 'spark',  color: 'var(--magenta)', sortOrder: 7 },
  { key: 'steam',    name: 'Steam',    icon: 'target', color: 'var(--cyan)',    sortOrder: 8 },
] as const;

// Default vitals metric set. Water lives here (moved out of habits).
export const METRIC_SEEDS = [
  { key: 'weight',     label: 'Weight',       unit: 'lb',      kind: 'number',  sortOrder: 0, min: 0, max: 1000 },
  { key: 'sleepHours', label: 'Sleep',        unit: 'h',       kind: 'number',  sortOrder: 1, min: 0, max: 24 },
  { key: 'mood',       label: 'Mood',         unit: '/5',      kind: 'scale',   sortOrder: 2, min: 1, max: 5 },
  { key: 'water',      label: 'Water',        unit: 'glasses', kind: 'integer', sortOrder: 3, min: 0, max: 30 },
  { key: 'workHours',  label: 'Focus work',   unit: 'h',       kind: 'number',  sortOrder: 4, min: 0, max: 24 },
  { key: 'steps',      label: 'Steps',        unit: '',        kind: 'integer', sortOrder: 5, min: 0, max: 100000 },
  { key: 'bpSys',      label: 'BP systolic',  unit: 'mmHg',    kind: 'integer', sortOrder: 6, min: 0, max: 300 },
  { key: 'bpDia',      label: 'BP diastolic', unit: 'mmHg',    kind: 'integer', sortOrder: 7, min: 0, max: 200 },
  { key: 'restingHr',  label: 'Resting HR',   unit: 'bpm',     kind: 'integer', sortOrder: 8, min: 0, max: 250 },
] as const;

/**
 * Ensure a user has the module set, a player profile, and the default
 * metric defs. Idempotent (upserts by unique key) — safe to call on every
 * login/seed/register. Returns the module map keyed by module key.
 */
export async function provisionLifeHub(
  prisma: PrismaClient,
  userId: string,
): Promise<Record<string, { id: string }>> {
  const modules: Record<string, { id: string }> = {};
  for (const m of MODULE_SEEDS) {
    const mod = await prisma.module.upsert({
      where: { userId_key: { userId, key: m.key } },
      update: {},
      create: { userId, ...m },
      select: { id: true, key: true },
    });
    modules[mod.key] = { id: mod.id };
  }

  await prisma.playerProfile.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });

  for (const m of METRIC_SEEDS) {
    await prisma.metricDef.upsert({
      where: { userId_key: { userId, key: m.key } },
      update: {},
      create: { userId, ...m },
    });
  }

  return modules;
}
