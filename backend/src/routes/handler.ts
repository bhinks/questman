/**
 * /api/handler — the AI Handler's message log + persona config.
 *
 * The Handler narrates (daily rundown, weekly debrief); these endpoints just
 * read its message log, mark lines seen, and let the user pick the persona.
 * No economy here.
 */
import express from 'express';
import { z } from 'zod';
import { prisma } from '../server';
import { AuthRequest } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { config } from '../config';
import { ALL_PERSONA_KEYS, FREE_PERSONA_KEYS, Persona } from '../services/handler';
import { getAiSettings, providerAvailable } from '../services/llm';
import { SHOP_ITEMS } from '../services/shopCatalog';

const router = express.Router();

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/** Parse PlayerProfile.cosmetics (JSON-string array) defensively. */
function parseCosmetics(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Persona display copy. Free trio first; paid voices are Night Market goods
 *  (price comes from the shop catalog so it lives in exactly one place). */
const PERSONA_OPTIONS: { key: Persona; label: string; blurb: string; free: boolean }[] = [
  { key: 'rogue_ai', label: 'Rogue AI', blurb: 'Sardonic, dry, quietly amused. The default.', free: true },
  { key: 'fixer', label: 'Fixer', blurb: 'Gruff, all-business, hands you the gig.', free: true },
  { key: 'ripperdoc', label: 'Ripperdoc', blurb: 'Upbeat, clinical, optimizes your day.', free: true },
  { key: 'drill', label: 'Drill Sergeant', blurb: 'Barked orders, zero sympathy, secretly proud.', free: false },
  { key: 'zen', label: 'Zen Monk', blurb: 'Koans and stillness. The work is the way.', free: false },
  { key: 'noir', label: 'Noir Detective', blurb: 'Hardboiled voice-over, rain-slicked metaphors.', free: false },
  { key: 'showman', label: 'The Showman', blurb: 'Prime-time hype-man. You are the headline act.', free: false },
];

/** Catalog price for a paid persona ('persona_<key>'), if listed. */
function personaPrice(key: Persona): number | undefined {
  return SHOP_ITEMS.find(i => i.category === 'persona' && i.key === `persona_${key}`)?.priceEddies;
}

/**
 * GET /api/handler/messages?limit=&kind=
 * The Net feed: the Handler's banter log, newest first.
 */
router.get('/messages', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const q = z.object({
    limit: z.string().transform(Number).pipe(z.number().int().positive().max(100)).default('30'),
    kind: z.enum(['daily_rundown', 'weekly_debrief', 'event']).optional(),
  }).parse(req.query);

  const messages = await prisma.handlerMessage.findMany({
    where: { userId, ...(q.kind ? { kind: q.kind } : {}) },
    orderBy: { createdAt: 'desc' },
    take: q.limit,
  });
  res.json({ messages: messages.map(m => ({ ...m, meta: parseJson(m.meta) })) });
}));

/**
 * GET /api/handler/latest
 * The single most-recent message (for the HUD ticker), plus whether the
 * Handler is even enabled/available so the UI can hide the ticker entirely.
 */
router.get('/latest', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const [latest, ai] = await Promise.all([
    prisma.handlerMessage.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    getAiSettings(prisma, userId),
  ]);
  res.json({
    message: latest ? { ...latest, meta: parseJson(latest.meta) } : null,
    // AI Calibration: the master breaker silences the Handler too.
    enabled: ai.handlerEnabled && ai.aiEnabled && config.features.handler,
    persona: ai.handlerPersona,
    // "Can new lines generate?" — cloud needs a key; a local Ollama node
    // is assumed reachable (calls degrade gracefully if it isn't).
    available: providerAvailable(ai),
  });
}));

/**
 * POST /api/handler/seen  { ids?: string[] }
 * Mark messages seen (all, or a specific set). Used to clear the ticker dot.
 */
router.post('/seen', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const { ids } = z.object({ ids: z.array(z.string()).max(200).optional() }).parse(req.body ?? {});
  const result = await prisma.handlerMessage.updateMany({
    where: { userId, seen: false, ...(ids && ids.length ? { id: { in: ids } } : {}) },
    data: { seen: true },
  });
  res.json({ updated: result.count });
}));

/**
 * GET /api/handler/persona — current persona + ALL personas (free + paid)
 * with { key, label, blurb, free, owned, priceEddies? } so the UI can
 * render locked chips for unbought voices.
 */
router.get('/persona', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const [settings, profile] = await Promise.all([
    prisma.userSettings.findUnique({
      where: { userId }, select: { handlerPersona: true, handlerEnabled: true },
    }),
    prisma.playerProfile.findUnique({ where: { userId }, select: { cosmetics: true } }),
  ]);
  const ownedKeys = parseCosmetics(profile?.cosmetics);
  res.json({
    persona: settings?.handlerPersona ?? 'rogue_ai',
    enabled: settings?.handlerEnabled ?? false, // AI is opt-in — off until enabled
    options: PERSONA_OPTIONS.map(o => ({
      ...o,
      owned: o.free || ownedKeys.includes(`persona_${o.key}`),
      ...(o.free ? {} : { priceEddies: personaPrice(o.key) }),
    })),
  });
}));

/**
 * PUT /api/handler/persona  { persona?, enabled? }
 * Update the Handler's voice / toggle it off. Upserts UserSettings so a user
 * with no settings row yet can still configure it. Paid personas require
 * 'persona_<key>' in PlayerProfile.cosmetics — 400 'Not owned' otherwise;
 * the free trio is always allowed.
 */
router.put('/persona', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const body = z.object({
    persona: z.enum(ALL_PERSONA_KEYS).optional(),
    enabled: z.boolean().optional(),
  }).parse(req.body ?? {});

  if (body.persona && !(FREE_PERSONA_KEYS as readonly string[]).includes(body.persona)) {
    const profile = await prisma.playerProfile.findUnique({
      where: { userId }, select: { cosmetics: true },
    });
    if (!parseCosmetics(profile?.cosmetics).includes(`persona_${body.persona}`)) {
      throw new AppError('Not owned', 400);
    }
  }

  const data = {
    ...(body.persona !== undefined ? { handlerPersona: body.persona } : {}),
    ...(body.enabled !== undefined ? { handlerEnabled: body.enabled } : {}),
  };
  const settings = await prisma.userSettings.upsert({
    where: { userId },
    update: data,
    create: { userId, ...data },
    select: { handlerPersona: true, handlerEnabled: true },
  });
  res.json({ persona: settings.handlerPersona, enabled: settings.handlerEnabled });
}));

export default router;
