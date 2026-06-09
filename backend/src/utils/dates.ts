/**
 * Day-key utilities. Always computed server-side; never trust client dates.
 *
 * "Day" = a DateTime normalized to local midnight in the server's TZ
 * (set via the TZ env var in Docker; defaults to the process TZ otherwise).
 *
 * All @@unique([..., questDate]) / @@unique([habitId, completedOn]) /
 * @@unique([userId, runDate]) constraints depend on this exact value.
 */

/** Local midnight for the given date (default: now). */
export function startOfLocalDay(date: Date = new Date()): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return d;
}

/** Local midnight of `n` days before the given date (default: now). */
export function daysAgoLocal(n: number, from: Date = new Date()): Date {
  const d = startOfLocalDay(from);
  d.setDate(d.getDate() - n);
  return d;
}

/** True iff the two dates are the same local day. */
export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** True iff `prior` is exactly the local day before `next`. */
export function isYesterdayLocal(prior: Date, next: Date = new Date()): boolean {
  const expected = daysAgoLocal(1, next);
  return isSameLocalDay(prior, expected);
}
