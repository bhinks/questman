/**
 * CalendarService — the calendar uplink (roadmap §Inputs & integrations).
 *
 * Reads one or more PRIVATE ICS feeds (UserSettings.calendarIcsUrls — e.g.
 * Google Calendar's "secret address in iCal format", comma-separated) and
 * reduces today to:
 *   - the day's events (recurrence-expanded, exdates/overrides honored),
 *   - merged BUSY minutes inside the waking window (08:00–22:00 local),
 *   - the matching FREE minutes and the next upcoming event.
 *
 * Read-only by design (Brent's call: free/busy first, two-way maybe later).
 * Mirrors WeatherService: one in-process snapshot cached per day with a
 * 15-minute TTL, hard fetch timeouts, and null on any failure — callers
 * (the day planner, /api/calendar/today) always degrade gracefully.
 * AI: gated by the SYS//CAL aiAccessCalendar grant (default SEALED). Even
 * when granted, only counts/times/free-busy reach the model — never titles.
 */
import * as ical from 'node-ical';
import { logger } from '../utils/logger';
import { startOfLocalDay } from '../utils/dates';

export interface CalEvent {
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  /** TRANSP:TRANSPARENT events (birthdays, FYI blocks) don't count as busy. */
  transparent: boolean;
}

export interface CalendarSnapshot {
  events: CalEvent[];   // today's events, all-day first then by start
  busyMin: number;      // merged timed-event overlap with the waking window
  freeMin: number;      // waking window minus busy
  fetchedAt: Date;
}

const CACHE_TTL_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 6_000;
// The "go time" window busy/free is measured against. Matches the planner's
// spirit (the day budget is waking capacity, not 24h).
const WAKE_START_H = 8;
const WAKE_END_H = 22;

export class CalendarService {
  private cache: { key: string; snap: CalendarSnapshot } | null = null;

  /** Parse the per-user comma-separated calendarIcsUrls string into a clean
   *  list (trimmed, blanks dropped). Mirrors the retired CALENDAR_ICS_URL env
   *  parsing so existing feed strings carry over verbatim. */
  static parseUrls(raw: string | null | undefined): string[] {
    if (!raw) return [];
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }

  static configured(urls: string[]): boolean {
    return urls.length > 0;
  }

  /** Today's snapshot for the given feeds, or null (none configured / all
   *  feeds failed). The cache key includes the feed list so different users'
   *  calendars never collide in the shared singleton's one-entry cache. */
  async getToday(urls: string[]): Promise<CalendarSnapshot | null> {
    if (urls.length === 0) return null;
    const dayStart = startOfLocalDay();
    const key = `${urls.join('|')}:${dayStart.getTime()}`;

    if (this.cache?.key === key &&
        Date.now() - this.cache.snap.fetchedAt.getTime() < CACHE_TTL_MS) {
      return this.cache.snap;
    }

    try {
      const events = await this.fetchDay(dayStart, urls);
      const snap = summarize(events, dayStart);
      this.cache = { key, snap };
      return snap;
    } catch (err: any) {
      logger.warn(`[calendar] feed fetch failed: ${err?.message ?? err}`);
      // Same-day stale snapshot beats nothing; otherwise degrade to null.
      return this.cache?.key === key ? this.cache.snap : null;
    }
  }

  /** Fetch + parse every feed, expanding recurrences into today's range. */
  private async fetchDay(dayStart: Date, urls: string[]): Promise<CalEvent[]> {
    const dayEnd = new Date(dayStart.getTime() + 86_400_000 - 1);
    const out: CalEvent[] = [];

    for (const url of urls) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!res.ok) {
          logger.warn(`[calendar] feed responded ${res.status}`);
          continue;
        }
        const parsed = ical.sync.parseICS(await res.text());
        for (const item of Object.values(parsed)) {
          if (!item || item.type !== 'VEVENT') continue;
          const ev = item as ical.VEvent;
          if (ev.status === 'CANCELLED') continue;
          // Handles both one-off and recurring events; exdates + overrides
          // applied by default. expandOngoing catches events spanning
          // midnight into today.
          const instances = ical.expandRecurringEvent(ev, {
            from: dayStart, to: dayEnd, expandOngoing: true,
          });
          for (const inst of instances) {
            if (inst.event.status === 'CANCELLED') continue;
            out.push({
              title: titleOf(inst.summary),
              startsAt: new Date(inst.start),
              endsAt: new Date(inst.end),
              allDay: inst.isFullDay,
              transparent: String((inst.event as any).transparency ?? '').toUpperCase() === 'TRANSPARENT',
            });
          }
        }
      } catch (err: any) {
        // One bad feed must not sink the others.
        logger.warn(`[calendar] feed skipped: ${err?.message ?? err}`);
      }
    }
    return out;
  }
}

function titleOf(summary: unknown): string {
  if (typeof summary === 'string') return summary || 'Busy';
  const val = (summary as { val?: string } | null)?.val;
  return val || 'Busy';
}

/** Reduce raw events to the day summary: sort + merged busy/free minutes. */
function summarize(events: CalEvent[], dayStart: Date): CalendarSnapshot {
  const sorted = [...events].sort((a, b) =>
    (a.allDay === b.allDay ? a.startsAt.getTime() - b.startsAt.getTime() : a.allDay ? -1 : 1));

  const winStart = dayStart.getTime() + WAKE_START_H * 3_600_000;
  const winEnd = dayStart.getTime() + WAKE_END_H * 3_600_000;

  // Clip timed, opaque events to the waking window and merge overlaps so
  // double-booked hours only count once.
  const spans = sorted
    .filter(e => !e.allDay && !e.transparent)
    .map(e => [Math.max(e.startsAt.getTime(), winStart), Math.min(e.endsAt.getTime(), winEnd)] as [number, number])
    .filter(([s, en]) => en > s)
    .sort((a, b) => a[0] - b[0]);

  let busyMs = 0;
  let curStart = 0, curEnd = -1;
  for (const [s, en] of spans) {
    if (s > curEnd) {
      if (curEnd > curStart) busyMs += curEnd - curStart;
      curStart = s; curEnd = en;
    } else {
      curEnd = Math.max(curEnd, en);
    }
  }
  if (curEnd > curStart) busyMs += curEnd - curStart;

  const busyMin = Math.round(busyMs / 60_000);
  const windowMin = (WAKE_END_H - WAKE_START_H) * 60;
  return {
    events: sorted,
    busyMin,
    freeMin: Math.max(0, windowMin - busyMin),
    fetchedAt: new Date(),
  };
}

/** Shared instance so the planner and the route reuse one cache. */
export const calendarService = new CalendarService();
