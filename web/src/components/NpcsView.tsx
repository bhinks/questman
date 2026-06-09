/**
 * NpcsView — "Crew": your street contacts / fixers.
 *
 * We track time-since-last-contact for everyone (cadence optional). A
 * contact's signal "decays" the longer you go without reaching out —
 * neglected contacts glow red. Logging a contact (inline form) posts an
 * interaction; the first one logged today clears the generic social quest.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Npc, Interaction } from '../lib/api';
import { Icon } from './Icon';
import { ConfirmDialog } from './ConfirmDialog';

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

/** Signal-decay tier from days-since-contact + cadence. */
type Signal = { color: string; label: string; level: 'strong' | 'fading' | 'lost' };
function signalFor(npc: Npc): Signal {
  const days = npc.daysSinceContact;
  if (days == null) {
    return { color: 'var(--red)', label: 'NO SIGNAL', level: 'lost' };
  }
  const threshold = npc.cadenceDays ?? 21;
  if (days > threshold) {
    return { color: 'var(--red)', label: `${days}D DARK`, level: 'lost' };
  }
  // Within 75% of the threshold = strong; the last quarter = fading.
  if (days > threshold * 0.75) {
    return { color: 'var(--amber)', label: `${days}D AGO`, level: 'fading' };
  }
  return { color: 'var(--lime)', label: days === 0 ? 'TODAY' : `${days}D AGO`, level: 'strong' };
}

export function NpcsView() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loggingId, setLoggingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Npc | null>(null);

  const npcsQ = useQuery({
    queryKey: ['npcs'],
    queryFn: () => api.get<{ npcs: Npc[] }>('/api/npcs').then(r => r.npcs),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/npcs/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['npcs'] });
      setPendingDelete(null);
    },
  });

  if (npcsQ.isLoading) return <Empty>LOADING CREW…</Empty>;
  if (npcsQ.isError) return <Empty color="var(--red)">FAILED TO LOAD</Empty>;

  const npcs = npcsQ.data ?? [];
  const dark = npcs.filter(n => signalFor(n).level === 'lost').length;

  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <Header count={npcs.length} dark={dark} />

      {creating
        ? <NpcForm onClose={() => setCreating(false)} />
        : (
          <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setCreating(true)}>
            <Icon name="plus" size={14} style={{ marginRight: 6 }} /> NEW CONTACT
          </button>
        )}

      {npcs.length === 0 && (
        <Empty>No contacts yet — wire up your crew above.</Empty>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {npcs.map(npc =>
          editingId === npc.id
            ? <NpcForm key={npc.id} npc={npc} onClose={() => setEditingId(null)} />
            : (
              <NpcCard
                key={npc.id}
                npc={npc}
                logging={loggingId === npc.id}
                onToggleLog={() => setLoggingId(loggingId === npc.id ? null : npc.id)}
                onCloseLog={() => setLoggingId(null)}
                onEdit={() => setEditingId(npc.id)}
                onDelete={() => setPendingDelete(npc)}
              />
            )
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        danger
        title="Drop contact?"
        message={pendingDelete && <>This permanently removes <strong style={{ color: 'var(--text)' }}>{pendingDelete.name}</strong> and the entire contact log. This can&rsquo;t be undone.</>}
        confirmLabel="DROP"
        busy={remove.isPending}
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete.id)}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

function Header({ count, dark }: { count: number; dark: number }) {
  return (
    <div className="panel hud" style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
      <Icon name="heart" size={20} style={{ color: 'var(--magenta)' }} />
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, fontFamily: 'var(--font-display)' }}>Crew</h2>
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
          STREET CONTACTS · FIXERS
        </div>
      </div>
      <div
        className="mono"
        style={{
          marginLeft: 'auto', fontSize: 11,
          color: dark > 0 ? 'var(--red)' : 'var(--text-dim)',
          padding: '4px 8px', background: 'var(--panel-2)',
          borderRadius: 6, border: `1px solid ${dark > 0 ? 'rgba(255,77,90,0.4)' : 'var(--line)'}`,
        }}
      >
        {dark} DARK · {count} TOTAL
      </div>
    </div>
  );
}

