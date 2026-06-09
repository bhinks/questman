/**
 * RecurringList — renders habits OR chores (same data model, different
 * `kind`). Pure list + check-off + create-new. Streak + last-completed
 * shown inline so the user doesn't have to open a detail view.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Habit, Module } from '../lib/api';
import { Icon } from './Icon';
import { ConfirmDialog } from './ConfirmDialog';

interface Props {
  kind: 'habit' | 'chore';
}

export function RecurringList({ kind }: Props) {
  const qc = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState<Habit | null>(null);

  const habitsQ = useQuery({
    queryKey: ['habits', kind],
    queryFn: () => api.get<{ habits: Habit[] }>(`/api/habits?kind=${kind}`).then(r => r.habits),
  });

  // For the "new habit" form we need the matching module id.
  const modulesQ = useQuery({
    queryKey: ['modules'],
    queryFn: () => api.get<{ modules: Module[] }>('/api/modules').then(r => r.modules),
  });

  const check = useMutation({
    mutationFn: (id: string) => api.post(`/api/habits/${id}/check`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['habits', kind] });
      qc.invalidateQueries({ queryKey: ['player'] });
      qc.invalidateQueries({ queryKey: ['quests', 'today'] });
    },
  });

  const uncheck = useMutation({
    mutationFn: (id: string) => api.del(`/api/habits/${id}/check`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['habits', kind] });
      qc.invalidateQueries({ queryKey: ['player'] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/habits/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['habits', kind] });
      setPendingDelete(null);
    },
  });

  if (habitsQ.isLoading) return <Empty>LOADING…</Empty>;
  if (habitsQ.isError) return <Empty color="var(--red)">FAILED TO LOAD</Empty>;

  const habits = habitsQ.data ?? [];
  const moduleId = modulesQ.data?.find(m => m.key === (kind === 'chore' ? 'chores' : 'habits'))?.id;
  const dueToday = habits.filter(h => h.isDueToday);
  const notDue = habits.filter(h => !h.isDueToday);

  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <Header kind={kind} count={habits.length} dueCount={dueToday.length} />

      {moduleId && <NewHabitForm kind={kind} moduleId={moduleId} />}

      {dueToday.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <SectionLabel>DUE TODAY</SectionLabel>
          {dueToday.map(h => (
            <Row key={h.id} habit={h}
              onCheck={() => check.mutate(h.id)}
              onUncheck={() => uncheck.mutate(h.id)}
              onDelete={() => setPendingDelete(h)}
            />
          ))}
        </section>
      )}

      {notDue.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <SectionLabel>NOT DUE TODAY</SectionLabel>
          {notDue.map(h => (
            <Row key={h.id} habit={h}
              onCheck={() => check.mutate(h.id)}
              onUncheck={() => uncheck.mutate(h.id)}
              onDelete={() => setPendingDelete(h)}
            />
          ))}
        </section>
      )}

      {habits.length === 0 && (
        <Empty>
          No {kind === 'chore' ? 'chores' : 'habits'} yet — add one above.
        </Empty>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        danger
        title={`Delete ${kind}?`}
        message={pendingDelete && <>This permanently removes <strong style={{ color: 'var(--text)' }}>{pendingDelete.title}</strong> and its history. This can&rsquo;t be undone.</>}
        confirmLabel="DELETE"
        busy={remove.isPending}
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete.id)}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

function Header({ kind, count, dueCount }: { kind: 'habit' | 'chore'; count: number; dueCount: number }) {
  const label = kind === 'chore' ? 'Chores' : 'Habits';
  return (
    <div className="panel hud" style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
      <Icon name={kind === 'chore' ? 'list' : 'check'} size={20} style={{ color: 'var(--cyan)' }} />
      <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, fontFamily: 'var(--font-display)' }}>{label}</h2>
      <div
        className="mono"
        style={{
          marginLeft: 'auto', fontSize: 11, color: 'var(--text-dim)',
          padding: '4px 8px', background: 'var(--panel-2)',
          borderRadius: 6, border: '1px solid var(--line)',
        }}
      >
        {dueCount} DUE · {count} TOTAL
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="kicker" style={{ paddingLeft: 4 }}>{children}</div>;
}

function Row({
  habit, onCheck, onUncheck, onDelete,
}: { habit: Habit; onCheck: () => void; onUncheck: () => void; onDelete: () => void }) {
  const done = habit.isCompletedToday;
  return (
    <div
      className="panel"
      style={{
        padding: 14,
        border: done ? '1px solid var(--lime)' : '1px solid var(--line)',
        background: done
          ? 'linear-gradient(180deg, rgba(67,255,166,0.06), rgba(67,255,166,0.02))'
          : undefined,
        display: 'flex', alignItems: 'center', gap: 14,
      }}
    >
      <button
        onClick={done ? onUncheck : onCheck}
        aria-label={done ? `Uncheck ${habit.title}` : `Check ${habit.title}`}
        style={{
          width: 32, height: 32, flexShrink: 0,
          borderRadius: 8,
          border: done
            ? '1px solid var(--lime)'
            : '1px solid var(--line-bright)',
          background: done
            ? 'linear-gradient(135deg, var(--lime), var(--teal))'
            : 'var(--panel-2)',
          color: done ? 'white' : 'var(--text-dim)',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: done ? 'var(--glow-lime)' : 'none',
          transition: 'all 0.15s ease',
        }}
      >
        {done && <Icon name="check" size={16} />}
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14, fontWeight: 600,
          color: done ? 'var(--lime)' : 'var(--text)',
          textDecoration: done ? 'line-through' : 'none',
          textDecorationColor: 'rgba(67,255,166,0.5)',
        }}>
          {habit.title}
        </div>
        {habit.description && (
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
            {habit.description}
          </div>
        )}
      </div>

      {habit.weatherRule?.outdoor && (
        <div
          title="Weather-aware: only surfaces as a quest when conditions fit"
          style={{
            fontSize: 11, color: 'var(--cyan)',
            padding: '4px 8px',
            background: 'color-mix(in srgb, var(--cyan) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--cyan) 30%, transparent)',
            borderRadius: 6,
          }}
        >
          🌤
        </div>
      )}

      {habit.currentStreak > 0 && (
        <div
          className="mono"
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            fontSize: 12, color: 'var(--amber)',
            padding: '4px 8px',
            background: 'rgba(255,194,75,0.08)',
            border: '1px solid rgba(255,194,75,0.3)',
            borderRadius: 6,
          }}
        >
          <Icon name="flame" size={12} />
          {habit.currentStreak}
        </div>
      )}

      <div
        className="mono"
        style={{
          fontSize: 11, color: 'var(--text-faint)',
          minWidth: 40, textAlign: 'right',
        }}
      >
        +{habit.baseXp}
      </div>

      <button
        onClick={onDelete}
        className="btn btn-ghost"
        style={{ padding: '6px 8px', fontSize: 11 }}
        aria-label={`Delete ${habit.title}`}
        title="Delete"
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

/**
 * XP defaults per difficulty tier. These match QuestEngine's
 * XP_BY_DIFFICULTY so a generated quest off a habit has a sensible
 * reward without needing per-habit tuning.
 *
 * Auto-fill behavior: when the user changes difficulty, the XP field
 * jumps to the new tier IFF the current value is one of the known
 * defaults (i.e. the user hasn't typed a custom number). Once they
 * override, we stop touching it.
 */
