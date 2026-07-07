/**
 * VitalsParts — the Biomonitor's reusable readout / sync / trend pieces.
 *
 * These were the internals of the old standalone VitalsView. The Vitals and
 * Workouts pages merged into one HEALTH page (HealthView), so the vitals half
 * lives here as shared parts the combined page composes:
 *
 *   useVitalsReadout()  — the readout "brain": metric defs + today's log +
 *                         the editable draft + the SUBMIT mutation + the
 *                         derived logged/total counts the command bar shows.
 *   MetricTile / BpTile — one instrument tile per metric (BP is combined).
 *   UplinkModule        — the PHONE UPLINK sync card.
 *   MetricTrendCard / BpTrendCard / TrainingTrendCard — trend cards, each
 *                         fetching its own windowed history.
 *   ConfigPanel         — toggle which MetricDefs appear.
 *
 * Presentational extras (color/icon/source/good/band) come from lib/vitalsMeta;
 * MetricDef stays data-only.
 */
import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { MetricDef } from '../lib/api';
import { Icon } from './Icon';
import { metaFor } from '../lib/vitalsMeta';
import type { MetricMeta, MetricSource } from '../lib/vitalsMeta';
import { TrendChart, BpChart } from './VitalsCharts';
import type { SeriesPoint, ChartStyle } from './VitalsCharts';

export interface DayLog {
  date: string;
  submitted: boolean;
  values: Record<string, number>;
}
interface SubmitResponse extends DayLog {
  questAutoCompleted: { id: string; xpReward: number } | null;
}
interface HistoryResponse {
  key: string;
  series: Array<{ date: string; value: number }>;
}
interface SyncStatus {
  configured: boolean;
  lastSyncedAt: string | null;
  lastSyncMins: number | null;
  backfillDays: number;
  readings: number;
  streams: Array<{ label: string; days: number }>;
}
interface SyncResult {
  configured: boolean;
  ok: boolean;
  written: number;
  days: number;
  error?: string;
  status: SyncStatus;
}

// One shared window selector → label + the days requested from the history
// endpoint. ALL ≈ 10y (the server caps history there).
export const WINDOWS: Array<[string, number]> = [
  ['7D', 7], ['30D', 30], ['90D', 90], ['1Y', 365], ['ALL', 3650],
];

// Product decisions baked from the design handoff's Tweaks panel (user picks):
// chart style = bars, healthy-range bands on, comfortable density.
const CHART_STYLE: ChartStyle = 'bars';
const SHOW_BAND = true;
export const CARD_MIN = 320;

export const CARD: React.CSSProperties = { padding: 16, display: 'flex', flexDirection: 'column', gap: 12 };

export const tileInput: React.CSSProperties = {
  width: '100%', background: '#070811', border: '1px solid var(--line-2)', borderRadius: 0,
  color: 'var(--text)', fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 22,
  padding: '6px 12px', outline: 'none', letterSpacing: '0.01em',
};

function toSeries(apiSeries?: Array<{ date: string; value: number }>): SeriesPoint[] {
  if (!apiSeries) return [];
  return apiSeries.map(p => ({ date: new Date(p.date), value: p.value }));
}

/* ---------- readout brain (shared hook) ---------- */
/**
 * The vitals readout state the HEALTH page drives: the configurable metric
 * set, today's persisted log, an editable draft prefilled from it (synced
 * phone readings included), and the SUBMIT mutation that upserts the day +
 * closes the daily-vitals quest. Also exposes the BP split, the enabled
 * metric list (BP streams removed — they render as one combined tile), and
 * the logged/total counts the command-bar summary uses.
 */
