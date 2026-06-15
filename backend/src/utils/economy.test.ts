import { describe, it, expect } from 'vitest';
import { overclockMultiplier, xpStreakBonus, eddiesForReward } from './economy';
import { applyGrants, grantAllowed } from '../services/aiGrants';

describe('economy math', () => {
  it('overclock multiplier ramps +0.1×/day and caps at ×2.0', () => {
    expect(overclockMultiplier(0)).toBe(1);
    expect(overclockMultiplier(3)).toBe(1.3);
    expect(overclockMultiplier(10)).toBe(2);
    expect(overclockMultiplier(50)).toBe(2); // hard cap holds
    expect(overclockMultiplier(-5)).toBe(1); // negatives floor at 1
  });

  it('xp streak bonus is +1 per 3 days, capped at +10', () => {
    expect(xpStreakBonus(0)).toBe(0);
    expect(xpStreakBonus(2)).toBe(0);
    expect(xpStreakBonus(3)).toBe(1);
    expect(xpStreakBonus(9)).toBe(3);
    expect(xpStreakBonus(60)).toBe(10); // cap
  });

  it('eddies = round(xp/2) + difficulty bonus, never negative', () => {
    expect(eddiesForReward(0)).toBe(0);
    expect(eddiesForReward(20, 'easy')).toBe(10);
    expect(eddiesForReward(20, 'medium')).toBe(13);
    expect(eddiesForReward(20, 'hard')).toBe(18);
    expect(eddiesForReward(-100, 'hard')).toBe(0); // floors at 0 → no bonus on nothing
  });
});

describe('aiGrants filter', () => {
  const grants = { aiAccessHealth: false, aiAccessSocial: true, aiAccessFinance: false, aiAccessCalendar: false };

  it('untagged lines always pass; tagged lines obey their grant', () => {
    expect(grantAllowed(undefined, grants)).toBe(true);
    expect(grantAllowed('social', grants)).toBe(true);
    expect(grantAllowed('health', grants)).toBe(false);
    expect(grantAllowed('finance', grants)).toBe(false);
  });

  it('applyGrants drops disallowed lines and strips to text', () => {
    const out = applyGrants([
      { text: 'general' },
      { text: 'health line', domain: 'health' },
      { text: 'social line', domain: 'social' },
      { text: 'finance line', domain: 'finance' },
    ], grants);
    expect(out).toEqual(['general', 'social line']);
  });
});
