/**
 * VitalsView — "Biomonitor". The daily vitals check-in.
 *
 * Renders one input per enabled MetricDef (number / integer / scale; mood
 * is a 1–5 scale selector). Prefills today's existing values; "SUBMIT LOG"
 * upserts them via PUT /api/metrics, which closes the loop on the daily
 * vitals quest (so submitting the log clears the quest + banks XP/eddies).
 *
 * Below the form: a trends strip with an inline SVG sparkline for a chosen
 * metric, fed by GET /api/metrics/history. A "configure" affordance toggles
 * each MetricDef.enabled.
 */
import { useState, useMemo, useEffect, useId } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../lib/api';
import type { MetricDef } from '../lib/api';
import { Icon } from './Icon';

interface DayLog {
  date: string;
  submitted: boolean;
  values: Record<string, number>;
}
/** PUT /api/metrics also returns the closed-loop quest result. */
interface SubmitResponse extends DayLog {
  questAutoCompleted: { id: string; xpReward: number } | null;
}
interface HistoryResponse {
  key: string;
  series: Array<{ date: string; value: number }>;
}

const inputStyle: React.CSSProperties = {
  padding: '8px 12px',
  background: '#070811',
  border: '1px solid var(--line-2)',
  borderRadius: 0,
  color: 'var(--text)',
  fontFamily: 'var(--font-mono)',
  fontSize: 13,
  outline: 'none',
};

export function VitalsView() {
  const qc = useQueryClient();
  const [configuring, setConfiguring] = useState(false);
  // Local edits to the form, keyed by metric key. '' = blank (not logged).
  const [draft, setDraft] = useState<Record<string, string>>({});

  const defsQ = useQuery({
    queryKey: ['metrics', 'defs'],
    queryFn: () => api.get<{ defs: MetricDef[] }>('/api/metrics/defs').then(r => r.defs),
  });
  const logQ = useQuery({
    queryKey: ['metrics', 'today'],
    queryFn: () => api.get<DayLog>('/api/metrics'),
  });

  // Prefill the draft from today's persisted values whenever they load.
  useEffect(() => {
    if (!logQ.data) return;
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(logQ.data.values)) next[k] = String(v);
    setDraft(next);
  }, [logQ.data]);

  const defs = useMemo(() => defsQ.data ?? [], [defsQ.data]);
  const enabled = useMemo(() => defs.filter(d => d.enabled), [defs]);

  const submit = useMutation({
    mutationFn: () => {
      const values: Record<string, number> = {};
      for (const [k, raw] of Object.entries(draft)) {
        if (raw === '' || raw == null) continue;
        const n = Number(raw);
        if (!Number.isNaN(n)) values[k] = n;
      }
      return api.put<SubmitResponse>('/api/metrics', { values });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['metrics'] });
      qc.invalidateQueries({ queryKey: ['player'] });
      qc.invalidateQueries({ queryKey: ['player', 'stats'] });
      qc.invalidateQueries({ queryKey: ['quests', 'today'] });
    },
  });

  const setVal = (key: string, value: string) =>
    setDraft(prev => ({ ...prev, [key]: value }));

  if (defsQ.isLoading || logQ.isLoading) return <Empty>LOADING…</Empty>;
  if (defsQ.isError || logQ.isError) return <Empty color="var(--red)">FAILED TO LOAD</Empty>;

  const submitted = logQ.data?.submitted ?? false;
  const loggedCount = Object.values(draft).filter(v => v !== '' && v != null).length;

  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <Header
        submitted={submitted}
        loggedCount={loggedCount}
        totalCount={enabled.length}
        configuring={configuring}
        onToggleConfig={() => setConfiguring(c => !c)}
      />

      {configuring ? (
        <ConfigPanel defs={defs} />
      ) : enabled.length === 0 ? (
        <Empty>
          No metrics enabled — open <strong style={{ color: 'var(--text)' }}>CONFIGURE</strong> to turn some on.
        </Empty>
      ) : (
        <section className="panel" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="edit" size={13} style={{ color: 'var(--cyan)' }} />
            <span className="mono" style={{ fontSize: 10, letterSpacing: '0.26em', color: 'var(--text-dim)', textTransform: 'uppercase' }}>TODAY&rsquo;S READOUT</span>
            <span style={{ flex: 1 }} />
            <span className="mono" style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--text-faint)', textTransform: 'uppercase' }}>
              {logQ.data ? format(new Date(logQ.data.date), 'EEE · MMM d') : ''}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(188px, 1fr))', gap: 12 }}>
            {enabled.map(def => (
              <MetricField
                key={def.id}
                def={def}
                value={draft[def.key] ?? ''}
                onChange={v => setVal(def.key, v)}
              />
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              className="btn btn-primary"
              disabled={submit.isPending || loggedCount === 0}
              onClick={() => submit.mutate()}
            >
              {submit.isPending ? 'TRANSMITTING…' : submitted ? 'UPDATE LOG' : 'SUBMIT LOG'}
            </button>
            {submit.isSuccess && submit.data?.questAutoCompleted && (
              <span className="mono" style={{ fontSize: 12, color: 'var(--lime)' }}>
                +{submit.data.questAutoCompleted.xpReward} XP banked
              </span>
            )}
            {submitted && !submit.isPending && (
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Icon name="check" size={12} style={{ color: 'var(--lime)' }} /> LOGGED
              </span>
            )}
          </div>
        </section>
      )}

      {!configuring && enabled.length > 0 && (
        <TrendsSection defs={enabled} />
      )}
    </div>
  );
}

