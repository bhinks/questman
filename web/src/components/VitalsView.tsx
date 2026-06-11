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
import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
  const [trendKey, setTrendKey] = useState<string | null>(null);

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

  // Default the trend selector to the first enabled metric once we have one.
  useEffect(() => {
    if (trendKey === null && enabled.length > 0) setTrendKey(enabled[0].key);
  }, [enabled, trendKey]);

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
          <span className="mono" style={{ fontSize: 10, letterSpacing: '0.26em', color: 'var(--text-dim)', textTransform: 'uppercase' }}>TODAY&rsquo;S READOUT</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14 }}>
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

      {!configuring && enabled.length > 0 && trendKey && (
        <Trends defs={enabled} metricKey={trendKey} onPick={setTrendKey} />
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
  const isScale = def.kind === 'scale';
  const lo = def.min ?? 1;
  const hi = def.max ?? 5;

  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="kicker" style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
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
          style={inputStyle}
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

/** Trends strip: metric selector + inline SVG sparkline from GET /history. */
function Trends({
  defs, metricKey, onPick,
}: { defs: MetricDef[]; metricKey: string; onPick: (k: string) => void }) {
  const [days, setDays] = useState(30);
  const historyQ = useQuery({
    queryKey: ['metrics', 'history', metricKey, days],
    queryFn: () => api.get<HistoryResponse>(`/api/metrics/history?key=${encodeURIComponent(metricKey)}&days=${days}`),
  });

  const def = defs.find(d => d.key === metricKey);
  const series = historyQ.data?.series ?? [];

  return (
    <section className="panel hud" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Icon name="trend" size={16} style={{ color: 'var(--violet)' }} />
        <span className="mono" style={{ fontSize: 10, letterSpacing: '0.26em', color: 'var(--text-dim)', textTransform: 'uppercase' }}>TRENDS</span>

        <select
          value={metricKey}
          onChange={e => onPick(e.target.value)}
          style={{ ...inputStyle, marginLeft: 4 }}
        >
          {defs.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
        </select>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {[7, 30, 90].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className="mono"
              style={{
                fontSize: 11, padding: '4px 10px', cursor: 'pointer',
                letterSpacing: '0.06em',
                border: days === d ? '1px solid var(--violet)' : '1px solid var(--line-2)',
                background: days === d ? 'color-mix(in srgb, var(--violet) 14%, transparent)' : 'var(--panel-2)',
                color: days === d ? 'var(--violet)' : 'var(--text-dim)',
                transition: 'background .15s, border-color .15s, color .15s',
              }}
            >
              {d}D
            </button>
          ))}
        </div>
      </div>

      {historyQ.isLoading ? (
        <Empty>LOADING SERIES…</Empty>
      ) : series.length === 0 ? (
        <Empty>No data points yet — submit a few daily logs to see the trend.</Empty>
      ) : (
        <Sparkline
          series={series}
          unit={def?.unit ?? null}
        />
      )}
    </section>
  );
}

/**
 * Pure inline SVG sparkline — no chart lib. Plots the value series as a
 * cyan area + line with min/max/latest callouts. Single point degrades to
 * a flat midline marker.
 */
function Sparkline({
  series, unit,
}: { series: Array<{ date: string; value: number }>; unit: string | null }) {
  const W = 640;
  const H = 120;
  const PAD = 8;

  const values = series.map(s => s.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const n = series.length;

  const x = (i: number) => n <= 1 ? W / 2 : PAD + (i / (n - 1)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2);

  const linePts = series.map((s, i) => `${x(i)},${y(s.value)}`).join(' ');
  const areaPts = `${PAD},${H - PAD} ${linePts} ${W - PAD},${H - PAD}`;
  const latest = series[n - 1];

  const fmt = (v: number) =>
    `${Number.isInteger(v) ? v : v.toFixed(1)}${unit ? ` ${unit}` : ''}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <Stat label="LATEST" value={fmt(latest.value)} color="var(--cyan)" />
        <Stat label="MIN" value={fmt(min)} color="var(--text-dim)" />
        <Stat label="MAX" value={fmt(max)} color="var(--text-dim)" />
        <Stat label="POINTS" value={String(n)} color="var(--text-faint)" />
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: 120, display: 'block' }}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="vitals-spark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--cyan)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--cyan)" stopOpacity={0} />
          </linearGradient>
        </defs>
        {n > 1 && <polygon points={areaPts} fill="url(#vitals-spark)" stroke="none" />}
        {n > 1 && (
          <polyline
            points={linePts}
            fill="none"
            stroke="var(--cyan)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ filter: 'drop-shadow(0 0 4px var(--cyan))' }}
          />
        )}
        {series.map((s, i) => (
          <circle key={i} cx={x(i)} cy={y(s.value)} r={i === n - 1 ? 4 : 2.5} fill="var(--cyan)" />
        ))}
      </svg>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span className="kicker" style={{ fontSize: 9 }}>{label}</span>
      <span className="mono" style={{ fontSize: 15, fontWeight: 700, color }}>{value}</span>
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
