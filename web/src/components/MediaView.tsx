/**
 * MediaView — the "Braindance" consumption PLANNER (redesign).
 *
 *   1. Command bar — title + in-progress/queued counts + this-week time + ADD.
 *   2. WHAT NOW — a time-budget planner ("I have 45 min → here's what fits"):
 *      finish a movie, watch N episodes, read ~N pages, or run a game session,
 *      ranked finish-first. Each suggestion's JACK IN opens the focus chamber.
 *   3. YOUR PACE strip — history-derived rates (GET /api/media/pace) that drive
 *      the ETAs + the planner's chunk sizes, plus the R&R "earn your leisure"
 *      status and the soft-gate ICE-target picker.
 *   4. Library — filter chips + rich cards with real lengths, progress, ETAs,
 *      and one-tap medium-specific logging.
 *
 * Wiring to the real backend:
 *   - Length/progress live on MediaItem's generic columns (estMinutes /
 *     totalUnits / unitsDone / meta); the helpers below adapt them per medium.
 *   - Consumption (jack-in + time/units logs) → POST /:id/session, which runs
 *     the per-title-per-day R&R charge and the soft gate (a breach on the
 *     configured anti-goal when you've no credit left). Status flips
 *     (done/re-queue) → POST /:id/progress (the quest closed-loop). Corrections
 *     (− steppers) → PUT /:id { unitsDone }. Endless games store meta.endless.
 */
import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type {
  MediaItem, MediaPace, MediaPaceResponse, MediaSessionResult, AntiGoal,
} from '../lib/api';
import { Icon } from './Icon';
import { ConfirmDialog } from './ConfirmDialog';
import type { FocusSeed } from './FocusView';

type MediaType = MediaItem['type'];
type Status = MediaItem['status'];

const TYPE_META: Record<MediaType, { label: string; icon: string; color: string }> = {
  movie: { label: 'Movie', icon: 'play',   color: 'var(--magenta)' },
  show:  { label: 'Show',  icon: 'eye',    color: 'var(--violet)' },
  game:  { label: 'Game',  icon: 'target', color: 'var(--lime)' },
  book:  { label: 'Book',  icon: 'file',   color: 'var(--amber)' },
};

// Pace fallback (mirrors the backend defaults) used until /pace loads.
const DEFAULT_PACE: MediaPace = {
  book:  { minPerPage: 3, pagesPerDay: 20, minPerDay: 60 },
  show:  { epsPerDay: 1, minPerDay: 45 },
  game:  { minPerDay: 26, minPerWeek: 180 },
  movie: { perWeek: 2 },
  refEpisodeMin: 45,
};

