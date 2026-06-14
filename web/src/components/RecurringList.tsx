/**
 * RecurringList — renders habits OR chores (same data model, different
 * `kind`). Pure list + check-off + create-new. Streak + last-completed
 * shown inline so the user doesn't have to open a detail view.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Habit, Module } from '../lib/api';
import { useFocusTotals, fmtFocusMin } from '../lib/useFocusTotals';
import { Icon } from './Icon';
import { ConfirmDialog } from './ConfirmDialog';

interface Props {
  kind: 'habit' | 'chore';
}

export function RecurringList({ kind }: Props) {
  const qc = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState<Habit | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const habitsQ = useQuery({
    queryKey: ['habits', kind],
    queryFn: () => api.get<{ habits: Habit[] }>(`/api/habits?kind=${kind}`).then(r => r.habits),
  });
  // Actual minutes jacked in against each row (focus-timer rollup; the
  // summary stores the row's real kind, so query both and join on id).
  const focusTotals = useFocusTotals(['habit', 'chore']);

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

  // A row in edit mode swaps to the inline form; otherwise the normal Row.
  const renderRow = (h: Habit) =>
    editingId === h.id
      ? <HabitForm key={h.id} kind={kind} moduleId={h.moduleId} habit={h} onClose={() => setEditingId(null)} />
      : <Row key={h.id} habit={h}
          focusMin={focusTotals.get(h.id) ?? 0}
          onCheck={() => check.mutate(h.id)}
          onUncheck={() => uncheck.mutate(h.id)}
          onEdit={() => setEditingId(h.id)}
          onDelete={() => setPendingDelete(h)}
        />;

  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <Header kind={kind} count={habits.length} dueCount={dueToday.length} />

      {moduleId && (creating
        ? <HabitForm kind={kind} moduleId={moduleId} onClose={() => setCreating(false)} />
        : (
          <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setCreating(true)}>
            <Icon name="plus" size={13} /> NEW {kind.toUpperCase()}
          </button>
        )
      )}

      {dueToday.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <SectionLabel>DUE TODAY</SectionLabel>
          {dueToday.map(renderRow)}
        </section>
      )}

      {notDue.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <SectionLabel>NOT DUE TODAY</SectionLabel>
          {notDue.map(renderRow)}
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
  const label = kind === 'chore' ? 'CHORES' : 'HABITS';
  return (
    <div className="panel hud" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
      <div className="ncx-chip" style={{ color: 'var(--cyan)' }}>
        <Icon name={kind === 'chore' ? 'list' : 'check'} size={18} />
      </div>
      <div>
        <h2 className="ncx-glitch ncx-chroma" style={{ fontSize: 20, fontWeight: 700, margin: 0, fontFamily: 'var(--font-display)', letterSpacing: '0.02em' }}>{label}</h2>
        <div className="mono" style={{ fontSize: 10, letterSpacing: '0.24em', color: 'var(--text-faint)', marginTop: 3, textTransform: 'uppercase' }}>
          {kind === 'chore' ? 'MAINTENANCE ROTATION' : 'DAILY PROTOCOLS'}
        </div>
      </div>
      <span className="mono" style={{ marginLeft: 'auto', fontSize: 10.5, letterSpacing: '0.12em', color: 'var(--text-dim)' }}>
        {dueCount} DUE · {count} TOTAL
      </span>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mono" style={{ fontSize: 10, letterSpacing: '0.26em', color: 'var(--text-dim)', textTransform: 'uppercase', paddingLeft: 4 }}>
      {children}
    </div>
  );
}

function Row({
  habit, focusMin, onCheck, onUncheck, onEdit, onDelete,
}: { habit: Habit; focusMin: number; onCheck: () => void; onUncheck: () => void; onEdit: () => void; onDelete: () => void }) {
  const done = habit.isCompletedToday;
  return (
    <div
      className="panel"
      style={{
        padding: 14,
        borderColor: done ? 'var(--lime)' : undefined,
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
          clipPath: 'polygon(7px 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 7px)',
          border: done
            ? '1px solid var(--lime)'
            : '1px solid var(--line-bright)',
          background: done
            ? 'linear-gradient(135deg, var(--lime), var(--teal))'
            : 'var(--panel-2)',
          color: done ? '#03161c' : 'var(--text-dim)',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background .15s, border-color .15s, color .15s',
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
            display: 'flex', alignItems: 'center',
            fontSize: 11, color: 'var(--cyan)',
            padding: '4px 8px',
            background: 'rgba(var(--accent-rgb),0.08)',
            border: '1px solid rgba(var(--accent-rgb),0.3)',
          }}
        >
          <Icon name="eye" size={12} />
        </div>
      )}

      {habit.estMinutes != null && (
        <div
          className="mono"
          title="Estimated time to complete"
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            fontSize: 11, color: 'var(--violet)',
            padding: '4px 8px',
            background: 'color-mix(in srgb, var(--violet) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--violet) 30%, transparent)',
          }}
        >
          <Icon name="clock" size={12} /> {habit.estMinutes}m
        </div>
      )}

      {focusMin > 0 && (
        <div
          className="mono"
          title={`${focusMin} minutes of logged focus time`}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            fontSize: 11, color: 'var(--teal)',
            padding: '4px 8px',
            background: 'color-mix(in srgb, var(--teal) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--teal) 30%, transparent)',
          }}
        >
          <Icon name="zap" size={12} /> {fmtFocusMin(focusMin)}
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
          }}
        >
          <Icon name="flame" size={12} />
          {habit.currentStreak}
        </div>
      )}

      <div
        className="mono"
        style={{
          fontSize: 11, color: 'var(--lime)',
          minWidth: 40, textAlign: 'right',
        }}
      >
        +{habit.baseXp}
      </div>

      <button
        onClick={onEdit}
        className="btn btn-ghost"
        style={{ padding: '6px 8px', fontSize: 11 }}
        aria-label={`Edit ${habit.title}`}
        title="Edit"
      >
        <Icon name="edit" size={14} />
      </button>

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

/**
 * Create/edit form for a habit or chore. When `habit` is passed it runs
 * in edit mode (prefilled, PUT, "SAVE"); otherwise create mode (POST,
 * "CREATE"). One component so create and edit stay at exact parity —
 * cadence + day picker, difficulty→XP auto-fill, est-minutes, interval
 * throttle, and weather gating are all available in both.
 */
