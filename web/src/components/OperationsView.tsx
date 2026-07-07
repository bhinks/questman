/**
 * OperationsView — consolidated **Projects + Chores** ("Operations").
 *
 * One page: project cards show OBJECTIVES (one-off tasks, incl. the
 * sequenced step-track), an attached recurring ROTATION (chores with
 * projectId === project.id), and MILESTONES. Loose chores (projectId null)
 * live in an UNCATEGORIZED bucket with a Move dropdown to file them into a
 * project. Recurring chores (round check + ↻ cadence + streak) are visually
 * distinct from one-off tasks (square check) — a one-off task is just a chore
 * with cadence "once".
 *
 * Inline suggestion (v1): a "rotation slipping" stale nudge, derived from the
 * chore's cadence + lastCompletedOn. (Keyword/convert suggestions deferred.)
 *
 * NEW opens a typed editor: PROJECT, RECURRING CHORE (the real HabitForm),
 * or ONE-OFF TASK. Both can be filed into a project at creation (optional
 * PROJECT select; default Uncategorized), and each project card's rotation
 * has its own ADD CHORE that pre-files into that project.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Project, ProjectTask, Milestone, Habit, Module } from '../lib/api';
import { Icon } from './Icon';
import { ConfirmDialog } from './ConfirmDialog';
import { AccentPicker } from './AccentPicker';
import { HabitForm } from './RecurringList';

const STATUS_META: Record<Project['status'], { label: string; color: string }> = {
  active:   { label: 'ACTIVE',   color: 'var(--lime)' },
  paused:   { label: 'PAUSED',   color: 'var(--amber)' },
  done:     { label: 'CLEARED',  color: 'var(--cyan)' },
  archived: { label: 'ARCHIVED', color: 'var(--text-faint)' },
};

/* ---------- chore helpers ---------- */
// Nominal cadence interval in days (the "rotation" target). once = no decay.
const CADENCE_DAYS: Record<Habit['cadence'], number | null> = {
  daily: 1, weekly: 7, custom: 7, once: null,
};
const CADENCE_LABEL: Record<Habit['cadence'], string> = {
  daily: 'DAILY', weekly: 'WEEKLY', custom: 'CUSTOM', once: 'ONE-OFF',
};
const isOnce = (c: Habit) => c.cadence === 'once';
/** "done" is sticky for one-off tasks (ever completed); per-day for recurring. */
const choreDone = (c: Habit) => (isOnce(c) ? (c.lastCompletedOn != null || c.isCompletedToday) : c.isCompletedToday);

/** Rotation-slipping signal from cadence + last completion. Quiet for
 *  one-off tasks and never-completed chores (no false alarms). */
function staleInfo(c: Habit): { stale: boolean; overdue: number } {
  const interval = CADENCE_DAYS[c.cadence];
  if (interval == null || !c.lastCompletedOn) return { stale: false, overdue: 0 };
  const daysSince = Math.floor((Date.now() - new Date(c.lastCompletedOn).getTime()) / 86_400_000);
  return { stale: daysSince > interval, overdue: daysSince - interval };
}

/* ---------- small bits ---------- */
function MoveSelect({ value, projects, onChange }: { value: string | null; projects: Project[]; onChange: (pid: string | null) => void }) {
  return (
    <select value={value || ''} onChange={e => onChange(e.target.value || null)} title="Move to a project"
      style={{ background: '#070811', border: '1px solid var(--line-2)', borderRadius: 0, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: 10, padding: '4px 6px', outline: 'none' }}>
      <option value="">Uncategorized</option>
      {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  );
}

function StaleHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 10, color: 'var(--text-dim)', padding: '5px 9px', background: 'color-mix(in srgb, var(--red) 8%, transparent)', borderLeft: '2px solid var(--red)' }}>
      <Icon name="bell" size={11} style={{ color: 'var(--red)', flex: 'none' }} />
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
    </div>
  );
}

function CheckBox({ done, busy, onClick, label }: { done: boolean; busy: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} disabled={busy} aria-label={label} style={{
      width: 26, height: 26, flexShrink: 0,
      border: done ? '1px solid var(--lime)' : '1px solid var(--line-2)',
      background: done ? 'linear-gradient(135deg, var(--lime), var(--teal))' : 'var(--panel-2)',
      color: done ? 'white' : 'var(--text-dim)', cursor: busy ? 'wait' : 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: done ? 'var(--glow-lime)' : 'none',
      transition: 'background .15s, box-shadow .15s, border-color .15s, color .15s, opacity .15s',
      opacity: busy ? 0.6 : 1,
    }}>
      {done && <Icon name="check" size={14} />}
    </button>
  );
}

