/**
 * WorkoutLogger — log a workout session + view recent ones.
 *
 * Phase 5 ships a flexible-enough form: type, duration, intensity,
 * notes, and an optional dynamic list of {exercise, sets[]}. The
 * backend stores `exercises` as JSON so the UI can evolve without a
 * migration. XP is awarded automatically on POST.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Workout } from '../lib/api';
import { Icon } from './Icon';
import { ConfirmDialog } from './ConfirmDialog';

type WorkoutType = 'strength' | 'cardio' | 'mobility' | 'sport' | 'other';
type Intensity = 'low' | 'moderate' | 'high';

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

  const del = useMutation({
    mutationFn: (id: string) => api.del(`/api/workouts/${id}`),
    onSuccess: () => {
      setPendingDelete(null);
      // Deleting reverses the workout's XP server-side, so refresh the
      // HUD and today's quests too.
      qc.invalidateQueries({ queryKey: ['workouts', 'recent'] });
      qc.invalidateQueries({ queryKey: ['player'] });
      qc.invalidateQueries({ queryKey: ['quests', 'today'] });
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
    }),
    onSuccess: () => {
      setTitle(''); setNotes(''); setExercises([]);
      qc.invalidateQueries({ queryKey: ['workouts', 'recent'] });
      qc.invalidateQueries({ queryKey: ['player'] });
      qc.invalidateQueries({ queryKey: ['quests', 'today'] });
    },
  });

  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <Header />

      <form
        className="panel"
        style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}
        onSubmit={e => { e.preventDefault(); log.mutate(); }}
      >
        <div className="kicker">LOG A WORKOUT</div>

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
          </strong>{pendingDelete.xpAwarded ? <> and refunds its <strong style={{ color: 'var(--text)' }}>+{pendingDelete.xpAwarded} XP</strong></> : null}. This can&rsquo;t be undone.</>
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
    <div className="panel hud" style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
      <Icon name="spark" size={20} style={{ color: 'var(--cyan)' }} />
      <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, fontFamily: 'var(--font-display)' }}>Workouts</h2>
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
          + ADD
        </button>
      </div>
      {exercises.map((ex, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10, background: 'var(--bg-2)', borderRadius: 'var(--r-sm)', border: '1px solid var(--line)' }}>
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
        + SET
      </button>
    </div>
  );
}

function RecentList({ workouts, loading, onDelete }: { workouts: Workout[]; loading: boolean; onDelete: (w: Workout) => void }) {
  if (loading) {
    return <div className="panel hud" style={{ padding: 40, textAlign: 'center', color: 'var(--text-faint)' }}><div className="mono" style={{ fontSize: 13 }}>LOADING…</div></div>;
  }
  if (workouts.length === 0) {
    return <div className="panel hud" style={{ padding: 30, textAlign: 'center', color: 'var(--text-faint)' }}><div className="mono" style={{ fontSize: 13 }}>NO WORKOUTS LOGGED YET</div></div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="kicker" style={{ paddingLeft: 4 }}>RECENT</div>
      {workouts.map(w => {
        const when = new Date(w.performedAt);
        const dateStr = when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        const timeStr = when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        return (
          <div key={w.id} className="panel" style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 38, height: 38, flexShrink: 0,
              borderRadius: 8,
              background: 'linear-gradient(135deg, var(--cyan), var(--violet))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'white', fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.02em',
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
            <button
              onClick={() => onDelete(w)}
              className="btn btn-ghost"
              style={{ padding: '6px 8px', fontSize: 11 }}
              aria-label="Delete workout"
              title="Delete workout"
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        );
      })}
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

const inputStyle: React.CSSProperties = {
  padding: '8px 12px',
  background: 'var(--panel-2)',
  border: '1px solid var(--line-2)',
  borderRadius: 'var(--r-sm)',
  color: 'var(--text)',
  fontFamily: 'var(--font-mono)',
  fontSize: 13,
  outline: 'none',
};