function NpcCard({
  npc, logging, onToggleLog, onCloseLog, onEdit, onDelete,
}: {
  npc: Npc;
  logging: boolean;
  onToggleLog: () => void;
  onCloseLog: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const sig = signalFor(npc);
  const recent = npc.interactions ?? [];

  return (
    <div
      className="panel"
      style={{
        padding: 14,
        border: `1px solid ${sig.level === 'lost' ? 'rgba(255,77,90,0.4)' : 'var(--line)'}`,
        background: sig.level === 'lost'
          ? 'linear-gradient(180deg, rgba(255,77,90,0.05), rgba(255,77,90,0.01))'
          : undefined,
        display: 'flex', flexDirection: 'column', gap: 12,
        // Lost-signal contacts feel dimmer / decayed.
        opacity: sig.level === 'lost' ? 0.92 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        {/* Signal pip */}
        <div
          title={sig.level === 'lost' ? 'Signal lost — reach out' : 'Signal'}
          style={{
            width: 10, height: 10, flexShrink: 0, borderRadius: '50%',
            background: sig.color,
            boxShadow: sig.level === 'strong' ? `0 0 8px ${sig.color}` : 'none',
          }}
        />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
            {npc.name}
          </div>
          {npc.relationship && (
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
              {npc.relationship}
              {npc.cadenceDays != null && <> · every {npc.cadenceDays}d</>}
            </div>
          )}
        </div>

        {/* Time-since-contact badge */}
        <div
          className="mono"
          title={npc.lastContactOn ? `Last contact: ${new Date(npc.lastContactOn).toLocaleDateString()}` : 'Never contacted'}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            fontSize: 11, color: sig.color,
            padding: '4px 8px',
            background: `color-mix(in srgb, ${sig.color} 10%, transparent)`,
            border: `1px solid color-mix(in srgb, ${sig.color} 35%, transparent)`,
            borderRadius: 6,
          }}
        >
          <Icon name={sig.level === 'lost' ? 'bell' : 'clock'} size={12} />
          {sig.label}
        </div>

        <button
          onClick={onToggleLog}
          className={logging ? 'btn' : 'btn btn-primary'}
          style={{ padding: '6px 10px', fontSize: 11 }}
        >
          {logging ? 'CANCEL' : 'LOG CONTACT'}
        </button>

        <button
          onClick={onEdit}
          className="btn btn-ghost"
          style={{ padding: '6px 8px', fontSize: 11 }}
          aria-label={`Edit ${npc.name}`}
          title="Edit"
        >
          <Icon name="edit" size={14} />
        </button>
        <button
          onClick={onDelete}
          className="btn btn-ghost"
          style={{ padding: '6px 8px', fontSize: 11 }}
          aria-label={`Delete ${npc.name}`}
          title="Drop contact"
        >
          <Icon name="close" size={14} />
        </button>
      </div>

      {npc.notes && (
        <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>
          {npc.notes}
        </div>
      )}

      {logging && <LogContactForm npcId={npc.id} onClose={onCloseLog} />}

      {recent.length > 0 && (
        <div className="panel-inset" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="kicker" style={{ fontSize: 9 }}>CONTACT LOG</span>
          {recent.slice(0, 5).map(i => <InteractionRow key={i.id} interaction={i} />)}
        </div>
      )}
    </div>
  );
}

function InteractionRow({ interaction: i }: { interaction: Interaction }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
      <span className="mono" style={{ color: 'var(--text-faint)', minWidth: 64 }}>
        {new Date(i.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
      </span>
      {i.planned && (
        <span className="mono" style={{ fontSize: 9, color: 'var(--violet)', border: '1px solid color-mix(in srgb, var(--violet) 35%, transparent)', borderRadius: 4, padding: '1px 5px' }}>
          PLANNED
        </span>
      )}
      {i.minutes != null && (
        <span className="mono" style={{ color: 'var(--teal)' }}>{i.minutes}m</span>
      )}
      <span style={{ color: 'var(--text-dim)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {i.note || '—'}
      </span>
    </div>
  );
}

/** Inline "log a contact" form. Posts an interaction and clears the
 *  generic social quest on the first contact of the day. */
function LogContactForm({ npcId, onClose }: { npcId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [minutes, setMinutes] = useState<number | ''>('');
  const [note, setNote] = useState('');
  const [planned, setPlanned] = useState(false);

  const log = useMutation({
    mutationFn: () => api.post(`/api/npcs/${npcId}/interactions`, {
      minutes: minutes === '' ? null : minutes,
      note: note.trim() || null,
      planned,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['npcs'] });
      qc.invalidateQueries({ queryKey: ['player'] });
      qc.invalidateQueries({ queryKey: ['player', 'stats'] });
      qc.invalidateQueries({ queryKey: ['quests', 'today'] });
      onClose();
    },
  });

  return (
    <div className="panel-inset" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span className="kicker">LOG CONTACT</span>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="kicker">MINUTES</span>
          <input
            type="number"
            min={0}
            max={1440}
            placeholder="—"
            value={minutes}
            onChange={e => setMinutes(e.target.value === '' ? '' : Math.max(0, Math.min(1440, Number(e.target.value))))}
            style={{ ...inputStyle, width: 90 }}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', paddingBottom: 8 }}>
          <input
            type="checkbox"
            checked={planned}
            onChange={e => setPlanned(e.target.checked)}
            style={{ accentColor: 'var(--violet)', width: 16, height: 16 }}
          />
          <span style={{ fontSize: 13, color: 'var(--text)' }}>Planned (future intent)</span>
        </label>
      </div>
      <input
        autoFocus
        placeholder="Note (e.g. grabbed coffee, talked shop)"
        value={note}
        onChange={e => setNote(e.target.value)}
        style={inputStyle}
      />
      {planned && (
        <div className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>
          Planned entries don&rsquo;t advance the contact clock.
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost" onClick={onClose}>CANCEL</button>
        <button
          className="btn btn-primary"
          disabled={log.isPending}
          onClick={() => log.mutate()}
        >
          {log.isPending ? 'LOGGING…' : 'LOG'}
        </button>
      </div>
    </div>
  );
}

/** Create/edit a contact. Edit mode when `npc` is supplied. */
function NpcForm({ npc, onClose }: { npc?: Npc; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = !!npc;

  const [name, setName] = useState(npc?.name ?? '');
  const [relationship, setRelationship] = useState(npc?.relationship ?? '');
  const [cadenceDays, setCadenceDays] = useState<number | ''>(npc?.cadenceDays ?? '');
  const [notes, setNotes] = useState(npc?.notes ?? '');

  const buildPayload = () => ({
    name: name.trim(),
    relationship: relationship.trim() || null,
    cadenceDays: cadenceDays === '' ? null : cadenceDays,
    notes: notes.trim() || null,
  });

  const save = useMutation({
    mutationFn: () => isEdit
      ? api.put(`/api/npcs/${npc!.id}`, buildPayload())
      : api.post('/api/npcs', buildPayload()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['npcs'] });
      onClose();
    },
  });

  return (
    <div className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <input
        autoFocus
        placeholder="Name (e.g. Jackie Welles)"
        value={name}
        onChange={e => setName(e.target.value)}
        style={inputStyle}
      />
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 180 }}>
          <span className="kicker">RELATIONSHIP</span>
          <input
            placeholder="e.g. fixer, old friend, sibling"
            value={relationship}
            onChange={e => setRelationship(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="kicker">CADENCE (DAYS)</span>
          <input
            type="number"
            min={1}
            max={3650}
            placeholder="optional"
            value={cadenceDays}
            onChange={e => setCadenceDays(e.target.value === '' ? '' : Math.max(1, Math.min(3650, Number(e.target.value))))}
            style={{ ...inputStyle, width: 110 }}
          />
        </label>
      </div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="kicker">NOTES</span>
        <textarea
          placeholder="Context, how you know them, what to talk about…"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
          style={{ ...inputStyle, resize: 'vertical', fontFamily: 'var(--font-mono)' }}
        />
      </label>
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
