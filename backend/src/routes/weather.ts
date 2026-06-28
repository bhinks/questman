/**
 * Weather — read-only forecast for the CALLER's location, for the Today page.
 * Location is now per-user (UserSettings.weatherLat/weatherLon); this is
 * backed by the same WeatherService (2h snapshot cache) that gates outdoor
 * quests, so it adds no extra API load beyond the cache TTL.
 */
import express from 'express';
import { prisma } from '../server';
import { AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { WeatherService, describeWeatherCode, hourLabel } from '../services/WeatherService';

const router = express.Router();
const weather = new WeatherService();

// An upcoming hour counts as a rain tip when the model says it's likely
// or already predicts measurable accumulation.
const RAIN_TIP_PROB_PCT = 50;
const RAIN_TIP_AMOUNT_IN = 0.02;

/**
 * GET /api/weather/today
 *
 * `{ configured: false }` when the caller has no weatherLat/weatherLon set
 * (the client hides the weather card). Otherwise `{ configured: true, weather }`
 * with today's forecast in US units — `weather` is null if the provider
 * was unreachable.
 */
router.get('/today', asyncHandler(async (req: AuthRequest, res) => {
  const settings = await prisma.userSettings.findUnique({
    where: { userId: req.user!.id },
    select: { weatherLat: true, weatherLon: true },
  });
  const lat = settings?.weatherLat ?? null;
  const lon = settings?.weatherLon ?? null;
  if (lat === null || lon === null) {
    res.json({ configured: false, weather: null });
    return;
  }

  const snap = await weather.getSnapshot(lat, lon);
  if (!snap) {
    res.json({ configured: true, weather: null });
    return;
  }

  const { label, emoji } = describeWeatherCode(snap.weatherCode);

  // "Will rain at 2pm" — the first upcoming hour (current hour included,
  // since its rain may still be ahead) the model flags as likely-wet.
  const nowHour = new Date().getHours();
  const wet = snap.hours.find(h =>
    h.hour >= nowHour
    && (h.precipProbPct >= RAIN_TIP_PROB_PCT || h.precipIn >= RAIN_TIP_AMOUNT_IN));
  const nextRain = wet
    ? { hour: wet.hour, label: hourLabel(wet.hour), probPct: Math.round(wet.precipProbPct) }
    : null;

  const t = snap.tomorrow;
  const tomorrowMeta = t ? describeWeatherCode(t.weatherCode) : null;

  res.json({
    configured: true,
    weather: {
      label,
      emoji,
      tempMaxF: Math.round(snap.tempMaxF),
      tempMinF: Math.round(snap.tempMinF),
      rainTodayIn: snap.rainTodayIn,
      windMaxMph: Math.round(snap.windMaxMph),
      // Today's hourly forecast (local hours 0–23) for tips/sparklines.
      hours: snap.hours.map(h => ({
        hour: h.hour,
        tempF: Math.round(h.tempF),
        precipIn: h.precipIn,
        precipProbPct: Math.round(h.precipProbPct),
      })),
      nextRain,
      tomorrow: t && tomorrowMeta ? {
        label: tomorrowMeta.label,
        emoji: tomorrowMeta.emoji,
        tempMaxF: Math.round(t.tempMaxF),
        tempMinF: Math.round(t.tempMinF),
        rainSumIn: t.rainSumIn,
        windMaxMph: Math.round(t.windMaxMph),
      } : null,
    },
  });
}));

export default router;
