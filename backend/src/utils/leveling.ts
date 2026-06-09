/**
 * XP / level math. Pure functions, no DB.
 *
 * Curve: each level requires ~100 * level^1.5 XP, so:
 *   L2 starts at 100, L3 at 283, L4 at 520, L5 at 800, L10 at ~3162, L20 at ~8944.
 * Early levels come fast (good for first-week dopamine); late levels stretch.
 */

const BASE = 100;
const EXP = 1.5;

/** XP threshold (cumulative) to reach level `n`. Level 1 = 0 XP. */
export function xpForLevel(n: number): number {
  if (n <= 1) return 0;
  return Math.floor(BASE * Math.pow(n - 1, EXP));
}

/** Current level for a given total XP. */
export function levelFromXp(totalXp: number): number {
  if (totalXp <= 0) return 1;
  // Levels are unbounded in principle; cap loop for safety.
  let level = 1;
  while (level < 1000 && xpForLevel(level + 1) <= totalXp) {
    level++;
  }
  return level;
}

export interface LevelInfo {
  level: number;
  totalXp: number;
  xpIntoLevel: number;     // xp earned since reaching `level`
  xpForNextLevel: number;  // xp required from `level` start to reach `level+1`
  progress: number;        // 0..1 (xpIntoLevel / xpForNextLevel)
}

/** Derive everything from totalXp. */
export function levelInfo(totalXp: number): LevelInfo {
  const level = levelFromXp(totalXp);
  const floor = xpForLevel(level);
  const ceil = xpForLevel(level + 1);
  const span = Math.max(1, ceil - floor);
  const xpIntoLevel = Math.max(0, totalXp - floor);
  return {
    level,
    totalXp,
    xpIntoLevel,
    xpForNextLevel: span,
    progress: Math.min(1, xpIntoLevel / span),
  };
}