/* ------------------------------------------------------------------ */
/* MediaItem → planning adapter (pure helpers)                         */
/* ------------------------------------------------------------------ */
function metaNum(it: MediaItem, key: string): number | undefined {
  const v = it.meta?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
const isEndless = (it: MediaItem) => it.type === 'game' && it.meta?.endless === true;
const minPerPageOf = (it: MediaItem, pace: MediaPace) => metaNum(it, 'readingMinPerPage') ?? pace.book.minPerPage;
const perEpMinOf = (it: MediaItem) => metaNum(it, 'avgEpisodeRuntime') ?? 45;
const hltbHoursOf = (it: MediaItem) => Math.round((it.estMinutes ?? 0) / 60);
const sourceOf = (it: MediaItem) => it.externalSource ?? 'manual';

function totalMin(it: MediaItem, pace: MediaPace): number {
  switch (it.type) {
    case 'movie': return it.estMinutes ?? 0;
    case 'show':  return it.estMinutes ?? (it.totalUnits ?? 0) * perEpMinOf(it);
    case 'book':  return it.estMinutes ?? Math.round((it.totalUnits ?? 0) * minPerPageOf(it, pace));
    case 'game':  return isEndless(it) ? 0 : (it.estMinutes ?? 0);
    default: return 0;
  }
}
function doneMin(it: MediaItem, pace: MediaPace): number {
  switch (it.type) {
    case 'movie': return it.unitsDone;
    case 'show':  return it.unitsDone * perEpMinOf(it);
    case 'book':  return Math.round(it.unitsDone * minPerPageOf(it, pace));
    case 'game':  return isEndless(it) ? 0 : it.unitsDone;
    default: return 0;
  }
}
const remainMin = (it: MediaItem, pace: MediaPace) => Math.max(0, totalMin(it, pace) - doneMin(it, pace));
const pctDone = (it: MediaItem, pace: MediaPace) => { const t = totalMin(it, pace); return t ? Math.min(1, doneMin(it, pace) / t) : 0; };

function fmtMin(m: number): string {
  m = Math.round(m);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}
function lengthText(it: MediaItem, pace: MediaPace): string {
  switch (it.type) {
    case 'movie': return fmtMin(it.estMinutes ?? 0);
    case 'show':  return `${it.totalUnits ?? '—'} eps · ${perEpMinOf(it)}m · ${fmtMin(totalMin(it, pace))}`;
    case 'book':  return `${it.totalUnits ?? '—'} pg · ~${fmtMin(totalMin(it, pace))}`;
    case 'game':  return isEndless(it) ? 'Endless · session-based' : `~${hltbHoursOf(it)}h main`;
    default: return '';
  }
}
function progressText(it: MediaItem): string {
  const h1 = Math.round((it.unitsDone / 60) * 10) / 10;
  switch (it.type) {
    case 'movie': return it.unitsDone ? `${fmtMin(it.unitsDone)} / ${fmtMin(it.estMinutes ?? 0)}` : 'not started';
    case 'show':  return `${it.unitsDone} / ${it.totalUnits ?? '—'} eps`;
    case 'book':  return `${it.unitsDone} / ${it.totalUnits ?? '—'} pg`;
    case 'game':  return isEndless(it) ? `${h1}h logged` : `${h1} / ${hltbHoursOf(it)} h`;
    default: return '';
  }
}
function relativeText(min: number, pace: MediaPace): string | null {
  if (min < 18) return null;
  const eps = min / pace.refEpisodeMin;
  if (min < 75) return `≈ ${Math.max(1, Math.round(eps))} episode${Math.round(eps) > 1 ? 's' : ''}`;
  if (min < 170) return '≈ a movie';
  return `≈ ${(min / 120).toFixed(1)} movies`;
}
function etaText(it: MediaItem, pace: MediaPace): string | null {
  if (isEndless(it)) return null;
  const rem = remainMin(it, pace);
  if (rem <= 0) return 'complete';
  if (it.type === 'movie') return rem <= (it.estMinutes ?? 0) && it.unitsDone === 0 ? 'one sitting' : 'one sitting left';
  const perDay = it.type === 'book' ? pace.book.minPerDay : it.type === 'show' ? pace.show.minPerDay : pace.game.minPerDay;
  const days = Math.max(1, Math.ceil(rem / Math.max(1, perDay)));
  return days <= 1 ? '~1 day at your pace' : `~${days} days at your pace`;
}

interface Suggestion { fits: boolean; finishes?: boolean; useMin?: number; needMin?: number; label: string; leftover?: number }
/** Per-item recommendation for a given budget (minutes). */
function suggest(it: MediaItem, budget: number, pace: MediaPace): Suggestion | null {
  if (it.status === 'done' || it.status === 'dropped') return null;
  if (isEndless(it)) return { fits: true, finishes: false, useMin: budget, label: `Play a ${fmtMin(budget)} session`, leftover: 0 };
  const rem = remainMin(it, pace);
  if (rem <= 0) return null;

  if (it.type === 'movie') {
    const need = it.unitsDone ? rem : (it.estMinutes ?? 0);
    const verb = it.unitsDone ? 'Finish' : 'Watch';
    return need <= budget
      ? { fits: true, finishes: true, useMin: need, label: `${verb} · ${fmtMin(need)}`, leftover: budget - need }
      : { fits: false, needMin: need, label: `needs ${fmtMin(need)}` };
  }
  if (it.type === 'show') {
    const perEp = perEpMinOf(it);
    const epsLeft = (it.totalUnits ?? 0) - it.unitsDone;
    const watch = Math.min(Math.floor(budget / Math.max(1, perEp)), epsLeft);
    if (watch >= 1) return { fits: true, finishes: watch >= epsLeft, useMin: watch * perEp, label: `Watch ${watch} ep${watch > 1 ? 's' : ''} · ${fmtMin(watch * perEp)}`, leftover: budget - watch * perEp };
    return { fits: false, needMin: perEp, label: `next ep ${perEp}m` };
  }
  if (it.type === 'book') {
    const mpp = minPerPageOf(it, pace);
    const pagesLeft = (it.totalUnits ?? 0) - it.unitsDone;
    const read = Math.min(Math.floor(budget / Math.max(0.1, mpp)), pagesLeft);
    if (read < 1) return { fits: false, needMin: Math.ceil(mpp), label: 'a page or two' };
    const useMin = Math.round(read * mpp);
    return { fits: true, finishes: read >= pagesLeft, useMin, label: `Read ~${read} pg · ${fmtMin(useMin)}`, leftover: budget - useMin };
  }
  // finite game — open-ended session
  return { fits: true, finishes: false, useMin: budget, label: `Play a ${fmtMin(budget)} session`, leftover: 0 };
}

/** Natural-unit "fully done" value (fills the bar when DONE is pressed). */
function fullUnits(it: MediaItem): number {
  if (it.type === 'movie' || it.type === 'game') return it.estMinutes ?? it.unitsDone;
  return it.totalUnits ?? it.unitsDone;
}

/* ------------------------------------------------------------------ */
/* page                                                                */
/* ------------------------------------------------------------------ */
const FILTERS: Array<[string, string]> = [
  ['all', 'ALL'], ['active', 'IN PROGRESS'], ['backlog', 'QUEUED'], ['done', 'DONE'], ['dropped', 'DROPPED'],
  ['movie', 'MOVIES'], ['show', 'SHOWS'], ['game', 'GAMES'], ['book', 'BOOKS'],
];
const STATUS_RANK: Record<string, number> = { active: 0, backlog: 1, done: 2, dropped: 3 };

export function MediaView({ onJackIn }: { onJackIn?: (seed: FocusSeed | null) => void }) {
  const qc = useQueryClient();
  const [budget, setBudget] = useState(45);
  const [filter, setFilter] = useState('all');
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<MediaItem | null>(null);
  // A charge that will overrun today's R&R + has a soft-gate target → confirm.
  const [pendingCharge, setPendingCharge] = useState<{ run: () => void; targetName: string } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const itemsQ = useQuery({
    queryKey: ['media'],
    queryFn: () => api.get<{ items: MediaItem[] }>('/api/media').then(r => r.items),
  });
  const paceQ = useQuery({
    queryKey: ['media', 'pace'],
    queryFn: () => api.get<MediaPaceResponse>('/api/media/pace'),
  });
  const antigoalsQ = useQuery({
    queryKey: ['antigoals'],
    queryFn: () => api.get<{ antigoals: AntiGoal[] }>('/api/antigoals').then(r => r.antigoals),
    staleTime: 5 * 60_000,
  });

  const pace = paceQ.data?.pace ?? DEFAULT_PACE;
  const rr = paceQ.data?.rr;
  const chargedToday = useMemo(() => new Set(paceQ.data?.chargedTodayItemIds ?? []), [paceQ.data]);

  const showFlash = (msg: string) => {
    setFlash(msg);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 6000);
  };
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  const invalidateAfterSession = (overran: boolean) => {
    qc.invalidateQueries({ queryKey: ['media'] });
    qc.invalidateQueries({ queryKey: ['player'] });
    if (overran) qc.invalidateQueries({ queryKey: ['antigoals'] });
  };

  // Consumption logger (jack-in + every time/units log) — runs the R&R charge.
  const session = useMutation({
    mutationFn: (vars: { id: string; kind?: 'start' | 'progress' | 'finish'; minutes?: number; units?: number }) =>
      api.post<MediaSessionResult>(`/api/media/${vars.id}/session`, { kind: vars.kind ?? 'progress', minutes: vars.minutes, units: vars.units }),
    onSuccess: (res) => {
      invalidateAfterSession(res.overran);
      if (res.overran && res.overrunTargetName) showFlash(`Unbudgeted leisure logged — breach on ${res.overrunTargetName}.`);
      else if (res.overran) showFlash('Logged over budget (no ICE target set — pick one to make it bite).');
    },
  });

  // R&R redemption: spend a banked credit to pull a backlog title onto the
  // active shelf. This is the loop a full-clear day's credit pays for.
  const rrSession = useMutation({
    mutationFn: (id: string) => api.post(`/api/media/${id}/rr-session`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['media'] });
      qc.invalidateQueries({ queryKey: ['media', 'pace'] });
      qc.invalidateQueries({ queryKey: ['player'] });
    },
  });

  // Status flips (done / re-queue) — quest closed-loop, no R&R charge.
  const statusMut = useMutation({
    mutationFn: (vars: { id: string; status: Status; unitsDone?: number }) =>
      api.post(`/api/media/${vars.id}/progress`, { status: vars.status, unitsDone: vars.unitsDone }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['media'] });
      if (vars.status === 'done') {
        qc.invalidateQueries({ queryKey: ['player'] });
        qc.invalidateQueries({ queryKey: ['quests', 'today'] });
      }
    },
  });

  // Progress corrections (− steppers) — plain edit, no ledger / no charge.
  const correct = useMutation({
    mutationFn: (vars: { id: string; unitsDone: number }) => api.put(`/api/media/${vars.id}`, { unitsDone: vars.unitsDone }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['media'] }),
  });

  const del = useMutation({
    mutationFn: (id: string) => api.del(`/api/media/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['media'] }); setPendingDelete(null); },
  });

  // Soft-gate guard: if this charge would overrun today's R&R (and the title
  // isn't already charged today) AND a breach target is set, confirm first.
  const guardedCharge = (item: MediaItem, run: () => void) => {
    const willOverrun = (rr?.remaining ?? 1) <= 0 && !chargedToday.has(item.id);
    if (willOverrun && rr?.overrunTargetName) setPendingCharge({ run, targetName: rr.overrunTargetName });
    else run();
  };

  const logSession = (item: MediaItem, payload: { kind?: 'start' | 'progress' | 'finish'; minutes?: number; units?: number }) =>
    guardedCharge(item, () => session.mutate({ id: item.id, ...payload }));

  const jackIn = (item: MediaItem) => {
    // A backlog title isn't on your plate yet — activate it by spending a
    // banked R&R credit (the redemption loop) before jacking in.
    if (item.status === 'backlog') {
      if ((rr?.banked ?? 0) <= 0) {
        showFlash('No R&R — earn one by clearing a full day, then activate this title.');
        return;
      }
      rrSession.mutate(item.id, {
        onSuccess: () => onJackIn?.({ type: 'other', id: null, label: item.title }),
      });
      return;
    }
    guardedCharge(item, () => {
      session.mutate({ id: item.id, kind: 'start', minutes: 0 });
      onJackIn?.({ type: 'other', id: null, label: item.title });
    });
  };

  if (itemsQ.isLoading) return <Empty>SPINNING UP THE STASH…</Empty>;
  if (itemsQ.isError) return <Empty color="var(--red)">FAILED TO LOAD QUEUE</Empty>;

  const items = itemsQ.data ?? [];
  const counts = {
    active: items.filter(i => i.status === 'active').length,
    backlog: items.filter(i => i.status === 'backlog').length,
  };
  const planItems = items.filter(i => i.status === 'active' || i.status === 'backlog');
  const weekMinutes = paceQ.data?.weekMinutes ?? 0;

  const shown = items
    .filter(i => filter === 'all' ? i.status !== 'dropped'
      : (['active', 'backlog', 'done', 'dropped'] as string[]).includes(filter) ? i.status === filter
      : i.type === filter && i.status !== 'dropped')
    .sort((a, b) => (STATUS_RANK[a.status] - STATUS_RANK[b.status]));

  const busy = session.isPending || statusMut.isPending || correct.isPending || rrSession.isPending;
  const rrBanked = rr?.banked ?? 0;

  return (
    <div className="qm-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* command bar */}
      <div className="panel hud" style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div className="ncx-chip" style={{ color: 'var(--magenta)' }}><Icon name="layers" size={18} /></div>
        <div style={{ minWidth: 0 }}>
          <h2 className="ncx-glitch ncx-chroma" style={{ fontSize: 20, fontWeight: 700, margin: 0, fontFamily: 'var(--font-display)', letterSpacing: '0.02em', textTransform: 'uppercase' }}>Braindance</h2>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '0.16em', color: 'var(--text-faint)', marginTop: 3 }}>
            {counts.active} IN PROGRESS · {counts.backlog} QUEUED · {fmtMin(weekMinutes)} THIS WEEK
          </div>
        </div>
        <button className={creating ? 'btn btn-ghost' : 'btn btn-primary'} style={{ marginLeft: 'auto', padding: '8px 15px', fontSize: 11 }} onClick={() => setCreating(c => !c)} key={`add-${creating}`}>
          <Icon name={creating ? 'close' : 'plus'} size={13} /> {creating ? 'CLOSE' : 'ADD TO QUEUE'}
        </button>
      </div>

      {creating && <AddForm onClose={() => setCreating(false)} onDone={() => qc.invalidateQueries({ queryKey: ['media'] })} />}

      {/* planner */}
      <WhatNow items={planItems} budget={budget} setBudget={setBudget} pace={pace} rrBanked={rrBanked} onJackIn={jackIn} />

      {/* pace strip + R&R status / soft-gate target picker */}
      <PaceStrip pace={pace} rr={rr} antigoals={antigoalsQ.data ?? []} />

      {/* library filters */}
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        {FILTERS.map(([k, label]) => {
          const on = filter === k;
          return (
            <button key={k} onClick={() => setFilter(k)} className="mono"
              style={{
                fontSize: 10, padding: '5px 12px', cursor: 'pointer', borderRadius: 0,
                border: on ? '1px solid rgba(var(--accent-rgb),0.55)' : '1px solid var(--line-2)',
                background: on ? 'rgba(var(--accent-rgb),0.12)' : 'var(--panel-2)',
                color: on ? 'var(--cyan)' : 'var(--text-dim)',
              }}>{label}</button>
          );
        })}
      </div>

      {items.length === 0 ? (
        <Empty>The queue is empty — add something above.</Empty>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(344px, 1fr))', gap: 14, alignItems: 'start' }}>
          {shown.map(it => (
            <MediaCard
              key={it.id}
              it={it}
              pace={pace}
              busy={busy}
              rrBanked={rrBanked}
              onJackIn={() => jackIn(it)}
              onLog={(payload) => logSession(it, payload)}
              onCorrect={(unitsDone) => correct.mutate({ id: it.id, unitsDone })}
              onStatus={(status) => statusMut.mutate({ id: it.id, status, unitsDone: status === 'done' ? fullUnits(it) : undefined })}
              onDelete={() => setPendingDelete(it)}
            />
          ))}
        </div>
      )}

      {/* flash toast (overrun notice) */}
      {flash && (
        <div style={{ position: 'fixed', bottom: 16, right: 16, maxWidth: 340, padding: 14, background: 'var(--panel)', border: '1px solid var(--red)', borderRadius: 'var(--r)', color: 'var(--text)', fontSize: 12.5, zIndex: 1000, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="shield" size={14} style={{ color: 'var(--red)', flex: 'none' }} />
          <span>{flash}</span>
          <button onClick={() => setFlash(null)} className="btn btn-ghost" style={{ marginLeft: 'auto', padding: '2px 6px', fontSize: 11 }}><Icon name="close" size={12} /></button>
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        danger
        title="Purge from queue?"
        message={pendingDelete && <>This removes <strong style={{ color: 'var(--text)' }}>{pendingDelete.title}</strong> from your stash. Earned XP stays banked.</>}
        confirmLabel="PURGE"
        busy={del.isPending}
        onConfirm={() => pendingDelete && del.mutate(pendingDelete.id)}
        onCancel={() => setPendingDelete(null)}
      />

      <ConfirmDialog
        open={pendingCharge !== null}
        danger
        title="Out of R&R"
        message={pendingCharge && <>You&rsquo;re out of downtime credits today. Logging this anyway records a breach on your <strong style={{ color: 'var(--text)' }}>{pendingCharge.targetName}</strong> anti-goal. Continue?</>}
        confirmLabel="LOG ANYWAY"
        onConfirm={() => { pendingCharge?.run(); setPendingCharge(null); }}
        onCancel={() => setPendingCharge(null)}
      />
    </div>
  );
}

/* ---------- WHAT NOW planner ---------- */
const CHIPS = [15, 30, 45, 60, 90, 120];
function WhatNow({
  items, budget, setBudget, pace, rrBanked, onJackIn,
}: { items: MediaItem[]; budget: number; setBudget: (n: number) => void; pace: MediaPace; rrBanked: number; onJackIn: (it: MediaItem) => void }) {
  const ranked = useMemo(() => {
    const out: Array<{ it: MediaItem; s: Suggestion }> = [];
    for (const it of items) { const s = suggest(it, budget, pace); if (s) out.push({ it, s }); }
    const fits = out.filter(o => o.s.fits).sort((a, b) => {
      if (!!a.s.finishes !== !!b.s.finishes) return a.s.finishes ? -1 : 1;       // finishes first
      const ar = a.it.status === 'active', br = b.it.status === 'active';
      if (ar !== br) return ar ? -1 : 1;                                          // in-progress next
      return (b.s.useMin ?? 0) - (a.s.useMin ?? 0);                               // fill the window
    });
    const over = out.filter(o => !o.s.fits).sort((a, b) => (a.s.needMin ?? 0) - (b.s.needMin ?? 0));
    return { fits, over };
  }, [items, budget, pace]);

  return (
    <div className="panel hud ncx-scan" style={{ padding: 18, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="sweep" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div className="ncx-chip" style={{ color: 'var(--cyan)', flex: 'none' }}><Icon name="clock" size={18} /></div>
        <div>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '0.26em', color: 'var(--text-dim)', textTransform: 'uppercase' }}>WHAT NOW</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 3 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>I HAVE</span>
            <input type="number" value={budget} min={5} max={300}
              onChange={e => setBudget(Math.max(5, Math.min(300, Number(e.target.value) || 0)))}
              style={{ width: 74, background: '#070811', border: '1px solid var(--line-2)', color: 'var(--cyan)', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 22, padding: '2px 8px', textAlign: 'center', outline: 'none' }} />
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>MIN</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}>
          {CHIPS.map(c => {
            const on = budget === c;
            return (
              <button key={c} onClick={() => setBudget(c)} className="mono"
                style={{
                  fontSize: 11, padding: '6px 12px', cursor: 'pointer', borderRadius: 0,
                  border: on ? '1px solid var(--cyan)' : '1px solid var(--line-2)',
                  background: on ? 'color-mix(in srgb, var(--cyan) 16%, transparent)' : 'var(--panel-2)',
                  color: on ? 'var(--cyan)' : 'var(--text-dim)',
                }}>{c >= 60 ? fmtMin(c) : `${c}m`}</button>
            );
          })}
        </div>
      </div>

      <input type="range" min={5} max={180} step={5} value={Math.min(180, budget)}
        onChange={e => setBudget(Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--cyan)' }} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(232px, 1fr))', gap: 12 }}>
        {ranked.fits.slice(0, 6).map(({ it, s }) => {
          const m = TYPE_META[it.type];
          const fillPct = Math.min(100, Math.round(((s.useMin ?? 0) / budget) * 100));
          return (
            <div key={it.id} className="panel-inset" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <Cover it={it} w={34} h={48} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.title}</div>
                  <div className="mono" style={{ fontSize: 9, letterSpacing: '0.1em', color: m.color, marginTop: 2 }}>{m.label.toUpperCase()}{it.status === 'active' ? ' · IN PROGRESS' : ''}</div>
                </div>
                {s.finishes && <span className="ncx-stamp flat" style={{ color: 'var(--lime)', fontSize: 8 }}>FINISHES</span>}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text)' }}>{s.label}</div>
              <div className="ncx-bar slim"><i style={{ width: `${fillPct}%`, background: `linear-gradient(90deg, ${m.color}, var(--cyan))` }} /><span className="seg-mask" /></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="mono" style={{ fontSize: 9, color: 'var(--text-faint)' }}>{fillPct}% OF WINDOW{(s.leftover ?? 0) > 4 ? ` · ${fmtMin(s.leftover!)} SPARE` : ''}</span>
                <button
                  className="btn btn-primary"
                  style={{ marginLeft: 'auto', padding: '5px 11px', fontSize: 10 }}
                  onClick={() => onJackIn(it)}
                  disabled={it.status === 'backlog' && rrBanked <= 0}
                  title={it.status === 'backlog' ? (rrBanked > 0 ? 'Spend 1 R&R credit to activate' : 'No R&R credits — clear a full day to bank one') : undefined}
                >
                  <Icon name="zap" size={11} /> JACK IN{it.status === 'backlog' ? ' · 1 R&R' : ''}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {ranked.fits.length === 0 && (
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-faint)' }}>Nothing fits {fmtMin(budget)} — try a bigger window, or start a book/game session.</div>
      )}
      {ranked.over.length > 0 && (
        <div className="mono" style={{ fontSize: 10, letterSpacing: '0.06em', color: 'var(--text-ghost)', display: 'flex', gap: 14, flexWrap: 'wrap', borderTop: '1px solid var(--line)', paddingTop: 11 }}>
          <span style={{ color: 'var(--text-faint)' }}>WON&rsquo;T FIT NOW:</span>
          {ranked.over.slice(0, 4).map(({ it, s }) => <span key={it.id}>{it.title} <span style={{ color: 'var(--text-faint)' }}>({s.label})</span></span>)}
        </div>
      )}
    </div>
  );
}

/* ---------- pace strip + R&R ---------- */
function PaceStrip({ pace, rr, antigoals }: { pace: MediaPace; rr: MediaPaceResponse['rr'] | undefined; antigoals: AntiGoal[] }) {
  const qc = useQueryClient();
  const setTarget = useMutation({
    mutationFn: (id: string | null) => api.put('/api/settings', { rrOverrunAntiGoalId: id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings'] }); qc.invalidateQueries({ queryKey: ['media', 'pace'] }); },
  });

  const remaining = rr?.remaining ?? 0;
  const rrColor = remaining > 0 ? 'var(--lime)' : 'var(--red)';
  const active = antigoals.filter(a => a.isActive);

  return (
    <div className="panel" style={{ padding: '11px 18px', display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'center' }}>
      <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.26em', color: 'var(--text-dim)', textTransform: 'uppercase' }}>YOUR PACE</span>
      <Pace icon="file" color="var(--amber)" label="READING" value={`${pace.book.pagesPerDay} pg/day`} />
      <Pace icon="eye" color="var(--violet)" label="SHOWS" value={`~${pace.show.epsPerDay} eps/day`} />
      <Pace icon="target" color="var(--lime)" label="GAMING" value={`${Math.round(pace.game.minPerWeek / 6) / 10} h/week`} />

      {/* R&R status + soft-gate target picker */}
      <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }} title={rr ? `${rr.dayBudget - rr.usedToday > 0 ? rr.dayBudget - rr.usedToday : 0} of today's budget + ${rr.banked} banked` : undefined}>
          <Icon name="zap" size={12} style={{ color: rrColor }} />
          <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.1em', color: 'var(--text-faint)' }}>R&amp;R</span>
          <span className="mono" style={{ fontSize: 11.5, fontWeight: 700, color: rrColor }}>{remaining} LEFT</span>
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span className="mono" style={{ fontSize: 9, letterSpacing: '0.1em', color: 'var(--text-ghost)' }}>OVERRUN →</span>
          <select
            value={rr?.overrunTargetId ?? ''}
            onChange={e => setTarget.mutate(e.target.value || null)}
            title="When you're out of R&R, logging media breaches this ICE entry"
            style={{ background: '#070811', border: '1px solid var(--line-2)', borderRadius: 0, color: rr?.overrunTargetId ? 'var(--red)' : 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: 10.5, padding: '4px 6px', outline: 'none', maxWidth: 160 }}
          >
            <option value="">no ICE (inert)</option>
            {active.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
          </select>
        </span>
      </span>
    </div>
  );
}
function Pace({ icon, color, label, value }: { icon: string; color: string; label: string; value: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
      <Icon name={icon} size={12} style={{ color }} />
      <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.1em', color: 'var(--text-faint)' }}>{label}</span>
      <span className="mono" style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-dim)' }}>{value}</span>
    </span>
  );
}

/* ---------- library card ---------- */
function MediaCard({
  it, pace, busy, rrBanked, onJackIn, onLog, onCorrect, onStatus, onDelete,
}: {
  it: MediaItem; pace: MediaPace; busy: boolean; rrBanked: number;
  onJackIn: () => void;
  onLog: (payload: { kind?: 'start' | 'progress' | 'finish'; minutes?: number; units?: number }) => void;
  onCorrect: (unitsDone: number) => void;
  onStatus: (status: Status) => void;
  onDelete: () => void;
}) {
  const m = TYPE_META[it.type];
  const done = it.status === 'done';
  const dropped = it.status === 'dropped';
  const rem = remainMin(it, pace);
  const pct = Math.round(pctDone(it, pace) * 100);
  const endlessGame = isEndless(it);

  // medium-specific one-tap controls — only an ACTIVE title can log time
  // (a backlog title must be activated with an R&R credit first; terminal
  // states log nothing).
  const controls: React.ReactNode[] = [];
  if (it.status === 'active') {
    if (it.type === 'show') {
      const perEp = perEpMinOf(it);
      controls.push(<Stepper key="s" label="EP"
        minus={() => onCorrect(Math.max(0, it.unitsDone - 1))}
        plus={() => onLog({ units: 1, minutes: perEp })} />);
    } else if (it.type === 'book') {
      const mpp = minPerPageOf(it, pace);
      controls.push(<Stepper key="b" label="10 PG"
        minus={() => onCorrect(Math.max(0, it.unitsDone - 10))}
        plus={() => onLog({ units: 10, minutes: Math.round(10 * mpp) })} />);
    } else if (it.type === 'game') {
      controls.push(<button key="g0" className="btn btn-ghost" style={ctrlBtn} onClick={() => onLog({ minutes: 15 })}>+15M</button>);
      controls.push(<button key="g1" className="btn btn-ghost" style={ctrlBtn} onClick={() => onLog({ minutes: 30 })}>+30M</button>);
      controls.push(<button key="g2" className="btn btn-ghost" style={ctrlBtn} onClick={() => onLog({ minutes: 60 })}>+1H</button>);
    } else {
      controls.push(<button key="mv" className="btn btn-ghost" style={ctrlBtn} onClick={() => onLog({ minutes: 15 })}>+15M</button>);
    }
    // Exact entry ("I'm on page 214") — PUTs absolute unitsDone, no charge.
    controls.push(<SetProgress key="set"
      unit={it.type === 'show' ? 'EP' : it.type === 'book' ? 'PG' : 'MIN'}
      max={(it.type === 'show' || it.type === 'book')
        ? (it.totalUnits ?? undefined)
        : (endlessGame ? undefined : it.estMinutes ?? undefined)}
      onSet={onCorrect} />);
  }

  return (
    <div className="panel" style={{
      padding: 14, display: 'flex', gap: 13, alignItems: 'stretch',
      border: done ? '1px solid color-mix(in srgb, var(--lime) 45%, transparent)' : '1px solid var(--line)',
      background: done ? 'linear-gradient(180deg, rgba(67,255,166,0.05), transparent)' : undefined,
      opacity: busy ? 0.92 : dropped ? 0.66 : 1,
    }}>
      <Cover it={it} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: done ? 'var(--lime)' : 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: done || dropped ? 'line-through' : 'none' }}>{it.title}</div>
          </div>
          {dropped && <span className="mono" style={{ fontSize: 9, letterSpacing: '0.12em', color: 'var(--text-faint)', border: '1px solid var(--line-2)', padding: '2px 6px', flex: 'none' }}>DROPPED</span>}
          <TypeBadge type={it.type} />
        </div>

        {/* length + source */}
        <div className="mono" style={{ fontSize: 10, letterSpacing: '0.04em', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Icon name="clock" size={11} style={{ color: m.color }} />{lengthText(it, pace)}
          <span style={{ color: 'var(--text-ghost)' }}>· via {sourceOf(it)}</span>
        </div>

        {/* progress */}
        {endlessGame ? (
          <div className="mono" style={{ fontSize: 10.5, color: 'var(--cyan)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {progressText(it)} <span style={{ color: 'var(--text-faint)' }}>· session-based · no finish line</span>
          </div>
        ) : (
          <>
            <div className="ncx-bar slim"><i style={{ width: `${pct}%`, background: done ? 'var(--lime)' : `linear-gradient(90deg, ${m.color}, var(--cyan))` }} /><span className="seg-mask" /></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--cyan)' }}>{progressText(it)}</span>
              {!done && rem > 0 && <span className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>· {fmtMin(rem)} left{relativeText(rem, pace) ? ` · ${relativeText(rem, pace)}` : ''}</span>}
            </div>
          </>
        )}

        {/* footer: ETA + controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'auto', flexWrap: 'wrap' }}>
          {!done && etaText(it, pace) && <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.06em', color: 'var(--violet)', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="trend" size={10} style={{ color: 'var(--violet)' }} />{etaText(it, pace)}</span>}
          {endlessGame && !done && <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.06em', color: 'var(--text-faint)', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="repeat" size={10} style={{ color: 'var(--text-faint)' }} />log a session anytime</span>}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {it.status === 'backlog' && (
              <button
                className="btn" style={ctrlBtn}
                disabled={busy || rrBanked <= 0}
                onClick={onJackIn}
                title={rrBanked > 0 ? 'Spend 1 R&R credit to activate' : 'No R&R credits — clear a full day to bank one'}
              >
                <Icon name="zap" size={11} /> JACK IN · 1 R&R
              </button>
            )}
            {controls}
            {done || dropped
              ? <button className="btn btn-ghost" style={ctrlBtn} disabled={busy} onClick={() => onStatus('backlog')}><Icon name="repeat" size={11} /> RE-QUEUE</button>
              : (!endlessGame && <button className="btn" style={ctrlBtn} disabled={busy} onClick={() => onStatus('done')}><Icon name="check" size={12} /> DONE</button>)}
            <button className="btn btn-ghost" style={{ ...ctrlBtn, padding: '5px 7px' }} onClick={onDelete} aria-label={`Delete ${it.title}`}><Icon name="close" size={13} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}
const ctrlBtn: React.CSSProperties = { padding: '5px 9px', fontSize: 10 };

function Stepper({ minus, plus, label }: { minus: () => void; plus: () => void; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <button className="btn btn-ghost" style={{ ...ctrlBtn, padding: '4px 8px' }} onClick={minus}>−</button>
      <span className="mono" style={{ fontSize: 9, color: 'var(--text-faint)' }}>{label}</span>
      <button className="btn btn-ghost" style={{ ...ctrlBtn, padding: '4px 8px' }} onClick={plus}>+</button>
    </span>
  );
}

/** Set absolute progress in the item's natural unit (Enter or SET commits). */
function SetProgress({ unit, max, onSet }: { unit: string; max?: number; onSet: (n: number) => void }) {
  const [val, setVal] = useState('');
  const commit = () => {
    const n = Math.round(Number(val));
    if (val.trim() === '' || !Number.isFinite(n) || n < 0) return;
    onSet(max != null ? Math.min(max, n) : n);
    setVal('');
  };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <input type="number" min={0} max={max} value={val} placeholder={unit}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') commit(); }}
        title={`Set exact ${unit.toLowerCase()} (Enter to save)`}
        style={{ width: 54, padding: '4px 6px', background: '#070811', border: '1px solid var(--line-2)', borderRadius: 0, color: 'var(--cyan)', fontFamily: 'var(--font-mono)', fontSize: 10, outline: 'none', textAlign: 'right' }} />
      <button className="btn btn-ghost" style={{ ...ctrlBtn, padding: '4px 8px' }} disabled={val.trim() === ''} onClick={commit}>SET</button>
    </span>
  );
}

/* ---------- cover placeholder (no real cover art — generated tile) ---------- */
function Cover({ it, w = 46, h = 66 }: { it: MediaItem; w?: number; h?: number }) {
  const m = TYPE_META[it.type];
  return (
    <div style={{
      width: w, height: h, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: m.color, border: '1px solid var(--line)',
      background: `linear-gradient(155deg, color-mix(in srgb, ${m.color} 26%, #0b0c16), #0b0c16)`,
    }}>
      <Icon name={m.icon} size={Math.round(h / 3.4)} style={{ color: m.color }} />
    </div>
  );
}
function TypeBadge({ type }: { type: MediaType }) {
  const m = TYPE_META[type];
  return <span className="ncx-stamp flat" style={{ color: m.color, display: 'inline-flex', alignItems: 'center', gap: 5, flex: 'none' }}><Icon name={m.icon} size={11} /> {m.label}</span>;
}

/* ---------- add form ---------- */
function AddForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [type, setType] = useState<MediaType>('book');
  const [title, setTitle] = useState('');
  const [endless, setEndless] = useState(false);
  const [inProgress, setInProgress] = useState(false);

  const create = useMutation({
    mutationFn: () => {
      const endlessGame = type === 'game' && endless;
      // Length/units/ids are left null on purpose: POST /api/media runs the
      // estimator server-side to fill them (skipped for endless games), so a
      // single ADD click does the whole job — no separate estimate step.
      return api.post('/api/media', {
        type,
        title: title.trim(),
        // "Already in progress" skips the queue — a half-read book shouldn't
        // need an R&R credit before its progress can be logged.
        status: inProgress ? 'active' : 'backlog',
        estMinutes: null,
        totalUnits: null,
        externalId: null,
        externalSource: endlessGame ? 'manual' : null,
        meta: endlessGame ? { endless: true } : null,
      });
    },
    onSuccess: () => { onDone(); onClose(); },
  });

  return (
    <div className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="kicker">TYPE</span>
          <select value={type} onChange={e => { setType(e.target.value as MediaType); setEndless(false); }} style={addInput}>
            <option value="book">Book</option><option value="movie">Movie</option><option value="show">Show</option><option value="game">Game</option>
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 200 }}>
          <span className="kicker">TITLE</span>
          <input autoFocus value={title} onChange={e => setTitle(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && title.trim() && !create.isPending && create.mutate()}
            placeholder="e.g. Dune, Severance, Hades" style={addInput} />
        </label>
        <button className="btn btn-primary" disabled={!title.trim() || create.isPending} onClick={() => create.mutate()}>
          <Icon name="plus" size={13} /> {create.isPending ? 'ADDING…' : 'ADD'}
        </button>
        <button className="btn btn-ghost" onClick={onClose}>CANCEL</button>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={() => setInProgress(p => !p)} className="mono"
          style={{
            fontSize: 10, letterSpacing: '0.06em', padding: '5px 10px', cursor: 'pointer', borderRadius: 0,
            border: inProgress ? '1px solid var(--cyan)' : '1px solid var(--line-2)',
            background: inProgress ? 'color-mix(in srgb, var(--cyan) 14%, transparent)' : 'var(--panel-2)',
            color: inProgress ? 'var(--cyan)' : 'var(--text-dim)', display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
          <Icon name={inProgress ? 'check' : 'close'} size={11} /> ALREADY IN PROGRESS — SKIP THE QUEUE
        </button>
        {type === 'game' && (
          <button onClick={() => setEndless(e => !e)} className="mono"
            style={{
              fontSize: 10, letterSpacing: '0.06em', padding: '5px 10px', cursor: 'pointer', borderRadius: 0,
              border: endless ? '1px solid var(--lime)' : '1px solid var(--line-2)',
              background: endless ? 'color-mix(in srgb, var(--lime) 14%, transparent)' : 'var(--panel-2)',
              color: endless ? 'var(--lime)' : 'var(--text-dim)', display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
            <Icon name={endless ? 'check' : 'close'} size={11} /> ENDLESS — NO FINISH LINE (LOG SESSIONS)
          </button>
        )}
      </div>
      <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-faint)' }}>
        {type === 'game' && endless
          ? 'Endless titles skip estimation — progress is logged per session.'
          : 'Pages / runtime / episodes auto-estimate on ADD.'}
      </div>
    </div>
  );
}
const addInput: React.CSSProperties = { padding: '8px 12px', background: '#070811', border: '1px solid var(--line-2)', borderRadius: 0, color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 13, outline: 'none' };

function Empty({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div className="panel hud" style={{ padding: 40, textAlign: 'center', color: color ?? 'var(--text-faint)' }}>
      <div className="mono" style={{ fontSize: 13 }}>{children}</div>
    </div>
  );
}
