/**
 * vitalsMeta — presentational metadata for the Biomonitor metrics, keyed by
 * the real MetricDef.key. MetricDef itself stays data-only (label/unit/kind/
 * min/max); the redesign layers on display extras the charts use:
 *
 *   color  — accent for the tile + trend line (a theme token)
 *   icon   — Icon name for the tile/card chip
 *   source — where the value comes from: 'phone' (Health uplink) | 'scale'
 *            (smart scale, also over the uplink) | 'manual' (hand-logged)
 *   good   — which direction is an improvement ('up' | 'down' | null), so the
 *            delta pill can color gains green and regressions red
 *   band   — optional [lo, hi] healthy range drawn faintly behind the trend
 *
 * Unknown / user-defined metrics fall back to a cycling palette + neutral
 * defaults so the page still renders every enabled metric.
 */

export type MetricSource = 'phone' | 'scale' | 'manual';

export interface MetricMeta {
  color: string;
  icon: string;
  source: MetricSource;
  good: 'up' | 'down' | null;
  band?: [number, number];
}

const META: Record<string, MetricMeta> = {
  weight:     { color: 'var(--cyan)',    icon: 'trend',  source: 'scale',  good: 'down' },
  restingHr:  { color: 'var(--magenta)', icon: 'heart',  source: 'phone',  good: 'down', band: [50, 65] },
  steps:      { color: 'var(--lime)',    icon: 'flame',  source: 'phone',  good: 'up' },
  sleepHours: { color: 'var(--violet)',  icon: 'moon',   source: 'phone',  good: 'up',   band: [7, 9] },
  water:      { color: 'var(--blue)',    icon: 'coffee', source: 'manual', good: 'up' },
  workHours:  { color: 'var(--teal)',    icon: 'clock',  source: 'manual', good: null },
  mood:       { color: 'var(--amber)',   icon: 'spark',  source: 'manual', good: 'up' },
  // Blood pressure renders as one combined card; the two streams keep their
  // own accents (systolic magenta over diastolic cyan) + healthy bands.
  bpSys:      { color: 'var(--magenta)', icon: 'heart',  source: 'phone',  good: 'down', band: [90, 120] },
  bpDia:      { color: 'var(--cyan)',    icon: 'heart',  source: 'phone',  good: 'down', band: [60, 80] },
  // Training (daily workout minutes) is a synthetic stream derived from logged
  // workouts — it only appears in the Health trends grid, never the readout.
  training:   { color: 'var(--lime)',    icon: 'spark',  source: 'manual', good: 'up' },
  // Bedtime (signed hours vs the wake day's midnight, written by the health
  // uplink). Def-less like training: charts via the Sleep Schedule card only,
  // never the readout tiles.
  sleepStart: { color: 'var(--violet)',  icon: 'moon',   source: 'phone',  good: null },
};

const FALLBACK_PALETTE = [
  'var(--cyan)', 'var(--violet)', 'var(--lime)', 'var(--amber)',
  'var(--blue)', 'var(--pink)', 'var(--magenta)', 'var(--teal)',
];

export function metaFor(key: string, idx = 0): MetricMeta {
  return META[key] ?? {
    color: FALLBACK_PALETTE[idx % FALLBACK_PALETTE.length],
    icon: 'trend',
    source: 'manual',
    good: null,
  };
}