/** Round check for recurring chores. */
function RoundCheck({ done, busy, onClick, label }: { done: boolean; busy: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} disabled={busy} aria-label={label} style={{
      width: 26, height: 26, flex: 'none', borderRadius: '50%', cursor: busy ? 'wait' : 'pointer',
      border: done ? '1px solid var(--lime)' : '1px solid var(--line-bright)',
      background: done ? 'linear-gradient(135deg, var(--lime), var(--teal))' : 'var(--panel-2)',
      color: done ? '#03161c' : 'var(--text-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      opacity: busy ? 0.6 : 1, transition: 'background .15s, border-color .15s' }}>
      {done && <Icon name="check" size={14} />}
    </button>
  );
}

function StatusPill({ status }: { status: Project['status'] }) {
  const meta = STATUS_META[status];
  return <span className="ncx-stamp flat" style={{ color: meta.color }}>{meta.label}</span>;
}

function SectionLabel({ icon, color, count, children }: { icon: string; color?: string; count?: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="mono" style={{ fontSize: 10, letterSpacing: '0.26em', color: color || 'var(--text-dim)', textTransform: 'uppercase', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <Icon name={icon} size={11} style={{ color: color || 'var(--text-dim)' }} />{children}
      {count != null && <span className="ncx-serial" style={{ marginLeft: 2 }}>{count}</span>}
    </span>
  );
}

/* ---------- recurring chore / one-off task row ---------- */
function ChoreRow({
  chore, projects, showSugg, editing, choreBusy, onToggle, onMove, onEdit, onDelete, onCloseEdit,
}: {
  chore: Habit; projects: Project[]; showSugg: boolean; editing: boolean; choreBusy: boolean;
  onToggle: () => void; onMove: (pid: string | null) => void; onEdit: () => void; onDelete: () => void; onCloseEdit: () => void;
}) {
  if (editing) {
    return <HabitForm kind="chore" moduleId={chore.moduleId} habit={chore} onClose={onCloseEdit} />;
  }
  const once = isOnce(chore);
  const done = choreDone(chore);
  const { stale, overdue } = staleInfo(chore);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
        {once
          ? <CheckBox done={done} busy={choreBusy} onClick={onToggle} label={done ? `Reopen ${chore.title}` : `Complete ${chore.title}`} />
          : <RoundCheck done={done} busy={choreBusy} onClick={onToggle} label={done ? `Uncheck ${chore.title}` : `Check ${chore.title}`} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: done ? 'var(--lime)' : 'var(--text)', textDecoration: done ? 'line-through' : 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{chore.title}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
            {!once && (
              <span className="mono" style={{ fontSize: 9, letterSpacing: '0.1em', color: 'var(--teal)', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 6px', border: '1px solid color-mix(in srgb, var(--teal) 35%, transparent)', background: 'color-mix(in srgb, var(--teal) 8%, transparent)' }}>
                <Icon name="repeat" size={9} /> {CADENCE_LABEL[chore.cadence]}
              </span>
            )}
            {once && <span className="ncx-stamp flat" style={{ fontSize: 8.5, color: 'var(--text-faint)' }}>ONE-OFF</span>}
            {!once && chore.currentStreak > 0 && <span className="mono" style={{ fontSize: 9.5, color: 'var(--amber)', display: 'inline-flex', alignItems: 'center', gap: 3 }}><Icon name="flame" size={10} />{chore.currentStreak}</span>}
            {chore.weatherRule?.outdoor && <Icon name="eye" size={11} style={{ color: 'var(--cyan)' }} />}
            {chore.estMinutes != null && <span className="mono" style={{ fontSize: 9.5, color: 'var(--violet)', display: 'inline-flex', alignItems: 'center', gap: 3 }}><Icon name="clock" size={10} />{chore.estMinutes}m</span>}
            <span className="mono" style={{ fontSize: 9.5, color: 'var(--lime)' }}>+{chore.baseXp}</span>
            {stale && <span className="mono" style={{ fontSize: 9.5, color: 'var(--red)', display: 'inline-flex', alignItems: 'center', gap: 3 }}><Icon name="bell" size={10} />OVERDUE {overdue}D</span>}
          </div>
        </div>
        <MoveSelect value={chore.projectId} projects={projects} onChange={onMove} />
        <button onClick={onEdit} className="btn btn-ghost" style={{ padding: '4px 6px' }} aria-label={`Edit ${chore.title}`} title="Edit"><Icon name="edit" size={12} /></button>
        <button onClick={onDelete} className="btn btn-ghost" style={{ padding: '4px 6px' }} aria-label={`Delete ${chore.title}`} title="Delete"><Icon name="close" size={12} /></button>
      </div>
      {showSugg && stale && (
        <StaleHint>Rotation slipping — {overdue}d past its {CADENCE_LABEL[chore.cadence].toLowerCase()} cadence</StaleHint>
      )}
    </div>
  );
}

/* ---------- project objectives (ported from ProjectsView) ---------- */
function TaskRow({ task, busy, onToggle, onDelete }: { task: ProjectTask; busy: boolean; onToggle: () => void; onDelete: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <CheckBox done={task.done} busy={busy} onClick={onToggle} label={task.done ? `Reopen ${task.title}` : `Complete ${task.title}`} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, color: task.done ? 'var(--lime)' : 'var(--text)', textDecoration: task.done ? 'line-through' : 'none', textDecorationColor: 'rgba(67,255,166,0.5)' }}>{task.title}</span>
        {task.description && <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 1 }}>{task.description}</div>}
      </div>
      {task.priority > 0 && <span className="ncx-stamp flat" title="Priority" style={{ color: 'var(--magenta)', fontSize: 9 }}>P{task.priority}</span>}
      {task.xpReward != null && <span className="ncx-stamp flat" title="Authored XP reward" style={{ color: 'var(--amber)', fontSize: 9, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="bolt" size={10} /> +{task.xpReward}</span>}
      {task.estMinutes != null && <span className="ncx-stamp flat" title="Estimated time" style={{ color: 'var(--violet)', fontSize: 9, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="clock" size={10} /> {task.estMinutes}m</span>}
      <button onClick={onDelete} className="btn btn-ghost" style={{ padding: '4px 6px' }} title="Delete objective" aria-label={`Delete ${task.title}`}><Icon name="close" size={12} /></button>
    </div>
  );
}

function orderedTasks(tasks: ProjectTask[]): ProjectTask[] {
  return [...tasks].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}
type SeqState = 'done' | 'current' | 'locked';
function sequenceState(seq: ProjectTask[], index: number): SeqState {
  if (seq[index].done) return 'done';
  const firstOpen = seq.findIndex(t => !t.done);
  return index === firstOpen ? 'current' : 'locked';
}

function SequenceProgress({ tasks }: { tasks: ProjectTask[] }) {
  const total = tasks.length;
  const doneCount = tasks.filter(t => t.done).length;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="ncx-serial">{doneCount}/{total} STEPS</span>
      <div className="ncx-bar slim">
        <i style={{ width: `${pct}%`, background: pct === 100 ? 'linear-gradient(90deg, var(--cyan), var(--teal))' : 'linear-gradient(90deg, var(--lime), var(--teal))', boxShadow: pct > 0 ? 'var(--glow-cyan)' : 'none' }} />
        <span className="seg-mask" />
      </div>
    </div>
  );
}

function SequencedTaskRow({ task, state, isLast, busy, onToggle, onDelete }: { task: ProjectTask; state: SeqState; isLast: boolean; busy: boolean; onToggle: () => void; onDelete: () => void }) {
  const done = state === 'done';
  const current = state === 'current';
  const locked = state === 'locked';
  const nodeColor = done ? 'var(--lime)' : current ? 'var(--cyan)' : 'var(--line-2)';
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 26 }}>
        <button onClick={locked ? undefined : onToggle} disabled={busy || locked}
          aria-label={done ? `Reopen ${task.title}` : current ? `Complete ${task.title}` : `${task.title} (locked)`}
          title={locked ? 'Locked — finish the current step first' : undefined}
          style={{
            width: 26, height: 26, flexShrink: 0, border: `1px solid ${nodeColor}`,
            background: done ? 'linear-gradient(135deg, var(--lime), var(--teal))' : current ? 'color-mix(in srgb, var(--cyan) 18%, var(--panel-2))' : 'var(--panel-2)',
            color: done ? 'white' : current ? 'var(--cyan)' : 'var(--text-faint)',
            boxShadow: current ? 'var(--glow-cyan)' : done ? 'var(--glow-lime)' : 'none',
            cursor: locked ? 'not-allowed' : busy ? 'wait' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.6 : 1,
          }}>
          <Icon name={done ? 'check' : locked ? 'lock' : 'bolt'} size={13} />
        </button>
        {!isLast && <div style={{ flex: 1, width: 2, minHeight: 10, background: done ? 'var(--lime)' : 'var(--line)', opacity: done ? 0.5 : 1 }} />}
      </div>
      <div style={{ flex: 1, minWidth: 0, paddingBottom: isLast ? 0 : 10, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: current ? 700 : 500, color: done ? 'var(--lime)' : current ? 'var(--text)' : 'var(--text-faint)', textDecoration: done ? 'line-through' : 'none', textDecorationColor: 'rgba(67,255,166,0.5)' }}>{task.title}</span>
            {current && <span className="ncx-stamp flat" style={{ fontSize: 9.5, padding: '2px 7px', color: 'var(--cyan)', background: 'rgba(var(--accent-rgb), 0.12)' }}>CURRENT</span>}
          </div>
          {task.description && <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 2, opacity: locked ? 0.6 : 1 }}>{task.description}</div>}
        </div>
        {task.xpReward != null && <span className="ncx-stamp flat" title="Authored XP reward" style={{ color: current ? 'var(--amber)' : 'var(--text-faint)', fontSize: 9, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="bolt" size={10} /> +{task.xpReward}</span>}
        {task.estMinutes != null && <span className="ncx-stamp flat" title="Estimated time" style={{ color: 'var(--violet)', fontSize: 9, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="clock" size={10} /> {task.estMinutes}m</span>}
        <button onClick={onDelete} className="btn btn-ghost" style={{ padding: '4px 6px' }} title="Delete step" aria-label={`Delete ${task.title}`}><Icon name="close" size={12} /></button>
      </div>
    </div>
  );
}

function MilestoneRow({ milestone, busy, onToggle, onDelete }: { milestone: Milestone; busy: boolean; onToggle: () => void; onDelete: () => void }) {
  const due = milestone.dueDate ? new Date(milestone.dueDate) : null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <CheckBox done={milestone.done} busy={busy} onClick={onToggle} label={milestone.done ? `Reopen ${milestone.title}` : `Clear ${milestone.title}`} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: milestone.done ? 'var(--cyan)' : 'var(--text)', textDecoration: milestone.done ? 'line-through' : 'none', textDecorationColor: 'rgba(72,209,255,0.5)' }}>{milestone.title}</span>
        {due && <span className="mono" style={{ fontSize: 10, color: 'var(--text-faint)', marginLeft: 8 }}><Icon name="clock" size={10} style={{ marginRight: 3, verticalAlign: 'middle' }} />{due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>}
      </div>
      <span className="ncx-stamp flat" title="Bonus XP on clear" style={{ color: 'var(--amber)', fontSize: 9, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="trophy" size={10} />+{milestone.bonusXp}</span>
      <button onClick={onDelete} className="btn btn-ghost" style={{ padding: '4px 6px' }} title="Delete milestone" aria-label={`Delete ${milestone.title}`}><Icon name="close" size={12} /></button>
    </div>
  );
}

/* ---------- project card ---------- */
function ProjectCard({
  project, chores, projects, choresModuleId, showSugg,
  editingChoreId, choreBusyId, onToggleChore, onMoveChore, onEditChore, onDeleteChore, onCloseEditChore,
  onEdit, onDelete,
}: {
  project: Project; chores: Habit[]; projects: Project[]; choresModuleId?: string; showSugg: boolean;
  editingChoreId: string | null; choreBusyId: string | null;
  onToggleChore: (c: Habit) => void; onMoveChore: (id: string, pid: string | null) => void;
  onEditChore: (id: string) => void; onDeleteChore: (c: Habit) => void; onCloseEditChore: () => void;
  onEdit: () => void; onDelete: () => void;
}) {
  const qc = useQueryClient();
  const [addingTask, setAddingTask] = useState(false);
  const [addingChore, setAddingChore] = useState(false);
  const [addingMilestone, setAddingMilestone] = useState(false);

  const tasks = project.tasks ?? [];
  const milestones = project.milestones ?? [];
  const openTasks = tasks.filter(t => !t.done).length;
  const rotation = chores.filter(c => c.projectId === project.id);

  const invalidateAfterCheck = () => {
    qc.invalidateQueries({ queryKey: ['projects'] });
    qc.invalidateQueries({ queryKey: ['player'] });
    qc.invalidateQueries({ queryKey: ['player', 'stats'] });
    qc.invalidateQueries({ queryKey: ['quests', 'today'] });
  };
  const toggleTask = useMutation({ mutationFn: (t: ProjectTask) => api.put(`/api/projects/tasks/${t.id}`, { done: !t.done }), onSuccess: invalidateAfterCheck });
  const removeTask = useMutation({ mutationFn: (id: string) => api.del(`/api/projects/tasks/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }) });
  const toggleMilestone = useMutation({ mutationFn: (m: Milestone) => api.put(`/api/projects/milestones/${m.id}`, { done: !m.done }), onSuccess: invalidateAfterCheck });
  const removeMilestone = useMutation({ mutationFn: (id: string) => api.del(`/api/projects/milestones/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }) });

  const accent = project.color || 'var(--cyan)';
  const dim = project.status === 'archived' || project.status === 'done';

  return (
    <div className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14, borderLeft: `3px solid ${accent}`, opacity: dim ? 0.85 : 1 }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, fontFamily: 'var(--font-display)', color: 'var(--text)' }}>{project.name}</h3>
            <StatusPill status={project.status} />
            {project.ordered && <span className="ncx-stamp flat" style={{ color: 'var(--cyan)', fontSize: 8.5 }}>SEQUENCED</span>}
          </div>
          {project.description && <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 4 }}>{project.description}</div>}
        </div>
        <button onClick={onEdit} className="btn btn-ghost" style={{ padding: '6px 8px' }} title="Edit operation" aria-label={`Edit ${project.name}`}><Icon name="edit" size={14} /></button>
        <button onClick={onDelete} className="btn btn-ghost" style={{ padding: '6px 8px' }} title="Delete operation" aria-label={`Delete ${project.name}`}><Icon name="close" size={14} /></button>
      </div>

      {/* objectives */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <SectionLabel icon={project.ordered ? 'layers' : 'list'} count={`${openTasks} OPEN`}>OBJECTIVES</SectionLabel>
        </div>
        {project.ordered && tasks.length > 0 && <SequenceProgress tasks={tasks} />}
        {project.ordered
          ? orderedTasks(tasks).map((t, i, arr) => (
              <SequencedTaskRow key={t.id} task={t} state={sequenceState(arr, i)} isLast={i === arr.length - 1}
                busy={toggleTask.isPending && toggleTask.variables?.id === t.id}
                onToggle={() => toggleTask.mutate(t)} onDelete={() => removeTask.mutate(t.id)} />
            ))
          : tasks.map(t => (
              <TaskRow key={t.id} task={t} busy={toggleTask.isPending && toggleTask.variables?.id === t.id}
                onToggle={() => toggleTask.mutate(t)} onDelete={() => removeTask.mutate(t.id)} />
            ))}
        {tasks.length === 0 && <div className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', paddingLeft: 4 }}>No objectives yet.</div>}
        {addingTask
          ? <TaskForm projectId={project.id} onClose={() => setAddingTask(false)} />
          : <button className="btn btn-ghost" style={{ alignSelf: 'flex-start', fontSize: 11, padding: '5px 10px' }} onClick={() => setAddingTask(true)}><Icon name="plus" size={12} style={{ marginRight: 4 }} /> ADD OBJECTIVE</button>}
      </section>

      {/* rotation — attached recurring chores */}
      <section className="panel-inset" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <SectionLabel icon="repeat" color="var(--teal)" count={rotation.length}>ROTATION · RECURRING</SectionLabel>
        {rotation.length === 0
          ? <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-faint)' }}>No recurring upkeep attached. Add one below, or move a chore here from Uncategorized.</div>
          : rotation.map(c => (
              <ChoreRow key={c.id} chore={c} projects={projects} showSugg={showSugg}
                editing={editingChoreId === c.id} choreBusy={choreBusyId === c.id}
                onToggle={() => onToggleChore(c)} onMove={(pid) => onMoveChore(c.id, pid)}
                onEdit={() => onEditChore(c.id)} onDelete={() => onDeleteChore(c)}
                onCloseEdit={onCloseEditChore} />
            ))}
        {choresModuleId && (addingChore
          ? <HabitForm kind="chore" moduleId={choresModuleId} defaultProjectId={project.id} onClose={() => setAddingChore(false)} />
          : <button className="btn btn-ghost" style={{ alignSelf: 'flex-start', fontSize: 11, padding: '5px 10px' }} onClick={() => setAddingChore(true)}><Icon name="plus" size={12} style={{ marginRight: 4 }} /> ADD CHORE</button>)}
      </section>

      {/* milestones */}
      <section className="panel-inset" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <SectionLabel icon="flag">MILESTONES</SectionLabel>
        {milestones.map(m => (
          <MilestoneRow key={m.id} milestone={m} busy={toggleMilestone.isPending && toggleMilestone.variables?.id === m.id}
            onToggle={() => toggleMilestone.mutate(m)} onDelete={() => removeMilestone.mutate(m.id)} />
        ))}
        {milestones.length === 0 && <div className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', paddingLeft: 4 }}>No milestones set.</div>}
        {addingMilestone
          ? <MilestoneForm projectId={project.id} onClose={() => setAddingMilestone(false)} />
          : <button className="btn btn-ghost" style={{ alignSelf: 'flex-start', fontSize: 11, padding: '5px 10px' }} onClick={() => setAddingMilestone(true)}><Icon name="plus" size={12} style={{ marginRight: 4 }} /> ADD MILESTONE</button>}
      </section>
    </div>
  );
}

