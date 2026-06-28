/**
 * /api/calendar — the read-only calendar uplink.
 *
 * GET /today: today's agenda + busy/free minutes from the CALLER's private
 * ICS feeds (UserSettings.calendarIcsUrls → CalendarService). `configured:false`
 * when the caller has no feeds set so the UI can hide the panel entirely;
 * `calendar:null` with configured:true means the feeds are temporarily
 * unreachable.
 */
import express from 'express';
import { prisma } from '../server';
import { AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { CalendarService, calendarService } from '../services/CalendarService';

const router = express.Router();

router.get('/today', asyncHandler(async (req: AuthRequest, res) => {
  const settings = await prisma.userSettings.findUnique({
    where: { userId: req.user!.id },
    select: { calendarIcsUrls: true },
  });
  const urls = CalendarService.parseUrls(settings?.calendarIcsUrls);
  if (!CalendarService.configured(urls)) {
    res.json({ configured: false, calendar: null });
    return;
  }
  const snap = await calendarService.getToday(urls);
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
