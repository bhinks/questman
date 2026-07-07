import { describe, it, expect } from 'vitest';
import { WeatherService, parseOpenMeteo } from './WeatherService';
import type { WeatherSnapshot, HourPoint } from './WeatherService';

const hoursOf = (spec: Array<[number, Partial<HourPoint>]>): HourPoint[] =>
  spec.map(([hour, over]) => ({ hour, tempF: 70, precipIn: 0, precipProbPct: 0, windMph: 5, ...over }));

const snap = (over: Partial<WeatherSnapshot> = {}): WeatherSnapshot => ({
  rainTodayIn: 0, tempMaxF: 75, tempMinF: 55, windMaxMph: 8, weatherCode: 1,
  dryDayStreak: 3, hours: hoursOf(Array.from({ length: 24 }, (_, h) => [h, {}])),
  tomorrow: null,
  ...over,
});

describe('WeatherService.evaluate', () => {
  const svc = new WeatherService();
  const rule = { outdoor: true, dryDaysRequired: 1, maxRainTodayIn: 0.1, minTempF: 40, maxTempF: 90, maxWindMph: 20 };

  it('no snapshot → permissive pass (interval-only fallback)', () => {
    expect(svc.evaluate(rule, null).ok).toBe(true);
  });

  it('a clean day passes with a window', () => {
    const v = svc.evaluate(rule, snap());
    expect(v.ok).toBe(true);
    expect(v.bestWindow).toBeTruthy();
  });

  it('dryDaysRequired is hard — no hourly window can waive a wet yard', () => {
    const v = svc.evaluate(rule, snap({ dryDayStreak: 0 }));
    expect(v.ok).toBe(false);
    expect(v.reasons.join(' ')).toContain('dry day');
  });

  it('an evening shower fails the day aggregate but a clear morning window still passes', () => {
    // Day total 0.4in > maxRainTodayIn 0.1, all of it after 5pm.
    const hours = hoursOf(Array.from({ length: 24 }, (_, h) => [h, h >= 17 ? { precipIn: 0.2 } : {}]));
    const v = svc.evaluate(rule, snap({ rainTodayIn: 0.4, hours }));
    expect(v.ok).toBe(true);
    expect(v.bestWindow).toBeTruthy();
  });

  it('a 4pm heat spike over maxTempF passes via the cooler morning window', () => {
    const hours = hoursOf(Array.from({ length: 24 }, (_, h) => [h, h >= 14 ? { tempF: 95 } : { tempF: 78 }]));
    const v = svc.evaluate(rule, snap({ tempMaxF: 95, hours }));
    expect(v.ok).toBe(true);
  });

  it('fails when no hour offers relief (rain all day)', () => {
    const hours = hoursOf(Array.from({ length: 24 }, (_, h) => [h, { precipIn: 0.2 }]));
    const v = svc.evaluate(rule, snap({ rainTodayIn: 3, hours }));
    expect(v.ok).toBe(false);
    expect(v.reasons.length).toBeGreaterThan(0);
  });
});

describe('WeatherService.isNiceDay', () => {
  it('dry + mild + calm + clear-ish = nice; null snapshot never is', () => {
    expect(WeatherService.isNiceDay(snap())).toBe(true);
    expect(WeatherService.isNiceDay(null)).toBe(false);
    expect(WeatherService.isNiceDay(snap({ tempMaxF: 95 }))).toBe(false);
    expect(WeatherService.isNiceDay(snap({ rainTodayIn: 0.5 }))).toBe(false);
    expect(WeatherService.isNiceDay(snap({ weatherCode: 63 }))).toBe(false);
  });
});

describe('parseOpenMeteo', () => {
  it('throws on a response with no daily data (caller degrades to null snapshot)', () => {
    expect(() => parseOpenMeteo({})).toThrow();
    expect(() => parseOpenMeteo({ daily: { time: [] } })).toThrow();
  });

  it('parses today/tomorrow/dry-streak from a normal shaped response', () => {
    const days = ['2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02'];
    const s = parseOpenMeteo({
      daily: {
        time: days,
        precipitation_sum: [0.0, 0.01, 0.3, 0.0],   // today (idx 2) rainy; yesterday dry
        temperature_2m_max: [80, 82, 84, 86],
        temperature_2m_min: [60, 61, 62, 63],
        wind_speed_10m_max: [10, 12, 14, 16],
        weather_code: [1, 2, 61, 0],
      },
      hourly: { time: [`${days[2]}T09:00`], temperature_2m: [75], precipitation: [0.1], precipitation_probability: [80], wind_speed_10m: [9] },
    });
    expect(s.rainTodayIn).toBeCloseTo(0.3);
    expect(s.tempMaxF).toBe(84);
    expect(s.dryDayStreak).toBe(2);       // walked back from yesterday: 0.01, 0.0 both ≤ threshold
    expect(s.tomorrow?.tempMaxF).toBe(86);
    expect(s.hours).toHaveLength(1);
    expect(s.hours[0].hour).toBe(9);
  });
});
