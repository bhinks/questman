/**
 * outdoorSchedule — weather-first scheduling for outdoor (weather-ruled)
 * habits and chores.
 *
 * Calendar cadence and the weather gate used to AND together: a weekly
 * chore scheduled for Monday was only *considered* on Mondays, and if that
 * one day's weather failed its rule the chore silently vanished until the
 * next Monday. For weather-dependent work that inverts the intent — the
 * weather is the real schedule; the weekday is at most a preference. In
 * practice rules like "needs a dry day" could go weeks without ever
 * landing on their scheduled weekday, so the chore never fired at all.
 *
 * The QuestEngine therefore treats an outdoor item as due when its weather
 * rule passes AND (it's calendar-due today OR its rotation has elapsed).
 * This module answers the rotation half: "has enough of the cadence's
 * nominal interval passed that the next good-weather day should count?"
 */
import { startOfLocalDay } from './dates';

export interface OutdoorScheduleFields {
  cadence: string;                 // 'daily' | 'weekly' | 'custom' | 'once'
  schedule: string | null;         // JSON {daysOfWeek?: number[]} for weekly/custom
  dueDate: Date | null;            // 'once' only
  lastCompletedOn: Date | null;
}

/**
 * True when an outdoor item's rotation has elapsed, making it eligible to
 * fire on a passing-weather day that isn't its scheduled weekday.
 *
 *  - daily: always (the calendar already makes it due every day).
 *  - weekly: 7 days since last completion; never completed → waiting.
 *  - custom: the nominal gap implied by the picked weekday count
 *    (ceil(7 / N days)); never completed → waiting.
 *  - once: any day at/after the due date (an outdoor one-off is waiting
 *    for a good day, not pinned to the exact date), but never again after
 *    it has been completed.
 *
 * minIntervalDays throttling stays the caller's job (intervalOk), same as
 * for indoor habits.
 */
export function outdoorRotationElapsed(h: OutdoorScheduleFields, today: Date): boolean {
  switch (h.cadence) {
    case 'daily':
      return true;
    case 'weekly':
    case 'custom': {
      if (!h.lastCompletedOn) return true;
      const rotationDays = h.cadence === 'weekly' ? 7 : customRotationDays(h.schedule);
      const last = startOfLocalDay(new Date(h.lastCompletedOn));
      const daysSince = Math.round((today.getTime() - last.getTime()) / 86_400_000);
      return daysSince >= rotationDays;
    }
    case 'once': {
      if (h.lastCompletedOn) return false; // a done one-off never re-fires
      if (!h.dueDate) return true;         // no date = "next good day"
      return startOfLocalDay(new Date(h.dueDate)).getTime() <= today.getTime();
    }
    default:
      return false;
  }
}

/** Nominal days between runs for a custom weekday set: 3 days/week ≈ every 3rd day. */
function customRotationDays(schedule: string | null): number {
  let days: unknown;
  try { days = schedule ? JSON.parse(schedule)?.daysOfWeek : null; } catch { /* fall through */ }
  const count = Array.isArray(days) && days.length > 0 ? days.length : 1;
  return Math.ceil(7 / count);
}