function Header({
  submitted, loggedCount, totalCount, configuring, onToggleConfig,
}: {
  submitted: boolean; loggedCount: number; totalCount: number;
  configuring: boolean; onToggleConfig: () => void;
}) {
  return (
    <div className="panel hud" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
      <div className="ncx-chip" style={{ color: submitted ? 'var(--lime)' : 'var(--cyan)' }}>
        <Icon name="heart" size={18} />
      </div>
      <h2 className="ncx-glitch ncx-chroma" style={{ fontSize: 18, fontWeight: 700, margin: 0, fontFamily: 'var(--font-display)', letterSpacing: '0.02em', textTransform: 'uppercase' }}>
        Biomonitor
      </h2>
      <span className="mono" style={{ fontSize: 10.5, letterSpacing: '0.12em', color: 'var(--text-dim)' }}>
        {loggedCount} / {totalCount} LOGGED
      </span>
      <span style={{ flex: 1 }} />
      <PhoneSyncButton />
      <button
        key={`cfg-${configuring}`}
        className={configuring ? 'btn btn-primary' : 'btn btn-ghost'}
        style={{ padding: '6px 12px', fontSize: 11 }}
        onClick={onToggleConfig}
      >
        <Icon name="edit" size={13} style={{ marginRight: 6 }} />
        {configuring ? 'DONE' : 'CONFIGURE'}
      </button>
    </div>
  );
}

/**
 * On-demand pull from the phone's Health Connect server (pull mode).
 * Hidden entirely unless HEALTH_PULL_URL is configured server-side.
 * Result feedback lives inline: +N VALUES on success, PHONE OFFLINE when
 * the poll fails — the scheduled poller keeps retrying either way.
 */
function PhoneSyncButton() {
  const qc = useQueryClient();
  const statusQ = useQuery({
    queryKey: ['metrics', 'pull-status'],
    queryFn: () => api.get<{ configured: boolean }>('/api/metrics/pull'),
    staleTime: 10 * 60_000,
  });
  const pull = useMutation({
    mutationFn: () => api.post<{ configured: boolean; ok: boolean; written: number; days: number }>('/api/metrics/pull'),
    onSuccess: (r) => {
      if (r.ok && r.written > 0) {
        qc.invalidateQueries({ queryKey: ['metrics'] });
        qc.invalidateQueries({ queryKey: ['quests', 'today'] });
      }
    },
  });

  if (!statusQ.data?.configured) return null;

  const r = pull.data;
  const readout = pull.isPending
    ? { text: 'POLLING…', color: 'var(--amber)' }
    : pull.isError
      ? { text: 'SYNC ERROR', color: 'var(--red)' }
      : r
        ? r.ok
          ? { text: `+${r.written} VALUES`, color: 'var(--lime)' }
          : { text: 'PHONE OFFLINE', color: 'var(--red)' }
        : null;

  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {readout && (
        <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.16em', color: readout.color }}>
          {readout.text}
        </span>
      )}
      <button
        className="btn btn-ghost"
        style={{ padding: '6px 12px', fontSize: 11 }}
        disabled={pull.isPending}
        title="Pull the latest readings from your phone now"
        onClick={() => pull.mutate()}
      >
        <Icon name="repeat" size={13} style={{ marginRight: 6 }} />
        SYNC PHONE
      </button>
    </span>
  );
}

