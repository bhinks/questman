/**
 * Eddies (€$) economy math. Pure functions, no DB.
 *
 * Two-currency design (roadmap economy):
 *   - XP    — permanent progression, drives levels. Earned, never spent.
 *   - Eddies — spendable currency. Earned alongside XP, spent in the Shop.
 *
 * Earn rate is **pegged to XP with a small difficulty bonus** (Brent's
 * call): a quest/habit that pays N XP pays N eddies plus a flat bonus
 * for the harder tiers, so grindier work feels a touch more rewarding to
 * spend. Kept deliberately simple and tunable; the overclock streak
 * multiplier (a later phase) will scale the *eddie* side on top of this.
 */

export type Difficulty = 'easy' | 'medium' | 'hard';

/** Flat eddie bonus per difficulty tier, added on top of the pegged XP. */
const DIFFICULTY_BONUS: Record<Difficulty, number> = {
  easy: 0,
  medium: 3,
  hard: 8,
};

function asDifficulty(value: string | null | undefined): Difficulty {
  return value === 'medium' || value === 'hard' ? value : 'easy';
}

/**
 * Eddies awarded for a reward worth `xp` at the given difficulty.
 * Pegged 1:1 to XP plus the difficulty bonus. Never negative.
 */
export function eddiesForReward(xp: number, difficulty?: string | null): number {
  const base = Math.max(0, Math.round(xp));
  if (base === 0) return 0;
  return base + DIFFICULTY_BONUS[asDifficulty(difficulty)];
}

// --- Overclock: streaks that mechanically matter (roadmap) -----------

/** Eddie multiplier per full-clear-day streak. +0.1× per day, capped ×2.0
 *  ("OVERCLOCK ×1.5 — cooling unstable"). Applied to eddie EARNS only. */
export function overclockMultiplier(overclockStreak: number): number {
  const m = 1 + Math.max(0, overclockStreak) * 0.1;
  return Math.round(Math.min(2.0, m) * 100) / 100;
}

/** Small flat XP bonus on quest completion that scales with the daily
 *  activity streak (Brent: no XP multiplier, but a streak bonus is fine).
 *  +1 XP per 3 streak-days, capped at +10. */
export function xpStreakBonus(currentStreak: number): number {
  return Math.min(10, Math.floor(Math.max(0, currentStreak) / 3));
}

/** ISO-week key like "2026-W24" for the weekly token-allowance refill. */
export function isoWeekKey(date: Date): string {
  // Copy to a UTC-ish date at local midnight, then find the Thursday of
  // this week (ISO weeks belong to the year of their Thursday).
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = (d.getDay() + 6) % 7; // Mon=0 .. Sun=6
  d.setDate(d.getDate() - day + 3); // move to Thursday
  const firstThursday = new Date(d.getFullYear(), 0, 4);
  const ft = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - ft + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}
