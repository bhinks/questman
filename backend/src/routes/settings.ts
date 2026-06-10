/**
 * /api/settings — per-user app settings.
 *
 * Currently the Night City "display calibration" knobs (design handoff):
 * corner cut, chroma split, CRT intensity, and the topbar ticker toggle.
 * Persisted per user (the prototype used localStorage; prod is UserSettings).
 * Applied client-side as CSS vars on the app root.
 */
import express from 'express';
import { z } from 'zod';
import { prisma } from '../server';
import { AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = express.Router();

const DISPLAY_DEFAULTS = { displayCut: 24, displayChroma: 2, displayCrt: 75, tickerEnabled: true };

const updateSchema = z.object({
  displayCut: z.number().int().min(0).max(28).optional(),
  displayChroma: z.number().min(0).max(4).optional(),
  displayCrt: z.number().int().min(0).max(100).optional(),
  tickerEnabled: z.boolean().optional(),
});

function project(s: { displayCut: number; displayChroma: number; displayCrt: number; tickerEnabled: boolean } | null) {
  return s
    ? { displayCut: s.displayCut, displayChroma: s.displayChroma, displayCrt: s.displayCrt, tickerEnabled: s.tickerEnabled }
    : DISPLAY_DEFAULTS;
}

/** GET /api/settings — the display-calibration block (defaults if no row). */
router.get('/', asyncHandler(async (req: AuthRequest, res) => {
  const settings = await prisma.userSettings.findUnique({
    where: { userId: req.user!.id },
    select: { displayCut: true, displayChroma: true, displayCrt: true, tickerEnabled: true },
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
    select: { displayCut: true, displayChroma: true, displayCrt: true, tickerEnabled: true },
  });
  res.json({ settings: project(settings) });
}));

export default router;
