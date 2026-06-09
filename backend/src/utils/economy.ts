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
