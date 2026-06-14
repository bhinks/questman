/**
 * /api/settings — per-user app settings.
 *
 * Two blocks, both edited on the SYS//CAL page:
 *   - Night City "display calibration" knobs (design handoff): corner cut,
 *     chroma split, CRT intensity. Applied client-side as CSS vars on the
 *     app root.
 *   - AI Calibration: master AI breaker, feature toggles (quest synthesis,
 *     handler), per-domain data-access grants, provider (Anthropic cloud vs
 *     local Ollama), model overrides, and the daily token cap. Enforced
 *     server-side in services/llm.ts + QuestEngine/handler.
 *
 * The projection also carries two READ-ONLY status fields (aiCloudKey,
 * aiTokensUsedToday) so the panel can show availability + cap usage without
 * a second query; they are not accepted on PUT.
 */
import express from 'express';
import { z } from 'zod';
import { prisma } from '../server';
import { AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { config } from '../config';
import { AI_DEFAULTS, tokensUsedToday } from '../services/llm';

const router = express.Router();

const DISPLAY_DEFAULTS = { displayCut: 24, displayChroma: 2, displayCrt: 75 };

const updateSchema = z.object({
  displayCut: z.number().int().min(0).max(28).optional(),
  displayChroma: z.number().min(0).max(4).optional(),
  displayCrt: z.number().int().min(0).max(100).optional(),
  // --- AI Calibration ---
  aiEnabled: z.boolean().optional(),
  aiQuestsEnabled: z.boolean().optional(),
  handlerEnabled: z.boolean().optional(),
  aiAccessFinance: z.boolean().optional(),
  aiAccessHealth: z.boolean().optional(),
  aiAccessSocial: z.boolean().optional(),
  aiAccessCalendar: z.boolean().optional(),
  aiProvider: z.enum(['anthropic', 'ollama']).optional(),
  aiModelQuests: z.string().min(1).max(80).nullable().optional(),
  aiModelHandler: z.string().min(1).max(80).nullable().optional(),
  ollamaUrl: z.string().url().max(200).optional(),
  ollamaModel: z.string().min(1).max(80).optional(),
  aiDailyTokenCap: z.number().int().min(0).max(10_000_000).optional(),
  // R&R "earn your leisure" (Media): day-of-week budget JSON + the soft-gate
  // anti-goal the planner breaches when you overrun it (null = inert).
  rrBudgetByDay: z.string().max(100).optional(),
  rrOverrunAntiGoalId: z.string().max(60).nullable().optional(),
});

const SETTINGS_SELECT = {
  displayCut: true, displayChroma: true, displayCrt: true,
  aiEnabled: true, aiQuestsEnabled: true, handlerEnabled: true,
  aiAccessFinance: true, aiAccessHealth: true, aiAccessSocial: true,
  aiAccessCalendar: true,
  aiProvider: true, aiModelQuests: true, aiModelHandler: true,
  ollamaUrl: true, ollamaModel: true, aiDailyTokenCap: true,
  aiTokensUsed: true, aiTokensUsedOn: true,
  rrBudgetByDay: true, rrOverrunAntiGoalId: true,
} as const;

type SettingsRow = {
  displayCut: number; displayChroma: number; displayCrt: number;
  aiEnabled: boolean; aiQuestsEnabled: boolean; handlerEnabled: boolean;
  aiAccessFinance: boolean; aiAccessHealth: boolean; aiAccessSocial: boolean;
  aiAccessCalendar: boolean;
  aiProvider: string; aiModelQuests: string | null; aiModelHandler: string | null;
  ollamaUrl: string; ollamaModel: string; aiDailyTokenCap: number;
  aiTokensUsed: number; aiTokensUsedOn: Date | null;
  rrBudgetByDay: string; rrOverrunAntiGoalId: string | null;
};

function project(s: SettingsRow | null) {
  const base = s ?? {
    ...DISPLAY_DEFAULTS,
    aiEnabled: AI_DEFAULTS.aiEnabled,
    aiQuestsEnabled: AI_DEFAULTS.aiQuestsEnabled,
    handlerEnabled: AI_DEFAULTS.handlerEnabled,
    aiAccessFinance: AI_DEFAULTS.aiAccessFinance,
    aiAccessHealth: AI_DEFAULTS.aiAccessHealth,
    aiAccessSocial: AI_DEFAULTS.aiAccessSocial,
    aiAccessCalendar: AI_DEFAULTS.aiAccessCalendar,
    aiProvider: AI_DEFAULTS.aiProvider,
    aiModelQuests: AI_DEFAULTS.aiModelQuests,
    aiModelHandler: AI_DEFAULTS.aiModelHandler,
    ollamaUrl: AI_DEFAULTS.ollamaUrl,
    ollamaModel: AI_DEFAULTS.ollamaModel,
    aiDailyTokenCap: AI_DEFAULTS.aiDailyTokenCap,
    aiTokensUsed: 0,
    aiTokensUsedOn: null as Date | null,
    rrBudgetByDay: '[2,1,1,1,1,2,3]',
    rrOverrunAntiGoalId: null as string | null,
  };
  const { aiTokensUsed, aiTokensUsedOn, ...rest } = base;
  return {
    ...rest,
    aiProvider: base.aiProvider === 'ollama' ? 'ollama' : 'anthropic',
    // Read-only status for the panel (never accepted on PUT):
    aiCloudKey: !!config.anthropic.apiKey,
    aiTokensUsedToday: tokensUsedToday({ aiTokensUsed, aiTokensUsedOn }),
  };
}

/** GET /api/settings — display + AI calibration blocks (defaults if no row). */
router.get('/', asyncHandler(async (req: AuthRequest, res) => {
  const settings = await prisma.userSettings.findUnique({
    where: { userId: req.user!.id },
    select: SETTINGS_SELECT,
  });
  res.json({ settings: project(settings) });
}));

/** PUT /api/settings — update any subset; upserts so first-save works. */
router.put('/', asyncHandler(async (req: AuthRequest, res) => {
  const data = updateSchema.parse(req.body ?? {});
  const settings = await prisma.userSettings.upsert({
    where: { userId: req.user!.id },
    update: data,
    create: { userId: req.user!.id, ...data },
    select: SETTINGS_SELECT,
  });
  res.json({ settings: project(settings) });
}));

export default router;
