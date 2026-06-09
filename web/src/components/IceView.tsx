/**
 * IceView — Anti-goals ("ICE"): the things you defend against.
 *
 * Model: "assumed clean, log only slips." Every day starts SECURE; clean
 * days and the avoidance streak are credited automatically at roll-over by
 * the spine. You only tap BREACH when you slip — the red breach IS the
 * sting, so the calm state stays motivating (no harsh numbers, no debuff).
 *
 * Security/ICE flavor: shields, locks, red breach alarms. Design system
 * only — reuses .panel / .btn / kicker / mono and CSS vars.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { AntiGoal } from '../lib/api';
import { Icon } from './Icon';
import { ConfirmDialog } from './ConfirmDialog';

type Difficulty = AntiGoal['difficulty'];

const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: 'LOW', medium: 'MED', hard: 'HIGH',
};

export function IceView() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [pendingBreach, setPendingBreach] = useState<AntiGoal | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AntiGoal | null>(null);

  const listQ = useQuery({
    queryKey: ['antigoals'],
    queryFn: () => api.get<{ antigoals: AntiGoal[] }>('/api/antigoals').then(r => r.antigoals),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['antigoals'] });

  const breach = useMutation({
    mutationFn: (id: string) => api.post(`/api/antigoals/${id}/breach`, {}),
    onSuccess: () => {
      invalidate();
      // A breach resets the avoidance streak; nudge the HUD just in case.
      qc.invalidateQueries({ queryKey: ['player'] });
      setPendingBreach(null);
    },
  });

  const toggleActive = useMutation({
    mutationFn: (vars: { id: string; isActive: boolean }) =>
      api.put(`/api/antigoals/${vars.id}`, { isActive: vars.isActive }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/antigoals/${id}`),
    onSuccess: () => { invalidate(); setPendingDelete(null); },
  });

  if (listQ.isLoading) return <Empty>BOOTING ICE…</Empty>;
  if (listQ.isError) return <Empty color="var(--red)">FAILED TO LOAD DEFENSES</Empty>;

  const items = listQ.data ?? [];
  const active = items.filter(i => i.isActive);
  const archived = items.filter(i => !i.isActive);
  const breachedCount = active.filter(i => i.breachedToday).length;

  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <Header total={active.length} breached={breachedCount} />

      {creating
        ? <AddForm onClose={() => setCreating(false)} onDone={invalidate} />
        : (
          <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setCreating(true)}>
            <Icon name="plus" size={14} /> INSTALL ICE
          </button>
        )}

      {active.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {active.map(ag => (
            <IceCard
              key={ag.id}
              ag={ag}
              busy={breach.isPending}
              onBreach={() => setPendingBreach(ag)}
              onArchive={() => toggleActive.mutate({ id: ag.id, isActive: false })}
              onDelete={() => setPendingDelete(ag)}
            />
          ))}
        </section>
      )}

      {archived.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="kicker" style={{ paddingLeft: 4, color: 'var(--text-faint)' }}>
            OFFLINE · {archived.length}
          </div>
          {archived.map(ag => (
            <IceCard
              key={ag.id}
              ag={ag}
              archived
              busy={false}
              onBreach={() => {}}
              onArchive={() => toggleActive.mutate({ id: ag.id, isActive: true })}
              onDelete={() => setPendingDelete(ag)}
            />
          ))}
        </section>
      )}

      {items.length === 0 && (
        <Empty>No ICE installed. Name something to defend against above.</Empty>
      )}

      <ConfirmDialog
        open={pendingBreach !== null}
        danger
        title="Log a breach?"
        message={pendingBreach && (
          <>
            Record a slip on <strong style={{ color: 'var(--text)' }}>{pendingBreach.title}</strong> for
            today. Your avoidance streak resets to zero — tomorrow is a clean start.
          </>
        )}
        confirmLabel="CONFIRM BREACH"
        busy={breach.isPending}
        onConfirm={() => pendingBreach && breach.mutate(pendingBreach.id)}
        onCancel={() => setPendingBreach(null)}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        danger
        title="Decommission ICE?"
        message={pendingDelete && (
          <>This permanently removes <strong style={{ color: 'var(--text)' }}>{pendingDelete.title}</strong> and its breach log. Your record stays banked.</>
        )}
        confirmLabel="DECOMMISSION"
        busy={remove.isPending}
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete.id)}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

function Header({ total, breached }: { total: number; breached: number }) {
  const allSecure = breached === 0;
  return (
    <div className="panel hud" style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
      <Icon name="shield" size={20} style={{ color: allSecure ? 'var(--cyan)' : 'var(--red)' }} />
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, fontFamily: 'var(--font-display)' }}>ICE</h2>
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
          intrusion countermeasures · log only slips
        </div>
      </div>
      <div
        className="mono"
        style={{
          marginLeft: 'auto', fontSize: 11,
          color: allSecure ? 'var(--cyan)' : 'var(--red)',
          padding: '4px 8px',
          background: allSecure
            ? 'color-mix(in srgb, var(--cyan) 8%, transparent)'
            : 'color-mix(in srgb, var(--red) 10%, transparent)',
          borderRadius: 6,
          border: `1px solid ${allSecure ? 'var(--line)' : 'color-mix(in srgb, var(--red) 40%, transparent)'}`,
        }}
      >
        {allSecure ? `${total} SECURE` : `${breached} BREACHED`}
      </div>
    </div>
  );
}

function streakLabel(n: number): string {
  return `${n} day${n === 1 ? '' : 's'} clean`;
}

function IceCard({
  ag, archived, busy, onBreach, onArchive, onDelete,
}: {
  ag: AntiGoal;
  archived?: boolean;
  busy: boolean;
  onBreach: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const breached = ag.breachedToday;
  const accent = breached ? 'var(--red)' : (ag.color || 'var(--cyan)');

  return (
    <div
      className="panel"
      style={{
        padding: 16,
        display: 'flex', alignItems: 'center', gap: 16,
        opacity: archived ? 0.55 : 1,
        border: breached
          ? '1px solid color-mix(in srgb, var(--red) 55%, transparent)'
          : '1px solid var(--line)',
        background: breached
          ? 'linear-gradient(180deg, color-mix(in srgb, var(--red) 9%, transparent), color-mix(in srgb, var(--red) 3%, transparent))'
          : undefined,
        boxShadow: breached ? '0 0 18px color-mix(in srgb, var(--red) 22%, transparent)' : undefined,
      }}
    >
      {/* sigil */}
      <div style={{
        width: 46, height: 46, borderRadius: 10, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: `color-mix(in srgb, ${accent} 10%, transparent)`,
        border: `1px solid color-mix(in srgb, ${accent} 35%, transparent)`,
        color: accent,
      }}>
        <Icon name={(ag.icon as any) || (breached ? 'lock' : 'shield')} size={22} />
      </div>

      {/* body */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{ag.title}</span>
          <span
            className="mono"
            title="Stakes"
            style={{
              fontSize: 9, fontWeight: 700, letterSpacing: '0.05em',
              color: 'var(--text-faint)',
              padding: '2px 6px', borderRadius: 5,
              border: '1px solid var(--line)', textTransform: 'uppercase',
            }}
          >
            {DIFFICULTY_LABEL[ag.difficulty]} RISK
          </span>
        </div>

        {breached ? (
          <div
            className="mono"
            style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--red)', textTransform: 'uppercase' }}
          >
            ⚠ BREACHED TODAY — defenses down
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="shield" size={12} style={{ color: 'var(--cyan)' }} />
            <span className="mono" style={{ fontSize: 12, color: 'var(--cyan)' }}>SECURE</span>
            {ag.currentStreak > 0 && (
              <>
                <span style={{ color: 'var(--text-faint)' }}>·</span>
                <span className="mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                  <Icon name="flame" size={11} style={{ color: 'var(--amber)', marginRight: 4 }} />
                  {streakLabel(ag.currentStreak)}
                </span>
              </>
            )}
            {ag.longestStreak > ag.currentStreak && ag.longestStreak > 0 && (
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                · best {ag.longestStreak}
              </span>
            )}
          </div>
        )}
      </div>

      {/* actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {!archived && (
          <button
            className="btn"
            disabled={busy || breached}
            onClick={onBreach}
            title={breached ? 'Already breached today' : 'Log a slip for today'}
            style={{
              padding: '8px 16px', fontSize: 12, fontWeight: 700, letterSpacing: '0.06em',
              color: breached ? 'var(--text-faint)' : 'var(--red)',
              borderColor: breached ? 'var(--line)' : 'color-mix(in srgb, var(--red) 50%, transparent)',
              background: breached ? undefined : 'color-mix(in srgb, var(--red) 10%, transparent)',
              cursor: breached ? 'default' : 'pointer',
            }}
          >
            <Icon name="bolt" size={13} /> {breached ? 'BREACHED' : 'BREACH'}
          </button>
        )}
        <button
          className="btn btn-ghost"
          onClick={onArchive}
          title={archived ? 'Bring back online' : 'Take offline'}
          style={{ padding: '6px 10px', fontSize: 11, color: 'var(--text-faint)' }}
        >
          {archived ? <><Icon name="repeat" size={12} /> ONLINE</> : <Icon name="moon" size={13} />}
        </button>
        <button
          className="btn btn-ghost"
          onClick={onDelete}
          aria-label={`Decommission ${ag.title}`}
          title="Decommission"
          style={{ padding: '6px 8px', fontSize: 11 }}
        >
          <Icon name="close" size={14} />
        </button>
      </div>
    </div>
  );
}

/** Install-ICE form: title + risk level. */
function AddForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');

  const create = useMutation({
    mutationFn: () => api.post('/api/antigoals', { title: title.trim(), difficulty }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['antigoals'] });
      onDone();
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
            placeholder="e.g. No doomscrolling after midnight"
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && title.trim() && !create.isPending) create.mutate(); }}
            style={inputStyle}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="kicker">RISK</span>
          <select value={difficulty} onChange={e => setDifficulty(e.target.value as Difficulty)} style={inputStyle}>
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
        <button
          className="btn btn-primary"
          disabled={!title.trim() || create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? 'INSTALLING…' : 'INSTALL ICE'}
        </button>
      </div>
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
  background: 'var(--panel-2)',
  border: '1px solid var(--line-2)',
  borderRadius: 'var(--r-sm)',
  color: 'var(--text)',
  fontFamily: 'var(--font-mono)',
  fontSize: 13,
  outline: 'none',
};
