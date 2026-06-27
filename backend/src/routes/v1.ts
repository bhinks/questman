/**
 * /api/v1 — external REST API (bearer token auth via user API keys).
 *
 * Initial scope: read-only access to the data Brent wants Nova to see.
 *
 * GET /api/v1/today — today's quest summary (same data as the internal
 *   /api/quests/today endpoint, with the same lazy-generation side effect).
 */
import express from 'express';
import { prisma } from '../server';
import { AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { QuestEngine } from '../services/QuestEngine';
import { startOfLocalDay } from '../utils/dates';

const router = express.Router();
let _engine: QuestEngine | null = null;
const engine = () => (_engine ??= new QuestEngine(prisma));

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

/**
 * GET /api/v1/today
 *
 * Returns today's quests for the authenticated user (authenticated via a
 * user-generated API key). Mirrors the /api/quests/today response shape so
 * external consumers can rely on the same contract.
 */
router.get('/today', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const today = startOfLocalDay();

  const result = await engine().ensureToday(userId);

  const quests = await prisma.quest.findMany({
    where: { userId, questDate: today },
    orderBy: [{ status: 'asc' }, { difficulty: 'asc' }, { createdAt: 'asc' }],
    include: { module: { select: { key: true, name: true, color: true, icon: true } } },
  });

  const grouped: Record<string, unknown[]> = {};
  let xpAvailable = 0;
  let xpEarned = 0;
  let completedCount = 0;
  let plannedCount = 0;

  for (const q of quests) {
    const key = q.module.key;
    (grouped[key] ??= []).push({ ...q, meta: parseJson(q.meta) });

    if (q.adhoc) continue;
    plannedCount += 1;

    if (q.status === 'completed') {
      completedCount += 1;
      xpEarned += q.xpReward;
    } else if (q.status === 'pending') {
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

export default router;