/* ---------- forms (ported) ---------- */
function ProjectForm({ project, onClose }: { project?: Project; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = !!project;
  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [status, setStatus] = useState<Project['status']>(project?.status ?? 'active');
  const [color, setColor] = useState(project?.color ?? '');
  const [ordered, setOrdered] = useState(project?.ordered ?? false);

  const buildPayload = () => ({ name: name.trim(), description: description.trim() || null, status, color: color.trim() || null, ordered });
  const save = useMutation({
    mutationFn: () => isEdit ? api.put(`/api/projects/${project!.id}`, buildPayload()) : api.post('/api/projects', buildPayload()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); onClose(); },
  });

  return (
    <div className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, borderLeft: '3px solid var(--cyan)' }}>
      <input autoFocus placeholder="Operation name (e.g. Ship the v2 launch)" value={name} onChange={e => setName(e.target.value)} style={inputStyle} />
      <input placeholder="Brief (optional)" value={description} onChange={e => setDescription(e.target.value)} style={inputStyle} />
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="kicker">STATUS</span>
          <select value={status} onChange={e => setStatus(e.target.value as Project['status'])} style={inputStyle}>
            <option value="active">Active</option><option value="paused">Paused</option><option value="done">Cleared</option><option value="archived">Archived</option>
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="kicker">ACCENT</span>
          <AccentPicker value={color} onChange={setColor} autoTitle="Stock cyan" />
        </label>
        <label title="Objectives unlock in order — only the current step is actionable (questline mode)" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', border: '1px solid var(--line-2)', cursor: 'pointer' }}>
          <input type="checkbox" checked={ordered} onChange={e => setOrdered(e.target.checked)} style={{ accentColor: 'var(--cyan)' }} />
          <span className="mono" style={{ fontSize: 10.5, letterSpacing: '0.14em', color: ordered ? 'var(--cyan)' : 'var(--text-dim)' }}>SEQUENCED</span>
        </label>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost" onClick={onClose}>CANCEL</button>
        <button className="btn btn-primary" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? (isEdit ? 'SAVING…' : 'CREATING…') : (isEdit ? 'SAVE' : 'CREATE')}
        </button>
      </div>
    </div>
  );
}