const XP_DEFAULTS: Record<'easy' | 'medium' | 'hard', number> = {
  easy: 10,
  medium: 25,
  hard: 50,
};
const XP_DEFAULT_VALUES = new Set(Object.values(XP_DEFAULTS));

function NewHabitForm({ kind, moduleId }: { kind: 'habit' | 'chore'; moduleId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [baseXp, setBaseXp] = useState<number>(XP_DEFAULTS.easy);
  const [cadence, setCadence] = useState<'daily' | 'weekly' | 'custom' | 'once'>(
    kind === 'chore' ? 'weekly' : 'daily',
  );
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('easy');
  // daysOfWeek: 0=Sun .. 6=Sat (matches JS Date.getDay()). Used when
  // cadence is "weekly" or "custom". The backend stores schedule as
  // {daysOfWeek: number[]}.
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1]); // default Mon
  // Min days between completions (blank = no throttle).
  const [minIntervalDays, setMinIntervalDays] = useState<number | ''>('');
  // Outdoor (weather-aware) gating. Defaults are sensible for a typical
  // outdoor chore like mowing/washing the car.
  const [outdoor, setOutdoor] = useState(false);
  const [weather, setWeather] = useState({
    dryDaysRequired: 1,
    maxRainTodayIn: 0.1,
    minTempF: 40,
    maxTempF: 90,
    maxWindMph: 20,
  });

  const handleDifficulty = (next: 'easy' | 'medium' | 'hard') => {
    setDifficulty(next);
    // Only overwrite XP if the user hasn't typed a custom value.
    if (XP_DEFAULT_VALUES.has(baseXp)) {
      setBaseXp(XP_DEFAULTS[next]);
    }
  };

  const reset = () => {
    setTitle('');
    setBaseXp(XP_DEFAULTS.easy);
    setCadence(kind === 'chore' ? 'weekly' : 'daily');
    setDifficulty('easy');
    setDaysOfWeek([1]);
    setMinIntervalDays('');
    setOutdoor(false);
    setWeather({ dryDaysRequired: 1, maxRainTodayIn: 0.1, minTempF: 40, maxTempF: 90, maxWindMph: 20 });
  };

  const needsDayPicker = cadence === 'weekly' || cadence === 'custom';

  const create = useMutation({
    mutationFn: () => api.post('/api/habits', {
      moduleId, kind, title: title.trim(),
      baseXp, cadence, difficulty,
      // Schedule is only meaningful for weekly/custom. Send null
      // otherwise so the backend doesn't store stale day data.
      schedule: needsDayPicker
        ? { daysOfWeek: daysOfWeek.length > 0 ? daysOfWeek : [1] }
        : null,
      minIntervalDays: minIntervalDays === '' ? null : minIntervalDays,
      weatherRule: outdoor ? { outdoor: true, ...weather } : null,
    }),
    onSuccess: () => {
      reset();
      setOpen(false);
      qc.invalidateQueries({ queryKey: ['habits', kind] });
    },
  });

  if (!open) {
    return (
      <button
        className="btn"
        style={{ alignSelf: 'flex-start' }}
        onClick={() => setOpen(true)}
      >
        + NEW {kind.toUpperCase()}
      </button>
    );
  }

  return (
    <div className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <input
        autoFocus
        placeholder={`Title (e.g. ${kind === 'chore' ? 'Vacuum the living room' : 'Meditate 10 minutes'})`}
        value={title}
        onChange={e => setTitle(e.target.value)}
        style={inputStyle}
      />
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Select label="CADENCE" value={cadence} onChange={v => setCadence(v as any)}
          options={[
            { value: 'daily', label: 'Daily' },
            { value: 'weekly', label: 'Weekly' },
            { value: 'custom', label: 'Custom days' },
            { value: 'once', label: 'One-off' },
          ]}
        />
        <Select label="DIFFICULTY" value={difficulty} onChange={v => handleDifficulty(v as any)}
          options={[
            { value: 'easy', label: 'Easy' },
            { value: 'medium', label: 'Medium' },
            { value: 'hard', label: 'Hard' },
          ]}
        />
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="kicker">XP</span>
          <input
            type="number"
            min={1}
            max={500}
            value={baseXp}
            onChange={e => setBaseXp(Math.max(1, Math.min(500, Number(e.target.value))))}
            style={{ ...inputStyle, width: 80 }}
          />
        </label>
      </div>

      {needsDayPicker && (
        <DayOfWeekPicker
          value={daysOfWeek}
          onChange={setDaysOfWeek}
        />
      )}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="kicker">MIN DAYS BETWEEN</span>
          <input
            type="number"
            min={1}
            max={365}
            placeholder="—"
            value={minIntervalDays}
            onChange={e => setMinIntervalDays(e.target.value === '' ? '' : Math.max(1, Math.min(365, Number(e.target.value))))}
            style={{ ...inputStyle, width: 90 }}
          />
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', paddingBottom: 8 }}>
          <input
            type="checkbox"
            checked={outdoor}
            onChange={e => setOutdoor(e.target.checked)}
            style={{ accentColor: 'var(--cyan)', width: 16, height: 16 }}
          />
          <span style={{ fontSize: 13, color: 'var(--text)' }}>🌤 Outdoor (weather-aware)</span>
        </label>
      </div>

      {outdoor && (
        <WeatherFields value={weather} onChange={setWeather} />
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost" onClick={() => { setOpen(false); reset(); }}>CANCEL</button>
        <button
          className="btn btn-primary"
          disabled={!title.trim() || create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? 'CREATING…' : 'CREATE'}
        </button>
      </div>
    </div>
  );
}

/**
 * 7-button day-of-week toggle row. Values are 0-6 to match
 * JS Date.getDay() (Sunday = 0), which is also what isHabitDueToday()
 * on the backend uses for the daysOfWeek comparison.
 */
function DayOfWeekPicker({
  value, onChange,
}: { value: number[]; onChange: (next: number[]) => void }) {
  const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const selected = new Set(value);
  const toggle = (d: number) => {
    const next = new Set(selected);
    if (next.has(d)) next.delete(d);
    else next.add(d);
    onChange(Array.from(next).sort((a, b) => a - b));
  };
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="kicker">REPEATS ON</span>
      <div style={{ display: 'flex', gap: 6 }}>
        {DAYS.map((letter, d) => {
          const on = selected.has(d);
          return (
            <button
              key={d}
              type="button"
              onClick={() => toggle(d)}
              aria-pressed={on}
              aria-label={FULL[d]}
              title={FULL[d]}
              className="mono"
              style={{
                width: 34, height: 34,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 8,
                cursor: 'pointer',
                fontSize: 12, fontWeight: 700,
                border: on
                  ? '1px solid var(--cyan)'
                  : '1px solid var(--line-2)',
                background: on
                  ? 'linear-gradient(135deg, var(--cyan), var(--violet))'
                  : 'var(--panel-2)',
                color: on ? 'white' : 'var(--text-dim)',
                boxShadow: on ? 'var(--glow-cyan)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              {letter}
            </button>
          );
        })}
      </div>
    </label>
  );
}

/**
 * Compact threshold grid for an outdoor habit's weather rule. The
 * backend (WeatherService) gates the quest on these against Open-Meteo
 * and degrades to interval-only when no HUB_LAT/HUB_LON is configured.
 */
interface WeatherVals {
  dryDaysRequired: number;
  maxRainTodayIn: number;
  minTempF: number;
  maxTempF: number;
  maxWindMph: number;
}
function WeatherFields({
  value, onChange,
}: { value: WeatherVals; onChange: (v: WeatherVals) => void }) {
  const set = (k: keyof WeatherVals, v: number) => onChange({ ...value, [k]: v });
  const fields: { key: keyof WeatherVals; label: string; min: number; max: number; step: number }[] = [
    { key: 'dryDaysRequired', label: 'DRY DAYS', min: 0, max: 14, step: 1 },
    { key: 'maxRainTodayIn', label: 'MAX RAIN (IN)', min: 0, max: 4, step: 0.05 },
    { key: 'minTempF', label: 'MIN °F', min: -40, max: 140, step: 1 },
    { key: 'maxTempF', label: 'MAX °F', min: -40, max: 140, step: 1 },
    { key: 'maxWindMph', label: 'MAX WIND (MPH)', min: 0, max: 120, step: 1 },
  ];
  return (
    <div className="panel-inset" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span className="kicker">WEATHER WINDOW — only surface this quest when…</span>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {fields.map(f => (
          <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="kicker" style={{ fontSize: 9 }}>{f.label}</span>
            <input
              type="number"
              min={f.min}
              max={f.max}
              step={f.step}
              value={value[f.key]}
              onChange={e => set(f.key, Math.max(f.min, Math.min(f.max, Number(e.target.value))))}
              style={{ ...inputStyle, width: 76 }}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function Select({
  label, value, onChange, options,
}: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="kicker">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={inputStyle}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function Empty({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div className="panel hud" style={{
      padding: 40, textAlign: 'center',
      color: color ?? 'var(--text-faint)',
    }}>
      <div className="mono" style={{ fontSize: 13 }}>{children}</div>
    </div>
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
