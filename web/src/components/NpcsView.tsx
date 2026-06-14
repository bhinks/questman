/**
 * NpcsView — "Crew": people you don't want to lose touch with, plus frequent
 * friends you just log hangouts with.
 *
 * One page, cadence optional. Cadence is a friendly TIER (weekly / monthly /
 * quarterly / yearly) or Casual (no cadence → never decays in the view). A
 * contact's signal "decays" the longer you go without reaching out: green
 * (strong) → amber (fading) → red (dark). Casual contacts read teal/frequent.
 *
 * Tiers map onto the existing `cadenceDays` column (7/30/90/365, Casual=null),
 * so no cadence schema change. Logging an interaction captures channel + note +
 * who reached out; the first real contact logged today clears the generic
 * social quest (handled server-side).
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Npc, Interaction, NpcChannel, NpcInitiatedBy } from '../lib/api';
import { Icon } from './Icon';
import { ConfirmDialog } from './ConfirmDialog';

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

/* ---------- cadence tiers (mapped onto cadenceDays) ---------- */
type TierKey = 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'casual';
const TIERS: { key: Exclude<TierKey, 'casual'>; label: string; days: number }[] = [
  { key: 'weekly',    label: 'WEEKLY',    days: 7 },
  { key: 'monthly',   label: 'MONTHLY',   days: 30 },
  { key: 'quarterly', label: 'QUARTERLY', days: 90 },
  { key: 'yearly',    label: 'YEARLY',    days: 365 },
];

/** Nearest tier for a stored day-count (handles legacy free-int cadences). */
function tierOf(cadenceDays: number | null): TierKey {
  if (cadenceDays == null) return 'casual';
  let best = TIERS[0];
  for (const t of TIERS) {
    if (Math.abs(t.days - cadenceDays) < Math.abs(best.days - cadenceDays)) best = t;
  }
  return best.key;
}
function tierToDays(tier: TierKey): number | null {
  if (tier === 'casual') return null;
  return TIERS.find(t => t.key === tier)!.days;
}
function tierLabel(tier: TierKey): string {
  return tier === 'casual' ? 'CASUAL' : (TIERS.find(t => t.key === tier)?.label ?? 'CASUAL');
}

/* ---------- signal + urgency ---------- */
type SignalLevel = 'frequent' | 'strong' | 'fading' | 'dark';
type Signal = { level: SignalLevel; color: string; label: string };

/** Signal-decay tier from days-since-contact + cadence. Casual never decays. */
function signalFor(npc: Npc): Signal {
  const days = npc.daysSinceContact ?? null;
  if (npc.cadenceDays == null) {
    const label = days == null ? 'NO LOGS' : days === 0 ? 'TODAY' : `${days}D AGO`;
    return { level: 'frequent', color: 'var(--teal)', label };
  }
  const thr = npc.cadenceDays;
  if (days == null)        return { level: 'dark',   color: 'var(--red)',   label: 'NO SIGNAL' };
  if (days > thr)          return { level: 'dark',   color: 'var(--red)',   label: `${days}D DARK` };
  if (days > thr * 0.75)   return { level: 'fading', color: 'var(--amber)', label: `${days}D AGO` };
  return { level: 'strong', color: 'var(--lime)', label: days === 0 ? 'TODAY' : `${days}D AGO` };
}

/** Urgency 0..1+ for the reach-out lane (tiered only; casual sorts out). */
function urgency(npc: Npc): number {
  if (npc.cadenceDays == null) return -1;
  if (npc.daysSinceContact == null) return 2;
  return npc.daysSinceContact / npc.cadenceDays;
}