/**
 * One metric input. `scale` renders a 1–5 (or min–max) segmented selector
 * (used for mood); `integer`/`number` render a numeric input with the unit
 * suffix shown inline.
 */
function MetricField({
  def, value, onChange,
}: { def: MetricDef; value: string; onChange: (v: string) => void }) {
  const [focused, setFocused] = useState(false);
  const isScale = def.kind === 'scale';
  const lo = def.min ?? 1;
  const hi = def.max ?? 5;
  const filled = value !== '' && value != null;

  return (
    <label
      className="panel-inset"
      style={{
        display: 'flex', flexDirection: 'column', gap: 8, padding: '11px 13px',
        borderColor: filled ? 'color-mix(in srgb, var(--cyan) 34%, var(--line))' : undefined,
        transition: 'border-color .15s',
      }}
    >
      <span className="kicker" style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 9.5 }}>
        {def.label}
        {def.unit && <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>{def.unit}</span>}
      </span>

      {isScale ? (
        <ScalePicker lo={lo} hi={hi} value={value} onChange={onChange} />
      ) : (
        <input
          type="number"
          inputMode={def.kind === 'integer' ? 'numeric' : 'decimal'}
          step={def.kind === 'integer' ? 1 : 'any'}
          min={def.min ?? undefined}
          max={def.max ?? undefined}
          placeholder="—"
          value={value}
          onChange={e => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            ...inputStyle,
            background: 'var(--panel-2)',
            borderColor: focused ? 'var(--cyan)' : 'var(--line-2)',
            boxShadow: focused ? 'var(--glow-cyan)' : 'none',
            transition: 'border-color .15s, box-shadow .15s',
          }}
        />
      )}
    </label>
  );
}

