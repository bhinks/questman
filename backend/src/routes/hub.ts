/**
 * /api/hub/summary — the NovaHQ landing card's badge (2026-09-27).
 *
 * Returns how many of today's quests the viewer still has open:
 *   { linked: true, left, done, total, gifts }   gifts = open quests someone sent you
 *   { linked: true, generated: false, gifts }    today's board hasn't been rolled yet
 *   { linked: false }                            no Questman account for this viewer
 *
 * Who the viewer is: the landing page is a HinksID page, so the HinksID session
 * cookie wins (verified by calling nova-auth's /auth/me with it, the same way
 * FamilyNet checks budgets). That keeps the badge right on a shared tablet where
 * the Questman cookie may belong to someone else. With no HinksID session (a local
 * install), the Questman session cookie is used. The account is found by the same
 * email the SSO hand-off mints (lowercased email, else u<id>@hinks.local); nothing
 * is auto-provisioned and nothing is generated here, so the card never costs an AI call.
 */
import express from 'express';
import { prisma } from '../server';
import { AUTH_COOKIE, readCookie, verifyAuthToken } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { startOfLocalDay } from '../utils/dates';

const router = express.Router();
const AUTH_ME_URL = (process.env.HINKSID_AUTH_ME_URL ?? 'http://nova-auth:8082/auth/me').trim();

async function hinksIdEmail(cookie: string | undefined): Promise<string | null> {
  if (!AUTH_ME_URL || !cookie) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch(AUTH_ME_URL, { headers: { Cookie: cookie, Accept: 'application/json' }, signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) return null;
    const me = await r.json() as { id?: number | string; email?: string | null };
    if (me?.id == null) return null;
    return (me.email ?? '').trim().toLowerCase() || `u${me.id}@hinks.local`;
  } catch {
    return null;
  }
}

router.get('/summary', asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  let userId: string | null = null;
  const email = await hinksIdEmail(req.headers.cookie);
  if (email) {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    userId = u?.id ?? null;
    if (!userId) return res.json({ linked: false });
  } else {
    const token = readCookie(req.headers.cookie, AUTH_COOKIE);
    if (token) {
      try { userId = (await verifyAuthToken(token)).id; } catch { userId = null; }
    }
    if (!userId) return res.status(401).json({ linked: false });
  }

  const today = startOfLocalDay();
  const [run, quests] = await Promise.all([
    prisma.dailyQuestRun.findUnique({ where: { userId_runDate: { userId, runDate: today } }, select: { id: true } }),
    prisma.quest.findMany({ where: { userId, questDate: today }, select: { status: true, meta: true } }),
  ]);
  const open = quests.filter(q => q.status === 'pending');
  const gifts = open.filter(q => (q.meta ?? '').includes('"gift"')).length;
  // Not rolled yet: only gifts/captures exist, so a count would undersell the day.
  if (!run) return res.json({ linked: true, generated: false, gifts });

  res.json({
    linked: true,
    generated: true,
    left: open.length,
    done: quests.filter(q => q.status === 'completed').length,
    total: quests.filter(q => q.status !== 'expired').length,
    gifts,
  });
}));

export default router;