const daysAgoOf = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/* ---------- channels ---------- */
const CHANNELS: { key: NpcChannel; label: string; color: string }[] = [
  { key: 'irl',   label: 'IRL',   color: 'var(--lime)' },
  { key: 'call',  label: 'CALL',  color: 'var(--cyan)' },
  { key: 'text',  label: 'TEXT',  color: 'var(--violet)' },
  { key: 'video', label: 'VIDEO', color: 'var(--amber)' },
];
const CHANNEL_META: Record<NpcChannel, { label: string; color: string }> = Object.fromEntries(
  CHANNELS.map(c => [c.key, { label: c.label, color: c.color }]),
) as Record<NpcChannel, { label: string; color: string }>;

function ChannelChip({ ch }: { ch: NpcChannel | null }) {
  if (!ch) return null;
  const m = CHANNEL_META[ch] ?? { label: String(ch).toUpperCase(), color: 'var(--text-dim)' };
  return (
    <span className="mono" style={{
      fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: m.color, padding: '1px 6px',
      border: `1px solid color-mix(in srgb, ${m.color} 35%, transparent)`,
      background: `color-mix(in srgb, ${m.color} 10%, transparent)`,
    }}>{m.label}</span>
  );
}

function WhoChip({ who }: { who: NpcInitiatedBy | null }) {
  if (!who) return null;
  const me = who === 'me';
  const color = me ? 'var(--cyan)' : 'var(--magenta)';
  return (
    <span className="mono" style={{ fontSize: 9, letterSpacing: '0.08em', color, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <Icon name={me ? 'arrowUp' : 'arrowDn'} size={10} style={{ color }} />{me ? 'YOU' : 'THEM'}
    </span>
  );
}

/* ---------- log-interaction mutation (shared) ---------- */
type LogVars = { npcId: string; channel: NpcChannel | null; initiatedBy: NpcInitiatedBy | null; note: string | null };
function useLogInteraction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ npcId, ...body }: LogVars) => api.post(`/api/npcs/${npcId}/interactions`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['npcs'] });
      qc.invalidateQueries({ queryKey: ['player'] });
      qc.invalidateQueries({ queryKey: ['player', 'stats'] });
      qc.invalidateQueries({ queryKey: ['quests', 'today'] });
    },
  });
}

/* ---------- stat strip ---------- */
function StatStrip({ npcs, action }: { npcs: Npc[]; action?: React.ReactNode }) {
  const tiered = npcs.filter(n => n.cadenceDays != null);
  const counts = { strong: 0, fading: 0, dark: 0 } as Record<string, number>;
  tiered.forEach(n => { const l = signalFor(n).level; counts[l] = (counts[l] || 0) + 1; });
  const weekInteractions = npcs.reduce(
    (a, n) => a + (n.interactions || []).filter(i => daysAgoOf(i.date) <= 7).length, 0,
  );
  const neglected = tiered
    .filter(n => n.daysSinceContact != null)
    .sort((a, b) => urgency(b) - urgency(a))[0];

  return (
    <div className="panel" style={{ padding: '12px 18px', display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'center', flex: 1, minWidth: 0 }}>
      <Stat label="IN TOUCH" value={counts.strong || 0} color="var(--lime)" />
      <Stat label="FADING" value={counts.fading || 0} color="var(--amber)" />
      <Stat label="GOING DARK" value={counts.dark || 0} color="var(--red)" />
      <span style={{ width: 1, height: 28, background: 'var(--line-2)' }} />
      <Stat label="LOGGED THIS WK" value={weekInteractions} color="var(--cyan)" />
      {neglected && <Stat label="LONGEST QUIET" value={`${neglected.name} · ${neglected.daysSinceContact}d`} color="var(--text-dim)" small />}
      {action && <div style={{ marginLeft: 'auto' }}>{action}</div>}
    </div>
  );
}
function Stat({ label, value, color, small }: { label: string; value: React.ReactNode; color: string; small?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span className="ncx-serial">{label}</span>
      <span className="ncx-val" style={{ fontSize: small ? 13 : 19, color }}>{value}</span>
    </div>
  );
}