export function useVitalsReadout() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>({});
  // Keys the user has edited this session. A mid-session refetch/SYNC must not
  // clobber an in-flight edit, so these are preserved during re-prefill and
  // cleared once a submit persists them.
  const dirtyRef = useRef<Set<string>>(new Set());

  const defsQ = useQuery({
    queryKey: ['metrics', 'defs'],
    queryFn: () => api.get<{ defs: MetricDef[] }>('/api/metrics/defs').then(r => r.defs),
  });
  const logQ = useQuery({
    queryKey: ['metrics', 'today'],
    queryFn: () => api.get<DayLog>('/api/metrics'),
  });

  // Prefill the draft from today's persisted values whenever they load (this
  // includes any readings the phone uplink already synced for today) — but
  // keep any field the user has touched so a SYNC mid-edit can't overwrite it.
  useEffect(() => {
    if (!logQ.data) return;
    const serverVals = logQ.data.values;
    setDraft(prev => {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(serverVals)) {
        next[k] = dirtyRef.current.has(k) && prev[k] !== undefined ? prev[k] : String(v);
      }
      // Preserve dirtied keys the server doesn't carry yet (newly typed values
      // and just-cleared fields the user means to un-log).
      for (const k of dirtyRef.current) {
        if (!(k in next) && prev[k] !== undefined) next[k] = prev[k];
      }
      return next;
    });
  }, [logQ.data]);

  const defs = useMemo(() => defsQ.data ?? [], [defsQ.data]);
  const enabled = useMemo(() => defs.filter(d => d.enabled), [defs]);

  const submit = useMutation({
    mutationFn: () => {
      const values: Record<string, number | null> = {};
      const prevValues = logQ.data?.values ?? {};
      for (const [k, raw] of Object.entries(draft)) {
        if (raw === '' || raw == null) {
          // A cleared field that was previously logged → send an explicit null
          // so the server deletes the row (un-log) instead of keeping the old
          // value.
          if (k in prevValues) values[k] = null;
          continue;
        }
        const num = Number(raw);
        if (!Number.isNaN(num)) values[k] = num;
      }
      return api.put<SubmitResponse>('/api/metrics', { values });
    },
    onSuccess: () => {
      // The draft is now persisted — drop the dirty marks so the refetched log
      // re-prefills cleanly.
      dirtyRef.current.clear();
      qc.invalidateQueries({ queryKey: ['metrics'] });
      qc.invalidateQueries({ queryKey: ['player'] });
      qc.invalidateQueries({ queryKey: ['player', 'stats'] });
      qc.invalidateQueries({ queryKey: ['quests', 'today'] });
    },
  });

  const setVal = (key: string, value: string) => {
    dirtyRef.current.add(key);
    setDraft(prev => ({ ...prev, [key]: value }));
  };

  // Blood pressure → one combined card/tile when both streams are enabled.
  const bpSysDef = enabled.find(d => d.key === 'bpSys');
  const bpDiaDef = enabled.find(d => d.key === 'bpDia');
  const hasBp = !!(bpSysDef && bpDiaDef);
  const metricDefs = enabled.filter(d => !(hasBp && (d.key === 'bpSys' || d.key === 'bpDia')));

  const isFilled = (k: string) => draft[k] !== '' && draft[k] != null;
  const loggedCount = metricDefs.filter(d => isFilled(d.key)).length
    + (hasBp && isFilled('bpSys') && isFilled('bpDia') ? 1 : 0);
  const totalCount = metricDefs.length + (hasBp ? 1 : 0);
  const submitted = logQ.data?.submitted ?? false;

  return {
    defsQ, logQ, defs, enabled, metricDefs, bpSysDef, bpDiaDef, hasBp,
    draft, setVal, isFilled, loggedCount, totalCount, submitted, submit,
  };
}

