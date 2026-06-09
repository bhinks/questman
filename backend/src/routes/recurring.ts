/**
 * /api/recurring — recurring bills & subscription audit ("leech processes").
 *
 * Tracks money drains (rent, utilities, subscriptions) with cadence + due day.
 * Brent: auto-detect → confirm (reuse the detector), recurring drains framed as
 * leech processes, the audit a "kill running processes" screen. Due dates spawn
 * reminder quests (QuestEngine.buildBillCandidates); completing that quest marks
 * the bill paid (hook in quests.ts).
 */
import express from 'express';
import { z } from 'zod';
import { prisma } from '../server';
import { AuthRequest } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { detectRecurring } from '../services/recurringDetector';
import { startOfLocalDay } from '../utils/dates';
import type { PrismaClient, Prisma } from '@prisma/client';
import type { QuestCandidate } from '../services/anthropic';

const router = express.Router();

const upsertSchema = z.object({
  name: z.string().min(1).max(120),
  amount: z.number().positive(),
  cadence: z.enum(['weekly', 'monthly', 'yearly']).default('monthly'),
  dueDay: z.number().int().min(1).max(31).nullable().optional(),
  categoryId: z.string().nullable().optional(),
  isSubscription: z.boolean().optional(),
  source: z.enum(['manual', 'detected']).optional(),
  notes: z.string().max(500).nullable().optional(),
});

/** Monthly-equivalent cost for ranking / totals. */
function monthlyEquivalent(amount: number, cadence: string): number {
  if (cadence === 'weekly') return amount * 52 / 12;
  if (cadence === 'yearly') return amount / 12;
  return amount;
}

/** The dueDay occurrence in a given month, clamped to the month's length. */
function dueDateFor(year: number, month: number, dueDay: number): Date {
  const dim = new Date(year, month + 1, 0).getDate(); // month auto-normalizes
  return new Date(year, month, Math.min(dueDay, dim));
}

/**
 * Next due date for a monthly bill, ACCOUNTING FOR lastPaidOn (null for non-
 * monthly / no dueDay). A bill paid for its current cycle rolls forward so the
 * "due soon" badge clears; an unpaid bill past its due returns the (overdue)
 * current due so reminders keep firing.
 */
function nextDue(dueDay: number | null, cadence: string, lastPaidOn: Date | null, from = new Date()): Date | null {
  if (cadence !== 'monthly' || !dueDay) return null;
  const today = startOfLocalDay(from);
  const y = today.getFullYear(), m = today.getMonth();
  const thisDue = dueDateFor(y, m, dueDay);
  const nextMonthDue = dueDateFor(y, m + 1, dueDay);
  const paid = lastPaidOn ? startOfLocalDay(lastPaidOn) : null;
  if (today <= thisDue) {
    // This month's due is upcoming. If already paid since last month's due, roll forward.
    const paidThisCycle = paid != null && paid >= dueDateFor(y, m - 1, dueDay);
    return paidThisCycle ? nextMonthDue : thisDue;
  }
  // Past this month's due: unpaid -> overdue (thisDue, negative dueInDays); paid -> next month.
  const paidForThisMonth = paid != null && paid >= thisDue;
  return paidForThisMonth ? nextMonthDue : thisDue;
}

function decorate(r: any) {
  const nd = nextDue(r.dueDay, r.cadence, r.lastPaidOn ?? null);
  const dueInDays = nd ? Math.round((nd.getTime() - startOfLocalDay().getTime()) / 86_400_000) : null;
  return {
    ...r,
    monthlyEquivalent: Math.round(monthlyEquivalent(r.amount, r.cadence) * 100) / 100,
    nextDueDate: nd ? nd.toISOString() : null,
    dueInDays,
  };
}

/** GET /api/recurring — all tracked bills + the monthly drain total. */
router.get('/', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const items = await prisma.recurringExpense.findMany({
    where: { userId },
    orderBy: [{ active: 'desc' }, { amount: 'desc' }],
    include: { category: { select: { id: true, name: true, color: true } } },
  });
  const decorated = items.map(decorate);
  const monthlyTotal = decorated
    .filter(r => r.active)
    .reduce((s, r) => s + r.monthlyEquivalent, 0);
  res.json({ recurring: decorated, monthlyTotal: Math.round(monthlyTotal * 100) / 100 });
}));

/**
 * GET /api/recurring/detect — auto-detected candidates NOT already tracked.
 * The confirm UI turns a candidate into a RecurringExpense via POST /.
 */
router.get('/detect', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const [candidates, existing] = await Promise.all([
    detectRecurring(prisma, userId),
    prisma.recurringExpense.findMany({ where: { userId }, select: { name: true } }),
  ]);
  const have = new Set(existing.map(e => e.name.toLowerCase().slice(0, 40)));
  const fresh = candidates.filter(c => !have.has(c.name.toLowerCase().slice(0, 40)));
  res.json({ candidates: fresh });
}));

/**
 * GET /api/recurring/audit — the subscription audit ("kill running processes").
 * Active subscriptions for a keep/cancel pass + the total monthly sub cost.
 */
router.get('/audit', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const subs = await prisma.recurringExpense.findMany({
    where: { userId, active: true, isSubscription: true },
    orderBy: { amount: 'desc' },
    include: { category: { select: { id: true, name: true, color: true } } },
  });
  const decorated = subs.map(decorate);
  const monthlySubCost = decorated.reduce((s, r) => s + r.monthlyEquivalent, 0);
  res.json({
    subscriptions: decorated,
    count: decorated.length,
    monthlySubCost: Math.round(monthlySubCost * 100) / 100,
    annualSubCost: Math.round(monthlySubCost * 12 * 100) / 100,
  });
}));

