/**
 * Boss fights route — "World Mechanics" big-goal slice.
 *
 * A Boss has HP you grind down (debt/project/challenge) or charge up
 * (savings). Damage is dealt MANUALLY (log a hit) or AUTOMATICALLY when a
 * linked project's milestone completes. Defeating one pays XP + eddies once
 * (idempotent on the active->defeated transition), via GamificationService.
 *
 * Conventions mirror routes/media.ts & routes/projects.ts:
 *   - userId-scoped queries (req.user!.id), router is auth-mounted.
 *   - SQLite has no JSON column: BossLog.note carries the dedupe tag for
 *     auto-damage (a JSON string {milestoneId}).
 *   - XP/eddies are server-owned via GamificationService inside a tx.
 *
 * Exports `dealBossDamageForLinkedProject`, called by routes/projects.ts
 * inside the milestone-completion transaction.
 */
import express from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../server';
import { AuthRequest } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { GamificationService } from '../services/GamificationService';

const router = express.Router();

let _game: GamificationService | null = null;
const game = () => (_game ??= new GamificationService(prisma));

type Tx = Prisma.TransactionClient;
type BossRow = Prisma.BossGetPayload<{}>;

const KIND = z.enum(['debt', 'savings', 'project', 'challenge', 'custom']);
const DIRECTION = z.enum(['grind_down', 'charge_up']);

// --- serialization ------------------------------------------------------

/**
 * Compute the HP-bar conveniences (pct toward defeat, remaining HP/charge)
 * and shape a Boss row for the API.
 *
 *   grind_down: remaining = currentValue (HP left); pct = how far reduced.
 *   charge_up:  remaining = targetValue - currentValue; pct = how far charged.
 */
function serialize<T extends BossRow & { logs?: unknown[] }>(boss: T) {
  const target = boss.targetValue;
  let pct: number;
  let remaining: number;
  if (boss.direction === 'grind_down') {
    remaining = Math.max(0, boss.currentValue);
    pct = target > 0 ? ((target - remaining) / target) * 100 : 100;
  } else {
    remaining = Math.max(0, target - boss.currentValue);
    pct = target > 0 ? (boss.currentValue / target) * 100 : 100;
  }
  pct = Math.max(0, Math.min(100, Math.round(pct * 10) / 10));
  return { ...boss, pct, remaining: Math.round(remaining * 100) / 100 };
}

// --- shared damage/defeat helper ---------------------------------------

/**
 * The ONE place damage/contribution is applied + a BossLog written + the
 * defeat transition checked. Runs inside the caller's transaction.
 *
 * Defeat is IDEMPOTENT and pays EXACTLY ONCE: the reward is gated behind a
 * guarded `updateMany(where: id + status:'active')` so a double-submit or
 * concurrent hit can never flip the row (and thus pay) twice. We only award
 * + report `defeated` on the request that actually performs the transition.
 *
 * Returns the post-hit boss, whether THIS call defeated it, and (only on the
 * defeating transition) the post-award player snapshot.
 */
async function applyBossHit(
  tx: Tx,
  userId: string,
  boss: BossRow,
  amount: number,
  source: 'manual' | 'project_milestone',
  note: string | null,
): Promise<{
  boss: BossRow;
  defeated: boolean;
  player: Awaited<ReturnType<GamificationService['awardXp']>> | null;
}> {
  const target = boss.targetValue;
  const nextValue = boss.direction === 'grind_down'
    ? Math.max(0, boss.currentValue - amount)
    : Math.min(target, boss.currentValue + amount);

  const reachedThreshold = boss.direction === 'grind_down'
    ? nextValue <= 0
    : nextValue >= target;

  // Always move the gauge + log the contribution.
  await tx.boss.update({
    where: { id: boss.id },
    data: { currentValue: nextValue },
  });
  await tx.bossLog.create({
    data: { bossId: boss.id, userId, amount, source, note },
  });

  let defeated = false;
  let player: Awaited<ReturnType<GamificationService['awardXp']>> | null = null;

  // Defeat transition — guarded so it fires at most once, ever. Only the
  // request that actually flips active->defeated pays the kill-screen reward.
  if (boss.status === 'active' && reachedThreshold) {
    const flipped = await tx.boss.updateMany({
      where: { id: boss.id, status: 'active' },
      data: { status: 'defeated', defeatedAt: new Date() },
    });
    if (flipped.count === 1) {
      defeated = true;
      // Ledger idempotency: pay the kill-screen reward at most ONCE per boss,
      // EVER. The active->defeated flip alone isn't enough — status is
      // resettable (PUT /:id can set 'active'), so a revive + re-defeat could
      // otherwise re-pay. Mirror the milestone guard (projects.ts): the
      // immutable ledger is the source of truth.
      const alreadyPaid = await tx.xpLedger.findFirst({
        where: { userId, reason: 'boss_defeat', refType: 'boss', refId: boss.id },
        select: { id: true },
      });
      if (!alreadyPaid) {
        player = await game().awardXp(userId, {
          amount: boss.xpReward,
          eddies: boss.eddieReward,
          reason: 'boss_defeat',
          refType: 'boss',
          refId: boss.id,
        }, tx);
      }
    }
  }

  const updated = await tx.boss.findUniqueOrThrow({ where: { id: boss.id } });
  return { boss: updated, defeated, player };
}