function TaskForm({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [estMinutes, setEstMinutes] = useState<number | ''>('');
  const [priority, setPriority] = useState<number>(0);
  const [xpReward, setXpReward] = useState<number | ''>('');
  const create = useMutation({
    mutationFn: () => api.post(`/api/projects/${projectId}/tasks`, { title: title.trim(), estMinutes: estMinutes === '' ? null : estMinutes, priority, xpReward: xpReward === '' ? null : xpReward }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); onClose(); },
  });
  const submit = () => { if (title.trim()) create.mutate(); };
  return (
    <div className="panel-inset" style={{ padding: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <input autoFocus placeholder="Objective title" value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} style={{ ...inputStyle, flex: 1, minWidth: 160 }} />
      <input type="number" min={1} max={1440} placeholder="est min" value={estMinutes} onChange={e => setEstMinutes(e.target.value === '' ? '' : Math.max(1, Math.min(1440, Number(e.target.value))))} style={{ ...inputStyle, width: 90 }} />
      <input type="number" min={0} max={100} title="Priority (higher surfaces first)" value={priority} onChange={e => setPriority(Math.max(0, Math.min(100, Number(e.target.value))))} style={{ ...inputStyle, width: 70 }} />
      <input type="number" min={0} max={2000} placeholder="xp auto" title="XP reward (blank = derived from the time estimate)" value={xpReward} onChange={e => setXpReward(e.target.value === '' ? '' : Math.max(0, Math.min(2000, Number(e.target.value))))} style={{ ...inputStyle, width: 80 }} />
      <button className="btn btn-ghost" onClick={onClose} style={{ fontSize: 11 }}>CANCEL</button>
      <button className="btn btn-primary" disabled={!title.trim() || create.isPending} onClick={submit} style={{ fontSize: 11 }}>{create.isPending ? 'ADDING…' : 'ADD'}</button>
    </div>
  );
}

function MilestoneForm({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [bonusXp, setBonusXp] = useState<number>(50);
  const create = useMutation({
    mutationFn: () => {
      // Parse the date-only input on LOCAL calendar fields — new Date('yyyy-mm-dd')
      // is UTC midnight, which renders as the previous day west of UTC
      // (same rule as TransactionEditor's date field).
      let dueIso: string | null = null;
      if (dueDate) {
        const [y, m, d] = dueDate.split('-').map(Number);
        dueIso = new Date(y, (m || 1) - 1, d || 1).toISOString();
      }
      return api.post(`/api/projects/${projectId}/milestones`, { title: title.trim(), dueDate: dueIso, bonusXp });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); onClose(); },
  });
  const submit = () => { if (title.trim()) create.mutate(); };
  return (
    <div className="panel" style={{ padding: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <input autoFocus placeholder="Milestone title" value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} style={{ ...inputStyle, flex: 1, minWidth: 160 }} />
      <input type="date" title="Due date (optional)" value={dueDate} onChange={e => setDueDate(e.target.value)} style={{ ...inputStyle, width: 150 }} />
      <input type="number" min={0} max={2000} title="Bonus XP on clear" value={bonusXp} onChange={e => setBonusXp(Math.max(0, Math.min(2000, Number(e.target.value))))} style={{ ...inputStyle, width: 90 }} />
      <button className="btn btn-ghost" onClick={onClose} style={{ fontSize: 11 }}>CANCEL</button>
      <button className="btn btn-primary" disabled={!title.trim() || create.isPending} onClick={submit} style={{ fontSize: 11 }}>{create.isPending ? 'ADDING…' : 'ADD'}</button>
    </div>
  );
}

/** One-off task = a chore with cadence "once". Files into the chosen
 *  project at creation (default Uncategorized). */
function TaskDefForm({ moduleId, onClose }: { moduleId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [estMinutes, setEstMinutes] = useState<number | ''>('');
  const [baseXp, setBaseXp] = useState<number>(10);
  const [projectId, setProjectId] = useState<string | null>(null);
  // Same key as the page's projects query — served from cache on this screen.
  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => api.get<{ projects: Project[] }>('/api/projects').then(r => r.projects) });
  const create = useMutation({
    mutationFn: () => api.post('/api/habits', {
      moduleId, kind: 'chore', title: title.trim(), cadence: 'once',
      difficulty: 'easy', baseXp, estMinutes: estMinutes === '' ? null : estMinutes,
      projectId,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['habits', 'chore'] }); onClose(); },
  });
  const submit = () => { if (title.trim()) create.mutate(); };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <input autoFocus placeholder="Task title (e.g. Call the plumber)" value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} style={inputStyle} />
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="kicker">EST. MINUTES</span>
          <input type="number" min={1} max={1440} placeholder="—" value={estMinutes} onChange={e => setEstMinutes(e.target.value === '' ? '' : Math.max(1, Math.min(1440, Number(e.target.value))))} style={{ ...inputStyle, width: 100 }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="kicker">XP</span>
          <input type="number" min={0} max={500} value={baseXp} onChange={e => setBaseXp(Math.max(0, Math.min(500, Number(e.target.value))))} style={{ ...inputStyle, width: 80 }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="kicker">PROJECT</span>
          <select value={projectId ?? ''} onChange={e => setProjectId(e.target.value || null)} style={inputStyle}>
            <option value="">Uncategorized</option>
            {(projectsQ.data ?? []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost" onClick={onClose}>CANCEL</button>
        <button className="btn btn-primary" disabled={!title.trim() || create.isPending} onClick={submit}>{create.isPending ? 'ADDING…' : 'ADD TASK'}</button>
      </div>
    </div>
  );
}

/* ---------- the page ---------- */
type NewKind = 'project' | 'chore' | 'task';

export function OperationsView() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [newKind, setNewKind] = useState<NewKind>('chore');
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editingChoreId, setEditingChoreId] = useState<string | null>(null);
  const [pendingDeleteProject, setPendingDeleteProject] = useState<Project | null>(null);
  const [pendingDeleteChore, setPendingDeleteChore] = useState<Habit | null>(null);

  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => api.get<{ projects: Project[] }>('/api/projects').then(r => r.projects) });
  const choresQ = useQuery({ queryKey: ['habits', 'chore'], queryFn: () => api.get<{ habits: Habit[] }>('/api/habits?kind=chore').then(r => r.habits) });
  const modulesQ = useQuery({ queryKey: ['modules'], queryFn: () => api.get<{ modules: Module[] }>('/api/modules').then(r => r.modules) });

  const invalidateChores = () => {
    qc.invalidateQueries({ queryKey: ['habits', 'chore'] });
    qc.invalidateQueries({ queryKey: ['player'] });
    qc.invalidateQueries({ queryKey: ['quests', 'today'] });
  };
  const check = useMutation({ mutationFn: (id: string) => api.post(`/api/habits/${id}/check`), onSuccess: invalidateChores });
  const uncheck = useMutation({ mutationFn: (id: string) => api.del(`/api/habits/${id}/check`), onSuccess: invalidateChores });
  const move = useMutation({
    mutationFn: ({ id, projectId }: { id: string; projectId: string | null }) => api.put(`/api/habits/${id}`, { projectId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['habits', 'chore'] }),
  });
  const removeProject = useMutation({ mutationFn: (id: string) => api.del(`/api/projects/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); qc.invalidateQueries({ queryKey: ['habits', 'chore'] }); setPendingDeleteProject(null); } });
  const removeChore = useMutation({ mutationFn: (id: string) => api.del(`/api/habits/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['habits', 'chore'] }); setPendingDeleteChore(null); } });

  if (projectsQ.isLoading || choresQ.isLoading) return <Empty>LOADING OPERATIONS…</Empty>;
  if (projectsQ.isError || choresQ.isError) return <Empty color="var(--red)">FAILED TO LOAD</Empty>;

  const projects = projectsQ.data ?? [];
  const chores = choresQ.data ?? [];
  const choresModuleId = modulesQ.data?.find(m => m.key === 'chores')?.id;

  const looseChores = chores.filter(c => c.projectId == null);
  const dueCount = chores.filter(c => !choreDone(c)).length;
  const overdueCount = chores.filter(c => staleInfo(c).stale).length;
  const busyChoreId = check.isPending ? (check.variables as string) : uncheck.isPending ? (uncheck.variables as string) : null;

  const toggleChore = (c: Habit) => (choreDone(c) ? uncheck.mutate(c.id) : check.mutate(c.id));
  const moveChore = (id: string, projectId: string | null) => move.mutate({ id, projectId });

  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* command bar */}
      <div className="panel hud" style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div className="ncx-chip" style={{ color: 'var(--cyan)' }}><Icon name="grid" size={18} /></div>
        <div style={{ minWidth: 0 }}>
          <h2 className="ncx-glitch ncx-chroma" style={{ fontSize: 20, fontWeight: 700, margin: 0, fontFamily: 'var(--font-display)', letterSpacing: '0.02em', textTransform: 'uppercase' }}>Operations</h2>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '0.16em', color: 'var(--text-faint)', marginTop: 3 }}>
            {projects.length} PROJECTS · {dueCount} CHORES DUE{overdueCount ? ` · ${overdueCount} OVERDUE` : ''}
          </div>
        </div>
        <button className={adding ? 'btn btn-ghost' : 'btn btn-primary'} style={{ marginLeft: 'auto', padding: '8px 15px', fontSize: 11 }} onClick={() => setAdding(a => !a)}>
          <Icon name={adding ? 'close' : 'plus'} size={13} /> {adding ? 'CLOSE' : 'NEW'}
        </button>
      </div>

      {/* add editor */}
      {adding && (
        <div className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', boxShadow: 'inset 0 0 0 1px var(--line-2)', alignSelf: 'flex-start' }}>
            {([['project', 'PROJECT'], ['chore', 'RECURRING CHORE'], ['task', 'ONE-OFF TASK']] as [NewKind, string][]).map(([k, label]) => {
              const on = newKind === k;
              return <button key={k} onClick={() => setNewKind(k)} className="mono" style={{ padding: '7px 12px', fontSize: 10, border: 'none', cursor: 'pointer', background: on ? 'color-mix(in srgb, var(--cyan) 16%, transparent)' : 'transparent', color: on ? 'var(--cyan)' : 'var(--text-dim)', fontWeight: on ? 700 : 500, boxShadow: on ? 'inset 0 0 0 1px var(--cyan)' : 'none' }}>{label}</button>;
            })}
          </div>
          {newKind === 'project' && <ProjectForm onClose={() => setAdding(false)} />}
          {newKind === 'chore' && (choresModuleId
            ? <HabitForm kind="chore" moduleId={choresModuleId} onClose={() => setAdding(false)} />
            : <div className="mono" style={{ fontSize: 11, color: 'var(--text-faint)' }}>Chores module missing — re-run seed.</div>)}
          {newKind === 'task' && (choresModuleId
            ? <TaskDefForm moduleId={choresModuleId} onClose={() => setAdding(false)} />
            : <div className="mono" style={{ fontSize: 11, color: 'var(--text-faint)' }}>Chores module missing — re-run seed.</div>)}
        </div>
      )}

      {/* projects — 2-up grid */}
      {projects.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(440px, 1fr))', gap: 14, alignItems: 'start' }}>
          {projects.map(p => editingProject?.id === p.id
            ? <ProjectForm key={p.id} project={p} onClose={() => setEditingProject(null)} />
            : <ProjectCard key={p.id} project={p} chores={chores} projects={projects} choresModuleId={choresModuleId} showSugg
                editingChoreId={editingChoreId} choreBusyId={busyChoreId}
                onToggleChore={toggleChore} onMoveChore={moveChore}
                onEditChore={setEditingChoreId} onDeleteChore={setPendingDeleteChore} onCloseEditChore={() => setEditingChoreId(null)}
                onEdit={() => setEditingProject(p)} onDelete={() => setPendingDeleteProject(p)} />)}
        </div>
      )}

      {/* uncategorized */}
      <div className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, border: '1px dashed var(--line-2)' }}>
        <SectionLabel icon="layers" count={looseChores.length}>UNCATEGORIZED — loose tasks &amp; chores</SectionLabel>
        <div className="mono" style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: -4 }}>Not tied to a project. Move anything into one, or leave it here.</div>
        {looseChores.length === 0
          ? <div className="mono" style={{ fontSize: 11, color: 'var(--text-faint)' }}>Empty — everything&rsquo;s organized.</div>
          : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 12, alignItems: 'start' }}>
              {looseChores.map(c => (
                <ChoreRow key={c.id} chore={c} projects={projects} showSugg
                  editing={editingChoreId === c.id} choreBusy={busyChoreId === c.id}
                  onToggle={() => toggleChore(c)} onMove={(pid) => moveChore(c.id, pid)}
                  onEdit={() => setEditingChoreId(c.id)} onDelete={() => setPendingDeleteChore(c)} onCloseEdit={() => setEditingChoreId(null)} />
              ))}
            </div>
          )}
      </div>

      <ConfirmDialog
        open={pendingDeleteProject !== null} danger title="Scrub operation?"
        message={pendingDeleteProject && <>This permanently deletes <strong style={{ color: 'var(--text)' }}>{pendingDeleteProject.name}</strong> along with all its objectives and milestones. Attached chores loosen back to Uncategorized. This can&rsquo;t be undone.</>}
        confirmLabel="DELETE" busy={removeProject.isPending}
        onConfirm={() => pendingDeleteProject && removeProject.mutate(pendingDeleteProject.id)} onCancel={() => setPendingDeleteProject(null)} />

      <ConfirmDialog
        open={pendingDeleteChore !== null} danger title="Delete chore?"
        message={pendingDeleteChore && <>This permanently removes <strong style={{ color: 'var(--text)' }}>{pendingDeleteChore.title}</strong> and its history. This can&rsquo;t be undone.</>}
        confirmLabel="DELETE" busy={removeChore.isPending}
        onConfirm={() => pendingDeleteChore && removeChore.mutate(pendingDeleteChore.id)} onCancel={() => setPendingDeleteChore(null)} />
    </div>
  );
}

function Empty({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div className="panel hud" style={{ padding: 40, textAlign: 'center', color: color ?? 'var(--text-faint)' }}>
      <div className="mono" style={{ fontSize: 13 }}>{children}</div>
    </div>
  );
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
