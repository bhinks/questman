/**
 * HealthView — the combined HEALTH page (Biomonitor vitals + Workouts).
 *
 * Merges what used to be two LIFE screens (Vitals + Workouts) into one:
 *
 *   1. Command bar — HEALTH title + a combined summary ("N/M vitals logged ·
 *      K workouts this week") + the shared PHONE UPLINK sync module, with a
 *      CONFIGURE toggle for the metric set.
 *   2. Log row (.hgrid) — TODAY'S READOUT (vitals instrument tiles + SUBMIT)
 *      beside LOG A WORKOUT (compact type/intensity/minutes/title + optional
 *      exercises/notes) and the THIS WEEK volume bar.
 *   3. Weekly Protocol — the planned training week (feeds workout quests).
 *   4. Recent workouts — a full-width band of color-coded session cards, each
 *      expandable to edit notes / delete.
 *   5. Trends — ONE window selector driving every chart: Training (workout
 *      minutes) beside the combined Blood Pressure plot and all vitals metrics.
 *
 * The vitals readout/sync/trend pieces live in VitalsParts (shared); the
 * workout half lives here. Both wire to the real endpoints — no mocks.
 */
import { useState, useRef, forwardRef, useImperativeHandle } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../lib/api';
import type { Workout, WorkoutPlan, WorkoutPlanResponse } from '../lib/api';
import { useFocusTotals, fmtFocusMin } from '../lib/useFocusTotals';
import { uid } from '../lib/uid';
import { Icon } from './Icon';
import { ConfirmDialog } from './ConfirmDialog';
import { metaFor } from '../lib/vitalsMeta';
import {
  useVitalsReadout, UplinkModule, MetricTile, BpTile,
  MetricTrendCard, BpTrendCard, TrainingTrendCard, ConfigPanel,
  WINDOWS, CARD_MIN,
} from './VitalsParts';
import { SleepScheduleCard } from './SleepCard';

type WorkoutType = 'strength' | 'cardio' | 'mobility' | 'sport' | 'other';
type Intensity = 'low' | 'moderate' | 'high';

const SESSION_TYPES: { value: WorkoutType; label: string }[] = [
  { value: 'strength', label: 'Strength' },
  { value: 'cardio', label: 'Cardio' },
  { value: 'mobility', label: 'Mobility' },
  { value: 'sport', label: 'Sport' },
  { value: 'other', label: 'Other' },
];
const INTENSITIES: { value: Intensity; label: string }[] = [
  { value: 'low', label: 'LOW' },
  { value: 'moderate', label: 'MOD' },
  { value: 'high', label: 'HIGH' },
];
// Type icon/accent + intensity accent (design handoff workout meta).
const TYPE_META: Record<string, { color: string; icon: string }> = {
  strength: { color: 'var(--magenta)', icon: 'flame' },
  cardio:   { color: 'var(--cyan)',    icon: 'heart' },
  mobility: { color: 'var(--teal)',    icon: 'spark' },
  sport:    { color: 'var(--amber)',   icon: 'target' },
  other:    { color: 'var(--text-dim)', icon: 'spark' },
};
const INTENSITY_COLOR: Record<string, string> = {
  low: 'var(--teal)', moderate: 'var(--amber)', high: 'var(--red)',
};
const WEEK_GOAL = 5;

function coerceType(t: string | undefined | null): WorkoutType {
  return SESSION_TYPES.some(s => s.value === t) ? (t as WorkoutType) : 'strength';
}

interface ExerciseRow {
  exercise: string;
  sets: { reps?: number; weight?: number }[];
}
interface LogResponse {
  workout: Workout;
  xpAwarded: number;
  questAutoCompleted: { id: string; xpReward: number } | null;
  deduped: boolean;
}
interface WeekVol { sessions: number; minutes: number; goal: number }

// Chamfered field, mirrors .ncx-input (kept inline so width overrides stay easy).
const inputStyle: React.CSSProperties = {
  padding: '8px 12px',
  background: '#070811',
  border: '1px solid var(--line-2)',
  borderRadius: 0,
  clipPath: 'polygon(7px 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 7px)',
  color: 'var(--text)',
  fontFamily: 'var(--font-mono)',
  fontSize: 13,
  outline: 'none',
};
// Plain (un-chamfered) control for the compact logger's top row.
const ctrl: React.CSSProperties = {
  width: '100%', background: '#070811', border: '1px solid var(--line-2)', borderRadius: 0,
  color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 13, padding: '9px 12px', outline: 'none',
};

