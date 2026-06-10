/**
 * ChainsView — "Questlines". Linear questlines: ordered steps where finishing
 * one unlocks the next. The current ("available") step is auto-surfaced on the
 * Today plan, so this view is for AUTHORING + TRACKING — there is no "complete"
 * button here (completion happens by finishing the daily quest).
 *
 * Each card shows its steps as a vertical track:
 *   done      → check + struck/green
 *   available → highlighted "CURRENT" with its xpReward
 *   locked    → dimmed + lock icon
 * plus a progress bar (done/total). A create form builds a chain from a name
 * and a list of step titles you can add/remove.
 *
 * Design system only — reuses .panel / .btn / kicker / mono + CSS vars.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { QuestChain, ChainStep } from '../lib/api';
import { Icon } from './Icon';
import { ConfirmDialog } from './ConfirmDialog';

const STATUS_META: Record<QuestChain['status'], { label: string; color: string }> = {
  active:    { label: 'ACTIVE',    color: 'var(--lime)' },
  done:      { label: 'COMPLETE',  color: 'var(--cyan)' },
  abandoned: { label: 'ABANDONED', color: 'var(--text-faint)' },
};

const DIFF_COLOR: Record<ChainStep['difficulty'], string> = {
  easy: 'var(--teal)', medium: 'var(--violet)', hard: 'var(--magenta)',
};

export function ChainsView() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<QuestChain | null>(null);

  const chainsQ = useQuery({
    queryKey: ['chains'],
    queryFn: () => api.get<{ chains: QuestChain[] }>('/api/chains').then(r => r.chains),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/chains/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chains'] });
      qc.invalidateQueries({ queryKey: ['quests', 'today'] });
      setPendingDelete(null);
    },
  });

  if (chainsQ.isLoading) return <Empty>LOADING QUESTLINES…</Empty>;
  if (chainsQ.isError) return <Empty color="var(--red)">FAILED TO LOAD</Empty>;

  const chains = chainsQ.data ?? [];
  const activeCount = chains.filter(c => c.status === 'active').length;

  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <Header total={chains.length} active={activeCount} />

      {creating
        ? <ChainForm onClose={() => setCreating(false)} />
        : (
          <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setCreating(true)}>
            <Icon name="plus" size={14} style={{ marginRight: 6 }} /> NEW QUESTLINE
          </button>
        )}

      {chains.map(c => (
        <ChainCard key={c.id} chain={c} onDelete={() => setPendingDelete(c)} />
      ))}

      {chains.length === 0 && (
        <Empty>No questlines yet — author one above. Each one drips its current step into your daily ops.</Empty>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        danger
        title="Scrub questline?"
        message={pendingDelete && <>This permanently deletes <strong style={{ color: 'var(--text)' }}>{pendingDelete.name}</strong> and all its steps. This can&rsquo;t be undone.</>}
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
      <Icon name="layers" size={20} style={{ color: 'var(--cyan)' }} />
      <h2 className="ncx-chroma" style={{ fontSize: 18, fontWeight: 700, margin: 0, fontFamily: 'var(--font-display)', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
        Questlines
      </h2>
      <span className="mono" style={{ marginLeft: 'auto', fontSize: 10.5, letterSpacing: '0.12em', color: 'var(--text-dim)' }}>
        {active} ACTIVE · {total} TOTAL
      </span>
    </div>
  );
}

function StatusPill({ status }: { status: QuestChain['status'] }) {
  const meta = STATUS_META[status];
  return (
    <span
      className="ncx-stamp flat"
      style={{ color: meta.color, background: `color-mix(in srgb, ${meta.color} 10%, transparent)` }}
    >
      {meta.label}
    </span>
  );
}

function ChainCard({ chain, onDelete }: { chain: QuestChain; onDelete: () => void }) {
  const qc = useQueryClient();
  const steps = [...(chain.steps ?? [])].sort((a, b) => a.order - b.order);
  const total = steps.length;
  const doneCount = steps.filter(s => s.status === 'done').length;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  const accent = chain.color || 'var(--cyan)';
  const dim = chain.status === 'abandoned';

  const abandon = useMutation({
    mutationFn: () => api.put(`/api/chains/${chain.id}`, {
      status: chain.status === 'abandoned' ? 'active' : 'abandoned',
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chains'] });
      qc.invalidateQueries({ queryKey: ['quests', 'today'] });
    },
  });

  return (
    <div
      className="panel"
      style={{
        padding: 18,
        display: 'flex', flexDirection: 'column', gap: 14,
        borderLeft: `3px solid ${accent}`,
        opacity: dim ? 0.75 : 1,
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, fontFamily: 'var(--font-display)', color: 'var(--text)' }}>
              {chain.name}
            </h3>
            <StatusPill status={chain.status} />
          </div>
          {chain.description && (
            <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 4 }}>
              {chain.description}
            </div>
          )}
        </div>
        {chain.status !== 'done' && (
          <button
            onClick={() => abandon.mutate()}
            className="btn btn-ghost"
            style={{ padding: '6px 8px' }}
            disabled={abandon.isPending}
            title={chain.status === 'abandoned' ? 'Reactivate questline' : 'Abandon questline'}
            aria-label={chain.status === 'abandoned' ? `Reactivate ${chain.name}` : `Abandon ${chain.name}`}
          >
            <Icon name={chain.status === 'abandoned' ? 'repeat' : 'moon'} size={14} />
          </button>
        )}
        <button onClick={onDelete} className="btn btn-ghost" style={{ padding: '6px 8px' }} title="Delete questline" aria-label={`Delete ${chain.name}`}>
          <Icon name="close" size={14} />
        </button>
      </div>

      {/* Progress bar */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="mono" style={{ fontSize: 10, letterSpacing: '0.26em', textTransform: 'uppercase', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="trend" size={11} />PROGRESS
          </span>
          <span className="ncx-serial">{doneCount}/{total} STEPS</span>
        </div>
        <div className="ncx-bar slim">
          <i style={{
            width: `${pct}%`,
            background: chain.status === 'done'
              ? 'linear-gradient(90deg, var(--cyan), var(--teal))'
              : 'linear-gradient(90deg, var(--lime), var(--teal))',
            boxShadow: pct > 0 ? 'var(--glow-cyan)' : 'none',
          }} />
          <span className="seg-mask" />
        </div>
      </div>

      {/* Step track */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {steps.map((s, i) => (
          <StepRow key={s.id} step={s} isLast={i === steps.length - 1} />
        ))}
        {total === 0 && (
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', paddingLeft: 4 }}>No steps.</div>
        )}
      </div>
    </div>
  );
}

function StepRow({ step, isLast }: { step: ChainStep; isLast: boolean }) {
  const done = step.status === 'done';
  const available = step.status === 'available';
  const locked = step.status === 'locked';

  const nodeColor = done ? 'var(--lime)' : available ? 'var(--cyan)' : 'var(--line-2)';

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
      {/* Track gutter: node + connector */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 26 }}>
        <div style={{
          width: 26, height: 26, flexShrink: 0,
          border: `1px solid ${nodeColor}`,
          background: done
            ? 'linear-gradient(135deg, var(--lime), var(--teal))'
            : available ? 'color-mix(in srgb, var(--cyan) 18%, var(--panel-2))'
            : 'var(--panel-2)',
          color: done ? 'white' : available ? 'var(--cyan)' : 'var(--text-faint)',
          boxShadow: available ? 'var(--glow-cyan)' : done ? 'var(--glow-lime)' : 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name={done ? 'check' : locked ? 'lock' : 'bolt'} size={13} />
        </div>
        {!isLast && (
          <div style={{
            flex: 1, width: 2, minHeight: 14,
            background: done ? 'var(--lime)' : 'var(--line)',
            opacity: done ? 0.5 : 1,
          }} />
        )}
      </div>

      {/* Step body */}
      <div style={{ flex: 1, minWidth: 0, paddingBottom: isLast ? 0 : 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 13,
            fontWeight: available ? 700 : 500,
            color: done ? 'var(--lime)' : available ? 'var(--text)' : 'var(--text-faint)',
            textDecoration: done ? 'line-through' : 'none',
            textDecorationColor: 'rgba(67,255,166,0.5)',
          }}>
            {step.title}
          </span>

          {available && (
            <span
              className="ncx-stamp flat"
              style={{ fontSize: 8.5, padding: '2px 7px', color: 'var(--cyan)', background: 'rgba(var(--accent-rgb), 0.12)' }}
            >
              CURRENT
            </span>
          )}
          {locked && (
            <Icon name="lock" size={11} style={{ color: 'var(--text-faint)' }} />
          )}
        </div>

        {step.description && (
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2, opacity: locked ? 0.6 : 1 }}>
            {step.description}
          </div>
        )}

        {/* Meta chips: difficulty / xp / est. XP only highlighted on the current step. */}
        <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span
            className="ncx-stamp flat"
            style={{ fontSize: 8.5, padding: '2px 7px', color: DIFF_COLOR[step.difficulty] }}
          >
            {step.difficulty.toUpperCase()}
          </span>
          <MetaChip
            color={available ? 'var(--amber)' : 'var(--text-faint)'}
            icon="bolt"
            label={`+${step.xpReward}`}
          />
          {step.estMinutes != null && (
            <MetaChip color="var(--violet)" icon="clock" label={`${step.estMinutes}m`} />
          )}
        </div>
      </div>
    </div>
  );
}

