/**
 * ProjectsView — "Operations" pool. Manage projects, their objective
 * checklist (tasks), and milestone timeline (boss clears).
 *
 * Checking a task PUTs done=true; if a matching quest is pending today the
 * server auto-completes it and lands XP/eddies — so toggles invalidate the
 * player + today's quests. Milestones award their bonusXp on completion.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Project, ProjectTask, Milestone } from '../lib/api';
import { Icon } from './Icon';
import { ConfirmDialog } from './ConfirmDialog';

const STATUS_META: Record<Project['status'], { label: string; color: string }> = {
  active:   { label: 'ACTIVE',   color: 'var(--lime)' },
  paused:   { label: 'PAUSED',   color: 'var(--amber)' },
  done:     { label: 'CLEARED',  color: 'var(--cyan)' },
  archived: { label: 'ARCHIVED', color: 'var(--text-faint)' },
};

export function ProjectsView() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null);

  const projectsQ = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<{ projects: Project[] }>('/api/projects').then(r => r.projects),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/projects/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      setPendingDelete(null);
    },
  });

  if (projectsQ.isLoading) return <Empty>LOADING OPERATIONS…</Empty>;
  if (projectsQ.isError) return <Empty color="var(--red)">FAILED TO LOAD</Empty>;

  const projects = projectsQ.data ?? [];
  const activeCount = projects.filter(p => p.status === 'active').length;

  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <Header total={projects.length} active={activeCount} />

      {creating
        ? <ProjectForm onClose={() => setCreating(false)} />
        : (
          <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setCreating(true)}>
            <Icon name="plus" size={14} style={{ marginRight: 6 }} /> NEW OPERATION
          </button>
        )}

      {projects.map(p =>
        editing?.id === p.id
          ? <ProjectForm key={p.id} project={p} onClose={() => setEditing(null)} />
          : <ProjectCard
              key={p.id}
              project={p}
              onEdit={() => setEditing(p)}
              onDelete={() => setPendingDelete(p)}
            />,
      )}

      {projects.length === 0 && (
        <Empty>No operations yet — spin one up above.</Empty>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        danger
        title="Scrub operation?"
        message={pendingDelete && <>This permanently deletes <strong style={{ color: 'var(--text)' }}>{pendingDelete.name}</strong> along with all its objectives and milestones. This can&rsquo;t be undone.</>}
        confirmLabel="DELETE"
        busy={remove.isPending}
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete.id)}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

function Header({ total, active }: { total: number; active: number }) {
  return (
    <div className="panel hud" style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
      <Icon name="target" size={20} style={{ color: 'var(--cyan)' }} />
      <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, fontFamily: 'var(--font-display)' }}>Operations</h2>
      <div
        className="mono"
        style={{
          marginLeft: 'auto', fontSize: 11, color: 'var(--text-dim)',
          padding: '4px 8px', background: 'var(--panel-2)',
          borderRadius: 6, border: '1px solid var(--line)',
        }}
      >
        {active} ACTIVE · {total} TOTAL
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: Project['status'] }) {
  const meta = STATUS_META[status];
  return (
    <span
      className="mono"
      style={{
        fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
        color: meta.color,
        padding: '3px 8px',
        borderRadius: 6,
        background: `color-mix(in srgb, ${meta.color} 10%, transparent)`,
        border: `1px solid color-mix(in srgb, ${meta.color} 35%, transparent)`,
      }}
    >
      {meta.label}
    </span>
  );
}

function ProjectCard({
  project, onEdit, onDelete,
}: { project: Project; onEdit: () => void; onDelete: () => void }) {
  const qc = useQueryClient();
  const [addingTask, setAddingTask] = useState(false);
  const [addingMilestone, setAddingMilestone] = useState(false);

  const tasks = project.tasks ?? [];
  const milestones = project.milestones ?? [];
  const openTasks = tasks.filter(t => !t.done).length;

  const toggleTask = useMutation({
    mutationFn: (t: ProjectTask) => api.put(`/api/projects/tasks/${t.id}`, { done: !t.done }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['player'] });
      qc.invalidateQueries({ queryKey: ['player', 'stats'] });
      qc.invalidateQueries({ queryKey: ['quests', 'today'] });
    },
  });

  const removeTask = useMutation({
    mutationFn: (id: string) => api.del(`/api/projects/tasks/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  });

  const toggleMilestone = useMutation({
    mutationFn: (m: Milestone) => api.put(`/api/projects/milestones/${m.id}`, { done: !m.done }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['player'] });
      qc.invalidateQueries({ queryKey: ['player', 'stats'] });
      qc.invalidateQueries({ queryKey: ['quests', 'today'] });
    },
  });

  const removeMilestone = useMutation({
    mutationFn: (id: string) => api.del(`/api/projects/milestones/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  });

  const accent = project.color || 'var(--cyan)';
  const dim = project.status === 'archived' || project.status === 'done';

  return (
    <div
      className="panel"
      style={{
        padding: 18,
        display: 'flex', flexDirection: 'column', gap: 16,
        borderLeft: `3px solid ${accent}`,
        opacity: dim ? 0.8 : 1,
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, fontFamily: 'var(--font-display)', color: 'var(--text)' }}>
              {project.name}
            </h3>
            <StatusPill status={project.status} />
          </div>
          {project.description && (
            <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 4 }}>
              {project.description}
            </div>
          )}
        </div>
        <button onClick={onEdit} className="btn btn-ghost" style={{ padding: '6px 8px' }} title="Edit operation" aria-label={`Edit ${project.name}`}>
          <Icon name="edit" size={14} />
        </button>
        <button onClick={onDelete} className="btn btn-ghost" style={{ padding: '6px 8px' }} title="Delete operation" aria-label={`Delete ${project.name}`}>
          <Icon name="close" size={14} />
        </button>
      </div>

      {/* Objectives (tasks) */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="kicker"><Icon name="list" size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />OBJECTIVES</span>
          <span className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>{openTasks} OPEN</span>
        </div>
        {tasks.map(t => (
          <TaskRow
            key={t.id}
            task={t}
            busy={toggleTask.isPending && toggleTask.variables?.id === t.id}
            onToggle={() => toggleTask.mutate(t)}
            onDelete={() => removeTask.mutate(t.id)}
          />
        ))}
        {tasks.length === 0 && (
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', paddingLeft: 4 }}>No objectives yet.</div>
        )}
        {addingTask
          ? <TaskForm projectId={project.id} onClose={() => setAddingTask(false)} />
          : (
            <button className="btn btn-ghost" style={{ alignSelf: 'flex-start', fontSize: 11, padding: '5px 10px' }} onClick={() => setAddingTask(true)}>
              <Icon name="plus" size={12} style={{ marginRight: 4 }} /> ADD OBJECTIVE
            </button>
          )}
      </section>

      {/* Milestone timeline */}
      <section className="panel-inset" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="kicker"><Icon name="flag" size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />MILESTONES</span>
        {milestones.map(m => (
          <MilestoneRow
            key={m.id}
            milestone={m}
            busy={toggleMilestone.isPending && toggleMilestone.variables?.id === m.id}
            onToggle={() => toggleMilestone.mutate(m)}
            onDelete={() => removeMilestone.mutate(m.id)}
          />
        ))}
        {milestones.length === 0 && (
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', paddingLeft: 4 }}>No milestones set.</div>
        )}
        {addingMilestone
          ? <MilestoneForm projectId={project.id} onClose={() => setAddingMilestone(false)} />
          : (
            <button className="btn btn-ghost" style={{ alignSelf: 'flex-start', fontSize: 11, padding: '5px 10px' }} onClick={() => setAddingMilestone(true)}>
              <Icon name="plus" size={12} style={{ marginRight: 4 }} /> ADD MILESTONE
            </button>
          )}
      </section>
    </div>
  );
}

