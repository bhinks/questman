/**
 * /api/calendar — the read-only calendar uplink.
 *
 * GET /today: today's agenda + busy/free minutes from the private ICS feeds
 * (CalendarService). `configured:false` when no CALENDAR_ICS_URL is set so
 * the UI can hide the panel entirely; `calendar:null` with configured:true
 * means the feeds are temporarily unreachable.
 */
import express from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { CalendarService, calendarService } from '../services/CalendarService';

const router = express.Router();

router.get('/today', asyncHandler(async (_req, res) => {
  if (!CalendarService.configured()) {
    res.json({ configured: false, calendar: null });
    return;
  }
  const snap = await calendarService.getToday();
  if (!snap) {
    res.json({ configured: true, calendar: null });
    return;
  }
  const now = Date.now();
  const nextEvent = snap.events.find(e => !e.allDay && e.startsAt.getTime() > now) ?? null;
  const shape = (e: typeof snap.events[number]) => ({
    title: e.title,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    allDay: e.allDay,
  });
  res.json({
    configured: true,
    calendar: {
      events: snap.events.map(shape),
      busyMin: snap.busyMin,
      freeMin: snap.freeMin,
      nextEvent: nextEvent ? shape(nextEvent) : null,
    },
  });
}));

export default router;
