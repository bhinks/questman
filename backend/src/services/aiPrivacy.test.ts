import { describe, it, expect } from 'vitest';
import { buildDailyBrief, buildWeeklyBrief } from './handler';
import type { DailyDigest, WeeklyDigest } from './digest';
import type { DomainGrants } from './aiGrants';

const ALL_OFF: DomainGrants = { aiAccessHealth: false, aiAccessSocial: false, aiAccessFinance: false, aiAccessCalendar: false };
const ALL_ON: DomainGrants = { aiAccessHealth: true, aiAccessSocial: true, aiAccessFinance: true, aiAccessCalendar: true };

// A digest deliberately loaded with sensitive data from every gated domain.
const DAILY: DailyDigest = {
  date: '2026-06-14', dayLabel: 'Sunday, June 14', isWeekend: true,
  streak: 4, overclockStreak: 3, overclockMultiplier: 1.3, energyTier: 'high',
  questCount: 5, mustDoCount: 1, carriedOverCount: 2, questTitles: ['Sweep the ledger', 'Iron tempo'],
  rrCredits: 1, topBoss: { name: 'Ripperdoc debt', pct: 37 },
  neglectedContact: { name: 'Judy Alvarez', days: 20 },
  breachedYesterday: [],
  calendar: { eventCount: 3, busyMin: 120, freeMin: 300, nextLabel: '2:00 PM' },
};

const WEEKLY: WeeklyDigest = {
  weekOf: '2026-06-08', weekEnd: '2026-06-14',
  xpEarned: 420, eddiesEarned: 210, eddiesSpent: 60,
  questsCompleted: 12, questsSkipped: 2, questsExpired: 1, completionRate: 80,
  currentStreak: 4, overclockStreak: 3,
  workouts: 5, bossDamageEvents: 4, bossesDefeated: 1, achievementsUnlocked: 2,
  spendTotal: 750, topCategories: [{ name: 'Cyberware', amount: 480 }],
  vitals: { sleepAvg: 7, moodAvg: 4, weightDelta: -1 },
  activeDays: 6,
};

// Substrings that MUST NOT appear once their domain grant is sealed.
const DAILY_LEAKS = ['Energy reads', 'Judy Alvarez', 'Calendar:', '2:00 PM'];
const WEEKLY_LEAKS = ['Spend this week', 'Cyberware', '$750', 'Avg sleep', 'Workouts logged'];

describe('AI privacy — sealed domains never reach the brief', () => {
  it('daily brief drops every gated line when all grants are off', () => {
    const brief = buildDailyBrief(DAILY, ALL_OFF);
    for (const leak of DAILY_LEAKS) expect(brief).not.toContain(leak);
    // General (ungated) facts still pass through.
    expect(brief).toContain('Sunday, June 14');
    expect(brief).toContain('Open gigs');
  });

  it('weekly brief drops every gated line when all grants are off', () => {
    const brief = buildWeeklyBrief(WEEKLY, [], ALL_OFF);
    for (const leak of WEEKLY_LEAKS) expect(brief).not.toContain(leak);
    expect(brief).toContain('Week of');
  });

  it('grants ON surface the data (proves the filter actually gates, not just hides)', () => {
    const daily = buildDailyBrief(DAILY, ALL_ON);
    for (const leak of DAILY_LEAKS) expect(daily).toContain(leak);
    const weekly = buildWeeklyBrief(WEEKLY, [], ALL_ON);
    for (const leak of WEEKLY_LEAKS) expect(weekly).toContain(leak);
  });

  it('each domain gates independently', () => {
    // Only health granted → energy/sleep/workouts show, finance/social/calendar don't.
    const onlyHealth: DomainGrants = { ...ALL_OFF, aiAccessHealth: true };
    const daily = buildDailyBrief(DAILY, onlyHealth);
    expect(daily).toContain('Energy reads');
    expect(daily).not.toContain('Judy Alvarez'); // social still sealed
    expect(daily).not.toContain('Calendar:');    // calendar still sealed

    const weekly = buildWeeklyBrief(WEEKLY, [], onlyHealth);
    expect(weekly).toContain('Workouts logged');
    expect(weekly).not.toContain('Spend this week'); // finance still sealed
  });
});