// --- auto-damage hook (called by routes/projects.ts) --------------------

/**
 * Apply automatic boss damage when milestone `milestoneId` of `projectId`
 * completes. For each ACTIVE boss linked to the project, deal one phase
 * (1 damage) and run the shared defeat check. Runs inside the caller's tx.
 *
 * Idempotent per milestone: we tag each auto-hit's BossLog.note with a JSON
 * {milestoneId} and skip a boss that already has a log for this milestone —
 * so re-toggling the milestone done off/on never re-damages.
 */
export async function dealBossDamageForLinkedProject(
  tx: Tx,
  userId: string,
  projectId: string,
  milestoneId: string,
): Promise<void> {
  const bosses = await tx.boss.findMany({
    where: { userId, linkedProjectId: projectId, status: 'active' },
  });
  if (bosses.length === 0) return;

  const tag = JSON.stringify({ milestoneId });

  for (const boss of bosses) {
    // Dedupe: skip if this milestone already chipped this boss.
    const already = await tx.bossLog.findFirst({
      where: { bossId: boss.id, source: 'project_milestone', note: tag },
      select: { id: true },
    });
    if (already) continue;

    await applyBossHit(tx, userId, boss, 1, 'project_milestone', tag);
  }
}

// --- list ---------------------------------------------------------------

/** GET /api/bosses — active first, then defeated/abandoned. Includes each
 *  boss's last 2 hits so the dossier mini hit-log renders without a per-boss
 *  detail fetch. */
router.get('/', asyncHandler(async (req: AuthRequest, res) => {
  const bosses = await prisma.boss.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: 'desc' },
    include: { logs: { take: 2, orderBy: { createdAt: 'desc' } } },
  });

  // Active first, then everything else (most-recently-created within each).
  bosses.sort((a, b) => {
    const ar = a.status === 'active' ? 0 : 1;
    const br = b.status === 'active' ? 0 : 1;
    if (ar !== br) return ar - br;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  res.json({ bosses: bosses.map(serialize) });
}));

// --- create -------------------------------------------------------------

const createSchema = z.object({
  name:            z.string().min(1).max(200),
  kind:            KIND,
  direction:       DIRECTION,
  targetValue:     z.number().positive().max(1e12),
  unit:            z.string().max(20).nullable().optional(),
  color:           z.string().max(40).nullable().optional(),
  linkedProjectId: z.string().nullable().optional(),
  xpReward:        z.number().int().min(0).max(100000).optional(),
  eddieReward:     z.number().int().min(0).max(100000).optional(),
});

/**
 * POST /api/bosses — spawn a boss. currentValue seeds from the direction:
 * grind_down starts at full HP (targetValue), charge_up starts empty (0).
 * A linkedProjectId must belong to the user.
 */
router.post('/', asyncHandler(async (req: AuthRequest, res) => {
  const data = createSchema.parse(req.body);
  const userId = req.user!.id;

  if (data.linkedProjectId) {
    const project = await prisma.project.findFirst({
      where: { id: data.linkedProjectId, userId },
      select: { id: true },
    });
    if (!project) throw new AppError('Linked project not found', 400);
  }

  const boss = await prisma.boss.create({
    data: {
      userId,
      name: data.name,
      kind: data.kind,
      direction: data.direction,
      targetValue: data.targetValue,
      currentValue: data.direction === 'grind_down' ? data.targetValue : 0,
      unit: data.unit ?? null,
      color: data.color ?? null,
      linkedProjectId: data.linkedProjectId ?? null,
      ...(data.xpReward !== undefined && { xpReward: data.xpReward }),
      ...(data.eddieReward !== undefined && { eddieReward: data.eddieReward }),
    },
  });

  res.status(201).json({ boss: serialize(boss) });
}));

