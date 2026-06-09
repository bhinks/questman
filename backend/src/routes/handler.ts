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
import { asyncHandler } from '../middleware/errorHandler';
import { config } from '../config';

const router = express.Router();

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
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
  const [latest, settings] = await Promise.all([
    prisma.handlerMessage.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    prisma.userSettings.findUnique({ where: { userId }, select: { handlerEnabled: true, handlerPersona: true } }),
  ]);
  res.json({
    message: latest ? { ...latest, meta: parseJson(latest.meta) } : null,
    enabled: (settings?.handlerEnabled ?? true) && config.features.handler,
    persona: settings?.handlerPersona ?? 'rogue_ai',
    available: !!config.anthropic.apiKey,
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
 * GET /api/handler/persona — current persona + the catalog of choices.
 */
router.get('/persona', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const settings = await prisma.userSettings.findUnique({
    where: { userId }, select: { handlerPersona: true, handlerEnabled: true },
  });
  res.json({
    persona: settings?.handlerPersona ?? 'rogue_ai',
    enabled: settings?.handlerEnabled ?? true,
    options: [
      { key: 'rogue_ai', label: 'Rogue AI', blurb: 'Sardonic, dry, quietly amused. The default.' },
      { key: 'fixer', label: 'Fixer', blurb: 'Gruff, all-business, hands you the gig.' },
      { key: 'ripperdoc', label: 'Ripperdoc', blurb: 'Upbeat, clinical, optimizes your day.' },
    ],
  });
}));

/**
 * PUT /api/handler/persona  { persona?, enabled? }
 * Update the Handler's voice / toggle it off. Upserts UserSettings so a user
 * with no settings row yet can still configure it.
 */
router.put('/persona', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const body = z.object({
    persona: z.enum(['rogue_ai', 'fixer', 'ripperdoc']).optional(),
    enabled: z.boolean().optional(),
  }).parse(req.body ?? {});

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
