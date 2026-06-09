/**
 * /api/budgets — per-category monthly budgets ("envelopes").
 *
 * Budgets ride the existing Category.budget cap (no new table). Spend is
 * month-to-date, expenses only, EXCLUDED rows ignored. Brent's calls:
 *   - HARD monthly reset (no rollover).
 *   - "Remaining budget" is a metric every category competes in — we rank them.
 *   - Month-to-month: how good am I at coming in under budget (history endpoint).
 *   - Leftover surplus near month-end → a gentle "bank it or treat yourself" nudge.
 *
 * The breach-warning quest lives in QuestEngine (buildBudgetCandidates); this
 * route is the data + the cap editor.
 */
import express from 'express';
import { z } from 'zod';
import { prisma } from '../server';
import { AuthRequest } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import type { PrismaClient } from '@prisma/client';
import type { QuestCandidate } from '../services/anthropic';

const router = express.Router();

function monthStart(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** WARN at ≥80% of cap, OVER at ≥100%. */
function statusFor(pct: number): 'ok' | 'warn' | 'over' {
  return pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok';
}

/**
 * GET /api/budgets — current-month overview.
 * Each budgeted category: cap, MTD spend, remaining, pct, status. Plus totals
 * and a leftover-surplus suggestion when the month is winding down.
 */
router.get('/', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const start = monthStart();
  const end = addMonths(start, 1);

  const cats = await prisma.category.findMany({
    where: { userId, budget: { not: null, gt: 0 } },
    select: { id: true, name: true, color: true, icon: true, budget: true },
  });

  // MTD spend per category (expenses, not excluded).
  const spendRows = await prisma.transaction.groupBy({
    by: ['categoryId'],
    where: { userId, excluded: false, amount: { lt: 0 }, date: { gte: start, lt: end } },
    _sum: { amount: true },
  });
  const spentByCat = new Map<string, number>();
  for (const r of spendRows) {
    if (r.categoryId) spentByCat.set(r.categoryId, Math.abs(r._sum.amount ?? 0));
  }

  const budgets = cats.map(c => {
    const cap = c.budget ?? 0;
    const spent = Math.round((spentByCat.get(c.id) ?? 0) * 100) / 100;
    const remaining = Math.round((cap - spent) * 100) / 100;
    const pct = cap > 0 ? Math.round((spent / cap) * 100) : 0;
    return { categoryId: c.id, name: c.name, color: c.color, icon: c.icon, cap, spent, remaining, pct, status: statusFor(pct) };
  }).sort((a, b) => b.remaining - a.remaining); // most-under-budget first (the "leaderboard")

  const totalCap = budgets.reduce((s, b) => s + b.cap, 0);
  const totalSpent = Math.round(budgets.reduce((s, b) => s + b.spent, 0) * 100) / 100;
  const totalRemaining = Math.round((totalCap - totalSpent) * 100) / 100;

  // Leftover nudge: only once the month is ≥70% gone and there's surplus left,
  // and nothing is over. Brent: money saved is spent — suggest bank vs reward.
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthProgress = now.getDate() / daysInMonth;
  let suggestion: string | null = null;
  if (totalCap > 0 && monthProgress >= 0.7 && totalRemaining > 0 && !budgets.some(b => b.status === 'over')) {
    suggestion = `You're tracking $${totalRemaining.toFixed(0)} under budget this month — bank it toward savings or earmark a slice for a reward.`;
  }

  res.json({
    month: monthKey(start),
    budgets,
    totals: { totalCap, totalSpent, totalRemaining },
    overCount: budgets.filter(b => b.status === 'over').length,
    warnCount: budgets.filter(b => b.status === 'warn').length,
    unbudgetedCount: await prisma.category.count({ where: { userId, OR: [{ budget: null }, { budget: { lte: 0 } }] } }),
    suggestion,
  });
}));

/**
 * GET /api/budgets/history?months=6 — month-to-month performance.
 * For each budgeted category and each of the last N COMPLETE months (plus the
 * current one), spend vs the current cap + under/over. Uses the current cap for
 * past months (no historical cap snapshots) — a reasonable trend signal.
 */