function CheckBox({ done, busy, onClick, label }: { done: boolean; busy: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      aria-label={label}
      style={{
        width: 26, height: 26, flexShrink: 0,
        borderRadius: 7,
        border: done ? '1px solid var(--lime)' : '1px solid var(--line-2)',
        background: done
          ? 'linear-gradient(135deg, var(--lime), var(--teal))'
          : 'var(--panel-2)',
        color: done ? 'white' : 'var(--text-dim)',
        cursor: busy ? 'wait' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: done ? 'var(--glow-lime)' : 'none',
        transition: 'all 0.15s ease',
        opacity: busy ? 0.6 : 1,
      }}
    >
      {done && <Icon name="check" size={14} />}
    </button>
  );
}

function TaskRow({
  task, busy, onToggle, onDelete,
}: { task: ProjectTask; busy: boolean; onToggle: () => void; onDelete: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <CheckBox done={task.done} busy={busy} onClick={onToggle} label={task.done ? `Reopen ${task.title}` : `Complete ${task.title}`} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{
          fontSize: 13,
          color: task.done ? 'var(--lime)' : 'var(--text)',
          textDecoration: task.done ? 'line-through' : 'none',
          textDecorationColor: 'rgba(67,255,166,0.5)',
        }}>
          {task.title}
        </span>
      </div>

      {task.priority > 0 && (
        <span
          className="mono"
          title="Priority"
          style={{
            fontSize: 10, color: 'var(--magenta)',
            padding: '3px 7px',
            background: 'color-mix(in srgb, var(--magenta) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--magenta) 30%, transparent)',
            borderRadius: 6,
          }}
        >
          P{task.priority}
        </span>
      )}

      {task.estMinutes != null && (
        <span
          className="mono"
          title="Estimated time"
          style={{
            fontSize: 10, color: 'var(--violet)',
            padding: '3px 7px',
            background: 'color-mix(in srgb, var(--violet) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--violet) 30%, transparent)',
            borderRadius: 6,
          }}
        >
          ⏱ {task.estMinutes}m
        </span>
      )}

      <button onClick={onDelete} className="btn btn-ghost" style={{ padding: '4px 6px' }} title="Delete objective" aria-label={`Delete ${task.title}`}>
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}

