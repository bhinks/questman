/**
 * recurringDetector.ts — find recurring money drains from transaction history.
 *
 * Replaces the old AnalyticsEngine.findRecurringTransactions stub (which
 * returned []). Heuristic: group expenses by a normalized description key,
 * then for each group with enough occurrences at a roughly-regular interval
 * and a stable amount, emit a candidate (monthly / weekly / yearly). Brent
 * wants **auto-detect → confirm**, so this only proposes; the user confirms
 * a candidate into a RecurringExpense via the route.
 */
import { Prisma, PrismaClient } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

const SUBSCRIPTION_HINTS = [
  'netflix', 'hulu', 'disney', 'spotify', 'apple', 'youtube', 'hbo', 'max', 'prime',
  'subscription', 'premium', 'membership', 'patreon', 'substack', 'icloud', 'dropbox',
  'adobe', 'microsoft', 'google', 'gym', 'fitness', 'paramount', 'peacock', 'audible',
];

export interface RecurringCandidate {
  name: string;            // a readable label from the description
  key: string;             // normalized grouping key
  amount: number;          // median charge magnitude (positive)
  cadence: 'weekly' | 'monthly' | 'yearly';
  dueDay: number | null;   // typical day-of-month (monthly)
  categoryId: string | null;
  isSubscription: boolean;
  matchCount: number;      // how many transactions backed this
  lastChargedOn: string;   // ISO of most recent hit
}

/** Normalize a description into a stable grouping key. */
function normalizeKey(desc: string): string {
  return desc
    .toLowerCase()
    .replace(/[0-9]+/g, ' ')
    .replace(/[^a-z ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .join(' ')
    .trim();
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Only weekly + monthly are auto-detected — a ~200-day scan can't span the 3
// charges a yearly cadence would need, so yearly stays a manual-entry option.
function cadenceFromInterval(days: number): 'weekly' | 'monthly' | null {
  if (days >= 5 && days <= 9) return 'weekly';
  if (days >= 25 && days <= 35) return 'monthly';
  return null;
}

/**
 * Detect recurring expenses over the last `windowDays`. Returns candidates
 * sorted by annualized cost (biggest drains first). Pure read.
 */
export async function detectRecurring(db: Db, userId: string, windowDays = 200): Promise<RecurringCandidate[]> {
  const since = new Date(Date.now() - windowDays * 86_400_000);
  const txns = await db.transaction.findMany({
    where: { userId, excluded: false, amount: { lt: 0 }, date: { gte: since } },
    select: { description: true, amount: true, date: true, categoryId: true },
    orderBy: { date: 'asc' },
  });

  // Group by normalized key.
  const groups = new Map<string, { desc: string; amount: number; date: Date; categoryId: string | null }[]>();
  for (const t of txns) {
    const key = normalizeKey(t.description);
    if (key.length < 3) continue; // too generic to be a useful group
    const arr = groups.get(key) ?? [];
    arr.push({ desc: t.description, amount: Math.abs(t.amount), date: t.date, categoryId: t.categoryId });
    groups.set(key, arr);
  }

  const out: RecurringCandidate[] = [];
  for (const [key, items] of groups) {
    if (items.length < 3) continue;
    // Intervals between consecutive charges.
    const intervals: number[] = [];
    for (let i = 1; i < items.length; i++) {
      intervals.push((items[i].date.getTime() - items[i - 1].date.getTime()) / 86_400_000);
    }
    const medInterval = median(intervals.filter(d => d > 0));
    const cadence = cadenceFromInterval(medInterval);
    if (!cadence) continue;

    const amounts = items.map(i => i.amount);
    const medAmount = median(amounts);
    if (medAmount <= 0) continue;
    // Require amount stability: most charges within ±25% of the median.
    const stable = amounts.filter(a => Math.abs(a - medAmount) <= medAmount * 0.25).length;
    if (stable < Math.ceil(items.length * 0.6)) continue;

    const last = items[items.length - 1];
    const dueDays = items.map(i => i.date.getDate());
    const dueDay = cadence === 'monthly' ? median(dueDays) : null;
    const isSubscription = SUBSCRIPTION_HINTS.some(h => key.includes(h) || last.desc.toLowerCase().includes(h));
    // Most common categoryId among the group.
    const catCount = new Map<string, number>();
    for (const i of items) if (i.categoryId) catCount.set(i.categoryId, (catCount.get(i.categoryId) ?? 0) + 1);
    const categoryId = [...catCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    out.push({
      name: last.desc.slice(0, 60),
      key,
      amount: Math.round(medAmount * 100) / 100,
      cadence,
      dueDay: dueDay ? Math.round(dueDay) : null,
      categoryId,
      isSubscription,
      matchCount: items.length,
      lastChargedOn: last.date.toISOString(),
    });
  }

  const annualized = (c: RecurringCandidate) =>
    c.amount * (c.cadence === 'weekly' ? 52 : c.cadence === 'monthly' ? 12 : 1);
  return out.sort((a, b) => annualized(b) - annualized(a));
}
