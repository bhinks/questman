/**
 * WeatherService — gates outdoor chores/habits on real weather and
 * picks the best time-of-day window to do them.
 *
 * Data source: Open-Meteo (https://open-meteo.com). No API key, free,
 * and it returns past + forecast in one call — exactly what the
 * dry-days-required check needs. We request US units (°F, mph, inches)
 * so rules and the UI speak freedom units end-to-end.
 *
 * Design:
 *   - One fetch per generation run covers every outdoor habit, because
 *     the hub has a single location (config.weather.lat/lon). The
 *     snapshot is cached in-process keyed by (lat, lon, localDay) so a
 *     day's repeated /quests/today calls reuse it.
 *   - When location is unset or the API is unreachable, getSnapshot()
 *     returns null and the QuestEngine degrades outdoor gating to
 *     interval-only (the rule is treated as satisfied on the weather
 *     axis). We never block quest generation on the weather provider.
 *
 * The weather rule lives on Habit.weatherRule as a JSON string:
 *   { outdoor: true, dryDaysRequired?, maxRainTodayIn?,
 *     minTempF?, maxTempF?, maxWindMph? }
 */
import { config } from '../config';
import { logger } from '../utils/logger';
import { startOfLocalDay } from '../utils/dates';

/** Parsed shape of Habit.weatherRule. All gates optional but `outdoor`. */
export interface WeatherRule {
  outdoor: boolean;
  /** Require this many consecutive dry days immediately before today. */
  dryDaysRequired?: number;
  /** Max precipitation forecast for today, in inches. */
  maxRainTodayIn?: number;
  /** Today's high must be at least this (°F). */
  minTempF?: number;
  /** Today's high must be at most this (°F). */
  maxTempF?: number;
  /** Today's max wind must be at most this (mph). */
  maxWindMph?: number;
}

/** Tomorrow's forecast distilled to a daily rollup (US units). */
export interface DayForecast {
  tempMaxF: number;
  tempMinF: number;
  rainSumIn: number;
  windMaxMph: number;
  weatherCode: number;
}

/** A day's weather distilled to what the rules need (US units). */
export interface WeatherSnapshot {
  rainTodayIn: number;
  tempMaxF: number;
  tempMinF: number;
  windMaxMph: number;
  /** WMO weather code for today (drives the display label/emoji). */
  weatherCode: number;
  /** Consecutive dry days (precip ≤ DRY_THRESHOLD_IN) right before today. */
  dryDayStreak: number;
  /** ALL of today's hours (0–23, local) — window scoring filters to the
   *  daylight band itself; the route exposes the full day for rain tips. */
  hours: HourPoint[];
  /** Tomorrow's daily rollup (null if the provider returned only today). */
  tomorrow: DayForecast | null;
}

/** Map a WMO weather code to a short label + emoji for the UI. */
export function describeWeatherCode(code: number): { label: string; emoji: string } {
  if (code === 0) return { label: 'Clear', emoji: '☀️' };
  if (code === 1) return { label: 'Mainly clear', emoji: '🌤️' };
  if (code === 2) return { label: 'Partly cloudy', emoji: '⛅' };
  if (code === 3) return { label: 'Overcast', emoji: '☁️' };
  if (code === 45 || code === 48) return { label: 'Fog', emoji: '🌫️' };
  if (code >= 51 && code <= 57) return { label: 'Drizzle', emoji: '🌦️' };
  if (code >= 61 && code <= 67) return { label: 'Rain', emoji: '🌧️' };
  if (code >= 71 && code <= 77) return { label: 'Snow', emoji: '🌨️' };
  if (code >= 80 && code <= 82) return { label: 'Rain showers', emoji: '🌦️' };
  if (code === 85 || code === 86) return { label: 'Snow showers', emoji: '🌨️' };
  if (code >= 95) return { label: 'Thunderstorm', emoji: '⛈️' };
  return { label: 'Unknown', emoji: '🌡️' };
}

export interface HourPoint {
  hour: number;     // 0–23, local
  tempF: number;
  precipIn: number;
  precipProbPct: number; // precipitation probability, 0–100
  windMph: number;
}