/** Segmented 1..N selector for scale metrics (e.g. mood 1–5). */
function ScalePicker({
  lo, hi, value, onChange,
}: { lo: number; hi: number; value: string; onChange: (v: string) => void }) {
  const steps: number[] = [];
  // Cap the visible buttons so an absurd min/max can't blow up the row.
  const ceiling = Math.min(hi, lo + 9);
  for (let n = lo; n <= ceiling; n++) steps.push(n);
  const selected = value === '' ? null : Number(value);

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {steps.map(n => {
        const on = selected === n;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(on ? '' : String(n))}
            aria-pressed={on}
            className="mono"
            style={{
              width: 34, height: 34, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', fontSize: 13, fontWeight: 700,
              border: on ? '1px solid var(--cyan)' : '1px solid var(--line-2)',
              background: on
                ? 'linear-gradient(135deg, var(--cyan), var(--violet))'
                : 'var(--panel-2)',
              color: on ? 'white' : 'var(--text-dim)',
              boxShadow: on ? 'var(--glow-cyan)' : 'none',
              transition: 'background .15s, box-shadow .15s, border-color .15s, color .15s',
            }}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Trends section: a single shared time-window selector over a responsive
 * grid of per-metric charts (one card per enabled metric; the two BP
 * metrics share one plot). Replaces the old pick-one-metric strip.
 */
const WINDOWS = [7, 30, 90, 365];

type ChartSpec =
  | { type: 'single'; def: MetricDef }
  | { type: 'bp'; sys: MetricDef; dia: MetricDef };

/** Build the card list: collapse bpSys + bpDia into one combined plot. */
function buildChartSpecs(defs: MetricDef[]): ChartSpec[] {
  const sys = defs.find(d => d.key === 'bpSys');
  const dia = defs.find(d => d.key === 'bpDia');
  const pairBp = !!(sys && dia);
  const specs: ChartSpec[] = [];
  let bpDone = false;
  for (const def of defs) {
    if (pairBp && (def.key === 'bpSys' || def.key === 'bpDia')) {
      if (!bpDone) { specs.push({ type: 'bp', sys: sys!, dia: dia! }); bpDone = true; }
      continue;
    }
    specs.push({ type: 'single', def });
  }
  return specs;
}

/** Stable per-metric line colors; unknown keys cycle a palette by position. */
const METRIC_COLORS: Record<string, string> = {
  weight: 'var(--cyan)',
  sleepHours: 'var(--violet)',
  mood: 'var(--lime)',
  water: 'var(--blue)',
  workHours: 'var(--amber)',
  steps: 'var(--magenta)',
  restingHr: 'var(--red)',
};
const PALETTE = ['var(--cyan)', 'var(--violet)', 'var(--lime)', 'var(--amber)', 'var(--blue)', 'var(--pink)', 'var(--magenta)', 'var(--red)'];
function colorFor(key: string, idx: number): string {
  return METRIC_COLORS[key] ?? PALETTE[idx % PALETTE.length];
}

const DAY_MS = 86_400_000;
function localMidnightMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const fmtNum = (v: number) => (Number.isInteger(v) ? v.toLocaleString() : v.toFixed(1));
const fmtValue = (v: number, unit: string | null) => (unit ? `${fmtNum(v)} ${unit}` : fmtNum(v));
const fmtDelta = (v: number) => `${v >= 0 ? '+' : '−'}${fmtNum(Math.abs(v))}`;

const cardStyle: React.CSSProperties = { padding: 14, display: 'flex', flexDirection: 'column', gap: 10 };

function TrendsSection({ defs }: { defs: MetricDef[] }) {
  const [days, setDays] = useState(30);
  const specs = useMemo(() => buildChartSpecs(defs), [defs]);

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="panel hud" style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Icon name="trend" size={16} style={{ color: 'var(--violet)' }} />
        <span className="mono" style={{ fontSize: 10, letterSpacing: '0.26em', color: 'var(--text-dim)', textTransform: 'uppercase' }}>Trends</span>
        <span className="mono" style={{ fontSize: 10, letterSpacing: '0.12em', color: 'var(--text-faint)' }}>
          {specs.length} {specs.length === 1 ? 'CHART' : 'CHARTS'}
        </span>
        <span style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 6 }}>
          {WINDOWS.map(d => {
            const on = days === d;
            return (
              <button
                key={d}
                onClick={() => setDays(d)}
                className="mono"
                style={{
                  fontSize: 11, padding: '4px 10px', cursor: 'pointer', letterSpacing: '0.06em',
                  border: on ? '1px solid var(--violet)' : '1px solid var(--line-2)',
                  background: on ? 'color-mix(in srgb, var(--violet) 14%, transparent)' : 'var(--panel-2)',
                  color: on ? 'var(--violet)' : 'var(--text-dim)',
                  transition: 'background .15s, border-color .15s, color .15s',
                }}
              >
                {d === 365 ? '1Y' : `${d}D`}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
        {specs.map((spec, i) =>
          spec.type === 'bp'
            ? <BpTrendCard key="bp" sys={spec.sys} dia={spec.dia} days={days} />
            : <TrendCard key={spec.def.key} def={spec.def} days={days} color={colorFor(spec.def.key, i)} />
        )}
      </div>
    </section>
  );
}

/** One metric's history card: header value + sparkline + min/max/Δ stats. */
function TrendCard({ def, days, color }: { def: MetricDef; days: number; color: string }) {
  const q = useQuery({
    queryKey: ['metrics', 'history', def.key, days],
    queryFn: () => api.get<HistoryResponse>(`/api/metrics/history?key=${encodeURIComponent(def.key)}&days=${days}`),
  });
  const points = q.data?.series ?? [];
  const values = points.map(p => p.value);
  const latest = values.length ? values[values.length - 1] : null;
  const first = values.length ? values[0] : null;
  const min = values.length ? Math.min(...values) : null;
  const max = values.length ? Math.max(...values) : null;
  const delta = latest != null && first != null ? latest - first : null;

  return (
    <div className="panel" style={cardStyle}>
      <CardHeader color={color} label={def.label} value={latest != null ? fmtValue(latest, def.unit) : '—'} />
      <MiniChart days={days} loading={q.isLoading} series={[{ label: def.label, color, points }]} />
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'baseline' }}>
        {delta != null && delta !== 0 && (
          <MiniStat
            label={`Δ ${days === 365 ? '1Y' : `${days}D`}`}
            value={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <Icon name={delta >= 0 ? 'arrowUp' : 'arrowDn'} size={10} />
                {fmtDelta(delta)}
              </span>
            }
          />
        )}
        {min != null && <MiniStat label="MIN" value={fmtNum(min)} />}
        {max != null && <MiniStat label="MAX" value={fmtNum(max)} />}
        <span style={{ flex: 1 }} />
        <MiniStat label="PTS" value={String(points.length)} color="var(--text-faint)" />
      </div>
    </div>
  );
}

/** Combined blood-pressure card: systolic + diastolic on one shared plot. */
function BpTrendCard({ sys, dia, days }: { sys: MetricDef; dia: MetricDef; days: number }) {
  const sysQ = useQuery({
    queryKey: ['metrics', 'history', sys.key, days],
    queryFn: () => api.get<HistoryResponse>(`/api/metrics/history?key=${encodeURIComponent(sys.key)}&days=${days}`),
  });
  const diaQ = useQuery({
    queryKey: ['metrics', 'history', dia.key, days],
    queryFn: () => api.get<HistoryResponse>(`/api/metrics/history?key=${encodeURIComponent(dia.key)}&days=${days}`),
  });
  const sysPts = sysQ.data?.series ?? [];
  const diaPts = diaQ.data?.series ?? [];
  const sColor = 'var(--cyan)', dColor = 'var(--violet)';
  const sysLast = sysPts.length ? sysPts[sysPts.length - 1].value : null;
  const diaLast = diaPts.length ? diaPts[diaPts.length - 1].value : null;

  return (
    <div className="panel" style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: `linear-gradient(135deg, ${sColor}, ${dColor})`, boxShadow: `0 0 6px ${sColor}`, flexShrink: 0, alignSelf: 'center' }} />
        <span className="kicker" style={{ fontSize: 9.5 }}>Blood pressure</span>
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 18, fontWeight: 700, lineHeight: 1 }}>
          <span style={{ color: sColor }}>{sysLast ?? '—'}</span>
          <span style={{ color: 'var(--text-faint)' }}>/</span>
          <span style={{ color: dColor }}>{diaLast ?? '—'}</span>
          {sys.unit && <span style={{ color: 'var(--text-faint)', fontSize: 11, fontWeight: 400, marginLeft: 4 }}>{sys.unit}</span>}
        </span>
      </div>
      <MiniChart
        days={days}
        fill={false}
        loading={sysQ.isLoading || diaQ.isLoading}
        series={[
          { label: 'SYS', color: sColor, points: sysPts },
          { label: 'DIA', color: dColor, points: diaPts },
        ]}
      />
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <LegendDot color={sColor} label="SYS" />
        <LegendDot color={dColor} label="DIA" />
        <span style={{ flex: 1 }} />
        <MiniStat label="PTS" value={String(Math.max(sysPts.length, diaPts.length))} color="var(--text-faint)" />
      </div>
    </div>
  );
}