function MetaChip({ color, icon, label }: { color: string; icon?: string; label: string }) {
  return (
    <span
      className="mono"
      style={{
        fontSize: 10, color,
        padding: '2px 7px',
        background: `color-mix(in srgb, ${color} 8%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 28%, transparent)`,
        display: 'inline-flex', alignItems: 'center', gap: 3,
      }}
    >
      {icon && <Icon name={icon} size={10} />}
      {label}
    </span>
  );
}

// ---- Create form -------------------------------------------------------

function ChainForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('');
  const [steps, setSteps] = useState<string[]>(['']);

  const cleanSteps = () => steps.map(s => s.trim()).filter(Boolean);
  const canCreate = name.trim().length > 0 && cleanSteps().length > 0;

  const create = useMutation({
    mutationFn: () => api.post('/api/chains', {
      name: name.trim(),
      description: description.trim() || null,
      color: color.trim() || null,
      steps: cleanSteps().map(title => ({ title })),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chains'] });
      qc.invalidateQueries({ queryKey: ['quests', 'today'] });
      onClose();
    },
  });

  const setStep = (i: number, v: string) =>
    setSteps(prev => prev.map((s, idx) => (idx === i ? v : s)));
  const addStep = () => setSteps(prev => [...prev, '']);
  const removeStep = (i: number) =>
    setSteps(prev => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)));

  return (
    <div className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, borderLeft: '3px solid var(--cyan)' }}>
      <input
        autoFocus
        className="ncx-input"
        placeholder="Questline name (e.g. Operation Clean Slate)"
        value={name}
        onChange={e => setName(e.target.value)}
      />
      <input
        className="ncx-input"
        placeholder="Brief (optional)"
        value={description}
        onChange={e => setDescription(e.target.value)}
      />
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, alignSelf: 'flex-start' }}>
        <span className="kicker">ACCENT</span>
        <input
          className="ncx-input"
          placeholder="#48d1ff"
          value={color}
          onChange={e => setColor(e.target.value)}
          style={{ width: 110 }}
        />
      </label>

      {/* Steps editor */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="mono" style={{ fontSize: 10, letterSpacing: '0.26em', textTransform: 'uppercase', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="layers" size={11} />STEPS
        </span>
        {steps.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', width: 20, textAlign: 'right' }}>{i + 1}.</span>
            <input
              className="ncx-input"
              placeholder={`Step ${i + 1} title`}
              value={s}
              onChange={e => setStep(i, e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (i === steps.length - 1) addStep();
                }
              }}
              style={{ flex: 1, minWidth: 140, width: 'auto' }}
            />
            <button
              className="btn btn-ghost"
              style={{ padding: '6px 8px' }}
              onClick={() => removeStep(i)}
              disabled={steps.length <= 1}
              title="Remove step"
              aria-label={`Remove step ${i + 1}`}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        ))}
        <button className="btn btn-ghost" style={{ alignSelf: 'flex-start', fontSize: 11, padding: '5px 10px' }} onClick={addStep}>
          <Icon name="plus" size={12} style={{ marginRight: 4 }} /> ADD STEP
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost" onClick={onClose}>CANCEL</button>
        <button
          className="btn btn-primary"
          disabled={!canCreate || create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? 'CREATING…' : 'CREATE'}
        </button>
      </div>
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