/* ---------- reach-out headline lane ---------- */
function ReachOutLane({ npcs, onOpen }: { npcs: Npc[]; onOpen: (id: string) => void }) {
  const logMut = useLogInteraction();
  const due = npcs.filter(n => urgency(n) > 0.75).sort((a, b) => urgency(b) - urgency(a));
  return (
    <div className="panel hud ncx-scan" style={{ padding: 18, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="sweep" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="ncx-chip" style={{ color: 'var(--magenta)', flex: 'none' }}><Icon name="bell" size={18} /></div>
        <div>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '0.26em', color: 'var(--text-dim)', textTransform: 'uppercase' }}>REACH OUT</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 700, color: 'var(--text)', marginTop: 2 }}>
            {due.length ? `${due.length} ${due.length === 1 ? 'person is' : 'people are'} slipping` : 'Everyone’s in touch'}
          </div>
        </div>
        <span className="ncx-serial" style={{ marginLeft: 'auto' }}>BY URGENCY</span>
      </div>
      {due.length === 0 ? (
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-faint)' }}>No one&rsquo;s going dark. Nice work keeping the crew close.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(248px, 1fr))', gap: 12 }}>
          {due.map(n => {
            const sig = signalFor(n);
            const last = (n.interactions || [])[0];
            const over = n.daysSinceContact == null ? 1 : Math.min(1, urgency(n));
            return (
              <div key={n.id} className="panel-inset" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 9, borderLeft: `2px solid ${sig.color}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: sig.color, flex: 'none' }} />
                  <button onClick={() => onOpen(n.id)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', minWidth: 0, flex: 1, textAlign: 'left' }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>{n.name}</span>
                  </button>
                  <span className="mono" style={{ fontSize: 9.5, fontWeight: 700, color: sig.color }}>{sig.label}</span>
                </div>
                <div className="mono" style={{ fontSize: 9.5, color: 'var(--text-faint)', letterSpacing: '0.04em' }}>
                  {n.relationship || '—'} · {tierLabel(tierOf(n.cadenceDays)).toLowerCase()}
                </div>
                <div className="ncx-bar slim"><i style={{ width: `${over * 100}%`, background: sig.color }} /><span className="seg-mask" /></div>
                {last && <div className="mono" style={{ fontSize: 10, color: 'var(--text-faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>last: {last.note || (last.channel ? CHANNEL_META[last.channel]?.label.toLowerCase() : '—')}</div>}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-primary" style={{ flex: 1, padding: '6px', fontSize: 10 }}
                    disabled={logMut.isPending}
                    onClick={() => logMut.mutate({ npcId: n.id, channel: null, initiatedBy: 'me', note: null })}>
                    <Icon name="check" size={11} /> REACHED OUT
                  </button>
                  <button className="btn btn-ghost" style={{ padding: '6px 9px', fontSize: 10 }} onClick={() => onOpen(n.id)} title="Log details">{'…'}</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------- log form (channel + who + note) ---------- */
function LogForm({ npcId, onClose }: { npcId: string; onClose: () => void }) {
  const logMut = useLogInteraction();
  const [channel, setChannel] = useState<NpcChannel>('irl');
  const [who, setWho] = useState<NpcInitiatedBy>('me');
  const [note, setNote] = useState('');
  return (
    <div className="panel-inset" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span className="mono" style={{ fontSize: 10, letterSpacing: '0.26em', color: 'var(--text-dim)', textTransform: 'uppercase' }}>LOG CONTACT</span>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 0, boxShadow: 'inset 0 0 0 1px var(--line-2)' }}>
          {CHANNELS.map(ch => {
            const on = channel === ch.key;
            return <button key={ch.key} type="button" onClick={() => setChannel(ch.key)} className="mono" style={{ padding: '6px 12px', fontSize: 10, letterSpacing: '0.08em', cursor: 'pointer', border: 'none', background: on ? `color-mix(in srgb, ${ch.color} 18%, transparent)` : 'transparent', color: on ? ch.color : 'var(--text-dim)', fontWeight: on ? 700 : 500, boxShadow: on ? `inset 0 0 0 1px ${ch.color}` : 'none' }}>{ch.label}</button>;
          })}
        </div>
        <div style={{ display: 'flex', gap: 0, boxShadow: 'inset 0 0 0 1px var(--line-2)', marginLeft: 'auto' }}>
          {([['me', 'I REACHED OUT'], ['them', 'THEY DID']] as [NpcInitiatedBy, string][]).map(([k, label]) => {
            const on = who === k;
            const c = k === 'me' ? 'var(--cyan)' : 'var(--magenta)';
            return <button key={k} type="button" onClick={() => setWho(k)} className="mono" style={{ padding: '6px 12px', fontSize: 10, letterSpacing: '0.06em', cursor: 'pointer', border: 'none', background: on ? `color-mix(in srgb, ${c} 16%, transparent)` : 'transparent', color: on ? c : 'var(--text-dim)', fontWeight: on ? 700 : 500, boxShadow: on ? `inset 0 0 0 1px ${c}` : 'none' }}>{label}</button>;
          })}
        </div>
      </div>
      <input autoFocus value={note} onChange={e => setNote(e.target.value)} placeholder="Note (e.g. grabbed coffee, talked shop)" style={inputStyle} />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost" onClick={onClose}>CANCEL</button>
        <button className="btn btn-primary" disabled={logMut.isPending}
          onClick={() => logMut.mutate({ npcId, channel, initiatedBy: who, note: note.trim() || null }, { onSuccess: onClose })}>
          {logMut.isPending ? 'LOGGING…' : 'LOG'}
        </button>
      </div>
    </div>
  );
}

/* ---------- contact card (shared by List + Board) ---------- */
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
  const recent = npc.interactions || [];
  const last = recent[0];
  const [open, setOpen] = useState(false);

  return (
    <div className="panel" style={{
      padding: 12, display: 'flex', flexDirection: 'column', gap: 9,
      border: sig.level === 'dark' ? '1px solid color-mix(in srgb, var(--red) 38%, transparent)' : '1px solid var(--line)',
      background: sig.level === 'dark' ? 'linear-gradient(180deg, color-mix(in srgb, var(--red) 5%, transparent), transparent)' : undefined,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 9, height: 9, flex: 'none', borderRadius: '50%', background: sig.color, boxShadow: sig.level === 'strong' || sig.level === 'frequent' ? `0 0 8px ${sig.color}` : 'none' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{npc.name}</div>
          <div className="mono" style={{ fontSize: 9.5, color: 'var(--text-dim)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {npc.relationship || '—'}<span style={{ color: 'var(--text-ghost)' }}> · {npc.cadenceDays != null ? `every ${tierLabel(tierOf(npc.cadenceDays)).toLowerCase()}` : 'frequent'}</span>
          </div>
        </div>
        <span className="mono" style={{ fontSize: 9, letterSpacing: '0.06em', color: sig.color, padding: '3px 7px', background: `color-mix(in srgb, ${sig.color} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${sig.color} 35%, transparent)`, display: 'inline-flex', alignItems: 'center', gap: 4, flex: 'none' }}>
          <Icon name={sig.level === 'dark' ? 'bell' : 'clock'} size={10} />{sig.label}
        </span>
        <button onClick={onToggleLog} className={logging ? 'btn' : 'btn btn-primary'} style={{ padding: '5px 9px', fontSize: 10, flex: 'none' }}>{logging ? 'CANCEL' : 'LOG'}</button>
        <button onClick={onEdit} className="btn btn-ghost" style={{ padding: '5px 6px', flex: 'none' }} aria-label={`Edit ${npc.name}`} title="Edit"><Icon name="edit" size={12} /></button>
        <button onClick={onDelete} className="btn btn-ghost" style={{ padding: '5px 6px', flex: 'none' }} aria-label={`Drop ${npc.name}`} title="Drop"><Icon name="close" size={12} /></button>
      </div>

      {logging && <LogForm npcId={npc.id} onClose={onCloseLog} />}

      {/* collapsible contact log — one-line summary, tap to expand */}
      {recent.length > 0 && !logging && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: open ? 7 : 0 }}>
          <button onClick={() => setOpen(o => !o)} title={open ? 'Hide log' : 'Show contact log'}
            style={{ display: 'flex', alignItems: 'center', gap: 7, width: '100%', textAlign: 'left', cursor: 'pointer', background: 'transparent', border: 'none', borderTop: '1px solid var(--line)', padding: '8px 0 0' }}>
            <span className="mono" style={{ fontSize: 9, color: 'var(--text-faint)', flex: 'none' }}>{shortDate(last.date)}</span>
            <ChannelChip ch={last.channel} />
            <WhoChip who={last.initiatedBy} />
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-dim)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{last.note || '—'}</span>
            <span className="mono" style={{ fontSize: 9, color: 'var(--text-faint)', flex: 'none' }}>{open ? '▾' : '▸'} {recent.length}</span>
          </button>
          {open && (
            <div className="panel-inset" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 7 }}>
              {recent.slice(0, 8).map((i: Interaction) => (
                <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  <span className="mono" style={{ color: 'var(--text-faint)', minWidth: 50, fontSize: 10 }}>{shortDate(i.date)}</span>
                  <ChannelChip ch={i.channel} />
                  <WhoChip who={i.initiatedBy} />
                  <span style={{ color: 'var(--text-dim)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.note || '—'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- add / edit form ---------- */
function NpcForm({ npc, onClose }: { npc?: Npc; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = !!npc;
  const [name, setName] = useState(npc?.name ?? '');
  const [relationship, setRelationship] = useState(npc?.relationship ?? '');
  const [tier, setTier] = useState<TierKey>(tierOf(npc?.cadenceDays ?? null));
  const [notes, setNotes] = useState(npc?.notes ?? '');

  const buildPayload = () => ({
    name: name.trim(),
    relationship: relationship.trim() || null,
    cadenceDays: tierToDays(tier),
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
      <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Name (e.g. Jackie Welles)" style={inputStyle} />
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 180 }}>
          <span className="kicker">RELATIONSHIP</span>
          <input value={relationship} onChange={e => setRelationship(e.target.value)} placeholder="e.g. fixer, old friend, sibling" style={inputStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="kicker">KEEP IN TOUCH</span>
          <select value={tier} onChange={e => setTier(e.target.value as TierKey)} style={inputStyle}>
            <option value="casual">Casual (no cadence)</option>
            {TIERS.map(t => <option key={t.key} value={t.key}>{t.label[0] + t.label.slice(1).toLowerCase()}</option>)}
          </select>
        </label>
      </div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="kicker">NOTES</span>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="How you know them, what to talk about…" style={{ ...inputStyle, resize: 'vertical' }} />
      </label>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost" onClick={onClose}>CANCEL</button>
        <button className="btn btn-primary" disabled={!name.trim() || save.isPending}
          onClick={() => save.mutate()}>
          {save.isPending ? (isEdit ? 'SAVING…' : 'CREATING…') : (isEdit ? 'SAVE' : 'CREATE')}
        </button>
      </div>
    </div>
  );
}

/* ---------- the page ---------- */
const BOARD_GROUPS: { key: SignalLevel; label: string; color: string }[] = [
  { key: 'dark',     label: 'NEEDS OUTREACH', color: 'var(--red)' },
  { key: 'fading',   label: 'FADING',         color: 'var(--amber)' },
  { key: 'strong',   label: 'IN TOUCH',       color: 'var(--lime)' },
  { key: 'frequent', label: 'FREQUENT',       color: 'var(--teal)' },
];
const FILTERS: [TierKey | 'all', string][] = [
  ['all', 'ALL'], ['weekly', 'WEEKLY'], ['monthly', 'MONTHLY'],
  ['quarterly', 'QUARTERLY'], ['yearly', 'YEARLY'], ['casual', 'CASUAL'],
];
const LS_LAYOUT = 'qm.social.layout';

type SortKey = 'urgency' | 'recent' | 'name' | 'cadence';
const SORTERS: Record<SortKey, (a: Npc, b: Npc) => number> = {
  urgency: (a, b) => urgency(b) - urgency(a),
  recent:  (a, b) => (a.daysSinceContact ?? 1e9) - (b.daysSinceContact ?? 1e9),
  name:    (a, b) => a.name.localeCompare(b.name),
  cadence: (a, b) => (a.cadenceDays ?? 1e9) - (b.cadenceDays ?? 1e9),
};

export function NpcsView() {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loggingId, setLoggingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Npc | null>(null);
  const [query, setQuery] = useState('');
  const [filterTier, setFilterTier] = useState<TierKey | 'all'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('urgency');
  const [layout, setLayout] = useState<'board' | 'list'>(() => {
    const v = localStorage.getItem(LS_LAYOUT);
    return v === 'list' || v === 'board' ? v : 'board';
  });
  const setLayoutPersist = (l: 'board' | 'list') => { setLayout(l); localStorage.setItem(LS_LAYOUT, l); };

  const qc = useQueryClient();
  const npcsQ = useQuery({
    queryKey: ['npcs'],
    queryFn: () => api.get<{ npcs: Npc[] }>('/api/npcs').then(r => r.npcs),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/npcs/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['npcs'] }); setPendingDelete(null); },
  });

  if (npcsQ.isLoading) return <Empty>LOADING CREW…</Empty>;
  if (npcsQ.isError) return <Empty color="var(--red)">FAILED TO LOAD</Empty>;

  const npcs = npcsQ.data ?? [];
  const dark = npcs.filter(n => signalFor(n).level === 'dark').length;

  const q = query.trim().toLowerCase();
  const sorted = npcs
    .filter(n => {
      if (q && !`${n.name} ${n.relationship || ''}`.toLowerCase().includes(q)) return false;
      if (filterTier === 'casual') return n.cadenceDays == null;
      if (filterTier !== 'all') return n.cadenceDays != null && tierOf(n.cadenceDays) === filterTier;
      return true;
    })
    .sort(SORTERS[sortKey]);

  const renderCard = (npc: Npc) => editingId === npc.id
    ? <NpcForm key={npc.id} npc={npc} onClose={() => setEditingId(null)} />
    : <NpcCard key={npc.id} npc={npc} logging={loggingId === npc.id}
        onToggleLog={() => setLoggingId(loggingId === npc.id ? null : npc.id)}
        onCloseLog={() => setLoggingId(null)}
        onEdit={() => setEditingId(npc.id)} onDelete={() => setPendingDelete(npc)} />;

  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* command bar + stats side by side */}
      <div style={{ display: 'flex', gap: 14, alignItems: 'stretch', flexWrap: 'wrap' }}>
        <div className="panel hud" style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', flex: '1 1 300px', minWidth: 0 }}>
          <div className="ncx-chip" style={{ color: 'var(--magenta)' }}><Icon name="flag" size={18} /></div>
          <div style={{ minWidth: 0 }}>
            <h2 className="ncx-glitch ncx-chroma" style={{ fontSize: 20, fontWeight: 700, margin: 0, fontFamily: 'var(--font-display)', letterSpacing: '0.02em', textTransform: 'uppercase' }}>Crew</h2>
            <div className="mono" style={{ fontSize: 10, letterSpacing: '0.16em', color: 'var(--text-faint)', marginTop: 3 }}>
              PEOPLE WORTH KEEPING CLOSE · {npcs.length} CONTACTS{dark ? ` · ${dark} GOING DARK` : ''}
            </div>
          </div>
        </div>
        <div style={{ flex: '2 1 440px', minWidth: 0, display: 'flex' }}>
          <StatStrip npcs={npcs} action={
            <button className={creating ? 'btn btn-ghost' : 'btn btn-primary'} style={{ padding: '8px 15px', fontSize: 11 }} onClick={() => setCreating(c => !c)}>
              <Icon name={creating ? 'close' : 'plus'} size={13} /> {creating ? 'CLOSE' : 'NEW CONTACT'}
            </button>
          } />
        </div>
      </div>

      {creating && <NpcForm onClose={() => setCreating(false)} />}

      <ReachOutLane npcs={npcs} onOpen={(id) => setLoggingId(id)} />

      {/* sort + filter controls */}
      <div className="panel" style={{ padding: '11px 16px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flex: '1 1 200px', minWidth: 160, background: '#070811', border: '1px solid var(--line-2)', padding: '6px 10px' }}>
          <Icon name="search" size={13} style={{ color: 'var(--text-faint)' }} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search crew…" style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 12 }} />
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {FILTERS.map(([k, label]) => {
            const on = filterTier === k;
            return <button key={k} onClick={() => setFilterTier(k)} className="mono" style={{ fontSize: 9.5, padding: '5px 10px', cursor: 'pointer', borderRadius: 0, border: on ? '1px solid rgba(var(--accent-rgb),0.55)' : '1px solid var(--line-2)', background: on ? 'rgba(var(--accent-rgb),0.12)' : 'var(--panel-2)', color: on ? 'var(--cyan)' : 'var(--text-dim)' }}>{label}</button>;
          })}
        </div>
        {/* layout toggle */}
        <div style={{ display: 'flex', gap: 0, boxShadow: 'inset 0 0 0 1px var(--line-2)' }}>
          {(['board', 'list'] as const).map(l => {
            const on = layout === l;
            return <button key={l} onClick={() => setLayoutPersist(l)} className="mono" title={`${l} layout`} style={{ padding: '5px 9px', cursor: 'pointer', border: 'none', background: on ? 'rgba(var(--accent-rgb),0.12)' : 'transparent', color: on ? 'var(--cyan)' : 'var(--text-dim)', display: 'inline-flex', alignItems: 'center' }}>
              <Icon name={l === 'board' ? 'layers' : 'list'} size={14} />
            </button>;
          })}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
          <span className="ncx-serial">SORT</span>
          <select value={sortKey} onChange={e => setSortKey(e.target.value as SortKey)} style={{ ...inputStyle, padding: '6px 10px' }}>
            <option value="urgency">Urgency</option>
            <option value="recent">Most recent</option>
            <option value="name">Name A–Z</option>
            <option value="cadence">Cadence</option>
          </select>
        </label>
      </div>

      {npcs.length === 0 ? (
        <Empty>No contacts yet — add your crew above.</Empty>
      ) : sorted.length === 0 ? (
        <div className="panel" style={{ padding: 28, textAlign: 'center' }}>
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-faint)' }}>No contacts match.</span>
        </div>
      ) : layout === 'board' ? (
        BOARD_GROUPS.map(g => {
          const rows = sorted.filter(n => signalFor(n).level === g.key);
          if (rows.length === 0) return null;
          return (
            <section key={g.key} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: g.color }} />
                <span className="mono" style={{ fontSize: 10, letterSpacing: '0.26em', color: g.color, textTransform: 'uppercase' }}>{g.label}</span>
                <span className="ncx-serial">{rows.length}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(322px, 1fr))', gap: 12, alignItems: 'start' }}>
                {rows.map(renderCard)}
              </div>
            </section>
          );
        })
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(440px, 1fr))', gap: 12, alignItems: 'start' }}>
          {sorted.map(renderCard)}
        </div>
      )}

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

function Empty({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div className="panel hud" style={{ padding: 40, textAlign: 'center', color: color ?? 'var(--text-faint)' }}>
      <div className="mono" style={{ fontSize: 13 }}>{children}</div>
    </div>
  );
}
