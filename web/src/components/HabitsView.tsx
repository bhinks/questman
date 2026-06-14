/**
 * HabitsView — the consolidated HABITS page (design handoff: merges the
 * old Habits list + Anti-Goals/ICE view into one screen).
 *
 *   DAEMONS = healthy recurring habits ("background processes running *for*
 *     you"): round check-off, cadence badge, streak, due-today highlight,
 *     +XP. Full schedule model preserved — add/edit reuse RecurringList's
 *     HabitForm (cadence, day-picker, difficulty→XP, est-minutes, interval
 *     throttle, weather gating) so habit definition stays at full parity.
 *   ICE = anti-goals / bad-habit countermeasures ("you run *against*
 *     intrusions"): secure by default, log only a BREACH on a slip (resets
 *     the clean streak); risk stamp; archive (OFFLINE) / decommission.
 *
 * Two independent data models shown together (no schema change): habits
 * (/api/habits?kind=habit) and antigoals (/api/antigoals). Mutations and
 * cache invalidations mirror the two source components verbatim.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Habit, AntiGoal, Module } from '../lib/api';
import { useFocusTotals, fmtFocusMin } from '../lib/useFocusTotals';
import { Icon } from './Icon';
import { ConfirmDialog } from './ConfirmDialog';
import { HabitForm } from './RecurringList';

const CADENCE_LABEL: Record<Habit['cadence'], string> = {
  daily: 'DAILY', weekly: 'WEEKLY', custom: 'CUSTOM', once: 'ONCE',
};
const RISK_LABEL: Record<AntiGoal['difficulty'], string> = {
  easy: 'LOW', medium: 'MED', hard: 'HIGH',
};

/* ---------- DAEMON card (a healthy habit) ---------- */
function DaemonCard({
  habit, focusMin, onCheck, onUncheck, onEdit, onDelete,
}: {
  habit: Habit; focusMin: number;
  onCheck: () => void; onUncheck: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const due = habit.isDueToday;
  const done = habit.isCompletedToday;
  return (
    <div className="panel" style={{
      padding: 13, display: 'flex', alignItems: 'center', gap: 12,
      border: done
        ? '1px solid color-mix(in srgb, var(--lime) 40%, transparent)'
        : due ? '1px solid var(--line-bright)' : '1px solid var(--line)',
      background: done ? 'linear-gradient(180deg, rgba(67,255,166,0.05), transparent)' : undefined,
    }}>
      <button
        onClick={done ? onUncheck : onCheck}
        aria-label={done ? `Uncheck ${habit.title}` : `Check ${habit.title}`}
        style={{
          width: 28, height: 28, flex: 'none', borderRadius: '50%', cursor: 'pointer',
          border: done ? '1px solid var(--lime)' : '1px solid var(--line-bright)',
          background: done ? 'linear-gradient(135deg, var(--lime), var(--teal))' : 'var(--panel-2)',
          color: done ? '#03161c' : 'var(--text-dim)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background .15s, border-color .15s, color .15s',
        }}
      >
        {done && <Icon name="check" size={15} />}
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13.5, fontWeight: 600,
          color: done ? 'var(--lime)' : 'var(--text)',
          textDecoration: done ? 'line-through' : 'none',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {habit.title}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
          <span className="mono" style={{
            fontSize: 9, letterSpacing: '0.1em', color: 'var(--cyan)',
            display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 6px',
            border: '1px solid color-mix(in srgb, var(--cyan) 35%, transparent)',
            background: 'color-mix(in srgb, var(--cyan) 8%, transparent)',
          }}>
            <Icon name="repeat" size={9} /> {CADENCE_LABEL[habit.cadence]}
          </span>
          {habit.currentStreak > 0 && (
            <span className="mono" style={{ fontSize: 9.5, color: 'var(--amber)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <Icon name="flame" size={10} />{habit.currentStreak}
            </span>
          )}
          {habit.estMinutes != null && (
            <span className="mono" style={{ fontSize: 9.5, color: 'var(--violet)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <Icon name="clock" size={10} />{habit.estMinutes}m
            </span>
          )}
          {focusMin > 0 && (
            <span className="mono" title={`${focusMin} minutes of logged focus time`} style={{ fontSize: 9.5, color: 'var(--teal)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <Icon name="zap" size={10} />{fmtFocusMin(focusMin)}
            </span>
          )}
          {habit.weatherRule?.outdoor && (
            <span title="Weather-aware: only surfaces as a quest when conditions fit" style={{ display: 'inline-flex' }}>
              <Icon name="eye" size={11} style={{ color: 'var(--cyan)' }} />
            </span>
          )}
          {due && !done && (
            <span className="mono" style={{ fontSize: 9, letterSpacing: '0.12em', color: 'var(--lime)' }}>DUE TODAY</span>
          )}
        </div>
      </div>

      <span className="mono" style={{ fontSize: 11, color: 'var(--lime)', flex: 'none' }}>+{habit.baseXp}</span>
      <button onClick={onEdit} className="btn btn-ghost" style={{ padding: '5px 6px', flex: 'none' }} aria-label={`Edit ${habit.title}`} title="Edit"><Icon name="edit" size={12} /></button>
      <button onClick={onDelete} className="btn btn-ghost" style={{ padding: '5px 6px', flex: 'none' }} aria-label={`Delete ${habit.title}`} title="Kill daemon"><Icon name="close" size={12} /></button>
    </div>
  );
}

/* ---------- ICE card (an anti-goal) ---------- */
function IceCard({
  ag, onBreach, onArchive, onDelete,
}: {
  ag: AntiGoal;
  onBreach: () => void; onArchive: () => void; onDelete: () => void;
}) {
  const breached = ag.breachedToday;
  const accent = breached ? 'var(--red)' : (ag.color || 'var(--cyan)');
  return (
    <div className="panel" style={{
      padding: 13, display: 'flex', alignItems: 'center', gap: 12, opacity: ag.isActive ? 1 : 0.55,
      border: breached
        ? '1px solid color-mix(in srgb, var(--red) 55%, transparent)'
        : '1px solid var(--line)',
      background: breached
        ? 'linear-gradient(180deg, color-mix(in srgb, var(--red) 9%, transparent), transparent)'
        : undefined,
      boxShadow: breached ? 'inset 0 0 30px color-mix(in srgb, var(--red) 8%, transparent)' : undefined,
    }}>
      <div className="ncx-chip" style={{
        width: 34, height: 34, flex: 'none', color: accent,
        background: `color-mix(in srgb, ${accent} 10%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${accent} 35%, transparent)`,
      }}>
        <Icon name={ag.icon || (breached ? 'lock' : 'shield')} size={17} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ag.title}</span>
          <span className={`ncx-stamp flat ${ag.difficulty}`} title="Stakes" style={{ fontSize: 8.5, padding: '2px 6px', flex: 'none' }}>{RISK_LABEL[ag.difficulty]} RISK</span>
        </div>
        <div style={{ marginTop: 3 }}>
          {breached ? (
            <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--red)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Icon name="bolt" size={11} /> BREACHED — defenses down
            </span>
          ) : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--cyan)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Icon name="shield" size={10} />SECURE
              </span>
              {ag.currentStreak > 0 && (
                <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-dim)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <Icon name="flame" size={10} style={{ color: 'var(--amber)' }} />{ag.currentStreak}d clean
                </span>
              )}
              {ag.longestStreak > ag.currentStreak && ag.longestStreak > 0 && (
                <span className="mono" style={{ fontSize: 9.5, color: 'var(--text-faint)' }}>· best {ag.longestStreak}</span>
              )}
            </span>
          )}
        </div>
      </div>

      {ag.isActive && (
        <button onClick={onBreach} disabled={breached} className="ncx-btn danger" title={breached ? 'Already breached today' : 'Log a slip for today'} style={{ padding: '6px 12px', fontSize: 10.5, fontWeight: 700, flex: 'none', color: breached ? 'var(--text-faint)' : undefined }}>
          <Icon name="bolt" size={12} /> {breached ? 'BREACHED' : 'BREACH'}
        </button>
      )}
      <button onClick={onArchive} className="btn btn-ghost" style={{ padding: '5px 7px', flex: 'none', color: 'var(--text-faint)' }} title={ag.isActive ? 'Take offline' : 'Bring online'}>
        {ag.isActive ? <Icon name="moon" size={12} /> : <Icon name="repeat" size={12} />}
      </button>
      <button onClick={onDelete} className="btn btn-ghost" style={{ padding: '5px 6px', flex: 'none' }} aria-label={`Decommission ${ag.title}`} title="Decommission"><Icon name="close" size={12} /></button>
    </div>
  );
}

/* ---------- ICE install form (title + risk) ---------- */
function IceAddForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [difficulty, setDifficulty] = useState<AntiGoal['difficulty']>('medium');

  const create = useMutation({
    mutationFn: () => api.post('/api/antigoals', { title: title.trim(), difficulty }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['antigoals'] });
      onClose();
    },
  });

  return (
    <div className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 220 }}>
          <span className="kicker">DEFEND AGAINST</span>
          <input
            autoFocus
            className="ncx-input"
            placeholder="e.g. No doomscrolling after midnight"
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && title.trim() && !create.isPending) create.mutate(); }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="kicker">RISK</span>
          <select className="ncx-input" value={difficulty} onChange={e => setDifficulty(e.target.value as AntiGoal['difficulty'])}>
            <option value="easy">Low</option>
            <option value="medium">Medium</option>
            <option value="hard">High</option>
          </select>
        </label>
      </div>
      <div className="mono" style={{ fontSize: 11, color: 'var(--text-faint)' }}>
        Days are clean by default — you only log a breach when you slip.
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost" onClick={onClose}>CANCEL</button>
        <button className="btn btn-primary" disabled={!title.trim() || create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? 'INSTALLING…' : 'INSTALL ICE'}
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: React.ReactNode; color: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span className="ncx-serial">{label}</span>
      <span className="ncx-val" style={{ fontSize: 18, color }}>{value}</span>
    </div>
  );
}