/* ---------- PHONE UPLINK sync module ---------- */
export function UplinkModule() {
  const qc = useQueryClient();
  const statusQ = useQuery({
    queryKey: ['metrics', 'sync-status'],
    queryFn: () => api.get<SyncStatus>('/api/metrics/sync-status'),
    staleTime: 60_000,
  });
  const sync = useMutation({
    mutationFn: () => api.post<SyncResult>('/api/metrics/sync'),
    onSuccess: (r) => {
      if (r.ok && r.written > 0) {
        qc.invalidateQueries({ queryKey: ['metrics'] });
        qc.invalidateQueries({ queryKey: ['quests', 'today'] });
        // Synced sleep can move the energy/battery tier — refresh the HUD.
        qc.invalidateQueries({ queryKey: ['player'] });
      } else {
        qc.invalidateQueries({ queryKey: ['metrics', 'sync-status'] });
      }
    },
  });

  // Prefer the freshest status: the sync response carries it, else the poll.
  const status = sync.data?.status ?? statusQ.data;
  if (statusQ.isLoading) return null;
  if (!status?.configured) return null;          // pull mode off → no module

  const scanning = sync.isPending;
  const offline = sync.isError || (sync.data && !sync.data.ok);
  const dotColor = scanning ? 'var(--amber)' : offline ? 'var(--red)' : 'var(--lime)';
  const mins = status.lastSyncMins;
  const syncTxt = mins == null ? 'NEVER'
    : mins === 0 ? 'JUST NOW'
    : mins < 60 ? `${mins}M AGO`
    : `${Math.floor(mins / 60)}H AGO`;
  const statusTxt = scanning ? 'SYNCING…' : offline ? 'PHONE OFFLINE' : `SYNCED ${syncTxt}`;

  const months = Math.round(status.backfillDays / 30.4);
  const streamLine = status.streams.length
    ? status.streams.map(s => `${s.label} ◂ ${s.days}d`).join(' · ')
    : 'NO HISTORY YET';

  return (
    <div style={{ flex: '2 1 440px', minWidth: 0, display: 'flex' }}>
      <div className="panel ncx-scan" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap', minWidth: 0, width: '100%' }}>
        <div className="sweep" style={{ animationDelay: '-3s' }} />
        <div className="ncx-chip" style={{ color: 'var(--cyan)', flex: 'none' }}>
          <Icon name="play" size={18} />
        </div>

        <div style={{ minWidth: 130 }}>
          <div className="kicker" style={{ fontSize: 9.5 }}>PHONE UPLINK</div>
          <div className="mono" style={{ fontSize: 12.5, color: 'var(--text)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 7 }}>
            <span className="cursor-blink" style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, boxShadow: `0 0 6px ${dotColor}` }} />
            {statusTxt}
          </div>
        </div>

        {/* backfill reach — the "grab as much history as possible" story */}
        <div className="panel-inset" style={{ flex: 1, minWidth: 200, padding: '8px 12px' }}>
          {scanning ? (
            <div className="ncx-term" style={{ fontSize: 10, lineHeight: 1.6, maxHeight: 46, overflow: 'hidden' }}>
              <div><span className="cy">▸</span> OPENING HEALTH BRIDGE</div>
              <div><span className="cy">▸</span> AUTH OK · PULLING HISTORY</div>
              <div><span className="cy">▸</span> {streamLine}</div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              <Reach label="BACKFILL" value={`${months} MO`} />
              <Reach label="READINGS" value={status.readings.toLocaleString()} />
              <Reach label="STREAMS" value={`${status.streams.length}`} />
            </div>
          )}
        </div>

        <button
          className={'btn ' + (scanning ? 'btn-ghost' : 'btn-primary')}
          style={{ padding: '8px 16px', fontSize: 11, flex: 'none' }}
          onClick={() => sync.mutate()}
          disabled={scanning}
          title="Pull your phone's health history now — backfills the trend lines"
        >
          <Icon name="repeat" size={13} /> {scanning ? 'PULLING…' : 'SYNC NOW'}
        </button>
      </div>
    </div>
  );
}

function Reach({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span className="ncx-serial">{label}</span>
      <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: 'var(--cyan)' }}>{value}</span>
    </div>
  );
}

