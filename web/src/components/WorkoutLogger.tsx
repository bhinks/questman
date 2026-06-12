/**
 * WorkoutLogger — log a workout session + view recent ones.
 *
 * Phase 5 ships a flexible-enough form: type, duration, intensity,
 * notes, and an optional dynamic list of {exercise, sets[]}. The
 * backend stores `exercises` as JSON so the UI can evolve without a
 * migration. XP is awarded automatically on POST.
 */
import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Workout, WorkoutPlan, WorkoutPlanResponse } from '../lib/api';
import { useFocusTotals, fmtFocusMin } from '../lib/useFocusTotals';
import { uid } from '../lib/uid';
import { Icon } from './Icon';
import { ConfirmDialog } from './ConfirmDialog';

type WorkoutType = 'strength' | 'cardio' | 'mobility' | 'sport' | 'other';
type Intensity = 'low' | 'moderate' | 'high';

const SESSION_TYPES: WorkoutType[] = ['strength', 'cardio', 'mobility', 'sport', 'other'];

function coerceType(t: string | undefined | null): WorkoutType {
  return (SESSION_TYPES as string[]).includes(t ?? '') ? (t as WorkoutType) : 'strength';
}

interface ExerciseRow {
  exercise: string;
  sets: { reps?: number; weight?: number }[];
}

export function WorkoutLogger() {
  const qc = useQueryClient();
  const recentQ = useQuery({
    queryKey: ['workouts', 'recent'],
    queryFn: () => api.get<{ workouts: Workout[] }>('/api/workouts?limit=20').then(r => r.workouts),
  });

  const [type, setType] = useState<WorkoutType>('strength');
  const [title, setTitle] = useState('');
  const [durationMin, setDurationMin] = useState<number>(45);
  const [intensity, setIntensity] = useState<Intensity>('moderate');
  const [notes, setNotes] = useState('');
  const [exercises, setExercises] = useState<ExerciseRow[]>([]);
  const [pendingDelete, setPendingDelete] = useState<Workout | null>(null);
  // Idempotency key for THIS log attempt. A double-click fires two POSTs with
  // the same key; the server dedupes the second (no double XP/eddie payout).
  // Reset to a fresh key after a successful log so the next session is its own.
  // uid(), not crypto.randomUUID — the latter is undefined over LAN http
  // (insecure context) and crashed this whole view on non-localhost machines.
  const [clientRequestId, setClientRequestId] = useState(() => uid());

  // "LOG" on a weekly-protocol slot pre-fills the form below and jumps to it.
  const formRef = useRef<HTMLFormElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const prefillFromPlan = (plan: WorkoutPlan) => {
    setTitle(plan.title);
    setType(coerceType(plan.type));
    if (plan.targetMin != null) setDurationMin(plan.targetMin);
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      titleInputRef.current?.focus({ preventScroll: true });
    });
  };

  const del = useMutation({
    mutationFn: (id: string) => api.del(`/api/workouts/${id}`),
    onSuccess: () => {
      setPendingDelete(null);
      // Earned XP/eddies persist on delete (the ledger keeps the grant),
      // so the HUD is unaffected — only the workout list needs a refresh.
      qc.invalidateQueries({ queryKey: ['workouts', 'recent'] });
    },
  });

  const log = useMutation({
    mutationFn: () => api.post('/api/workouts', {
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
      setTitle(''); setNotes(''); setExercises([]);
      setClientRequestId(uid()); // fresh key for the next log
      qc.invalidateQueries({ queryKey: ['workouts', 'recent'] });
      qc.invalidateQueries({ queryKey: ['player'] });
      qc.invalidateQueries({ queryKey: ['quests', 'today'] });
    },
  });

  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <Header />

      <WeeklyProtocol onLogSlot={prefillFromPlan} />

      <form
        ref={formRef}
        className="panel"
        style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}
        onSubmit={e => { e.preventDefault(); log.mutate(); }}
      >
        <div className="mono" style={{ fontSize: 10, letterSpacing: '0.26em', color: 'var(--text-dim)', textTransform: 'uppercase' }}>LOG A WORKOUT</div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
          <Select label="TYPE" value={type} onChange={v => setType(v as WorkoutType)} options={[
            { value: 'strength', label: 'Strength' },
            { value: 'cardio', label: 'Cardio' },
            { value: 'mobility', label: 'Mobility' },
            { value: 'sport', label: 'Sport' },
            { value: 'other', label: 'Other' },
          ]}/>
          <Select label="INTENSITY" value={intensity} onChange={v => setIntensity(v as Intensity)} options={[
            { value: 'low', label: 'Low' },
            { value: 'moderate', label: 'Moderate' },
            { value: 'high', label: 'High' },
          ]}/>
          <Field label="MINUTES">
            <input
              type="number" min={0} max={720}
              value={durationMin}
              onChange={e => setDurationMin(Number(e.target.value))}
              style={inputStyle}
            />
          </Field>
        </div>

        <Field label="TITLE (optional)">
          <input
            ref={titleInputRef}
            placeholder='e.g. "Push day", "5k run"'
            value={title}
            onChange={e => setTitle(e.target.value)}
            style={inputStyle}
          />
        </Field>

        <Field label="NOTES (optional)">
          <textarea
            placeholder="How did it feel?"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </Field>

        <ExercisesEditor exercises={exercises} setExercises={setExercises} />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={log.isPending}
          >
            {log.isPending ? 'LOGGING…' : 'LOG WORKOUT'}
          </button>
        </div>
      </form>

      <RecentList workouts={recentQ.data ?? []} loading={recentQ.isLoading} onDelete={setPendingDelete} />

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
    </div>
  );
}