function timeAgo(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  return d < 7 ? `${d}d ago` : new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/* ===================================================================== */
/* PAGE                                                                  */
/* ===================================================================== */
export function HealthView() {
  const v = useVitalsReadout();
  const [days, setDays] = useState(30);
  const [configuring, setConfiguring] = useState(false);

  // Recent workouts feed the THIS WEEK bar + the recent band + the command-bar
  // count (one query, shared via the react-query cache).
  const recentQ = useQuery({
    queryKey: ['workouts', 'recent'],
    queryFn: () => api.get<{ workouts: Workout[] }>('/api/workouts?limit=20').then(r => r.workouts),
  });
  const workouts = recentQ.data ?? [];
  const weekCut = Date.now() - 7 * 86_400_000;
  const wk = workouts.filter(w => new Date(w.performedAt).getTime() >= weekCut);
  const week: WeekVol = {
    sessions: wk.length,
    minutes: wk.reduce((a, w) => a + (w.durationMin ?? 0), 0),
    goal: WEEK_GOAL,
  };

  // "LOG" on a weekly-protocol slot pre-fills the compact logger + jumps to it.
  const loggerRef = useRef<WorkoutLoggerHandle>(null);

  return (
    <div className="qm-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* command bar */}
      <div style={{ display: 'flex', gap: 14, alignItems: 'stretch', flexWrap: 'wrap' }}>
        <div className="panel hud" style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 14, flex: '1 1 320px', minWidth: 0 }}>
          <div className="ncx-chip" style={{ color: v.submitted ? 'var(--lime)' : 'var(--cyan)' }}>
            <Icon name="heart" size={18} />
          </div>
          <div style={{ minWidth: 0 }}>
            <h2 className="ncx-glitch ncx-chroma" style={{ fontSize: 20, fontWeight: 700, margin: 0, fontFamily: 'var(--font-display)', letterSpacing: '0.02em', textTransform: 'uppercase' }}>Health</h2>
            <div className="mono" style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--text-faint)', marginTop: 3 }}>
              {v.loggedCount}/{v.totalCount} VITALS LOGGED · {week.sessions} WORKOUT{week.sessions === 1 ? '' : 'S'} THIS WEEK
            </div>
          </div>
          <button className={configuring ? 'btn btn-primary' : 'btn btn-ghost'} style={{ marginLeft: 'auto', padding: '7px 13px', fontSize: 11, flex: 'none' }}
            onClick={() => setConfiguring(c => !c)} key={`cfg-${configuring}`}>
            <Icon name="edit" size={13} /> {configuring ? 'DONE' : 'CONFIGURE'}
          </button>
        </div>
        <UplinkModule />
      </div>

      {configuring ? (
        <ConfigPanel defs={v.defs} />
      ) : (
        <>
          {/* log row: vitals readout | workout logger + this-week */}
          <div className="hgrid">
            <VitalsReadout v={v} />
            <div className="hcol">
              <WorkoutLogger ref={loggerRef} />
              <WeekVolume week={week} />
            </div>
          </div>

          {/* weekly protocol — planned training week (feeds workout quests) */}
          <WeeklyProtocol onLogSlot={p => loggerRef.current?.prefill(p)} />

          {/* recent workouts — full-width band of expandable session cards */}
          <RecentWorkouts workouts={workouts} loading={recentQ.isLoading} />

          {/* trends — one window selector governs every chart */}
          <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="panel" style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <Icon name="trend" size={16} style={{ color: 'var(--violet)' }} />
              <span className="mono" style={{ fontSize: 10, letterSpacing: '0.26em', color: 'var(--text-dim)', textTransform: 'uppercase' }}>TRENDS</span>
              <span className="ncx-serial">ALL STREAMS · ONE WINDOW</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                {WINDOWS.map(([label, d]) => {
                  const on = days === d;
                  return (
                    <button key={label} onClick={() => setDays(d)} className="mono"
                      style={{
                        fontSize: 11, padding: '5px 13px', cursor: 'pointer', letterSpacing: '0.06em', borderRadius: 0,
                        border: on ? '1px solid var(--violet)' : '1px solid var(--line-2)',
                        background: on ? 'color-mix(in srgb, var(--violet) 16%, transparent)' : 'var(--panel-2)',
                        color: on ? 'var(--violet)' : 'var(--text-dim)',
                        transition: 'background .15s, border-color .15s, color .15s',
                      }}>
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${CARD_MIN}px, 1fr))`, gap: 14, alignItems: 'start' }}>
              {v.hasBp && <BpTrendCard key="bp" sysDef={v.bpSysDef!} diaDef={v.bpDiaDef!} days={days} />}
              {/* Fixed 10-night window by design (bedtime alignment is a
                  short read); hides itself until bedtimes have synced. */}
              <SleepScheduleCard key="sleep-schedule" />
              <TrainingTrendCard key="training" days={days} />
              {v.metricDefs.map((def, i) => (
                <MetricTrendCard key={def.key} def={def} meta={metaFor(def.key, i)} days={days} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

/* ---------- vitals readout (left column of the log row) ---------- */
function VitalsReadout({ v }: { v: ReturnType<typeof useVitalsReadout> }) {
  const { defsQ, logQ } = v;
  const loading = defsQ.isLoading || logQ.isLoading;
  const error = defsQ.isError || logQ.isError;
  const noMetrics = !loading && !error && v.enabled.length === 0;

  return (
    <section className="panel" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span className="mono" style={{ fontSize: 10, letterSpacing: '0.26em', color: 'var(--text-dim)', textTransform: 'uppercase' }}>TODAY&rsquo;S READOUT</span>
        {logQ.data && <span className="ncx-serial">LOG {format(new Date(logQ.data.date), 'yyyy.MM.dd')}</span>}
        <span className="mono" style={{ marginLeft: 'auto', fontSize: 9.5, letterSpacing: '0.14em', color: 'var(--text-faint)' }}>
          UPLINK PREFILLED · EDIT ANYTIME
        </span>
      </div>

      {loading ? (
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-faint)', letterSpacing: '0.12em', padding: '8px 0' }}>LOADING…</div>
      ) : error ? (
        <div className="mono" style={{ fontSize: 12, color: 'var(--red)', letterSpacing: '0.12em', padding: '8px 0' }}>FAILED TO LOAD</div>
      ) : noMetrics ? (
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-faint)', letterSpacing: '0.06em', padding: '8px 0' }}>
          No metrics enabled — open <strong style={{ color: 'var(--text)' }}>CONFIGURE</strong> to turn some on.
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(176px, 1fr))', gap: 12 }}>
            {v.hasBp && (
              <BpTile
                sys={v.draft.bpSys ?? ''} dia={v.draft.bpDia ?? ''}
                onSys={val => v.setVal('bpSys', val)} onDia={val => v.setVal('bpDia', val)}
              />
            )}
            {v.metricDefs.map((def, i) => (
              <MetricTile
                key={def.key}
                def={def}
                meta={metaFor(def.key, i)}
                value={v.draft[def.key] ?? ''}
                onChange={val => v.setVal(def.key, val)}
                logged={v.isFilled(def.key)}
              />
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="btn btn-primary" disabled={v.submit.isPending || v.loggedCount === 0} onClick={() => v.submit.mutate()}>
              {v.submit.isPending ? 'TRANSMITTING…' : v.submitted ? 'UPDATE LOG' : 'SUBMIT LOG'}
            </button>
            {v.submit.isSuccess && v.submit.data?.questAutoCompleted && (
              <span className="mono" style={{ fontSize: 12, color: 'var(--lime)', display: 'flex', alignItems: 'center', gap: 5 }}>
                <Icon name="check" size={13} style={{ color: 'var(--lime)' }} /> +{v.submit.data.questAutoCompleted.xpReward} XP banked · daily vitals contract cleared
              </span>
            )}
            {v.submitted && !v.submit.isPending && !(v.submit.isSuccess && v.submit.data?.questAutoCompleted) && (
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Icon name="check" size={12} style={{ color: 'var(--lime)' }} /> LOGGED
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/* ===================================================================== */
/* WORKOUT LOGGER (compact form + optional exercises / notes)            */
/* ===================================================================== */
export interface WorkoutLoggerHandle {
  /** Pre-fill the form from a weekly-protocol slot and scroll/focus to it. */
  prefill: (plan: WorkoutPlan) => void;
}

const WorkoutLogger = forwardRef<WorkoutLoggerHandle>(function WorkoutLogger(_props, ref) {
  const qc = useQueryClient();
  const [type, setType] = useState<WorkoutType>('strength');
  const [intensity, setIntensity] = useState<Intensity>('moderate');
  const [durationMin, setDurationMin] = useState<number>(45);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [exercises, setExercises] = useState<ExerciseRow[]>([]);
  const [showDetails, setShowDetails] = useState(false);
  // Idempotency key for THIS log attempt — a double-click fires two POSTs with
  // the same key; the server dedupes the second (no double XP). Reset after a
  // successful log. uid(), not crypto.randomUUID (undefined over LAN http).
  const [clientRequestId, setClientRequestId] = useState(() => uid());

  const formRef = useRef<HTMLFormElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    prefill(plan: WorkoutPlan) {
      setTitle(plan.title);
      setType(coerceType(plan.type));
      if (plan.targetMin != null) setDurationMin(plan.targetMin);
      requestAnimationFrame(() => {
        formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        titleInputRef.current?.focus({ preventScroll: true });
      });
    },
  }), []);

  const log = useMutation({
    mutationFn: () => api.post<LogResponse>('/api/workouts', {
      type, title: title.trim() || null,
      durationMin: durationMin || null,
      intensity,
      notes: notes.trim() || null,
      exercises: exercises.length ? exercises.map(e => ({
        exercise: e.exercise,
        sets: e.sets.filter(s => s.reps || s.weight),
      })).filter(e => e.exercise) : undefined,
      clientRequestId,
    }),
    onSuccess: () => {
      setTitle(''); setNotes(''); setExercises([]); setShowDetails(false);
      setClientRequestId(uid()); // fresh key for the next log
      qc.invalidateQueries({ queryKey: ['workouts', 'recent'] });
      qc.invalidateQueries({ queryKey: ['player'] });
      qc.invalidateQueries({ queryKey: ['quests', 'today'] });
    },
  });

  return (
    <form
      ref={formRef}
      className="panel"
      style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 13 }}
      onSubmit={e => { e.preventDefault(); log.mutate(); }}
    >
      <span className="mono" style={{ fontSize: 10, letterSpacing: '0.26em', color: 'var(--text-dim)', textTransform: 'uppercase' }}>LOG A WORKOUT</span>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="kicker" style={{ fontSize: 9 }}>TYPE</span>
          <select value={type} onChange={e => setType(e.target.value as WorkoutType)} style={ctrl}>
            {SESSION_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="kicker" style={{ fontSize: 9 }}>MINUTES</span>
          <input type="number" inputMode="numeric" min={0} max={720} value={durationMin}
            onChange={e => setDurationMin(Number(e.target.value))} style={ctrl} />
        </label>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="kicker" style={{ fontSize: 9 }}>INTENSITY</span>
        <div style={{ display: 'flex', gap: 0, boxShadow: 'inset 0 0 0 1px var(--line-2)' }}>
          {INTENSITIES.map(o => {
            const on = intensity === o.value;
            const c = INTENSITY_COLOR[o.value];
            return (
              <button key={o.value} type="button" onClick={() => setIntensity(o.value)} className="mono"
                style={{
                  flex: 1, padding: '8px 0', fontSize: 11, letterSpacing: '0.1em', cursor: 'pointer', border: 'none', borderRadius: 0,
                  background: on ? `color-mix(in srgb, ${c} 18%, transparent)` : 'transparent',
                  color: on ? c : 'var(--text-dim)', fontWeight: on ? 700 : 500,
                  boxShadow: on ? `inset 0 0 0 1px ${c}` : 'none',
                }}>
                {o.label}
              </button>
            );
          })}
        </div>
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="kicker" style={{ fontSize: 9 }}>TITLE (OPTIONAL)</span>
        <input ref={titleInputRef} value={title} onChange={e => setTitle(e.target.value)}
          placeholder='e.g. "Push day", "5k run"' style={ctrl} />
      </label>

      {/* optional richer logging — exercises + notes, collapsed by default */}
      <button type="button" className="btn btn-ghost"
        style={{ alignSelf: 'flex-start', padding: '4px 8px', fontSize: 10, letterSpacing: '0.12em', color: 'var(--text-faint)' }}
        onClick={() => setShowDetails(s => !s)}
        aria-expanded={showDetails}
      >
        <Icon name="chevD" size={11} style={{ transform: showDetails ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease', marginRight: 4 }} />
        {showDetails ? 'HIDE DETAILS' : 'ADD EXERCISES / NOTES'}
      </button>

      {showDetails && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="kicker" style={{ fontSize: 9 }}>NOTES</span>
            <textarea placeholder="How did it feel?" value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              style={{ ...inputStyle, resize: 'vertical' }} />
          </label>
          <ExercisesEditor exercises={exercises} setExercises={setExercises} />
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="submit" className="btn btn-primary" disabled={log.isPending} style={{ padding: '8px 16px', fontSize: 11 }}>
          <Icon name="plus" size={13} /> {log.isPending ? 'LOGGING…' : 'LOG WORKOUT'}
        </button>
        {log.isSuccess && log.data && !log.data.deduped && (
          <span className="mono" style={{ fontSize: 12, color: 'var(--lime)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <Icon name="check" size={13} style={{ color: 'var(--lime)' }} /> +{log.data.xpAwarded} XP banked
          </span>
        )}
      </div>
    </form>
  );
});

/* ---------- this-week volume bar ---------- */
function WeekVolume({ week }: { week: WeekVol }) {
  const pct = Math.min(100, Math.round((week.sessions / week.goal) * 100));
  return (
    <div className="panel-inset" style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
        <span className="kicker" style={{ fontSize: 9 }}>THIS WEEK</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 16, alignItems: 'baseline' }}>
          <span><span className="ncx-val" style={{ fontSize: 17, color: 'var(--lime)' }}>{week.sessions}</span><span className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>/{week.goal} SESSIONS</span></span>
          <span><span className="ncx-val" style={{ fontSize: 17, color: 'var(--cyan)' }}>{week.minutes}</span><span className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}> MIN</span></span>
        </span>
      </div>
      <div className="ncx-bar slim">
        <i style={{ width: `${pct}%`, background: 'linear-gradient(90deg, var(--cyan-deep), var(--lime))' }} />
        <span className="seg-mask" />
      </div>
    </div>
  );
}

/* ===================================================================== */
/* RECENT WORKOUTS (full-width band of expandable session cards)         */
/* ===================================================================== */
function RecentWorkouts({ workouts, loading }: { workouts: Workout[]; loading: boolean }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Workout | null>(null);
  const qc = useQueryClient();

  const del = useMutation({
    mutationFn: (id: string) => api.del(`/api/workouts/${id}`),
    onSuccess: () => {
      setPendingDelete(null);
      // Earned XP/eddies persist on delete (the ledger keeps the grant) — only
      // the workout list needs a refresh.
      qc.invalidateQueries({ queryKey: ['workouts', 'recent'] });
    },
  });

  return (
    <section className="panel" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Icon name="spark" size={14} style={{ color: 'var(--lime)' }} />
        <span className="mono" style={{ fontSize: 10, letterSpacing: '0.26em', color: 'var(--text-dim)', textTransform: 'uppercase' }}>RECENT WORKOUTS</span>
        <span className="ncx-serial">{workouts.length} LOGGED</span>
      </div>

      {loading ? (
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-faint)', letterSpacing: '0.12em' }}>LOADING…</div>
      ) : workouts.length === 0 ? (
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-faint)', letterSpacing: '0.08em' }}>NO WORKOUTS LOGGED YET</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 12, alignItems: 'start' }}>
          {workouts.map(w => (
            <WorkoutCard
              key={w.id}
              workout={w}
              expanded={expandedId === w.id}
              onToggle={() => setExpandedId(id => id === w.id ? null : w.id)}
              onDelete={() => setPendingDelete(w)}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        danger
        title="Delete workout?"
        message={pendingDelete && (
          <>This removes <strong style={{ color: 'var(--text)' }}>
            {pendingDelete.title ?? `${pendingDelete.type} session`}
          </strong> from your log. The <strong style={{ color: 'var(--text)' }}>+{pendingDelete.xpAwarded} XP</strong> you earned stays banked. This can&rsquo;t be undone.</>
        )}
        confirmLabel="DELETE"
        busy={del.isPending}
        onConfirm={() => pendingDelete && del.mutate(pendingDelete.id)}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  );
}

/**
 * One recent-workout card — color-coded by type. Collapsed shows the gist;
 * clicking expands it (full-width) to detail + editable notes + delete.
 */
function WorkoutCard({
  workout: w, expanded, onToggle, onDelete,
}: { workout: Workout; expanded: boolean; onToggle: () => void; onDelete: () => void }) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState(w.notes ?? '');
  const dirty = notes !== (w.notes ?? '');
  const tm = TYPE_META[w.type] ?? TYPE_META.other;
  const ic = w.intensity ? INTENSITY_COLOR[w.intensity] : 'var(--text-dim)';

  const saveNotes = useMutation({
    mutationFn: () => api.put(`/api/workouts/${w.id}`, { notes: notes.trim() || null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workouts', 'recent'] }),
  });

  return (
    <div className="panel-inset" style={{ padding: 0, display: 'flex', flexDirection: 'column', gridColumn: expanded ? '1 / -1' : 'auto' }}>
      {/* compact header — click to expand */}
      <div onClick={onToggle} style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
        <div className="ncx-chip" style={{ width: 32, height: 32, color: tm.color, flex: 'none' }}>
          <Icon name={tm.icon} size={15} style={{ color: tm.color }} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {w.title || w.type[0].toUpperCase() + w.type.slice(1)}
          </div>
          <div className="mono" style={{ fontSize: 9.5, letterSpacing: '0.06em', color: 'var(--text-faint)', marginTop: 2 }}>
            <span style={{ color: tm.color }}>{w.type.toUpperCase()}</span>
            {w.intensity && <> · <span style={{ color: ic }}>{w.intensity.toUpperCase()}</span></>}
            {w.durationMin ? ` · ${w.durationMin}M` : ''} · {timeAgo(w.performedAt)}
          </div>
        </div>
        <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--lime)', flex: 'none' }}>+{w.xpAwarded}</span>
        <Icon name="chevD" size={13} style={{ color: 'var(--text-faint)', flex: 'none', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }} />
      </div>

      {/* expanded detail */}
      {expanded && (
        <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: 12, borderTop: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Detail label="TYPE" value={w.type} />
            {w.durationMin != null && <Detail label="DURATION" value={`${w.durationMin} min`} />}
            {w.intensity && <Detail label="INTENSITY" value={w.intensity} />}
            {w.caloriesEst != null && <Detail label="CALORIES" value={`~${w.caloriesEst}`} />}
          </div>

          {w.exercises && w.exercises.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="kicker">EXERCISES</span>
              {w.exercises.map((ex: any, i: number) => (
                <div key={i} className="panel-inset" style={{ padding: '8px 10px' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: ex.sets?.length ? 4 : 0 }}>{ex.exercise}</div>
                  {ex.sets?.length > 0 && (
                    <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                      {ex.sets.map((s: any) =>
                        [s.reps != null ? `${s.reps} reps` : null, s.weight != null ? `${s.weight} kg` : null]
                          .filter(Boolean).join(' × ') || 'set'
                      ).join('  ·  ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="kicker">NOTES</span>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              placeholder="Add notes about this session…" style={{ ...inputStyle, resize: 'vertical' }} />
          </label>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={onDelete} className="btn btn-ghost" style={{ padding: '6px 10px', fontSize: 11, color: 'var(--red)' }}>
              <Icon name="close" size={13} style={{ marginRight: 4 }} /> DELETE
            </button>
            {dirty && (
              <button onClick={() => saveNotes.mutate()} className="btn btn-primary" style={{ padding: '6px 12px', fontSize: 11 }} disabled={saveNotes.isPending}>
                {saveNotes.isPending ? 'SAVING…' : 'SAVE NOTES'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel-inset" style={{ padding: '6px 10px', minWidth: 70 }}>
      <div className="kicker" style={{ fontSize: 9, marginBottom: 2 }}>{label}</div>
      <div className="mono" style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600, textTransform: 'capitalize' }}>{value}</div>
    </div>
  );
}

/* ===================================================================== */
/* WEEKLY PROTOCOL (planned training week — feeds workout quests)        */
/* ===================================================================== */

// Display Monday-first; values stay JS getDay numbers (0=Sun..6=Sat).
const WEEK: { dow: number; label: string }[] = [
  { dow: 1, label: 'MON' }, { dow: 2, label: 'TUE' }, { dow: 3, label: 'WED' },
  { dow: 4, label: 'THU' }, { dow: 5, label: 'FRI' }, { dow: 6, label: 'SAT' },
  { dow: 0, label: 'SUN' },
];

interface PlanBody {
  title: string;
  type: string;
  targetMin: number | null;
  notes: string | null;
}

function WeeklyProtocol({ onLogSlot }: { onLogSlot: (plan: WorkoutPlan) => void }) {
  const qc = useQueryClient();
  const plansQ = useQuery({
    queryKey: ['workouts', 'plan'],
    queryFn: () => api.get<WorkoutPlanResponse>('/api/workouts/plan').then(r => r.plans),
  });
  // Actual minutes jacked in against each plan slot (focus-timer rollup).
  const focusTotals = useFocusTotals(['workout']);

  const [addingDay, setAddingDay] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const invalidatePlan = () => qc.invalidateQueries({ queryKey: ['workouts', 'plan'] });
  const invalidateQuests = () => qc.invalidateQueries({ queryKey: ['quests', 'today'] });

  const create = useMutation({
    mutationFn: (body: PlanBody & { dayOfWeek: number }) => api.post('/api/workouts/plan', body),
    onSuccess: () => { setAddingDay(null); invalidatePlan(); invalidateQuests(); },
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: PlanBody & { id: string }) => api.put(`/api/workouts/plan/${id}`, body),
    onSuccess: () => { setEditingId(null); invalidatePlan(); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/workouts/plan/${id}`),
    onSuccess: () => { invalidatePlan(); invalidateQuests(); },
  });

  const plans = plansQ.data ?? [];
  const todayDow = new Date().getDay();

  return (
    <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span className="mono" style={{ fontSize: 10, letterSpacing: '0.26em', color: 'var(--text-dim)', textTransform: 'uppercase' }}>WEEKLY PROTOCOL</span>
        <span style={{ flex: 1 }} />
        <span className="ncx-serial">{plans.length} SLOT{plans.length === 1 ? '' : 'S'}</span>
      </div>

      {plansQ.isLoading ? (
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', letterSpacing: '0.1em' }}>SYNCING PROTOCOL…</div>
      ) : plans.length === 0 && (
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', letterSpacing: '0.08em' }}>
          NO PROTOCOL ON FILE — lay out your training week
        </div>
      )}

      <div style={{ overflowX: 'auto', paddingBottom: 2 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 6, minWidth: 660 }}>
          {WEEK.map(({ dow, label }) => {
            const isToday = dow === todayDow;
            const daySlots = plans.filter(p => p.dayOfWeek === dow);
            return (
              <div
                key={dow}
                style={{
                  display: 'flex', flexDirection: 'column', gap: 6, padding: 6,
                  border: isToday ? '1px solid rgba(var(--accent-rgb), 0.45)' : '1px solid var(--line)',
                  background: isToday ? 'rgba(var(--accent-rgb), 0.05)' : 'transparent',
                }}
              >
                <div className="mono" style={{
                  fontSize: 9, letterSpacing: '0.22em', fontWeight: 700, textAlign: 'center',
                  color: isToday ? 'rgba(var(--accent-rgb), 0.95)' : 'var(--text-faint)',
                }}>
                  {label}
                </div>

                {daySlots.map(plan => editingId === plan.id ? (
                  <PlanForm
                    key={plan.id}
                    initial={plan}
                    busy={update.isPending}
                    onSave={body => update.mutate({ id: plan.id, ...body })}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <PlanSlot
                    key={plan.id}
                    plan={plan}
                    focusMin={focusTotals.get(plan.id) ?? 0}
                    busy={remove.isPending}
                    onLog={() => onLogSlot(plan)}
                    onEdit={() => { setEditingId(plan.id); setAddingDay(null); }}
                    onDelete={() => remove.mutate(plan.id)}
                  />
                ))}

                {addingDay === dow ? (
                  <PlanForm
                    busy={create.isPending}
                    onSave={body => create.mutate({ dayOfWeek: dow, ...body })}
                    onCancel={() => setAddingDay(null)}
                  />
                ) : (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ padding: '3px 6px', fontSize: 9, letterSpacing: '0.14em', color: 'var(--text-faint)', justifyContent: 'center' }}
                    onClick={() => { setAddingDay(dow); setEditingId(null); }}
                  >
                    <Icon name="plus" size={9} /> ADD
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/** One planned slot card in a day column. */
function PlanSlot({
  plan, focusMin, busy, onLog, onEdit, onDelete,
}: { plan: WorkoutPlan; focusMin: number; busy: boolean; onLog: () => void; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="panel-inset" style={{ padding: 7, display: 'flex', flexDirection: 'column', gap: 5, opacity: plan.isActive ? 1 : 0.45 }}>
      <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.3, overflowWrap: 'break-word' }}>{plan.title}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
        <span className="ncx-stamp flat" style={{ fontSize: 9.5, padding: '1px 5px', letterSpacing: '0.12em', color: (TYPE_META[plan.type] ?? TYPE_META.other).color }}>
          {plan.type}
        </span>
        {plan.targetMin != null && (
          <span className="mono" style={{ fontSize: 9.5, color: 'var(--text-dim)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <Icon name="clock" size={9} /> {plan.targetMin}m
          </span>
        )}
        {focusMin > 0 && (
          <span className="mono" title={`${focusMin} minutes of logged focus time`} style={{ fontSize: 9.5, color: 'var(--teal)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <Icon name="zap" size={9} /> {fmtFocusMin(focusMin)}
          </span>
        )}
      </div>
      {plan.notes && (
        <div className="mono" style={{ fontSize: 9.5, color: 'var(--text-faint)', lineHeight: 1.4, overflowWrap: 'break-word' }}>{plan.notes}</div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        <button type="button" className="btn btn-ghost" style={{ padding: '2px 7px', fontSize: 9, letterSpacing: '0.14em' }} onClick={onLog}>
          LOG
        </button>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn-ghost" style={{ padding: '2px 5px' }} onClick={onEdit} aria-label="Edit slot">
          <Icon name="edit" size={10} />
        </button>
        <button type="button" className="btn btn-ghost" style={{ padding: '2px 5px', color: 'var(--red)' }} onClick={onDelete} disabled={busy} aria-label="Delete slot">
          <Icon name="close" size={10} />
        </button>
      </div>
    </div>
  );
}

/** Inline add/edit form for a plan slot (fits inside a day column). */
function PlanForm({
  initial, busy, onSave, onCancel,
}: { initial?: WorkoutPlan; busy: boolean; onSave: (body: PlanBody) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [type, setType] = useState<WorkoutType>(coerceType(initial?.type));
  const [targetMin, setTargetMin] = useState<string>(initial?.targetMin != null ? String(initial.targetMin) : '');
  const [notes, setNotes] = useState(initial?.notes ?? '');

  const slotInput: React.CSSProperties = { ...inputStyle, padding: '5px 8px', fontSize: 11, width: '100%', boxSizing: 'border-box' };

  const submit = () => {
    if (!title.trim()) return;
    const mins = Number(targetMin);
    onSave({
      title: title.trim(),
      type,
      targetMin: targetMin !== '' && Number.isFinite(mins) && mins > 0 ? Math.round(mins) : null,
      notes: notes.trim() || null,
    });
  };

  return (
    <div className="panel-inset" style={{ padding: 7, display: 'flex', flexDirection: 'column', gap: 5 }}>
      <input
        placeholder="Title" autoFocus
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); }}
        style={slotInput}
      />
      <select value={type} onChange={e => setType(coerceType(e.target.value))} style={slotInput}>
        {SESSION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>
      <input
        type="number" min={0} max={720} placeholder="Min"
        value={targetMin}
        onChange={e => setTargetMin(e.target.value)}
        style={slotInput}
      />
      <input
        placeholder="Notes"
        value={notes}
        onChange={e => setNotes(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); }}
        style={slotInput}
      />
      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-ghost" style={{ padding: '2px 6px' }} onClick={onCancel} aria-label="Cancel">
          <Icon name="close" size={10} />
        </button>
        <button type="button" className="btn btn-primary" style={{ padding: '2px 6px' }} onClick={submit} disabled={busy || !title.trim()} aria-label="Save slot">
          <Icon name="check" size={10} />
        </button>
      </div>
    </div>
  );
}

/* ===================================================================== */
/* EXERCISES EDITOR (optional, inside the compact logger)                */
/* ===================================================================== */
function ExercisesEditor({
  exercises, setExercises,
}: { exercises: ExerciseRow[]; setExercises: (e: ExerciseRow[]) => void }) {
  const addExercise = () => setExercises([...exercises, { exercise: '', sets: [{}] }]);
  const removeExercise = (i: number) => setExercises(exercises.filter((_, idx) => idx !== i));
  const updateExercise = (i: number, fn: (e: ExerciseRow) => ExerciseRow) =>
    setExercises(exercises.map((e, idx) => idx === i ? fn(e) : e));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="kicker">EXERCISES</span>
        <button type="button" className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 11 }} onClick={addExercise}>
          <Icon name="plus" size={12} /> ADD
        </button>
      </div>
      {exercises.map((ex, i) => (
        <div key={i} className="panel-inset" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              placeholder="Exercise (e.g. Bench Press)"
              value={ex.exercise}
              onChange={e => updateExercise(i, x => ({ ...x, exercise: e.target.value }))}
              style={{ ...inputStyle, flex: 1 }}
            />
            <button type="button" className="btn btn-ghost" style={{ padding: '6px 10px', fontSize: 11 }} onClick={() => removeExercise(i)}>
              <Icon name="close" size={12} />
            </button>
          </div>
          <SetsEditor ex={ex} onChange={x => updateExercise(i, () => x)} />
        </div>
      ))}
    </div>
  );
}

function SetsEditor({ ex, onChange }: { ex: ExerciseRow; onChange: (x: ExerciseRow) => void }) {
  const update = (sets: ExerciseRow['sets']) => onChange({ ...ex, sets });
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {ex.sets.map((s, j) => (
        <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input
            type="number" placeholder="reps"
            value={s.reps ?? ''}
            onChange={e => {
              const next = [...ex.sets];
              next[j] = { ...s, reps: e.target.value ? Number(e.target.value) : undefined };
              update(next);
            }}
            style={{ ...inputStyle, width: 64 }}
          />
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-faint)' }}>×</span>
          <input
            type="number" placeholder="kg"
            value={s.weight ?? ''}
            onChange={e => {
              const next = [...ex.sets];
              next[j] = { ...s, weight: e.target.value ? Number(e.target.value) : undefined };
              update(next);
            }}
            style={{ ...inputStyle, width: 64 }}
          />
        </div>
      ))}
      <button type="button" className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: 11 }} onClick={() => update([...ex.sets, {}])}>
        <Icon name="plus" size={11} /> SET
      </button>
    </div>
  );
}
