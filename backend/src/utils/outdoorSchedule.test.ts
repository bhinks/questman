import { describe, it, expect } from 'vitest';
import { outdoorRotationElapsed } from './outdoorSchedule';
import { startOfLocalDay } from './dates';

const today = startOfLocalDay(new Date('2026-07-07T12:00:00'));
const daysAgo = (n: number) => new Date(today.getTime() - n * 86_400_000);

const base = { schedule: null as string | null, dueDate: null as Date | null, lastCompletedOn: null as Date | null };

describe('outdoorRotationElapsed', () => {
  it('daily is always rotation-eligible', () => {
    expect(outdoorRotationElapsed({ ...base, cadence: 'daily' }, today)).toBe(true);
  });

  it('weekly: never-completed is waiting for its first good day', () => {
    expect(outdoorRotationElapsed({ ...base, cadence: 'weekly' }, today)).toBe(true);
  });

  it('weekly: elapses at 7 days since last completion', () => {
    expect(outdoorRotationElapsed({ ...base, cadence: 'weekly', lastCompletedOn: daysAgo(6) }, today)).toBe(false);
    expect(outdoorRotationElapsed({ ...base, cadence: 'weekly', lastCompletedOn: daysAgo(7) }, today)).toBe(true);
    expect(outdoorRotationElapsed({ ...base, cadence: 'weekly', lastCompletedOn: daysAgo(9) }, today)).toBe(true);
  });

  it('custom: nominal gap follows the weekday count (3 days/week ≈ every 3rd day)', () => {
    const sched = JSON.stringify({ daysOfWeek: [1, 3, 5] });
    expect(outdoorRotationElapsed({ ...base, cadence: 'custom', schedule: sched, lastCompletedOn: daysAgo(2) }, today)).toBe(false);
    expect(outdoorRotationElapsed({ ...base, cadence: 'custom', schedule: sched, lastCompletedOn: daysAgo(3) }, today)).toBe(true);
  });

  it('custom: unparsable or empty schedule degrades to a 7-day rotation', () => {
    expect(outdoorRotationElapsed({ ...base, cadence: 'custom', schedule: 'not json', lastCompletedOn: daysAgo(6) }, today)).toBe(false);
    expect(outdoorRotationElapsed({ ...base, cadence: 'custom', schedule: 'not json', lastCompletedOn: daysAgo(7) }, today)).toBe(true);
    expect(outdoorRotationElapsed({ ...base, cadence: 'custom', schedule: JSON.stringify({ daysOfWeek: [] }), lastCompletedOn: daysAgo(7) }, today)).toBe(true);
  });

  it('once: waits for a good day from the due date onward, never before', () => {
    expect(outdoorRotationElapsed({ ...base, cadence: 'once', dueDate: daysAgo(-2) }, today)).toBe(false); // due in 2 days
    expect(outdoorRotationElapsed({ ...base, cadence: 'once', dueDate: today }, today)).toBe(true);
    expect(outdoorRotationElapsed({ ...base, cadence: 'once', dueDate: daysAgo(4) }, today)).toBe(true);  // overdue: any good day
    expect(outdoorRotationElapsed({ ...base, cadence: 'once' }, today)).toBe(true);                        // no date = next good day
  });

  it('once: a completed one-off never re-fires', () => {
    expect(outdoorRotationElapsed({ ...base, cadence: 'once', dueDate: daysAgo(4), lastCompletedOn: daysAgo(2) }, today)).toBe(false);
  });

  it('unknown cadence never fires', () => {
    expect(outdoorRotationElapsed({ ...base, cadence: 'yearly' }, today)).toBe(false);
  });
});