export interface WeatherEvaluation {
  ok: boolean;
  /** Human-readable reasons a gate failed (empty when ok). */
  reasons: string[];
  /** Best window label e.g. "2pm" or "1–3pm", when one is found. */
  bestWindow?: string;
}

// A day with ≤ this much precip counts as "dry" for the streak check.
// 0.04 in ≈ 1 mm — a trace that won't leave the ground soggy.
const DRY_THRESHOLD_IN = 0.04;
// Daylight band considered for the best-window scan (local hours).
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 20;
// How long to wait on Open-Meteo before giving up and degrading.
const FETCH_TIMEOUT_MS = 4000;
// Cache TTL. Open-Meteo refreshes its model hourly; 2h keeps intraday
// "rain at 2pm" tips reasonably fresh without hammering the API.
const CACHE_TTL_MS = 2 * 60 * 60 * 1000;

interface CacheEntry { dayKey: string; fetchedAt: number; snapshot: WeatherSnapshot | null; }
let cache: CacheEntry | null = null;

export class WeatherService {
  /**
   * Today's snapshot for the hub location, or null if location is
   * unconfigured or the provider is unreachable. Cached for 2 hours
   * (and never across a day rollover).
   */
  async getSnapshot(): Promise<WeatherSnapshot | null> {
    const { lat, lon } = config.weather;
    if (lat === undefined || lon === undefined) return null;

    const dayKey = `${lat},${lon}:${startOfLocalDay().getTime()}`;
    if (cache && cache.dayKey === dayKey && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
      return cache.snapshot;
    }

    let snapshot: WeatherSnapshot | null = null;
    try {
      snapshot = await this.fetchSnapshot(lat, lon);
    } catch (err: any) {
      logger.warn(`[weather] fetch failed, degrading to interval-only: ${err?.message ?? err}`);
      snapshot = null;
    }
    cache = { dayKey, fetchedAt: Date.now(), snapshot };
    return snapshot;
  }

  /**
   * Evaluate a parsed rule against a snapshot. With no snapshot the
   * weather axis is treated as satisfied (interval-only fallback), so
   * outdoor habits still surface when the provider is down.
   */
  evaluate(rule: WeatherRule, snap: WeatherSnapshot | null): WeatherEvaluation {
    if (!snap) return { ok: true, reasons: [] };

    const reasons: string[] = [];
    if (rule.dryDaysRequired !== undefined && snap.dryDayStreak < rule.dryDaysRequired) {
      reasons.push(`needs ${rule.dryDaysRequired} dry day(s), has ${snap.dryDayStreak}`);
    }
    if (rule.maxRainTodayIn !== undefined && snap.rainTodayIn > rule.maxRainTodayIn) {
      reasons.push(`rain ${snap.rainTodayIn.toFixed(2)}in > ${rule.maxRainTodayIn}in`);
    }
    if (rule.minTempF !== undefined && snap.tempMaxF < rule.minTempF) {
      reasons.push(`high ${snap.tempMaxF.toFixed(0)}°F < ${rule.minTempF}°F`);
    }
    if (rule.maxTempF !== undefined && snap.tempMaxF > rule.maxTempF) {
      reasons.push(`high ${snap.tempMaxF.toFixed(0)}°F > ${rule.maxTempF}°F`);
    }
    if (rule.maxWindMph !== undefined && snap.windMaxMph > rule.maxWindMph) {
      reasons.push(`wind ${snap.windMaxMph.toFixed(0)}mph > ${rule.maxWindMph}mph`);
    }

    const ok = reasons.length === 0;
    return {
      ok,
      reasons,
      bestWindow: ok ? this.bestWindow(rule, snap) : undefined,
    };
  }

  /**
   * Would this rule still pass TOMORROW? Drives the planner's
   * "last clear day" boost: an outdoor quest that's doable today but
   * blocked tomorrow deserves to rank up today. With no snapshot or no
   * tomorrow data we return true (no boost — never pressure on guesses).
   * The dry-streak axis projects forward: tomorrow's streak is today's
   * +1 if today stays dry, else 0.
   */
  passesTomorrow(rule: WeatherRule, snap: WeatherSnapshot | null): boolean {
    const t = snap?.tomorrow;
    if (!snap || !t) return true;
    if (rule.dryDaysRequired !== undefined) {
      const streakTomorrow = snap.rainTodayIn <= DRY_THRESHOLD_IN ? snap.dryDayStreak + 1 : 0;
      if (streakTomorrow < rule.dryDaysRequired) return false;
    }
    if (rule.maxRainTodayIn !== undefined && t.rainSumIn > rule.maxRainTodayIn) return false;
    if (rule.minTempF !== undefined && t.tempMaxF < rule.minTempF) return false;
    if (rule.maxTempF !== undefined && t.tempMaxF > rule.maxTempF) return false;
    if (rule.maxWindMph !== undefined && t.windMaxMph > rule.maxWindMph) return false;
    return true;
  }