/** POST /api/recurring — create (manual or from a confirmed candidate). */
router.post('/', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const data = upsertSchema.parse(req.body);
  const created = await prisma.recurringExpense.create({
    data: {
      userId,
      name: data.name,
      amount: data.amount,
      cadence: data.cadence,
      dueDay: data.dueDay ?? null,
      categoryId: data.categoryId ?? null,
      isSubscription: data.isSubscription ?? false,
      source: data.source ?? 'manual',
      notes: data.notes ?? null,
    },
  });
  res.status(201).json({ recurring: decorate(created) });
}));

/** PUT /api/recurring/:id — edit. */
router.put('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const data = upsertSchema.partial().extend({ active: z.boolean().optional() }).parse(req.body);
  const existing = await prisma.recurringExpense.findFirst({ where: { id: req.params.id, userId }, select: { id: true } });
  if (!existing) throw new AppError('Recurring expense not found', 404);
  const updated = await prisma.recurringExpense.update({
    where: { id: existing.id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.amount !== undefined ? { amount: data.amount } : {}),
      ...(data.cadence !== undefined ? { cadence: data.cadence } : {}),
      ...(data.dueDay !== undefined ? { dueDay: data.dueDay } : {}),
      ...(data.categoryId !== undefined ? { categoryId: data.categoryId } : {}),
      ...(data.isSubscription !== undefined ? { isSubscription: data.isSubscription } : {}),
      ...(data.active !== undefined ? { active: data.active } : {}),
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
    },
  });
  res.json({ recurring: decorate(updated) });
}));

/** POST /api/recurring/:id/cancel — mark inactive (audit "cancel"). */
router.post('/:id/cancel', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const result = await prisma.recurringExpense.updateMany({
    where: { id: req.params.id, userId }, data: { active: false },
  });
  if (result.count === 0) throw new AppError('Recurring expense not found', 404);
  res.json({ cancelled: true });
}));

/** POST /api/recurring/:id/pay — mark paid (sets lastPaidOn = today). */
router.post('/:id/pay', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const result = await prisma.recurringExpense.updateMany({
    where: { id: req.params.id, userId }, data: { lastPaidOn: startOfLocalDay() },
  });
  if (result.count === 0) throw new AppError('Recurring expense not found', 404);
  // Clear any lingering "pay <bill>" reminder quest (it carries over, so paying
  // from the Bills view should retire it rather than leave it hanging).
  await prisma.quest.updateMany({
    where: { userId, source: 'bill', sourceId: req.params.id, status: 'pending' },
    data: { status: 'skipped' },
  });
  res.json({ paid: true });
}));

/** DELETE /api/recurring/:id */
router.delete('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const result = await prisma.recurringExpense.deleteMany({ where: { id: req.params.id, userId } });
  if (result.count === 0) throw new AppError('Recurring expense not found', 404);
  res.json({ deleted: true });
}));

/**
 * Mark a bill paid when its reminder quest is completed (closed loop, called
 * from quests.ts /complete for source:"bill"). Idempotent — just stamps
 * lastPaidOn. Scoped by userId.
 */
export async function markBillPaid(tx: Prisma.TransactionClient, userId: string, billId: string): Promise<void> {
  await tx.recurringExpense.updateMany({
    where: { id: billId, userId }, data: { lastPaidOn: startOfLocalDay() },
  });
}

/**
 * QuestEngine candidate builder: "pay <bill>" reminders for active monthly
 * bills due within 3 days that haven't been paid this period. source:"bill",
 * sourceId=billId — completing the quest marks it paid (markBillPaid).
 */
export async function buildBillCandidates(
  prisma: PrismaClient,
  userId: string,
  date: Date,
  nextId: () => string,
): Promise<QuestCandidate[]> {
  const bills = await prisma.recurringExpense.findMany({
    where: { userId, active: true, cadence: 'monthly', dueDay: { not: null } },
    include: { category: { select: { name: true } } },
  });
  if (bills.length === 0) return [];

  const today = startOfLocalDay(date);
  const out: QuestCandidate[] = [];
  for (const b of bills) {
    // nextDue already folds in lastPaidOn: a paid bill rolls past the cycle
    // (dueInDays large), an unpaid one stays at its (possibly overdue) due.
    const nd = nextDue(b.dueDay, b.cadence, b.lastPaidOn ?? null, date);
    if (!nd) continue;
    const dueInDays = Math.round((nd.getTime() - today.getTime()) / 86_400_000);
    // Surface upcoming (≤3 days out) and recently-overdue (within a week) bills.
    if (dueInDays > 3 || dueInDays < -7) continue;
    const overdue = dueInDays < 0;
    out.push({
      candidateId: nextId(),
      source: 'bill',
      sourceId: b.id,
      moduleKey: 'finance',
      baseTitle: overdue
        ? `Pay ${b.name} — $${b.amount.toFixed(2)} (OVERDUE ${-dueInDays}d)`
        : `Pay ${b.name} — $${b.amount.toFixed(2)} due ${dueInDays === 0 ? 'today' : `in ${dueInDays}d`}`,
      difficulty: 'easy',
      xpReward: 15,
      context: `recurring bill${b.category?.name ? ` (${b.category.name})` : ''}, due day ${b.dueDay}`,
      estMinutes: 5,
      mustDo: dueInDays <= 0,
      carryOver: true,
    });
  }
  return out;
}

export default router;