function Header() {
  return (
    <div className="panel hud" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
      <div className="ncx-chip" style={{ color: 'var(--cyan)' }}>
        <Icon name="spark" size={18} />
      </div>
      <div>
        <h2 className="ncx-glitch ncx-chroma" style={{ fontSize: 20, fontWeight: 700, margin: 0, fontFamily: 'var(--font-display)', letterSpacing: '0.02em' }}>WORKOUTS</h2>
        <div className="mono" style={{ fontSize: 10, letterSpacing: '0.24em', color: 'var(--text-faint)', marginTop: 3 }}>TRAINING SESSIONS · XP BANKED ON LOG</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------- weekly protocol -- */

// Display Monday-first; values stay JS getDay numbers (0=Sun..6=Sat).
const WEEK: { dow: number; label: string }[] = [
  { dow: 1, label: 'MON' }, { dow: 2, label: 'TUE' }, { dow: 3, label: 'WED' },
  { dow: 4, label: 'THU' }, { dow: 5, label: 'FRI' }, { dow: 6, label: 'SAT' },
  { dow: 0, label: 'SUN' },
];

const TYPE_COLOR: Record<string, string> = {
  strength: 'var(--magenta)',
  cardio:   'var(--cyan)',
  mobility: 'var(--teal)',
  sport:    'var(--amber)',
  other:    'var(--text-dim)',
};

interface PlanBody {
  title: string;
  type: string;
  targetMin: number | null;
  notes: string | null;
}

/**
 * WEEKLY PROTOCOL — the planned training week as a 7-column strip.
 * Each slot can be logged (pre-fills the form below), edited inline,
 * or deleted; each day has an "+ ADD" affordance. Plan changes feed
 * tomorrow's quest candidates, so create/delete also refresh quests.
 */
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
        <span className="ncx-stamp flat" style={{ fontSize: 9.5, padding: '1px 5px', letterSpacing: '0.12em', color: TYPE_COLOR[plan.type] ?? 'var(--text-dim)' }}>
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
        {SESSION_TYPES.map(t => <option key={t} value={t}>{t[0].toUpperCase()}{t.slice(1)}</option>)}
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
        <span className="kicker">EXERCISES (OPTIONAL)</span>
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
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: '6px 10px', fontSize: 11 }}
              onClick={() => removeExercise(i)}
            >
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
      <button
        type="button"
        className="btn btn-ghost"
        style={{ padding: '4px 8px', fontSize: 11 }}
        onClick={() => update([...ex.sets, {}])}
      >
        <Icon name="plus" size={11} /> SET
      </button>
    </div>
  );
}