function CardHeader({ color, label, value }: { color: string; label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, boxShadow: `0 0 6px ${color}`, flexShrink: 0, alignSelf: 'center' }} />
      <span className="kicker" style={{ fontSize: 9.5 }}>{label}</span>
      <span style={{ flex: 1 }} />
      <span className="mono" style={{ fontSize: 18, fontWeight: 700, color, lineHeight: 1 }}>{value}</span>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <span className="kicker" style={{ fontSize: 8.5 }}>{label}</span>
      <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: color ?? 'var(--text-dim)' }}>{value}</span>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 9, height: 2, background: color, boxShadow: `0 0 4px ${color}`, display: 'inline-block' }} />
      <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.12em', color: 'var(--text-dim)' }}>{label}</span>
    </span>
  );
}

/**
 * Multi-series inline SVG chart — no chart lib. All series share one y-axis
 * and a fixed x-axis spanning the selected window (so sparse data sits where
 * it actually fell in time, and every card lines up). `fill` adds the area
 * gradient (on for single-metric cards, off for the two-line BP card).
 */
function MiniChart({
  series, days, fill = true, loading,
}: {
  series: Array<{ label: string; color: string; points: Array<{ date: string; value: number }> }>;
  days: number; fill?: boolean; loading?: boolean;
}) {
  const gid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const W = 320, H = 76, PAD = 6;

  const maxMs = localMidnightMs();
  const minMs = maxMs - (days - 1) * DAY_MS;
  const xSpan = maxMs - minMs || 1;
  const x = (ms: number) => PAD + clamp((ms - minMs) / xSpan, 0, 1) * (W - PAD * 2);

  const all = series.flatMap(s => s.points.map(p => p.value));
  if (loading) return <ChartEmpty height={H} text="loading…" />;
  if (all.length === 0) return <ChartEmpty height={H} text="no readings in window" />;

  let lo = Math.min(...all), hi = Math.max(...all);
  if (hi === lo) { lo -= 1; hi += 1; }
  const padY = (hi - lo) * 0.14;
  const yLo = lo - padY, yHi = hi + padY;
  const y = (v: number) => H - PAD - ((v - yLo) / (yHi - yLo)) * (H - PAD * 2);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: H, display: 'block' }} aria-hidden="true">
      <defs>
        {fill && series.map((s, i) => (
          <linearGradient key={i} id={`spark-${gid}-${i}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={s.color} stopOpacity={0.22} />
            <stop offset="100%" stopColor={s.color} stopOpacity={0} />
          </linearGradient>
        ))}
      </defs>
      {series.map((s, i) => {
        const pts = [...s.points].sort((a, b) => +new Date(a.date) - +new Date(b.date));
        const n = pts.length;
        if (n === 0) return null;
        const line = pts.map(p => `${x(+new Date(p.date)).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
        const x0 = x(+new Date(pts[0].date)).toFixed(1);
        const xN = x(+new Date(pts[n - 1].date)).toFixed(1);
        return (
          <g key={i}>
            {fill && n > 1 && (
              <polygon points={`${x0},${H - PAD} ${line} ${xN},${H - PAD}`} fill={`url(#spark-${gid}-${i})`} stroke="none" />
            )}
            {n > 1 && (
              <polyline
                points={line}
                fill="none"
                stroke={s.color}
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ filter: `drop-shadow(0 0 3px ${s.color})` }}
              />
            )}
            {pts.map((p, j) => (
              <circle key={j} cx={x(+new Date(p.date))} cy={y(p.value)} r={j === n - 1 ? 3 : 1.5} fill={s.color} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

function ChartEmpty({ height, text }: { height: number; text: string }) {
  return (
    <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-ghost)', fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
      {text}
    </div>
  );
}

/** Configure panel: toggle each MetricDef.enabled. */
function ConfigPanel({ defs }: { defs: MetricDef[] }) {
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.put(`/api/metrics/defs/${id}`, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['metrics'] }),
  });

  return (
    <section className="panel" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span className="mono" style={{ fontSize: 10, letterSpacing: '0.26em', color: 'var(--text-dim)', textTransform: 'uppercase' }}>METRIC SET — toggle what shows in your daily readout</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {defs.map(def => (
          <div
            key={def.id}
            className="panel-inset"
            style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12 }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: def.enabled ? 'var(--text)' : 'var(--text-faint)' }}>
                {def.label}
                {def.unit && (
                  <span className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 8 }}>
                    {def.unit}
                  </span>
                )}
              </div>
              <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-faint)' }}>
                {def.key} · {def.kind.toUpperCase()}
              </div>
            </div>
            <button
              onClick={() => toggle.mutate({ id: def.id, enabled: !def.enabled })}
              disabled={toggle.isPending}
              aria-pressed={def.enabled}
              className="mono"
              style={{
                fontSize: 11, padding: '6px 14px', cursor: 'pointer',
                letterSpacing: '0.06em',
                border: def.enabled ? '1px solid var(--lime)' : '1px solid var(--line-2)',
                background: def.enabled ? 'color-mix(in srgb, var(--lime) 14%, transparent)' : 'var(--panel-2)',
                color: def.enabled ? 'var(--lime)' : 'var(--text-dim)',
                transition: 'background .15s, border-color .15s, color .15s',
              }}
            >
              {def.enabled ? 'ON' : 'OFF'}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function Empty({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div className="panel hud" style={{ padding: 40, textAlign: 'center', color: color ?? 'var(--text-faint)' }}>
      <div className="mono" style={{ fontSize: 13 }}>{children}</div>
    </div>
  );
}
