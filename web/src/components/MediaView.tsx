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
  book:  { label: 'Book', icon: 'file', color: 'var(--amber)', unitWord: 'pages' },
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
  // Banked R&R credits gate backlog activation (shared cache with the HUD).
  const playerQ = useQuery({
    queryKey: ['player'],
    queryFn: () => api.get<{ player: { rrCredits: number } }>('/api/player').then(r => r.player),
  });
  const rrCredits = playerQ.data?.rrCredits ?? 0;

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

  // R&R redemption — spend one banked downtime credit to pull a BACKLOG item
  // onto the active shelf (the economy's earn-your-leisure loop). The server
  // guards the spend; this closes the loop the Shop's R&R credits feed.
  const rrSession = useMutation({
    mutationFn: (id: string) => api.post(`/api/media/${id}/rr-session`),
    onSuccess: () => {
      invalidateAll();
      qc.invalidateQueries({ queryKey: ['player'] });
    },
    onError: (err: unknown) => {
      window.alert(err instanceof Error ? err.message : 'R&R redemption failed');
    },
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
          <SectionLabel count={g.rows.length}>{STATUS_LABEL[g.status]}</SectionLabel>
          {g.rows.map(item => (
            <Row
              key={item.id}
              item={item}
              busy={progress.isPending || update.isPending || rrSession.isPending}
              rrCredits={rrCredits}
              onRrSession={() => rrSession.mutate(item.id)}
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
    <div className="panel hud" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
      <div className="ncx-chip" style={{ color: 'var(--magenta)' }}>
        <Icon name="layers" size={18} />
      </div>
      <div>
        <h2 className="ncx-glitch ncx-chroma" style={{ fontSize: 18, fontWeight: 700, margin: 0, fontFamily: 'var(--font-display)', letterSpacing: '0.02em', textTransform: 'uppercase' }}>
          Braindance Queue
        </h2>
        <div className="mono" style={{ fontSize: 10, letterSpacing: '0.24em', color: 'var(--text-faint)', textTransform: 'uppercase', marginTop: 3 }}>
          movies · shows · games · books
        </div>
      </div>
      <span className="mono" style={{ marginLeft: 'auto', fontSize: 10.5, letterSpacing: '0.12em', color: 'var(--text-dim)' }}>
        {active} ACTIVE · {total} TOTAL
      </span>
    </div>
  );
}

function SectionLabel({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, paddingLeft: 4 }}>
      <span className="mono" style={{ fontSize: 10, letterSpacing: '0.26em', color: 'var(--text-dim)', textTransform: 'uppercase' }}>
        {children}
      </span>
      {count != null && <span className="ncx-serial">{count} RECORDS</span>}
    </div>
  );
}

function TypeBadge({ type }: { type: MediaType }) {
  const m = TYPE_META[type];
  return (
    <div
      className="ncx-stamp flat"
      title={m.label}
      style={{ color: m.color, display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0 }}
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
  item, busy, rrCredits, onRrSession, onStatus, onUnits, onEst, onDelete,
}: {
  item: MediaItem;
  busy: boolean;
  rrCredits: number;
  onRrSession: () => void;
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
            style={{ width: 38, height: 54, objectFit: 'cover', flexShrink: 0, border: '1px solid var(--line)' }}
          />
        )
        : (
          <div className="panel-inset" style={{
            width: 38, height: 54, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
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
                fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase',
                color: 'var(--violet)', cursor: 'pointer',
                padding: '4px 8px',
                background: 'color-mix(in srgb, var(--violet) 8%, transparent)',
                border: '1px solid color-mix(in srgb, var(--violet) 30%, transparent)',
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
          <div className="ncx-bar slim">
            <i style={{ width: `${pct}%`, background: 'linear-gradient(90deg, var(--cyan), var(--violet))' }} />
            <span className="seg-mask" />
          </div>
        )}
      </div>

      {/* status-change buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {item.status === 'backlog' && (
            // Activating from the backlog SPENDS one R&R credit (the economy's
            // earn-your-leisure loop) — server-guarded via /rr-session.
            <button
              key={`rr-${rrCredits > 0}`}
              className={rrCredits > 0 ? 'btn btn-primary' : 'btn'}
              style={{ padding: '6px 10px', fontSize: 11 }}
              disabled={busy || rrCredits <= 0}
              onClick={onRrSession}
              title={rrCredits > 0
                ? `Spend 1 R&R credit to jack in (${rrCredits} banked)`
                : 'No R&R credits — bank one with a full-clear day or buy one in the Shop'}
            >
              <Icon name="play" size={12} /> JACK IN · 1 R&R
            </button>
          )}
          {item.status === 'dropped' && (
            <button
              className="btn"
              style={{ padding: '6px 10px', fontSize: 11 }}
              disabled={busy}
              onClick={() => onStatus('backlog')}
              title="Back to the queue"
            >
              <Icon name="repeat" size={12} /> RE-QUEUE
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
          <img src={coverUrl} alt="" style={{ width: 36, height: 52, objectFit: 'cover', border: '1px solid var(--line)' }} />
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
  background: '#070811',
  border: '1px solid var(--line-2)',
  borderRadius: 0,
  color: 'var(--text)',
  fontFamily: 'var(--font-mono)',
  fontSize: 13,
  outline: 'none',
};