function SectionHead({ icon, color, title, sub, count }: { icon: string; color: string; title: string; sub: string; count?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div className="ncx-chip" style={{ width: 30, height: 30, color }}><Icon name={icon} size={15} style={{ color }} /></div>
      <span className="mono" style={{ fontSize: 12, letterSpacing: '0.22em', textTransform: 'uppercase', color }}>{title}</span>
      <span className="ncx-serial">{sub}</span>
      {count != null && <span className="ncx-serial" style={{ marginLeft: 'auto' }}>{count}</span>}
    </div>
  );
}

const GRID: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 12, alignItems: 'start' };

function Empty({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div className="panel hud" style={{ padding: 40, textAlign: 'center', color: color ?? 'var(--text-faint)' }}>
      <div className="mono" style={{ fontSize: 13 }}>{children}</div>
    </div>
  );
}

/* ---------- the page ---------- */
export function HabitsView() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [addType, setAddType] = useState<'daemon' | 'ice'>('daemon');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDeleteHabit, setPendingDeleteHabit] = useState<Habit | null>(null);
  const [pendingBreach, setPendingBreach] = useState<AntiGoal | null>(null);
  const [pendingDeleteIce, setPendingDeleteIce] = useState<AntiGoal | null>(null);

  const habitsQ = useQuery({
    queryKey: ['habits', 'habit'],
    queryFn: () => api.get<{ habits: Habit[] }>('/api/habits?kind=habit').then(r => r.habits),
  });
  const iceQ = useQuery({
    queryKey: ['antigoals'],
    queryFn: () => api.get<{ antigoals: AntiGoal[] }>('/api/antigoals').then(r => r.antigoals),
  });
  const modulesQ = useQuery({
    queryKey: ['modules'],
    queryFn: () => api.get<{ modules: Module[] }>('/api/modules').then(r => r.modules),
  });
  // Actual logged minutes per row (focus-timer rollup; summary keeps the
  // real kind, so query both habit + chore and join on id).
  const focusTotals = useFocusTotals(['habit', 'chore']);

  const check = useMutation({
    mutationFn: (id: string) => api.post(`/api/habits/${id}/check`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['habits', 'habit'] });
      qc.invalidateQueries({ queryKey: ['player'] });
      qc.invalidateQueries({ queryKey: ['quests', 'today'] });
    },
  });
  const uncheck = useMutation({
    mutationFn: (id: string) => api.del(`/api/habits/${id}/check`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['habits', 'habit'] });
      qc.invalidateQueries({ queryKey: ['player'] });
    },
  });
  const removeHabit = useMutation({
    mutationFn: (id: string) => api.del(`/api/habits/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['habits', 'habit'] });
      setPendingDeleteHabit(null);
    },
  });

  const invalidateIce = () => qc.invalidateQueries({ queryKey: ['antigoals'] });
  const breach = useMutation({
    mutationFn: (id: string) => api.post(`/api/antigoals/${id}/breach`, {}),
    onSuccess: () => {
      invalidateIce();
      qc.invalidateQueries({ queryKey: ['player'] });
      setPendingBreach(null);
    },
  });
  const toggleActive = useMutation({
    mutationFn: (vars: { id: string; isActive: boolean }) => api.put(`/api/antigoals/${vars.id}`, { isActive: vars.isActive }),
    onSuccess: invalidateIce,
  });
  const removeIce = useMutation({
    mutationFn: (id: string) => api.del(`/api/antigoals/${id}`),
    onSuccess: () => { invalidateIce(); setPendingDeleteIce(null); },
  });

  if (habitsQ.isLoading || iceQ.isLoading) return <Empty>BOOTING…</Empty>;
  if (habitsQ.isError || iceQ.isError) return <Empty color="var(--red)">FAILED TO LOAD</Empty>;

  const habits = habitsQ.data ?? [];
  const ice = iceQ.data ?? [];
  const moduleId = modulesQ.data?.find(m => m.key === 'habits')?.id;

  const dueCount = habits.filter(h => h.isDueToday && !h.isCompletedToday).length;
  const bestStreak = Math.max(0, ...habits.map(h => h.currentStreak));
  const activeIce = ice.filter(a => a.isActive);
  const archivedIce = ice.filter(a => !a.isActive);
  const breaches = activeIce.filter(a => a.breachedToday).length;
  const secure = activeIce.length - breaches;

  const renderDaemon = (h: Habit) =>
    editingId === h.id
      ? (
        <div key={h.id} style={{ gridColumn: '1 / -1' }}>
          <HabitForm kind="habit" moduleId={h.moduleId} habit={h} onClose={() => setEditingId(null)} />
        </div>
      )
      : (
        <DaemonCard
          key={h.id}
          habit={h}
          focusMin={focusTotals.get(h.id) ?? 0}
          onCheck={() => check.mutate(h.id)}
          onUncheck={() => uncheck.mutate(h.id)}
          onEdit={() => setEditingId(h.id)}
          onDelete={() => setPendingDeleteHabit(h)}
        />
      );

  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* command bar + stat strip */}
      <div style={{ display: 'flex', gap: 14, alignItems: 'stretch', flexWrap: 'wrap' }}>
        <div className="panel hud" style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 14, flex: '1 1 300px', minWidth: 0 }}>
          <div className="ncx-chip" style={{ color: 'var(--cyan)' }}><Icon name="check" size={18} /></div>
          <div style={{ minWidth: 0 }}>
            <h2 className="ncx-glitch ncx-chroma" style={{ fontSize: 20, fontWeight: 700, margin: 0, fontFamily: 'var(--font-display)', letterSpacing: '0.02em', textTransform: 'uppercase' }}>Habits</h2>
            <div className="mono" style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--text-faint)', marginTop: 3 }}>DAEMONS RUN FOR YOU · ICE GUARDS AGAINST YOU</div>
          </div>
        </div>
        <div className="panel" style={{ padding: '12px 18px', display: 'flex', gap: 22, alignItems: 'center', flexWrap: 'wrap', flex: '2 1 440px', minWidth: 0 }}>
          <Stat label="DAEMONS DUE" value={dueCount} color="var(--lime)" />
          <Stat label="BEST STREAK" value={`${bestStreak}d`} color="var(--amber)" />
          <span style={{ width: 1, height: 28, background: 'var(--line-2)' }} />
          <Stat label="ICE SECURE" value={secure} color="var(--cyan)" />
          <Stat label="BREACHED" value={breaches} color={breaches ? 'var(--red)' : 'var(--text-dim)'} />
          <button
            className={adding ? 'btn btn-ghost' : 'btn btn-primary'}
            style={{ marginLeft: 'auto', padding: '8px 15px', fontSize: 11 }}
            onClick={() => setAdding(a => !a)}
          >
            <Icon name={adding ? 'close' : 'plus'} size={13} /> {adding ? 'CLOSE' : 'NEW'}
          </button>
        </div>
      </div>

      {/* add: daemon (full HabitForm) or ICE */}
      {adding && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', boxShadow: 'inset 0 0 0 1px var(--line-2)', alignSelf: 'flex-start' }}>
            {([['daemon', 'DAEMON · HEALTHY HABIT'], ['ice', 'ICE · DEFEND AGAINST']] as const).map(([k, label]) => {
              const on = addType === k;
              const c = k === 'daemon' ? 'var(--lime)' : 'var(--red)';
              return (
                <button
                  key={k}
                  onClick={() => setAddType(k)}
                  className="mono"
                  style={{
                    padding: '7px 12px', fontSize: 10, border: 'none', cursor: 'pointer',
                    background: on ? `color-mix(in srgb, ${c} 16%, transparent)` : 'transparent',
                    color: on ? c : 'var(--text-dim)', fontWeight: on ? 700 : 500,
                    boxShadow: on ? `inset 0 0 0 1px ${c}` : 'none',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {addType === 'daemon'
            ? (moduleId
              ? <HabitForm kind="habit" moduleId={moduleId} onClose={() => setAdding(false)} />
              : <Empty>HABITS MODULE UNAVAILABLE</Empty>)
            : <IceAddForm onClose={() => setAdding(false)} />}
        </div>
      )}

      {/* DAEMONS */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <SectionHead icon="spark" color="var(--lime)" title="Daemons" sub="healthy habits running in the background" count={`${dueCount} DUE`} />
        {habits.length > 0
          ? <div style={GRID}>{habits.map(renderDaemon)}</div>
          : <Empty>No daemons yet — install one above.</Empty>}
      </section>

      {/* ICE */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <SectionHead icon="shield" color={breaches ? 'var(--red)' : 'var(--cyan)'} title="ICE" sub="countermeasures · log only slips" count={breaches ? `${breaches} BREACHED` : `${secure} SECURE`} />
        {ice.length === 0 && <Empty>No ICE installed. Name something to defend against above.</Empty>}
        {activeIce.length > 0 && (
          <div style={GRID}>
            {activeIce.map(a => (
              <IceCard
                key={a.id}
                ag={a}
                onBreach={() => setPendingBreach(a)}
                onArchive={() => toggleActive.mutate({ id: a.id, isActive: false })}
                onDelete={() => setPendingDeleteIce(a)}
              />
            ))}
          </div>
        )}
        {archivedIce.length > 0 && (
          <>
            <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.26em', textTransform: 'uppercase', color: 'var(--text-faint)', marginTop: 4 }}>OFFLINE · {archivedIce.length}</span>
            <div style={GRID}>
              {archivedIce.map(a => (
                <IceCard
                  key={a.id}
                  ag={a}
                  onBreach={() => {}}
                  onArchive={() => toggleActive.mutate({ id: a.id, isActive: true })}
                  onDelete={() => setPendingDeleteIce(a)}
                />
              ))}
            </div>
          </>
        )}
      </section>

      {/* confirms — destructive actions stay guarded (parity with sources) */}
      <ConfirmDialog
        open={pendingDeleteHabit !== null}
        danger
        title="Delete habit?"
        message={pendingDeleteHabit && <>This permanently removes <strong style={{ color: 'var(--text)' }}>{pendingDeleteHabit.title}</strong> and its history. This can&rsquo;t be undone.</>}
        confirmLabel="DELETE"
        busy={removeHabit.isPending}
        onConfirm={() => pendingDeleteHabit && removeHabit.mutate(pendingDeleteHabit.id)}
        onCancel={() => setPendingDeleteHabit(null)}
      />
      <ConfirmDialog
        open={pendingBreach !== null}
        danger
        title="Log a breach?"
        message={pendingBreach && <>Record a slip on <strong style={{ color: 'var(--text)' }}>{pendingBreach.title}</strong> for today. Your avoidance streak resets to zero — tomorrow is a clean start.</>}
        confirmLabel="CONFIRM BREACH"
        busy={breach.isPending}
        onConfirm={() => pendingBreach && breach.mutate(pendingBreach.id)}
        onCancel={() => setPendingBreach(null)}
      />
      <ConfirmDialog
        open={pendingDeleteIce !== null}
        danger
        title="Decommission ICE?"
        message={pendingDeleteIce && <>This permanently removes <strong style={{ color: 'var(--text)' }}>{pendingDeleteIce.title}</strong> and its breach log. Your record stays banked.</>}
        confirmLabel="DECOMMISSION"
        busy={removeIce.isPending}
        onConfirm={() => pendingDeleteIce && removeIce.mutate(pendingDeleteIce.id)}
        onCancel={() => setPendingDeleteIce(null)}
      />
    </div>
  );
}