export function HabitForm({
  kind, moduleId, habit, onClose,
}: { kind: 'habit' | 'chore'; moduleId: string; habit?: Habit; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = !!habit;

  const [title, setTitle] = useState(habit?.title ?? '');
  const [baseXp, setBaseXp] = useState<number>(habit?.baseXp ?? XP_DEFAULTS.easy);
  const [cadence, setCadence] = useState<'daily' | 'weekly' | 'custom' | 'once'>(
    habit?.cadence ?? (kind === 'chore' ? 'weekly' : 'daily'),
  );
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>(habit?.difficulty ?? 'easy');
  // daysOfWeek: 0=Sun .. 6=Sat (matches JS Date.getDay()). Used when
  // cadence is "weekly" or "custom". The backend stores schedule as
  // {daysOfWeek: number[]}.
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(
    (habit?.schedule as { daysOfWeek?: number[] } | null)?.daysOfWeek ?? [1],
  );
  // Estimated time-to-complete (blank = unknown). Feeds the day planner.
  const [estMinutes, setEstMinutes] = useState<number | ''>(habit?.estMinutes ?? '');
  // Min days between completions (blank = no throttle).
  const [minIntervalDays, setMinIntervalDays] = useState<number | ''>(habit?.minIntervalDays ?? '');
  // Outdoor (weather-aware) gating.
  const [outdoor, setOutdoor] = useState(!!habit?.weatherRule?.outdoor);
  const [weather, setWeather] = useState({
    dryDaysRequired: habit?.weatherRule?.dryDaysRequired ?? 1,
    maxRainTodayIn: habit?.weatherRule?.maxRainTodayIn ?? 0.1,
    minTempF: habit?.weatherRule?.minTempF ?? 40,
    maxTempF: habit?.weatherRule?.maxTempF ?? 90,
    maxWindMph: habit?.weatherRule?.maxWindMph ?? 20,
  });

  const handleDifficulty = (next: 'easy' | 'medium' | 'hard') => {
    setDifficulty(next);
    // Only overwrite XP if the user hasn't typed a custom value.
    if (XP_DEFAULT_VALUES.has(baseXp)) {
      setBaseXp(XP_DEFAULTS[next]);
    }
  };

  const needsDayPicker = cadence === 'weekly' || cadence === 'custom';

  const buildPayload = () => ({
    moduleId, kind, title: title.trim(),
    baseXp, cadence, difficulty,
    estMinutes: estMinutes === '' ? null : estMinutes,
    // Schedule is only meaningful for weekly/custom. Send null otherwise
    // so the backend doesn't store stale day data.
    schedule: needsDayPicker
      ? { daysOfWeek: daysOfWeek.length > 0 ? daysOfWeek : [1] }
      : null,
    minIntervalDays: minIntervalDays === '' ? null : minIntervalDays,
    weatherRule: outdoor ? { outdoor: true, ...weather } : null,
  });

  const save = useMutation({
    mutationFn: () => isEdit
      ? api.put(`/api/habits/${habit!.id}`, buildPayload())
      : api.post('/api/habits', buildPayload()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['habits', kind] });
      onClose();
    },
  });

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
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="kicker">EST. MINUTES</span>
          <input
            type="number"
            min={1}
            max={1440}
            placeholder="—"
            value={estMinutes}
            onChange={e => setEstMinutes(e.target.value === '' ? '' : Math.max(1, Math.min(1440, Number(e.target.value))))}
            style={{ ...inputStyle, width: 100 }}
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
          <Icon name="eye" size={14} style={{ color: 'var(--cyan)' }} />
          <span style={{ fontSize: 13, color: 'var(--text)' }}>Outdoor (weather-aware)</span>
        </label>
      </div>

      {outdoor && (
        <WeatherFields value={weather} onChange={setWeather} />
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost" onClick={onClose}>CANCEL</button>
        <button
          className="btn btn-primary"
          disabled={!title.trim() || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? (isEdit ? 'SAVING…' : 'CREATING…') : (isEdit ? 'SAVE' : 'CREATE')}
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
                clipPath: 'polygon(7px 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 7px)',
                cursor: 'pointer',
                fontSize: 12, fontWeight: 700,
                border: on
                  ? '1px solid var(--cyan)'
                  : '1px solid var(--line-2)',
                background: on
                  ? 'linear-gradient(135deg, var(--cyan), var(--violet))'
                  : 'var(--panel-2)',
                color: on ? '#03161c' : 'var(--text-dim)',
                transition: 'background .15s, border-color .15s, color .15s',
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
