/**
 * insights.ts — the cross-domain insights engine.
 *
 * Two halves:
 *   - generateInsightsForWeek(): run the conservative correlation finder
 *     (digest.computeCorrelations) and persist the findings as Insight rows
 *     for a review week. Deterministic + honest; no Claude call needed (the
 *     wording is already "possible pattern", the Handler re-voices patterns
 *     in the weekly debrief narrative instead).
 *   - acceptInsight(): the economy-sensitive bit. When the user ACCEPTS an
 *     insight's suggested action, the SERVER materializes one constrained,
 *     low-XP quest from an allowlist of action types. The AI never sets the
 *     reward — the economy stays server-owned. Idempotent via a guarded
 *     status transition so a double-click spawns exactly one quest.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { startOfLocalDay } from '../utils/dates';
import { computeCorrelations, CorrelationFinding, InsightActionType } from './digest';
import { logger } from '../utils/logger';
import { config } from '../config';

type Tx = Prisma.TransactionClient;
type Db = PrismaClient | Tx;

/**
 * Compute + persist this week's insights. Returns the created rows (lightly
 * typed). Skips silently on any failure — insights are never load-bearing.
 */
export async function generateInsightsForWeek(
  db: Db,
  userId: string,
  weekOf: Date,
): Promise<Array<{ title: string; evidence: string }>> {
  if (!config.features.insights) return [];
  let findings: CorrelationFinding[] = [];
  try {
    findings = await computeCorrelations(db, userId);
  } catch (err: any) {
    logger.warn(`[insights] correlation compute failed: ${err?.message ?? err}`);
    return [];
  }
  // Cap at 2 actionable nudges (roadmap: "1-2 actionable nudges"). Prefer
  // higher-confidence findings.
  const ranked = [...findings].sort((a, b) => (b.confidence === 'medium' ? 1 : 0) - (a.confidence === 'medium' ? 1 : 0));
  const chosen = ranked.slice(0, 2);

  for (const f of chosen) {
    try {
      await db.insight.create({
        data: {
          userId,
          weekOf,
          kind: f.kind,
          title: f.title,
          body: f.body,
          evidence: f.evidence,
          confidence: f.confidence,
          windowDays: f.windowDays,
          suggestion: f.suggestion,
          actionType: f.actionType,
        },
      });
    } catch (err: any) {
      logger.warn(`[insights] persist failed: ${err?.message ?? err}`);
    }
  }
  return chosen.map(f => ({ title: f.title, evidence: f.evidence }));
}

// Allowlist: action type → the quest template the server spawns. moduleKey
// must be an existing, enabled module; xp is server-fixed and small.
const ACTION_TEMPLATES: Record<Exclude<InsightActionType, 'none'>, { moduleKey: string; title: string; xp: number; difficulty: string }> = {
  reach_out:     { moduleKey: 'social',  title: 'Reach out to a contact going cold', xp: 15, difficulty: 'easy' },
  review_budget: { moduleKey: 'finance', title: 'Review the budget running hot',       xp: 15, difficulty: 'easy' },
  review_spend:  { moduleKey: 'finance', title: 'Review the last few days of spending', xp: 15, difficulty: 'easy' },
  log_sleep:     { moduleKey: 'vitals',  title: 'Log tonight\'s sleep',                 xp: 10, difficulty: 'easy' },
};

export interface AcceptResult {
  spawned: boolean;
  questId?: string;
  reason?: string;
}

/**
 * Accept an insight's suggested action → spawn one server-owned quest for
 * today. Idempotent: the insight's status transition (new/accepted →
 * spawned) is the guard, so a double-submit creates exactly one quest. The
 * reward is fixed by the server template (the AI never mints economy).
 */
export async function acceptInsight(prisma: PrismaClient, userId: string, insightId: string): Promise<AcceptResult> {
  const insight = await prisma.insight.findFirst({ where: { id: insightId, userId } });
  if (!insight) return { spawned: false, reason: 'not_found' };
  if (insight.status === 'spawned' && insight.spawnedQuestId) {
    return { spawned: false, reason: 'already_spawned', questId: insight.spawnedQuestId };
  }
  if (insight.actionType === 'none' || !(insight.actionType in ACTION_TEMPLATES)) {
    return { spawned: false, reason: 'no_action' };
  }
  const tpl = ACTION_TEMPLATES[insight.actionType as keyof typeof ACTION_TEMPLATES];

  // Module must exist + be enabled, else we can't place the quest.
  const mod = await prisma.module.findUnique({
    where: { userId_key: { userId, key: tpl.moduleKey } },
    select: { id: true, isEnabled: true },
  });
  if (!mod || !mod.isEnabled) return { spawned: false, reason: 'module_unavailable' };

  const today = startOfLocalDay();
  try {
    const questId = await prisma.$transaction(async (tx) => {
      // Guarded status flip — only the request that actually moves the row
      // off new/accepted proceeds to create the quest.
      const flip = await tx.insight.updateMany({
        where: { id: insight.id, userId, status: { in: ['new', 'accepted'] } },
        data: { status: 'spawned' },
      });
      if (flip.count !== 1) return null; // lost the race / already spawned

      const quest = await tx.quest.create({
        data: {
          userId,
          moduleId: mod.id,
          questDate: today,
          title: tpl.title,
          description: insight.suggestion ?? tpl.title,
          difficulty: tpl.difficulty,
          xpReward: tpl.xp,
          source: 'insight',
          sourceId: insight.id,
          status: 'pending',
          target: 1,
          progress: 0,
          isAiThemed: false,
          meta: JSON.stringify({ emoji: '🧠', fromInsight: insight.kind }),
          targetCount: 1,
          currentCount: 0,
          carryOver: true,
          mustDo: false,
          originDate: today,
        },
        select: { id: true },
      });
      await tx.insight.update({ where: { id: insight.id }, data: { spawnedQuestId: quest.id } });
      return quest.id;
    });
    if (!questId) {
      // Race lost — return whatever quest already got linked.
      const fresh = await prisma.insight.findUnique({ where: { id: insight.id }, select: { spawnedQuestId: true } });
      return { spawned: false, reason: 'already_spawned', questId: fresh?.spawnedQuestId ?? undefined };
    }
    return { spawned: true, questId };
  } catch (err: any) {
    // A duplicate (same source+sourceId already scheduled today) — treat as
    // already done rather than a 500.
    if (err?.code === 'P2002') return { spawned: false, reason: 'already_spawned' };
    throw err;
  }
}
