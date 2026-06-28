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
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../server';
import { AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { config } from '../config';
import { AI_DEFAULTS, tokensUsedToday } from '../services/llm';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger';

const router = express.Router();

const DISPLAY_DEFAULTS = { displayCut: 24, displayChroma: 2, displayCrt: 75 };

/** A fresh per-user ingest token: 32 hex chars (128 bits) — high-entropy, used
 *  like an API key in the phone bridge's /api/ingest secret URL. */
function genIngestToken(): string {
  return crypto.randomBytes(16).toString('hex');
}

/** The convenience URL the user pastes into their phone bridge: the
 *  health-connect ingest path carrying their own token. Built from the
 *  request host so it works on whatever origin they reached us through. */
function ingestUrlFor(req: express.Request, token: string | null): string | null {
  if (!token) return null;
  const host = req.get('host');
  if (!host) return null;
  return `${req.protocol}://${host}/api/ingest/health-connect?token=${token}`;
}

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
  // --- Per-user integrations: location, calendar, phone-health-pull ---
  // (formerly global env values; now owned per account, no global fallback)
  weatherLat: z.number().min(-90).max(90).nullable().optional(),
  weatherLon: z.number().min(-180).max(180).nullable().optional(),
  calendarIcsUrls: z.string().max(4000).nullable().optional(),
  healthPullUrl: z.string().url().max(500).nullable().optional(),
  healthPullToken: z.string().max(500).nullable().optional(),
  healthPullMinutes: z.number().int().min(5).max(1440).optional(),
  healthBackfillDays: z.number().int().min(2).max(3650).optional(),
  // ingestToken is NOT settable here — it's (re)generated via
  // POST /api/settings/ingest-token or lazily on GET (treated like an API key).
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
  weatherLat: true, weatherLon: true, calendarIcsUrls: true,
  healthPullUrl: true, healthPullToken: true, healthPullMinutes: true,
  healthBackfillDays: true, ingestToken: true,
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
  weatherLat: number | null; weatherLon: number | null; calendarIcsUrls: string | null;
  healthPullUrl: string | null; healthPullToken: string | null; healthPullMinutes: number;
  healthBackfillDays: number; ingestToken: string | null;
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
    weatherLat: null as number | null,
    weatherLon: null as number | null,
    calendarIcsUrls: null as string | null,
    healthPullUrl: null as string | null,
    healthPullToken: null as string | null,
    healthPullMinutes: 30,
    healthBackfillDays: 365,
    ingestToken: null as string | null,
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

/** GET /api/settings — display + AI calibration + per-user integration blocks
 *  (defaults if no row). The owner's own authenticated view, so their own
 *  secrets (health/ingest tokens) are returned. Lazily mints an ingestToken
 *  if the user has none yet, so the phone-bridge URL is always displayable. */
router.get('/', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  let settings = await prisma.userSettings.findUnique({
    where: { userId }, select: SETTINGS_SELECT,
  });
  if (!settings || !settings.ingestToken) {
    settings = await prisma.userSettings.upsert({
      where: { userId },
      update: { ingestToken: genIngestToken() },
      create: { userId, ingestToken: genIngestToken() },
      select: SETTINGS_SELECT,
    });
  }
  res.json({ settings: { ...project(settings), ingestUrl: ingestUrlFor(req, settings.ingestToken) } });
}));

/**
 * GET /api/settings/models?provider=anthropic|ollama
 *
 * Discover the models actually available for a provider so the SYS//CAL
 * dropdowns reflect reality instead of a hardcoded guess: Anthropic's catalog
 * (server key) or the local Ollama node's pulled tags. Best-effort — any
 * failure (no key, node down, timeout) returns an empty list and the UI falls
 * back to its built-in options. Never throws.
 */
router.get('/models', asyncHandler(async (req: AuthRequest, res) => {
  const provider = req.query.provider === 'ollama' ? 'ollama' : 'anthropic';
  let models: Array<{ id: string; label: string }> = [];

  try {
    if (provider === 'anthropic') {
      if (config.anthropic.apiKey) {
        const client = new Anthropic({ apiKey: config.anthropic.apiKey });
        const list = await client.models.list({ limit: 100 });
        models = (list.data ?? []).map((m: { id: string; display_name?: string }) => ({
          id: m.id,
          label: m.display_name ?? m.id,
        }));
      }
    } else {
      const row = await prisma.userSettings.findUnique({
        where: { userId: req.user!.id }, select: { ollamaUrl: true },
      });
      const url = (row?.ollamaUrl || AI_DEFAULTS.ollamaUrl).replace(/\/+$/, '');
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      try {
        const r = await fetch(`${url}/api/tags`, { signal: ctrl.signal });
        if (r.ok) {
          const body = await r.json() as { models?: Array<{ name?: string; model?: string }> };
          models = (body.models ?? [])
            .map(m => m.name ?? m.model)
            .filter((n): n is string => !!n)
            .map(n => ({ id: n, label: n }));
        }
      } finally {
        clearTimeout(timer);
      }
    }
  } catch (err: any) {
    logger.warn(`[settings] model discovery (${provider}) failed: ${err?.message ?? err}`);
  }

  res.json({ provider, models });
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
  res.json({ settings: { ...project(settings), ingestUrl: ingestUrlFor(req, settings.ingestToken) } });
}));

/**
 * POST /api/settings/ingest-token — (re)generate the per-user ingest token.
 * Rotating it immediately invalidates any phone bridge still using the old
 * secret URL (the lookup in routes/ingest.ts is exact-match). Returns the
 * fresh token + the convenience ingest URL to paste into the bridge.
 */
router.post('/ingest-token', asyncHandler(async (req: AuthRequest, res) => {
  const token = genIngestToken();
  const settings = await prisma.userSettings.upsert({
    where: { userId: req.user!.id },
    update: { ingestToken: token },
    create: { userId: req.user!.id, ingestToken: token },
    select: SETTINGS_SELECT,
  });
  res.json({ settings: { ...project(settings), ingestUrl: ingestUrlFor(req, settings.ingestToken) } });
}));

export default router;