router.get('/history', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const { months } = z.object({
    months: z.string().transform(Number).pipe(z.number().int().min(1).max(24)).default('6'),
  }).parse(req.query);

  const cats = await prisma.category.findMany({
    where: { userId, budget: { not: null, gt: 0 } },
    select: { id: true, name: true, color: true, budget: true },
  });
  if (cats.length === 0) return res.json({ months: [], categories: [] });

  const thisMonth = monthStart();
  const firstMonth = addMonths(thisMonth, -(months - 1));

  // One scan of the window, bucketed by (categoryId, yyyy-mm).
  const txns = await prisma.transaction.findMany({
    where: { userId, excluded: false, amount: { lt: 0 }, date: { gte: firstMonth, lt: addMonths(thisMonth, 1) } },
    select: { categoryId: true, amount: true, date: true },
  });
  const spend = new Map<string, number>(); // `${catId}|${mkey}` -> spent
  for (const t of txns) {
    if (!t.categoryId) continue;
    const k = `${t.categoryId}|${monthKey(t.date)}`;
    spend.set(k, (spend.get(k) ?? 0) + Math.abs(t.amount));
  }

  const monthCols: string[] = [];
  for (let i = 0; i < months; i++) monthCols.push(monthKey(addMonths(firstMonth, i)));

  const categories = cats.map(c => {
    const cap = c.budget ?? 0;
    const cells = monthCols.map(mk => {
      const spent = Math.round((spend.get(`${c.id}|${mk}`) ?? 0) * 100) / 100;
      return { month: mk, spent, cap, under: spent <= cap, pct: cap > 0 ? Math.round((spent / cap) * 100) : 0 };
    });
    // "How good am I" — share of COMPLETE months under cap (exclude current).
    const complete = cells.slice(0, -1);
    const underCount = complete.filter(c2 => c2.under).length;
    return {
      categoryId: c.id, name: c.name, color: c.color, cap,
      cells,
      underRate: complete.length ? Math.round((underCount / complete.length) * 100) : null,
    };
  });

  res.json({ months: monthCols, categories });
}));

/**
 * PUT /api/budgets/:categoryId  { cap: number | null }
 * Set or clear a category's monthly cap (null/0 clears it).
 */
router.put('/:categoryId', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const { cap } = z.object({ cap: z.number().min(0).nullable() }).parse(req.body);

  const cat = await prisma.category.findFirst({ where: { id: req.params.categoryId, userId }, select: { id: true } });
  if (!cat) throw new AppError('Category not found', 404);

  const updated = await prisma.category.update({
    where: { id: cat.id },
    data: { budget: cap && cap > 0 ? cap : null },
    select: { id: true, name: true, budget: true },
  });
  res.json({ category: updated });
}));

/**
 * QuestEngine candidate builder: a single "BUDGET BREACH" reminder quest for
 * the worst category that's ≥90% of its monthly cap (Brent: a breach warning
 * fires around ~90%). Low XP, finance module, deduped per category per day.
 */
export async function buildBudgetCandidates(
  prisma: PrismaClient,
  userId: string,
  _date: Date,
  nextId: () => string,
): Promise<QuestCandidate[]> {
  const start = monthStart();
  const end = addMonths(start, 1);
  const cats = await prisma.category.findMany({
    where: { userId, budget: { not: null, gt: 0 } },
    select: { id: true, name: true, budget: true },
  });
  if (cats.length === 0) return [];

  const spendRows = await prisma.transaction.groupBy({
    by: ['categoryId'],
    where: { userId, excluded: false, amount: { lt: 0 }, date: { gte: start, lt: end } },
    _sum: { amount: true },
  });
  const spentByCat = new Map<string, number>();
  for (const r of spendRows) if (r.categoryId) spentByCat.set(r.categoryId, Math.abs(r._sum.amount ?? 0));

  let worst: { id: string; name: string; pct: number } | null = null;
  for (const c of cats) {
    const cap = c.budget ?? 0;
    if (cap <= 0) continue;
    const pct = Math.round(((spentByCat.get(c.id) ?? 0) / cap) * 100);
    if (pct >= 90 && (!worst || pct > worst.pct)) worst = { id: c.id, name: c.name, pct };
  }
  if (!worst) return [];

  return [{
    candidateId: nextId(),
    source: 'finance',
    sourceId: `budget:${worst.id}`,
    moduleKey: 'finance',
    baseTitle: `Rein in ${worst.name} spending — ${worst.pct}% of budget used`,
    difficulty: 'easy',
    xpReward: 15,
    context: `budget breach: ${worst.name} at ${worst.pct}% this month`,
    estMinutes: 10,
    carryOver: true,
  }];
}

export default router;