  /**
   * Is today a genuinely pleasant day for outdoor work — dry, mild, calm, and
   * clear-ish? Drives the planner's "don't waste a nice day" boost so weather-
   * gated tasks float up the board when the conditions are actually good (not
   * merely passing a task's minimum gate). No snapshot → false (never nudge on
   * a guess).
   */
  static isNiceDay(snap: WeatherSnapshot | null): boolean {
    if (!snap) return false;
    const clearish = snap.weatherCode <= 3;                 // clear → overcast, no precip codes
    const dry = snap.rainTodayIn <= DRY_THRESHOLD_IN;
    const mild = snap.tempMaxF >= 55 && snap.tempMaxF <= 88 && snap.tempMinF >= 38;
    const calm = snap.windMaxMph <= 22;
    return clearish && dry && mild && calm;
  }

  /** Parse a Habit.weatherRule JSON string. Returns null if absent or not outdoor. */
  static parseRule(raw: string | null): WeatherRule | null {
    if (!raw) return null;
    let parsed: any;
    try { parsed = JSON.parse(raw); } catch { return null; }
    if (!parsed || parsed.outdoor !== true) return null;
    return parsed as WeatherRule;
  }

  // -------------------------------------------------------------------

  /**
   * Score each daylight hour by how comfortably it satisfies the rule
   * (within temp band, low precip, low wind) and return a label for the
   * best contiguous run of acceptable hours, e.g. "1–3pm".
   */
  private bestWindow(rule: WeatherRule, snap: WeatherSnapshot): string | undefined {
    // The snapshot now carries all 24 hours — scan only the daylight band.
    const daylight = snap.hours.filter(h => h.hour >= DAY_START_HOUR && h.hour <= DAY_END_HOUR);
    const acceptable = daylight.filter(h => {
      if (rule.maxRainTodayIn !== undefined && h.precipIn > Math.max(rule.maxRainTodayIn, 0.01)) return false;
      if (rule.maxWindMph !== undefined && h.windMph > rule.maxWindMph) return false;
      if (rule.minTempF !== undefined && h.tempF < rule.minTempF) return false;
      if (rule.maxTempF !== undefined && h.tempF > rule.maxTempF) return false;
      return true;
    });
    if (acceptable.length === 0) return undefined;

    // Comfort score: prefer dry, calm, mid-band temperature.
    const midTemp = rule.minTempF !== undefined && rule.maxTempF !== undefined
      ? (rule.minTempF + rule.maxTempF) / 2
      : 65;
    const score = (h: HourPoint) =>
      h.precipIn * 100 + h.windMph * 0.3 + Math.abs(h.tempF - midTemp);

    const best = [...acceptable].sort((a, b) => score(a) - score(b))[0];

    // Grow a contiguous run of acceptable hours around the best hour.
    const okHours = new Set(acceptable.map(h => h.hour));
    let start = best.hour;
    let end = best.hour;
    while (okHours.has(start - 1)) start--;
    while (okHours.has(end + 1)) end++;

    return formatWindow(start, end);
  }

  private async fetchSnapshot(lat: number, lon: number): Promise<WeatherSnapshot> {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', String(lat));
    url.searchParams.set('longitude', String(lon));
    url.searchParams.set('daily', 'weather_code,precipitation_sum,temperature_2m_max,temperature_2m_min,wind_speed_10m_max');
    url.searchParams.set('hourly', 'temperature_2m,precipitation,precipitation_probability,wind_speed_10m');
    url.searchParams.set('past_days', '7');
    url.searchParams.set('forecast_days', '2');
    url.searchParams.set('timezone', 'auto');
    // Freedom units.
    url.searchParams.set('temperature_unit', 'fahrenheit');
    url.searchParams.set('wind_speed_unit', 'mph');
    url.searchParams.set('precipitation_unit', 'inch');

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    let json: any;
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
      json = await res.json();
    } finally {
      clearTimeout(timer);
    }

