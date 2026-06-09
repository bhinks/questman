/**
 * Weather — read-only today's forecast for the hub location, for the
 * Today page. Backed by the same WeatherService (and per-day snapshot
 * cache) that gates outdoor quests, so this adds no extra API load
 * beyond the first call of the day.
 */
import express from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { config } from '../config';
import { WeatherService, describeWeatherCode } from '../services/WeatherService';

const router = express.Router();
const weather = new WeatherService();

/**
 * GET /api/weather/today
 *
 * `{ configured: false }` when no HUB_LAT/HUB_LON is set (the client
 * hides the weather card). Otherwise `{ configured: true, weather }`
 * with today's forecast in US units — `weather` is null if the provider
 * was unreachable.
 */
router.get('/today', asyncHandler(async (_req, res) => {
  const configured =
    config.weather.lat !== undefined && config.weather.lon !== undefined;
  if (!configured) {
    res.json({ configured: false, weather: null });
    return;
  }

  const snap = await weather.getSnapshot();
  if (!snap) {
    res.json({ configured: true, weather: null });
    return;
  }

  const { label, emoji } = describeWeatherCode(snap.weatherCode);
  res.json({
    configured: true,
    weather: {
      label,
      emoji,
      tempMaxF: Math.round(snap.tempMaxF),
      tempMinF: Math.round(snap.tempMinF),
      rainTodayIn: snap.rainTodayIn,
      windMaxMph: Math.round(snap.windMaxMph),
    },
  });
}));

export default router;