function RecentList({ workouts, loading, onDelete }: { workouts: Workout[]; loading: boolean; onDelete: (w: Workout) => void }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (loading) {
    return <div className="panel hud" style={{ padding: 40, textAlign: 'center', color: 'var(--text-faint)' }}><div className="mono" style={{ fontSize: 13 }}>LOADING…</div></div>;
  }
  if (workouts.length === 0) {
    return <div className="panel hud" style={{ padding: 30, textAlign: 'center', color: 'var(--text-faint)' }}><div className="mono" style={{ fontSize: 13 }}>NO WORKOUTS LOGGED YET</div></div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', paddingLeft: 4, paddingRight: 4 }}>
        <span className="mono" style={{ fontSize: 10, letterSpacing: '0.26em', color: 'var(--text-dim)', textTransform: 'uppercase' }}>RECENT</span>
        <span style={{ flex: 1 }} />
        <span className="ncx-serial">{workouts.length} RECORDS</span>
      </div>
      {workouts.map(w => (
        <WorkoutRow
          key={w.id}
          workout={w}
          expanded={expandedId === w.id}
          onToggle={() => setExpandedId(id => id === w.id ? null : w.id)}
          onDelete={() => onDelete(w)}
        />
      ))}
    </div>
  );
}

/**
 * One recent-workout row. Collapsed by default; clicking the card expands
 * it to show full details (duration/intensity/calories, the exercise +
 * set breakdown, and editable notes). Editing notes is the gentle path
 * that means you rarely need to delete-and-re-log to correct a session.
 */
function WorkoutRow({
  workout: w, expanded, onToggle, onDelete,
}: { workout: Workout; expanded: boolean; onToggle: () => void; onDelete: () => void }) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState(w.notes ?? '');
  const dirty = notes !== (w.notes ?? '');

  const saveNotes = useMutation({
    mutationFn: () => api.put(`/api/workouts/${w.id}`, { notes: notes.trim() || null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workouts', 'recent'] }),
  });

  const when = new Date(w.performedAt);
  const dateStr = when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const timeStr = when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
      {/* Header row — click to expand */}
      <div
        onClick={onToggle}
        style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer' }}
      >
        <div className="ncx-chip mono" style={{
          width: 38, height: 38,
          color: 'var(--cyan)', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
        }}>
          {w.type.slice(0, 3).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            {w.title ?? `${w.type[0].toUpperCase()}${w.type.slice(1)} session`}
          </div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            {dateStr} · {timeStr}
            {w.durationMin ? ` · ${w.durationMin} min` : ''}
            {w.intensity ? ` · ${w.intensity}` : ''}
            {w.exercises?.length ? ` · ${w.exercises.length} exercise${w.exercises.length > 1 ? 's' : ''}` : ''}
          </div>
        </div>
        <div className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--lime)' }}>
          +{w.xpAwarded}
        </div>
        <Icon name="chevD" size={14} style={{ color: 'var(--text-faint)', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }} />
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 12, borderTop: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 12 }}>
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
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Add notes about this session…"
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </label>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              onClick={onDelete}
              className="btn btn-ghost"
              style={{ padding: '6px 10px', fontSize: 11, color: 'var(--red)' }}
            >
              <Icon name="close" size={13} style={{ marginRight: 4 }} /> DELETE
            </button>
            {dirty && (
              <button
                onClick={() => saveNotes.mutate()}
                className="btn btn-primary"
                style={{ padding: '6px 12px', fontSize: 11 }}
                disabled={saveNotes.isPending}
              >
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="kicker">{label}</span>
      {children}
    </label>
  );
}

function Select({
  label, value, onChange, options,
}: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <Field label={label}>
      <select value={value} onChange={e => onChange(e.target.value)} style={inputStyle}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}

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