/* ---------- readout instrument tiles ---------- */
function SourceTag({ source }: { source: MetricSource }) {
  const map: Record<MetricSource, { icon: string; label: string; color: string }> = {
    phone:  { icon: 'play',  label: 'UPLINK', color: 'var(--cyan)' },
    scale:  { icon: 'trend', label: 'SCALE',  color: 'var(--teal)' },
    manual: { icon: 'edit',  label: 'MANUAL', color: 'var(--text-faint)' },
  };
  const s = map[source];
  return (
    <span className="mono" style={{ fontSize: 8.5, letterSpacing: '0.18em', color: s.color, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <Icon name={s.icon} size={10} style={{ color: s.color }} /> {s.label}
    </span>
  );
}

function ScalePicker({ lo, hi, value, onChange, color }: { lo: number; hi: number; value: string; onChange: (v: string) => void; color: string }) {
  const steps: number[] = [];
  const ceiling = Math.min(hi, lo + 9);
  for (let n = lo; n <= ceiling; n++) steps.push(n);
  const sel = value === '' ? null : Number(value);
  return (
    <div style={{ display: 'flex', gap: 5 }}>
      {steps.map(n => {
        const on = sel === n;
        return (
          <button key={n} type="button" onClick={() => onChange(on ? '' : String(n))} className="mono"
            style={{
              flex: 1, height: 38, cursor: 'pointer', fontSize: 14, fontWeight: 700, borderRadius: 0,
              border: on ? `1px solid ${color}` : '1px solid var(--line-2)',
              background: on ? `linear-gradient(135deg, ${color}, var(--violet))` : 'var(--panel-2)',
              color: on ? '#06070d' : 'var(--text-dim)',
              boxShadow: on ? '0 0 16px -4px ' + color : 'none',
              transition: 'background .15s, color .15s, border-color .15s, box-shadow .15s',
            }}>
            {n}
          </button>
        );
      })}
    </div>
  );
}

export function MetricTile({ def, meta, value, onChange, logged }: {
  def: MetricDef; meta: MetricMeta; value: string; onChange: (v: string) => void; logged: boolean;
}) {
  const isScale = def.kind === 'scale';
  return (
    <div className="panel-inset" style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 9, position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="kicker" style={{ fontSize: 9.5, color: logged ? 'var(--text-dim)' : 'var(--text-faint)' }}>{def.label}</span>
        {def.unit && <span className="mono" style={{ fontSize: 9.5, color: 'var(--text-ghost)' }}>{def.unit}</span>}
        <span style={{ marginLeft: 'auto' }}><SourceTag source={meta.source} /></span>
      </div>
      {isScale ? (
        <ScalePicker lo={def.min ?? 1} hi={def.max ?? 5} value={value} onChange={onChange} color={meta.color} />
      ) : (
        <div style={{ position: 'relative' }}>
          <input type="number" inputMode={def.kind === 'integer' ? 'numeric' : 'decimal'}
            step={def.kind === 'integer' ? 1 : 'any'} min={def.min ?? undefined} max={def.max ?? undefined}
            placeholder="—" value={value} onChange={e => onChange(e.target.value)}
            style={{ ...tileInput, color: value === '' ? 'var(--text-ghost)' : meta.color }} />
          {logged && (
            <Icon name="check" size={14} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--lime)' }} />
          )}
        </div>
      )}
    </div>
  );
}

/* combined systolic/diastolic tile (spans 2 columns) */
export function BpTile({ sys, dia, onSys, onDia }: { sys: string; dia: string; onSys: (v: string) => void; onDia: (v: string) => void }) {
  const logged = sys !== '' && dia !== '';
  return (
    <div className="panel-inset" style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 9, gridColumn: 'span 2' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="kicker" style={{ fontSize: 9.5 }}>Blood Pressure</span>
        <span className="mono" style={{ fontSize: 9.5, color: 'var(--text-ghost)' }}>mmHg</span>
        <span style={{ marginLeft: 'auto' }}><SourceTag source="phone" /></span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="number" inputMode="numeric" placeholder="SYS" value={sys} onChange={e => onSys(e.target.value)}
          style={{ ...tileInput, color: sys === '' ? 'var(--text-ghost)' : 'var(--magenta)', textAlign: 'center' }} />
        <span className="ncx-val" style={{ fontSize: 22, color: 'var(--text-faint)' }}>/</span>
        <input type="number" inputMode="numeric" placeholder="DIA" value={dia} onChange={e => onDia(e.target.value)}
          style={{ ...tileInput, color: dia === '' ? 'var(--text-ghost)' : 'var(--cyan)', textAlign: 'center' }} />
        {logged && <Icon name="check" size={15} style={{ color: 'var(--lime)', flex: 'none' }} />}
      </div>
    </div>
  );
}

/* ---------- trend cards (each fetches its own history) ---------- */
export function CardHead({ meta, label }: { meta: MetricMeta; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div className="ncx-chip" style={{ width: 30, height: 30, color: meta.color }}>
        <Icon name={meta.icon} size={14} style={{ color: meta.color }} />
      </div>
      <span className="mono" style={{ fontSize: 11.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text)' }}>{label}</span>
      <span style={{ marginLeft: 'auto' }}><SourceTag source={meta.source} /></span>
    </div>
  );
}

export function MetricTrendCard({ def, meta, days }: { def: MetricDef; meta: MetricMeta; days: number }) {
  const q = useQuery({
    queryKey: ['metrics', 'history', def.key, days],
    queryFn: () => api.get<HistoryResponse>(`/api/metrics/history?key=${encodeURIComponent(def.key)}&days=${days}`),
  });
  return (
    <div className="panel" style={CARD}>
      <CardHead meta={meta} label={def.label} />
      <TrendChart
        series={toSeries(q.data?.series)}
        color={meta.color}
        unit={def.unit}
        good={meta.good}
        band={meta.band}
        chartStyle={CHART_STYLE}
        showBand={SHOW_BAND}
      />
    </div>
  );
}

export function BpTrendCard({ sysDef, diaDef, days }: { sysDef: MetricDef; diaDef: MetricDef; days: number }) {
  const sysQ = useQuery({
    queryKey: ['metrics', 'history', sysDef.key, days],
    queryFn: () => api.get<HistoryResponse>(`/api/metrics/history?key=${encodeURIComponent(sysDef.key)}&days=${days}`),
  });
  const diaQ = useQuery({
    queryKey: ['metrics', 'history', diaDef.key, days],
    queryFn: () => api.get<HistoryResponse>(`/api/metrics/history?key=${encodeURIComponent(diaDef.key)}&days=${days}`),
  });
  const bands = {
    sys: (metaFor('bpSys').band ?? [90, 120]) as [number, number],
    dia: (metaFor('bpDia').band ?? [60, 80]) as [number, number],
  };
  return (
    <div className="panel hud" style={{ ...CARD, gridColumn: 'span 2' }}>
      <CardHead meta={metaFor('bpSys')} label="Blood Pressure" />
      <BpChart sys={toSeries(sysQ.data?.series)} dia={toSeries(diaQ.data?.series)} bands={bands} chartStyle={CHART_STYLE} showBand={SHOW_BAND} />
    </div>
  );
}

/**
 * Training trend card — the daily workout-minutes series. Same windowed
 * history endpoint as the metrics, but 'training' is synthesised server-side
 * from logged workouts (no MetricDef). It rides the same shared window.
 */
export function TrainingTrendCard({ days }: { days: number }) {
  const meta = metaFor('training');
  const q = useQuery({
    queryKey: ['metrics', 'history', 'training', days],
    queryFn: () => api.get<HistoryResponse>(`/api/metrics/history?key=training&days=${days}`),
  });
  return (
    <div className="panel" style={CARD}>
      <CardHead meta={meta} label="Training" />
      <TrendChart
        series={toSeries(q.data?.series)}
        color={meta.color}
        unit="min"
        good={meta.good}
        chartStyle={CHART_STYLE}
        showBand={SHOW_BAND}
      />
    </div>
  );
}

/* ---------- configure ---------- */
export function ConfigPanel({ defs }: { defs: MetricDef[] }) {
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.put(`/api/metrics/defs/${id}`, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['metrics'] }),
  });

  return (
    <section className="panel" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span className="mono" style={{ fontSize: 10, letterSpacing: '0.26em', color: 'var(--text-dim)', textTransform: 'uppercase' }}>METRIC SET — toggle what shows in your readout + trends</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {defs.map((def, i) => {
          const meta = metaFor(def.key, i);
          return (
            <div key={def.id} className="panel-inset" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div className="ncx-chip" style={{ width: 30, height: 30, color: meta.color }}>
                <Icon name={meta.icon} size={14} style={{ color: meta.color }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: def.enabled ? 'var(--text)' : 'var(--text-faint)' }}>
                  {def.label}
                  {def.unit && <span className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 8 }}>{def.unit}</span>}
                </div>
                <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-faint)' }}>
                  {def.key} · {def.kind.toUpperCase()} · {meta.source.toUpperCase()}
                </div>
              </div>
              <button
                onClick={() => toggle.mutate({ id: def.id, enabled: !def.enabled })}
                disabled={toggle.isPending}
                aria-pressed={def.enabled}
                className="mono"
                style={{
                  fontSize: 11, padding: '6px 14px', cursor: 'pointer', letterSpacing: '0.06em', borderRadius: 0,
                  border: def.enabled ? '1px solid var(--lime)' : '1px solid var(--line-2)',
                  background: def.enabled ? 'color-mix(in srgb, var(--lime) 14%, transparent)' : 'var(--panel-2)',
                  color: def.enabled ? 'var(--lime)' : 'var(--text-dim)',
                  transition: 'background .15s, border-color .15s, color .15s',
                }}>
                {def.enabled ? 'ON' : 'OFF'}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