    return parseOpenMeteo(json);
  }
}

// ---------------------------------------------------------------------
// Pure parsing helpers (exported-free; unit-testable in isolation)
// ---------------------------------------------------------------------

/**
 * Convert an Open-Meteo response (past_days=7, forecast_days=2,
 * timezone=auto, US units) into a WeatherSnapshot. TOMORROW is the last
 * daily entry, TODAY the one before it; the 7 entries before today are
 * the dry-streak candidates.
 */
function parseOpenMeteo(json: any): WeatherSnapshot {
  const daily = json?.daily ?? {};
  const precip: number[] = daily.precipitation_sum ?? [];
  const tmax: number[] = daily.temperature_2m_max ?? [];
  const tmin: number[] = daily.temperature_2m_min ?? [];
  const wmax: number[] = daily.wind_speed_10m_max ?? [];
  const codes: number[] = daily.weather_code ?? [];
  const dates: string[] = daily.time ?? [];

  // forecast_days=2 → [.. 7 past days, today, tomorrow]. Guard the
  // degenerate single-day response by treating the last entry as today.
  const todayIdx = Math.max(0, dates.length - 2);
  const tomorrowIdx = dates.length - 1;
  const hasTomorrow = tomorrowIdx > todayIdx;

  const rainTodayIn = num(precip[todayIdx]);
  const tempMaxF = num(tmax[todayIdx]);
  const tempMinF = num(tmin[todayIdx]);
  const windMaxMph = num(wmax[todayIdx]);
  const weatherCode = num(codes[todayIdx]);

  const tomorrow: DayForecast | null = hasTomorrow ? {
    tempMaxF: num(tmax[tomorrowIdx]),
    tempMinF: num(tmin[tomorrowIdx]),
    rainSumIn: num(precip[tomorrowIdx]),
    windMaxMph: num(wmax[tomorrowIdx]),
    weatherCode: num(codes[tomorrowIdx]),
  } : null;

  // Count consecutive dry days walking backward from yesterday.
  let dryDayStreak = 0;
  for (let i = todayIdx - 1; i >= 0; i--) {
    if (num(precip[i]) <= DRY_THRESHOLD_IN) dryDayStreak++;
    else break;
  }

  // All of today's hours — window scoring band-filters; rain tips don't.
  const todayDate = dates[todayIdx];
  const hourly = json?.hourly ?? {};
  const htime: string[] = hourly.time ?? [];
  const htemp: number[] = hourly.temperature_2m ?? [];
  const hprecip: number[] = hourly.precipitation ?? [];
  const hprob: number[] = hourly.precipitation_probability ?? [];
  const hwind: number[] = hourly.wind_speed_10m ?? [];

  const hours: HourPoint[] = [];
  for (let i = 0; i < htime.length; i++) {
    const t = htime[i]; // "YYYY-MM-DDTHH:MM"
    if (todayDate && !t.startsWith(todayDate)) continue;
    hours.push({
      hour: Number(t.slice(11, 13)),
      tempF: num(htemp[i]),
      precipIn: num(hprecip[i]),
      precipProbPct: num(hprob[i]),
      windMph: num(hwind[i]),
    });
  }

  return { rainTodayIn, tempMaxF, tempMinF, windMaxMph, weatherCode, dryDayStreak, hours, tomorrow };
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Compact am/pm label for a local hour: 14 → "2pm". */
export function hourLabel(h: number): string {
  const ampm = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${ampm}`;
}

/** Format an hour span as a compact am/pm label: "2pm", "1–3pm". */
function formatWindow(start: number, end: number): string {
  const label = hourLabel;
  if (start === end) return label(start);
  // Drop the am/pm on the start when both are the same half of the day.
  const sameHalf = (start < 12) === (end < 12);
  const startLabel = sameHalf
    ? String(start % 12 === 0 ? 12 : start % 12)
    : label(start);
  return `${startLabel}–${label(end)}`;
}
