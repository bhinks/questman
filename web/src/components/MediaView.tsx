/**
 * MediaView — the "Braindance queue", a backlog manager for movies,
 * shows, games and books. Add items with an AUTO-ESTIMATE button (free
 * Open Library / TMDb lookups via POST /api/media/lookup) plus manual
 * override, then push them through backlog → active → done. Marking an
 * item done fires the closed-loop media quest (XP + eddies).
 *
 * Design system only — reuses .panel / .btn / kicker / mono and CSS vars
 * (no new CSS). Cyberpunk stash framing.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { MediaItem } from '../lib/api';
import { Icon } from './Icon';
import { ConfirmDialog } from './ConfirmDialog';

type MediaType = MediaItem['type'];
type Status = MediaItem['status'];

interface Estimate {
  estMinutes?: number;
  totalUnits?: number;
  coverUrl?: string;
  externalId?: string;
  externalSource?: string;
  meta?: Record<string, unknown>;
}

const TYPE_META: Record<MediaType, { label: string; icon: string; color: string; unitWord: string }> = {
  movie: { label: 'Movie', icon: 'play', color: 'var(--magenta)', unitWord: '' },
  show:  { label: 'Show', icon: 'eye', color: 'var(--violet)', unitWord: 'eps' },
  game:  { label: 'Game', icon: 'target', color: 'var(--lime)', unitWord: '' },
  book:  { label: 'Book', icon: 'book', color: 'var(--amber)', unitWord: 'pages' },
};

const STATUS_ORDER: Status[] = ['active', 'backlog', 'done', 'dropped'];
const STATUS_LABEL: Record<Status, string> = {
  active: 'IN PROGRESS',
  backlog: 'QUEUED',
  done: 'COMPLETED',
  dropped: 'DROPPED',
};

export function MediaView() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<MediaItem | null>(null);

  const itemsQ = useQuery({
    queryKey: ['media'],
    queryFn: () => api.get<{ items: MediaItem[] }>('/api/media').then(r => r.items),
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['media'] });
  };

  // status / progress changes; on "done" also refresh economy + quests.
  const progress = useMutation({
    mutationFn: (vars: { id: string; status?: Status; unitsDone?: number }) =>
      api.post(`/api/media/${vars.id}/progress`, { status: vars.status, unitsDone: vars.unitsDone }),
    onSuccess: (_data, vars) => {
      invalidateAll();
      if (vars.status === 'done') {
        qc.invalidateQueries({ queryKey: ['player'] });
        qc.invalidateQueries({ queryKey: ['player', 'stats'] });
        qc.invalidateQueries({ queryKey: ['quests', 'today'] });
      }
    },
  });

  const update = useMutation({
    mutationFn: (vars: { id: string; body: Record<string, unknown> }) =>
      api.put(`/api/media/${vars.id}`, vars.body),
    onSuccess: invalidateAll,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/media/${id}`),
    onSuccess: () => { invalidateAll(); setPendingDelete(null); },
  });

  if (itemsQ.isLoading) return <Empty>SPINNING UP THE STASH…</Empty>;
  if (itemsQ.isError) return <Empty color="var(--red)">FAILED TO LOAD QUEUE</Empty>;

  const items = itemsQ.data ?? [];
  const activeCount = items.filter(i => i.status === 'active').length;

  const grouped = STATUS_ORDER
    .map(status => ({ status, rows: items.filter(i => i.status === status) }))
    .filter(g => g.rows.length > 0);

  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <Header total={items.length} active={activeCount} />

      {creating
        ? <AddForm onClose={() => setCreating(false)} onDone={invalidateAll} />
        : (
          <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setCreating(true)}>
            <Icon name="plus" size={14} /> ADD TO QUEUE
          </button>
        )}

      {grouped.map(g => (
        <section key={g.status} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <SectionLabel>{STATUS_LABEL[g.status]} · {g.rows.length}</SectionLabel>
          {g.rows.map(item => (
            <Row
              key={item.id}
              item={item}
              busy={progress.isPending || update.isPending}
              onStatus={(status) => progress.mutate({ id: item.id, status })}
              onUnits={(unitsDone) => progress.mutate({ id: item.id, unitsDone })}
              onEst={(estMinutes) => update.mutate({ id: item.id, body: { estMinutes } })}
              onDelete={() => setPendingDelete(item)}
            />
          ))}
        </section>
      ))}

      {items.length === 0 && (
        <Empty>The queue is empty — jack something in above.</Empty>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        danger
        title="Purge from queue?"
        message={pendingDelete && <>This removes <strong style={{ color: 'var(--text)' }}>{pendingDelete.title}</strong> from your stash. Earned XP stays banked.</>}
        confirmLabel="PURGE"
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
      <Icon name="layers" size={20} style={{ color: 'var(--magenta)' }} />
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, fontFamily: 'var(--font-display)' }}>Braindance Queue</h2>
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
          movies · shows · games · books
        </div>
      </div>
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="kicker" style={{ paddingLeft: 4 }}>{children}</div>;
}

function TypeBadge({ type }: { type: MediaType }) {
  const m = TYPE_META[type];
  return (
    <div
      className="mono"
      title={m.label}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
        color: m.color,
        padding: '4px 8px',
        background: `color-mix(in srgb, ${m.color} 8%, transparent)`,
        border: `1px solid color-mix(in srgb, ${m.color} 30%, transparent)`,
        borderRadius: 6, textTransform: 'uppercase', flexShrink: 0,
      }}
    >
      <Icon name={m.icon as any} size={11} />
      {m.label}
    </div>
  );
}

function timeLabel(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function Row({
  item, busy, onStatus, onUnits, onEst, onDelete,
}: {
  item: MediaItem;
  busy: boolean;
  onStatus: (status: Status) => void;
  onUnits: (unitsDone: number) => void;
  onEst: (estMinutes: number) => void;
  onDelete: () => void;
}) {
  const m = TYPE_META[item.type];
  const done = item.status === 'done';
  const hasUnits = item.totalUnits != null && item.totalUnits > 0;
  const pct = hasUnits ? Math.min(100, Math.round((item.unitsDone / item.totalUnits!) * 100)) : 0;
  const [editingEst, setEditingEst] = useState(false);
  const [estDraft, setEstDraft] = useState<number | ''>(item.estMinutes ?? '');

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
      {item.coverUrl
        ? (
          <img
            src={item.coverUrl}
            alt=""
            style={{ width: 38, height: 54, objectFit: 'cover', borderRadius: 6, flexShrink: 0, border: '1px solid var(--line)' }}
          />
        )
        : (
          <div style={{
            width: 38, height: 54, borderRadius: 6, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--panel-2)', border: '1px solid var(--line)',
            color: m.color,
          }}>
            <Icon name={m.icon as any} size={18} />
          </div>
        )}

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 14, fontWeight: 600,
            color: done ? 'var(--lime)' : 'var(--text)',
            textDecoration: done ? 'line-through' : 'none',
            textDecorationColor: 'rgba(67,255,166,0.5)',
          }}>
            {item.title}
          </span>
          <TypeBadge type={item.type} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/* est-time pill — click to edit a manual override */}
          {editingEst ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <input
                type="number"
                min={0}
                max={100000}
                autoFocus
                value={estDraft}
                onChange={e => setEstDraft(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                style={{ ...inputStyle, width: 80 }}
              />
              <button
                className="btn btn-ghost"
                style={{ padding: '4px 8px', fontSize: 11 }}
                disabled={busy}
                onClick={() => { if (estDraft !== '') onEst(Number(estDraft)); setEditingEst(false); }}
              >
                <Icon name="check" size={12} />
              </button>
            </span>
          ) : (
            <button
              onClick={() => { setEstDraft(item.estMinutes ?? ''); setEditingEst(true); }}
              className="mono"
              title="Estimated time commitment — click to set"
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                fontSize: 11, color: 'var(--violet)', cursor: 'pointer',
                padding: '4px 8px',
                background: 'color-mix(in srgb, var(--violet) 8%, transparent)',
                border: '1px solid color-mix(in srgb, var(--violet) 30%, transparent)',
                borderRadius: 6,
              }}
            >
              <Icon name="clock" size={11} />
              {item.estMinutes != null ? timeLabel(item.estMinutes) : 'set time'}
            </button>
          )}

          {/* progress for unit-tracked items (books/shows) */}
          {hasUnits && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                className="btn btn-ghost"
                style={{ padding: '2px 7px', fontSize: 13, lineHeight: 1 }}
                disabled={busy || item.unitsDone <= 0}
                aria-label="Decrease progress"
                onClick={() => onUnits(Math.max(0, item.unitsDone - 1))}
              >
                −
              </button>
              <span className="mono" style={{ fontSize: 11, color: 'var(--cyan)', minWidth: 64, textAlign: 'center' }}>
                {item.unitsDone}/{item.totalUnits} {m.unitWord}
              </span>
              <button
                className="btn btn-ghost"
                style={{ padding: '2px 7px', fontSize: 13, lineHeight: 1 }}
                disabled={busy || item.unitsDone >= (item.totalUnits ?? 0)}
                aria-label="Increase progress"
                onClick={() => onUnits(Math.min(item.totalUnits!, item.unitsDone + 1))}
              >
                +
              </button>
            </span>
          )}
        </div>

        {hasUnits && (
          <div style={{ height: 4, background: 'var(--panel-2)', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{
              width: `${pct}%`, height: '100%',
              background: 'linear-gradient(90deg, var(--cyan), var(--violet))',
              transition: 'width 0.25s ease',
            }} />
          </div>
        )}
      </div>

      {/* status-change buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {item.status !== 'active' && item.status !== 'done' && (
            <button
              className="btn btn-primary"
              style={{ padding: '6px 10px', fontSize: 11 }}
              disabled={busy}
              onClick={() => onStatus('active')}
            >
              <Icon name="play" size={12} /> START
            </button>
          )}
          {item.status !== 'done' && (
            <button
              className="btn"
              style={{ padding: '6px 10px', fontSize: 11 }}
              disabled={busy}
              onClick={() => onStatus('done')}
              title="Mark done — completes the matching quest"
            >
              <Icon name="check" size={12} /> DONE
            </button>
          )}
          {item.status === 'done' && (
            <button
              className="btn btn-ghost"
              style={{ padding: '6px 10px', fontSize: 11 }}
              disabled={busy}
              onClick={() => onStatus('backlog')}
              title="Re-queue"
            >
              <Icon name="repeat" size={12} /> RE-QUEUE
            </button>
          )}
          <button
            onClick={onDelete}
            className="btn btn-ghost"
            style={{ padding: '6px 8px', fontSize: 11 }}
            aria-label={`Delete ${item.title}`}
            title="Delete"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
        {item.status !== 'dropped' && item.status !== 'done' && (
          <button
            className="btn btn-ghost"
            style={{ padding: '4px 8px', fontSize: 10, alignSelf: 'flex-end', color: 'var(--text-faint)' }}
            disabled={busy}
            onClick={() => onStatus('dropped')}
          >
            drop
          </button>
        )}
      </div>
    </div>
  );
}

/** Add-to-queue form with type select, title, AUTO-ESTIMATE + manual override. */
function AddForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const [type, setType] = useState<MediaType>('book');
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<Status>('backlog');
  const [estMinutes, setEstMinutes] = useState<number | ''>('');
  const [totalUnits, setTotalUnits] = useState<number | ''>('');
  const [coverUrl, setCoverUrl] = useState<string>('');
  const [externalId, setExternalId] = useState<string | undefined>();
  const [externalSource, setExternalSource] = useState<string | undefined>();
  const [meta, setMeta] = useState<Record<string, unknown> | undefined>();
  const [lookupNote, setLookupNote] = useState<string | null>(null);

  const lookup = useMutation({
    mutationFn: () => api.post<{ estimate: Estimate | null }>('/api/media/lookup', { type, title: title.trim() }),
    onSuccess: (res) => {
      const e = res.estimate;
      if (!e) { setLookupNote('No match found — enter time manually.'); return; }
      if (e.estMinutes != null) setEstMinutes(e.estMinutes);
      if (e.totalUnits != null) setTotalUnits(e.totalUnits);
      if (e.coverUrl) setCoverUrl(e.coverUrl);
      if (e.externalId) setExternalId(e.externalId);
      if (e.externalSource) setExternalSource(e.externalSource);
      if (e.meta) setMeta(e.meta);
      const bits: string[] = [];
      if (e.estMinutes != null) bits.push(timeLabel(e.estMinutes));
      if (e.totalUnits != null) bits.push(`${e.totalUnits} ${TYPE_META[type].unitWord || 'units'}`);
      setLookupNote(`Matched via ${e.externalSource ?? 'lookup'}${bits.length ? ` — ${bits.join(' · ')}` : ''}`);
    },
    onError: () => setLookupNote('Lookup failed — enter time manually.'),
  });

  const create = useMutation({
    mutationFn: () => api.post('/api/media', {
      type,
      title: title.trim(),
      status,
      estMinutes: estMinutes === '' ? null : estMinutes,
      totalUnits: totalUnits === '' ? null : totalUnits,
      coverUrl: coverUrl || null,
      externalId: externalId ?? null,
      externalSource: externalSource ?? null,
      meta: meta ?? null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['media'] });
      onDone();
      onClose();
    },
  });

  const m = TYPE_META[type];

  return (
    <div className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="kicker">TYPE</span>
          <select value={type} onChange={e => { setType(e.target.value as MediaType); setLookupNote(null); }} style={inputStyle}>
            <option value="book">Book</option>
            <option value="movie">Movie</option>
            <option value="show">Show</option>
            <option value="game">Game</option>
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 200 }}>
          <span className="kicker">TITLE</span>
          <input
            autoFocus
            placeholder={`e.g. ${type === 'book' ? 'Neuromancer' : type === 'game' ? 'Cyberpunk 2077' : 'Blade Runner'}`}
            value={title}
            onChange={e => setTitle(e.target.value)}
            style={inputStyle}
          />
        </label>
        <button
          className="btn"
          disabled={!title.trim() || lookup.isPending}
          onClick={() => { setLookupNote(null); lookup.mutate(); }}
          style={{ color: m.color }}
        >
          <Icon name="spark" size={14} /> {lookup.isPending ? 'SCANNING…' : 'AUTO-ESTIMATE'}
        </button>
      </div>

      {lookupNote && (
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>{lookupNote}</div>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="kicker">STATUS</span>
          <select value={status} onChange={e => setStatus(e.target.value as Status)} style={inputStyle}>
            <option value="backlog">Queued</option>
            <option value="active">In progress</option>
            <option value="done">Completed</option>
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="kicker">EST. MINUTES</span>
          <input
            type="number"
            min={0}
            max={100000}
            placeholder="—"
            value={estMinutes}
            onChange={e => setEstMinutes(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
            style={{ ...inputStyle, width: 110 }}
          />
        </label>
        {(type === 'book' || type === 'show') && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="kicker">TOTAL {type === 'book' ? 'PAGES' : 'EPISODES'}</span>
            <input
              type="number"
              min={0}
              max={100000}
              placeholder="—"
              value={totalUnits}
              onChange={e => setTotalUnits(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
              style={{ ...inputStyle, width: 110 }}
            />
          </label>
        )}
        {coverUrl && (
          <img src={coverUrl} alt="" style={{ width: 36, height: 52, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--line)' }} />
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost" onClick={onClose}>CANCEL</button>
        <button
          className="btn btn-primary"
          disabled={!title.trim() || create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? 'ADDING…' : 'ADD TO QUEUE'}
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