function MilestoneRow({
  milestone, busy, onToggle, onDelete,
}: { milestone: Milestone; busy: boolean; onToggle: () => void; onDelete: () => void }) {
  const due = milestone.dueDate ? new Date(milestone.dueDate) : null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <CheckBox done={milestone.done} busy={busy} onClick={onToggle} label={milestone.done ? `Reopen ${milestone.title}` : `Clear ${milestone.title}`} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{
          fontSize: 13, fontWeight: 600,
          color: milestone.done ? 'var(--cyan)' : 'var(--text)',
          textDecoration: milestone.done ? 'line-through' : 'none',
          textDecorationColor: 'rgba(72,209,255,0.5)',
        }}>
          {milestone.title}
        </span>
        {due && (
          <span className="mono" style={{ fontSize: 10, color: 'var(--text-faint)', marginLeft: 8 }}>
            <Icon name="clock" size={10} style={{ marginRight: 3, verticalAlign: 'middle' }} />
            {due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </span>
        )}
      </div>

      <span
        className="mono"
        title="Bonus XP on clear"
        style={{
          fontSize: 10, color: 'var(--amber)',
          padding: '3px 7px',
          background: 'rgba(255,194,75,0.08)',
          border: '1px solid rgba(255,194,75,0.3)',
          borderRadius: 6,
        }}
      >
        <Icon name="trophy" size={10} style={{ marginRight: 3, verticalAlign: 'middle' }} />
        +{milestone.bonusXp}
      </span>

      <button onClick={onDelete} className="btn btn-ghost" style={{ padding: '4px 6px' }} title="Delete milestone" aria-label={`Delete ${milestone.title}`}>
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}

// ---- Forms ----------------------------------------------------------