// --- detail -------------------------------------------------------------

/** GET /api/bosses/:id — the boss plus its recent damage log. */
router.get('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const boss = await prisma.boss.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
    include: { logs: { orderBy: { createdAt: 'desc' }, take: 50 } },
  });
  if (!boss) throw new AppError('Boss not found', 404);
  res.json({ boss: serialize(boss) });
}));

// --- hit (the core action) ----------------------------------------------

const hitSchema = z.object({
  amount: z.number().positive().max(1e12),
  note:   z.string().max(500).nullable().optional(),
});

/**
 * POST /api/bosses/:id/hit — deal a manual hit (damage / contribution).
 *
 * Applies the gauge move + a manual BossLog + the defeat check inside ONE
 * transaction via the shared helper. Responds BossHitResponse: the updated
 * boss, whether this hit defeated it, and (only on defeat) the post-award
 * player snapshot for the kill screen + HUD refresh.
 */
router.post('/:id/hit', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const data = hitSchema.parse(req.body);

  const existing = await prisma.boss.findFirst({
    where: { id: req.params.id, userId },
  });
  if (!existing) throw new AppError('Boss not found', 404);
  if (existing.status !== 'active') {
    throw new AppError('That boss is no longer active', 400);
  }

  const result = await prisma.$transaction((tx) =>
    applyBossHit(tx, userId, existing, data.amount, 'manual', data.note ?? null),
  );

  const ws = (global as any).wsService;
  if (ws?.broadcastGameEvent && result.defeated) {
    ws.broadcastGameEvent(userId, 'boss-defeated', {
      bossId: existing.id, name: existing.name,
      xpReward: existing.xpReward, eddieReward: existing.eddieReward,
    });
  }

  res.json({
    boss: serialize(result.boss),
    defeated: result.defeated,
    ...(result.player ? { player: result.player } : {}),
  });
}));

// --- edit ---------------------------------------------------------------

const updateSchema = z.object({
  name:        z.string().min(1).max(200).optional(),
  unit:        z.string().max(20).nullable().optional(),
  color:       z.string().max(40).nullable().optional(),
  targetValue: z.number().positive().max(1e12).optional(),
  xpReward:    z.number().int().min(0).max(100000).optional(),
  eddieReward: z.number().int().min(0).max(100000).optional(),
  status:      z.enum(['active', 'abandoned']).optional(),
});

/**
 * PUT /api/bosses/:id — edit labels / target / rewards / status (e.g.
 * abandon). Does NOT pay any reward (that's the defeat transition's job).
 * Raising targetValue on a grind_down boss can re-open HP; we leave
 * currentValue alone so the user stays in control of the gauge.
 */
router.put('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const data = updateSchema.parse(req.body);

  const existing = await prisma.boss.findFirst({
    where: { id: req.params.id, userId },
    select: { id: true },
  });
  if (!existing) throw new AppError('Boss not found', 404);

  const boss = await prisma.boss.update({
    where: { id: existing.id },
    data: {
      name:        data.name,
      unit:        data.unit === undefined ? undefined : data.unit,
      color:       data.color === undefined ? undefined : data.color,
      targetValue: data.targetValue,
      xpReward:    data.xpReward,
      eddieReward: data.eddieReward,
      status:      data.status,
    },
  });

  res.json({ boss: serialize(boss) });
}));

// --- delete -------------------------------------------------------------

/**
 * DELETE /api/bosses/:id — removes the boss + its logs (cascade).
 * XP-integrity rule: any kill-screen reward already paid stays in the
 * ledger; deleting the boss only drops the tracking record.
 */
router.delete('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const existing = await prisma.boss.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
    select: { id: true },
  });
  if (!existing) throw new AppError('Boss not found', 404);

  await prisma.boss.delete({ where: { id: existing.id } });
  res.status(204).end();
}));

export default router;
