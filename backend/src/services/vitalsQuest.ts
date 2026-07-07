/**
 * vitalsQuest — shared auto-completion of the daily "log your vitals" quest.
 *
 * The closed loop ("vitals land → the check-in quest clears + XP/eddies")
 * used to live only inside PUT /api/metrics, the interactive SUBMIT. But
 * vitals also land without a submit — the phone pull (healthSync.pullNow)
 * and the push webhook (POST /api/ingest/health-connect) — and those must
 * clear the same pending quest so the user isn't asked to re-enter data the
 * server already has.
 *
 * Idempotent by construction: the quest match is on status 'pending', so a
 * repeat call after completion finds nothing and no-ops (award-once).
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { GamificationService } from './GamificationService';
import { eddiesForReward } from '../utils/economy';
import { startOfLocalDay } from '../utils/dates';

export interface VitalsQuestCompletion {
  questAutoCompleted: { id: string; xpReward: number };
  player: Awaited<ReturnType<GamificationService['awardXp']>>;
}

/**
 * Complete the day's pending vitals check-in quest inside an EXISTING
 * transaction. Vitals quests carry no sourceId (one generic check-in), so
 * the match is on source + questDate + status. Returns null when nothing is
 * pending (already completed / no quest generated today).
 */
export async function completeVitalsQuest(
  tx: Prisma.TransactionClient,
  game: GamificationService,
  userId: string,
  day: Date,
  trigger: string,
): Promise<VitalsQuestCompletion | null> {
  const q = await tx.quest.findFirst({
    where: { userId, source: 'vitals', sourceId: null, questDate: day, status: 'pending' },
  });
  if (!q) return null;

  await tx.quest.update({
    where: { id: q.id },
    data: { status: 'completed', progress: 1, currentCount: q.targetCount },
  });
  await tx.questCompletion.create({
    data: {
      userId, questId: q.id, xpAwarded: q.xpReward,
      meta: JSON.stringify({ trigger }),
    },
  });
  const player = await game.awardXp(userId, {
    amount: q.xpReward,
    eddies: eddiesForReward(q.xpReward, q.difficulty),
    reason: 'quest_complete',
    module: 'vitals',
    refType: 'quest',
    refId: q.id,
  }, tx);

  return { questAutoCompleted: { id: q.id, xpReward: q.xpReward }, player };
}

/**
 * Sync-path trigger: after a successful ingest, clear TODAY's pending vitals
 * quest — but only when today's log actually has rows (a purely historic
 * backfill must not clear the check-in). Opens its own transaction and
 * mirrors the interactive submit's WS broadcast so the HUD updates live.
 * Callers wrap it best-effort (`.catch(() => {})`) — a quest/XP hiccup must
 * never fail a sync.
 */
export async function completeVitalsQuestForToday(
  prisma: PrismaClient,
  userId: string,
): Promise<void> {
  const day = startOfLocalDay();
  const logged = await prisma.dailyMetric.count({ where: { userId, date: day } });
  if (logged === 0) return;

  // Cheap pre-check outside the transaction: the common repeat-sync case is
  // "already completed", which shouldn't cost a write transaction at all.
  const pending = await prisma.quest.findFirst({
    where: { userId, source: 'vitals', sourceId: null, questDate: day, status: 'pending' },
    select: { id: true },
  });
  if (!pending) return;

  const game = new GamificationService(prisma);
  let done: VitalsQuestCompletion | null = null;
  await prisma.$transaction(async (tx) => {
    done = await completeVitalsQuest(tx, game, userId, day, 'vitals-sync');
  });

  const ws = (global as any).wsService;
  if (ws?.broadcastGameEvent && done) {
    ws.broadcastGameEvent(userId, 'vitals-logged', {
      questAutoCompleted: (done as VitalsQuestCompletion).questAutoCompleted,
    });
  }
}