function ProjectForm({ project, onClose }: { project?: Project; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = !!project;

  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [status, setStatus] = useState<Project['status']>(project?.status ?? 'active');
  const [color, setColor] = useState(project?.color ?? '');

  const buildPayload = () => ({
    name: name.trim(),
    description: description.trim() || null,
    status,
    color: color.trim() || null,
  });

  const save = useMutation({
    mutationFn: () => isEdit
      ? api.put(`/api/projects/${project!.id}`, buildPayload())
      : api.post('/api/projects', buildPayload()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      onClose();
    },
  });

  return (
    <div className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, borderLeft: '3px solid var(--cyan)' }}>
      <input
        autoFocus
        placeholder="Operation name (e.g. Ship the v2 launch)"
        value={name}
        onChange={e => setName(e.target.value)}
        style={inputStyle}
      />
      <input
        placeholder="Brief (optional)"
        value={description}
        onChange={e => setDescription(e.target.value)}
        style={inputStyle}
      />
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="kicker">STATUS</span>
          <select value={status} onChange={e => setStatus(e.target.value as Project['status'])} style={inputStyle}>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="done">Cleared</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="kicker">ACCENT</span>
          <input
            placeholder="#48d1ff"
            value={color}
            onChange={e => setColor(e.target.value)}
            style={{ ...inputStyle, width: 110 }}
          />
        </label>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost" onClick={onClose}>CANCEL</button>
        <button
          className="btn btn-primary"
          disabled={!name.trim() || save.isPending}
          onClick={() => save.mutate()}
        >
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

  const create = useMutation({
    mutationFn: () => api.post(`/api/projects/${projectId}/tasks`, {
      title: title.trim(),
      estMinutes: estMinutes === '' ? null : estMinutes,
      priority,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      onClose();
    },
  });

  const submit = () => { if (title.trim()) create.mutate(); };

  return (
    <div className="panel-inset" style={{ padding: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <input
        autoFocus
        placeholder="Objective title"
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && submit()}
        style={{ ...inputStyle, flex: 1, minWidth: 160 }}
      />
      <input
        type="number"
        min={1}
        max={1440}
        placeholder="est min"
        value={estMinutes}
        onChange={e => setEstMinutes(e.target.value === '' ? '' : Math.max(1, Math.min(1440, Number(e.target.value))))}
        style={{ ...inputStyle, width: 90 }}
      />
      <input
        type="number"
        min={0}
        max={100}
        title="Priority (higher surfaces first)"
        value={priority}
        onChange={e => setPriority(Math.max(0, Math.min(100, Number(e.target.value))))}
        style={{ ...inputStyle, width: 70 }}
      />
      <button className="btn btn-ghost" onClick={onClose} style={{ fontSize: 11 }}>CANCEL</button>
      <button className="btn btn-primary" disabled={!title.trim() || create.isPending} onClick={submit} style={{ fontSize: 11 }}>
        {create.isPending ? 'ADDING…' : 'ADD'}
      </button>
    </div>
  );
}

function MilestoneForm({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [bonusXp, setBonusXp] = useState<number>(50);

  const create = useMutation({
    mutationFn: () => api.post(`/api/projects/${projectId}/milestones`, {
      title: title.trim(),
      dueDate: dueDate ? new Date(dueDate).toISOString() : null,
      bonusXp,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      onClose();
    },
  });

  const submit = () => { if (title.trim()) create.mutate(); };

  return (
    <div className="panel" style={{ padding: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <input
        autoFocus
        placeholder="Milestone title"
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && submit()}
        style={{ ...inputStyle, flex: 1, minWidth: 160 }}
      />
      <input
        type="date"
        title="Due date (optional)"
        value={dueDate}
        onChange={e => setDueDate(e.target.value)}
        style={{ ...inputStyle, width: 150 }}
      />
      <input
        type="number"
        min={0}
        max={2000}
        title="Bonus XP on clear"
        value={bonusXp}
        onChange={e => setBonusXp(Math.max(0, Math.min(2000, Number(e.target.value))))}
        style={{ ...inputStyle, width: 90 }}
      />
      <button className="btn btn-ghost" onClick={onClose} style={{ fontSize: 11 }}>CANCEL</button>
      <button className="btn btn-primary" disabled={!title.trim() || create.isPending} onClick={submit} style={{ fontSize: 11 }}>
        {create.isPending ? 'ADDING…' : 'ADD'}
      </button>
    </div>
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
