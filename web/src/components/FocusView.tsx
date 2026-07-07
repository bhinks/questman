/**
 * FocusView — the JACK IN deep-work chamber.
 *
 * A dedicated, distraction-free page (App.tsx renders it INSTEAD of the
 * AppShell — no deck, no topbar, no status rail) with one huge clock in
 * the center. Above the clock, two optional setup inputs:
 *
 *   - TIME LIMIT: none (default) → the clock counts UP until jacked out;
 *     55/40/25/15 or a custom minute value → counts DOWN and auto-logs
 *     at zero.
 *   - WORKING ON: pre-seeded with the priority contract when launched
 *     from the Today page; otherwise pick one of today's contracts, a
 *     project / habit / chore / workout plan, or OTHER with freeform text.
 *
 * Both inputs default to the LAST run's setup (localStorage) so a repeat
 * visit doesn't re-enter everything from scratch.
 *
 * Sessions persist via POST /api/focus/sessions on jack-out (quest targets
 * also accumulate Quest.actualMinutes server-side). ABORT discards. The
 * active run is mirrored to localStorage so an accidental reload drops you
 * straight back into the chamber with the clock still right.
 *
 * The clock face honors the equipped Night Market timer style
 * (PlayerSnapshot.equippedTimer → data-timer attr). The v1 faces
 * (flip/ring/pulse) restyle the digits; the v2 CHRONO styles
 * (standard/fuse/flatline/orbital/detonator) additionally render their
 * furniture (progress rail / fuse bar / EKG / EST label) as a compact
 * row under the clock (SessionTimer), and 'ring'/'orbital' draw an SVG
 * ring that drains the countdown or laps the minute.
 *
 * OVERTIME (Night Market v2 handoff): a countdown no longer auto-logs at
 * zero — past the limit the clock flips to red `+MM:SS` and keeps counting
 * ("BOOM. KEEP WORKING"). Jack-out logs the full raw minutes.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import type { FocusTargetOption, FocusTargetType, FocusSession, PlayerSnapshot } from '../lib/api';
import { Icon } from './Icon';
import { SessionTimer, type ChronoStyle } from './SessionTimer';

/** v2 CHRONO styles that render a furniture row under the chamber clock. */
const CHRONO_STYLES: ReadonlySet<string> = new Set(['standard', 'fuse', 'flatline', 'orbital', 'detonator'] satisfies ChronoStyle[]);

/** What the launcher (topbar / priority contract) seeds the chamber with. */
export interface FocusSeed {
  type: FocusTargetType;
  id: string | null;
  label: string;
}

const LS_KEY = 'qm-focus-active';
const LS_SETUP_KEY = 'qm-focus-setup';

/** The running session, mirrored to localStorage for reload-resume. */
interface ActiveRun {
  startedAt: number;            // epoch ms
  limitMin: number | null;      // null = open-ended count-up
  targetType: FocusTargetType;
  targetId: string | null;
  label: string;
}

const LIMIT_PRESETS = [55, 40, 25, 15];

function fmtClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function readActiveRun(): ActiveRun | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (typeof j?.startedAt !== 'number') return null;
    // Discard a stale run: a tab reloaded days later must not resume a multi-day
    // "open run". 48h matches the server-side startedAt clamp in POST
    // /api/focus/sessions, so a discarded run couldn't have logged a real session.
    if (Date.now() - j.startedAt > 48 * 60 * 60 * 1000) {
      localStorage.removeItem(LS_KEY);
      return null;
    }
    return {
      startedAt: j.startedAt,
      limitMin: typeof j.limitMin === 'number' ? j.limitMin : null,
      targetType: j.targetType ?? 'other',
      targetId: typeof j.targetId === 'string' ? j.targetId : null,
      label: typeof j.label === 'string' && j.label ? j.label : 'Unlabeled run',
    };
  } catch {
    return null;
  }
}

/** Last run's setup, restored as the next visit's defaults. */
interface SavedSetup {
  limitChoice: number | 'custom' | null;
  customMin: string;
  targetSel: string;
  otherText: string;
}

function readSavedSetup(): SavedSetup | null {
  try {
    const raw = localStorage.getItem(LS_SETUP_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    return {
      limitChoice: typeof j?.limitChoice === 'number' ? j.limitChoice : j?.limitChoice === 'custom' ? 'custom' : null,
      customMin: typeof j?.customMin === 'string' ? j.customMin : '',
      targetSel: typeof j?.targetSel === 'string' && j.targetSel ? j.targetSel : 'other',
      otherText: typeof j?.otherText === 'string' ? j.otherText : '',
    };
  } catch {
    return null;
  }
}

const TYPE_GROUPS: Array<[FocusTargetType, string]> = [
  ['quest', "TODAY'S CONTRACTS"],
  ['project', 'PROJECTS'],
  ['habit', 'HABITS'],
  ['chore', 'CHORES'],
  ['workout', 'WORKOUTS'],
];

export function FocusView({ seed, onExit }: { seed: FocusSeed | null; onExit: () => void }) {
  const qc = useQueryClient();

  // ---- setup state ----------------------------------------------------
  // Defaults restore the last run's setup (localStorage) — re-picking the
  // limit/target every visit is how runs end up "Unlabeled".
  const [saved] = useState(readSavedSetup);
  // Limit: null = no limit (count up). 'custom' keeps its own minute text.
  const [limitChoice, setLimitChoice] = useState<number | 'custom' | null>(saved?.limitChoice ?? null);
  const [customMin, setCustomMin] = useState(saved?.customMin ?? '');
  // Target select, encoded "type:id" | "other". Seeded launches preselect.
  const seedValue = seed && seed.id ? `${seed.type}:${seed.id}` : null;
  const [targetSel, setTargetSel] = useState<string>(seedValue ?? saved?.targetSel ?? 'other');
  const [otherText, setOtherText] = useState(saved?.otherText ?? '');

  // ---- run state -------------------------------------------------------
  // Initialized from localStorage so a reload mid-run resumes seamlessly.
  const [run, setRun] = useState<ActiveRun | null>(() => readActiveRun());
  const [done, setDone] = useState<{ minutes: number; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const phase: 'setup' | 'running' | 'done' = done ? 'done' : run ? 'running' : 'setup';

  // Re-render twice a second while the clock runs.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (phase !== 'running') return;
    const id = setInterval(() => setTick(t => t + 1), 500);
    return () => clearInterval(id);
  }, [phase]);

  const playerQ = useQuery({
    queryKey: ['player'],
    queryFn: () => api.get<{ player: PlayerSnapshot }>('/api/player').then(r => r.player),
  });
  const targetsQ = useQuery({
    queryKey: ['focus', 'targets'],
    queryFn: () => api.get<{ targets: FocusTargetOption[] }>('/api/focus/targets').then(r => r.targets),
  });
  const targets = targetsQ.data ?? [];
  // null slot = STANDARD ISSUE (the free CHRONO built-in, v2 default face).
  const timerKey = playerQ.data?.equippedTimer ?? 'standard';

  // A restored selection can point at a target that no longer exists
  // (contract cleared, project archived) — fall back to freeform once the
  // picker options load rather than jacking in against a dead id.
  useEffect(() => {
    if (targetsQ.data == null || targetSel === 'other' || targetSel === seedValue) return;
    if (!targetsQ.data.some(t => `${t.type}:${t.id}` === targetSel)) setTargetSel('other');
  }, [targetsQ.data, targetSel, seedValue]);

  const logSession = useMutation({
    mutationFn: (body: {
      targetType: FocusTargetType; targetId: string | null; label: string;
      startedAt: string; minutes: number; limitMinutes: number | null;
    }) => api.post<{ session: FocusSession }>('/api/focus/sessions', body),
    onSuccess: (res) => {
      localStorage.removeItem(LS_KEY);
      setRun(null);
      setDone({ minutes: res.session.minutes, label: res.session.label });
      qc.invalidateQueries({ queryKey: ['focus'] });
      // Quest targets accumulate actualMinutes — refresh the contract board.
      qc.invalidateQueries({ queryKey: ['quests'] });
    },
    onError: (err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Failed to log the session');
    },
  });

  // ---- derived clock ---------------------------------------------------
  const limitMin = phase === 'running'
    ? run!.limitMin
    : limitChoice === 'custom'
      ? (Number(customMin) >= 1 ? Math.min(1440, Math.floor(Number(customMin))) : null)
      : limitChoice;

  const elapsedSec = run ? (Date.now() - run.startedAt) / 1000 : 0;
  const limitSec = limitMin != null ? limitMin * 60 : null;
  const clockSec = phase === 'running'
    ? (limitSec != null ? limitSec - elapsedSec : elapsedSec)
    : (limitSec ?? 0);

  // OVERTIME (v2 handoff): past the limit the clock counts UP in red
  // (+MM:SS) instead of auto-logging — keep working, jack out yourself.
  const overtime = phase === 'running' && limitSec != null && elapsedSec >= limitSec;

  // Ring progress: countdown drains 1 → 0; open runs lap once per minute.
  const ringFrac = phase !== 'running'
    ? 1
    : limitSec != null
      ? Math.max(0, 1 - elapsedSec / limitSec)
      : (elapsedSec % 60) / 60;
  // Orbital satellite/arc tracks PROGRESS (elapsed), not remainder.
  const orbitFrac = limitSec != null ? Math.min(1, 1 - ringFrac) : (elapsedSec % 60) / 60;

  const jackOut = () => {
    if (!run || logSession.isPending) return;
    const minutes = Math.min(1440, Math.max(1, Math.round((Date.now() - run.startedAt) / 60_000)));
    setError(null);
    logSession.mutate({
      targetType: run.targetType,
      targetId: run.targetId,
      label: run.label,
      startedAt: new Date(run.startedAt).toISOString(),
      minutes,
      limitMinutes: run.limitMin,
    });
  };

  const jackIn = () => {
    let targetType: FocusTargetType = 'other';
    let targetId: string | null = null;
    let label = otherText.trim() || 'Unlabeled run';
    if (targetSel !== 'other') {
      const i = targetSel.indexOf(':');
      targetType = targetSel.slice(0, i) as FocusTargetType;
      targetId = targetSel.slice(i + 1);
      label = (seedValue === targetSel ? seed?.label : targets.find(t => t.id === targetId)?.label) ?? 'Unlabeled run';
    }
    const next: ActiveRun = { startedAt: Date.now(), limitMin, targetType, targetId, label };
    // Remember this setup — it becomes the next visit's defaults.
    localStorage.setItem(LS_SETUP_KEY, JSON.stringify({ limitChoice, customMin, targetSel, otherText } satisfies SavedSetup));
    localStorage.setItem(LS_KEY, JSON.stringify(next));
    setError(null);
    setRun(next);
  };

  const abort = () => {
    localStorage.removeItem(LS_KEY);
    setRun(null);
    onExit();
  };

  // ---- clock face -------------------------------------------------------
  const clockStr = overtime
    ? '+' + fmtClock(elapsedSec - (limitSec ?? 0))
    : fmtClock(clockSec);
  // DETONATOR blinks under a minute (and in overtime) — design contract.
  const detonatorHot = timerKey === 'detonator' && phase === 'running'
    && (overtime || (limitSec != null && limitSec - elapsedSec < 60));
  const clock = (
    <div
      className={'qm-clock'
        + (phase === 'running' ? ' running' : '')
        + (overtime ? ' overtime' : '')
        + (detonatorHot ? ' tmr-blink' : '')}
      data-timer={timerKey}
    >
      {timerKey === 'detonator' && <span className="qm-sep">⟦</span>}
      {clockStr.split('').map((ch, i) => (
        ch === ':'
          ? <span key={i} className="qm-sep">:</span>
          : <span key={i} className="qm-digit">{ch}</span>
      ))}
      {timerKey === 'detonator' && <span className="qm-sep">⟧</span>}
    </div>
  );

  const C = 2 * Math.PI * 46; // ring circumference (r=46 in a 100-unit viewBox)
  const face = timerKey === 'ring' ? (
    <div className="qm-ring-wrap">
      <svg viewBox="0 0 100 100" aria-hidden>
        <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(var(--accent-rgb),0.14)" strokeWidth="1.5" />
        <circle
          cx="50" cy="50" r="46" fill="none"
          stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round"
          strokeDasharray={`${Math.max(0.001, ringFrac) * C} ${C}`}
          transform="rotate(-90 50 50)"
          style={{ filter: 'drop-shadow(0 0 6px rgba(var(--accent-rgb),0.7))', transition: 'stroke-dasharray .4s linear' }}
        />
      </svg>
      {clock}
    </div>
  ) : timerKey === 'orbital' ? (
    /* ORBITAL — progress arc + a satellite dot riding the rim (v2). */
    <div className="qm-ring-wrap">
      <svg viewBox="0 0 100 100" aria-hidden>
        <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(var(--accent-rgb),0.14)" strokeWidth="1.5" />
        <circle
          cx="50" cy="50" r="46" fill="none"
          stroke={overtime ? 'var(--red)' : 'var(--cyan)'} strokeWidth="2" strokeLinecap="round"
          strokeDasharray={`${Math.max(0.001, orbitFrac) * C} ${C}`}
          transform="rotate(-90 50 50)"
          style={{ filter: 'drop-shadow(0 0 6px rgba(var(--accent-rgb),0.7))', transition: 'stroke-dasharray .4s linear' }}
        />
        <circle
          cx={50 + 46 * Math.cos(orbitFrac * 2 * Math.PI - Math.PI / 2)}
          cy={50 + 46 * Math.sin(orbitFrac * 2 * Math.PI - Math.PI / 2)}
          r="2.6" fill={overtime ? 'var(--red)' : 'var(--cyan)'}
          style={{ filter: 'drop-shadow(0 0 5px rgba(var(--accent-rgb),0.9))' }}
        />
      </svg>
      {clock}
    </div>
  ) : clock;

  // CHRONO furniture row (v2): the style's rail/fuse/EKG/EST readout under
  // the clock while a LIMITED run is live (open runs have no est to burn).
  const chronoRail = phase === 'running' && run && run.limitMin != null
    && CHRONO_STYLES.has(timerKey) && timerKey !== 'orbital' ? (
      <div style={{ width: 'min(560px, 86vw)' }}>
        <SessionTimer styleKey={timerKey} start={run.startedAt} estMin={run.limitMin} hideDigits />
      </div>
    ) : null;

  // Group the picker options by type once per fetch. A seeded launch renders
  // its own PRIORITY CONTRACT optgroup, so drop that id here — otherwise the
  // same target appears twice in the select.
  const grouped = useMemo(() => TYPE_GROUPS
    .map(([type, title]) => ({ type, title, opts: targets.filter(t => t.type === type && `${t.type}:${t.id}` !== seedValue) }))
    .filter(g => g.opts.length > 0), [targets, seedValue]);

  return (
    <div className="qm-focus">
      {/* ---- minimal header: serial + exit ---- */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span className="ncx-serial">FOCUS CHAMBER // DEEP WORK</span>
        <span style={{ flex: 1 }} />
        {phase !== 'running' && (
          <button className="btn btn-ghost" onClick={onExit} title="Back to the hub">
            <Icon name="close" size={13} /> EXIT
          </button>
        )}
      </div>

      <div className="qm-focus-center">
        {/* ---- setup: limit + target, above the clock ---- */}
        {phase === 'setup' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, alignItems: 'center', width: 'min(620px, 92vw)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
              <span className="kicker">TIME LIMIT</span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                {/* keyed by selection state — remount instead of morphing (stuck-transition pitfall) */}
                <button
                  key={'none-' + String(limitChoice === null)}
                  className={'btn' + (limitChoice === null ? ' btn-primary' : '')}
                  style={{ padding: '7px 14px', fontSize: 11 }}
                  onClick={() => setLimitChoice(null)}
                >
                  NONE · COUNT UP
                </button>
                {LIMIT_PRESETS.map(m => (
                  <button
                    key={m + '-' + String(limitChoice === m)}
                    className={'btn' + (limitChoice === m ? ' btn-primary' : '')}
                    style={{ padding: '7px 14px', fontSize: 11 }}
                    onClick={() => setLimitChoice(m)}
                  >
                    {m} MIN
                  </button>
                ))}
                <button
                  key={'custom-' + String(limitChoice === 'custom')}
                  className={'btn' + (limitChoice === 'custom' ? ' btn-primary' : '')}
                  style={{ padding: '7px 14px', fontSize: 11 }}
                  onClick={() => setLimitChoice('custom')}
                >
                  CUSTOM
                </button>
                {limitChoice === 'custom' && (
                  <input
                    className="ncx-input"
                    type="number"
                    min={1}
                    max={1440}
                    placeholder="min"
                    value={customMin}
                    onChange={e => setCustomMin(e.target.value)}
                    style={{ width: 84, padding: '7px 10px' }}
                    autoFocus
                  />
                )}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', width: '100%' }}>
              <span className="kicker">WHAT ARE YOU WORKING ON</span>
              <div style={{ display: 'flex', gap: 8, width: '100%', justifyContent: 'center' }}>
                <select
                  className="ncx-input"
                  value={targetSel}
                  onChange={e => setTargetSel(e.target.value)}
                  style={{ maxWidth: 320 }}
                >
                  {seedValue && seed && (
                    <optgroup label="PRIORITY CONTRACT">
                      <option value={seedValue}>{seed.label}</option>
                    </optgroup>
                  )}
                  {grouped.map(g => (
                    <optgroup key={g.type} label={g.title}>
                      {g.opts.map(t => (
                        <option key={t.id} value={`${t.type}:${t.id}`}>{t.label}</option>
                      ))}
                    </optgroup>
                  ))}
                  <optgroup label="FREEFORM">
                    <option value="other">Other…</option>
                  </optgroup>
                </select>
                {targetSel === 'other' && (
                  <input
                    className="ncx-input"
                    placeholder="What's the run?"
                    value={otherText}
                    maxLength={200}
                    onChange={e => setOtherText(e.target.value)}
                    style={{ maxWidth: 260 }}
                  />
                )}
              </div>
            </div>
          </div>
        )}

        {/* ---- the clock (+ the equipped CHRONO style's furniture row) ---- */}
        {face}
        {chronoRail}

        {/* ---- under-clock: status + controls ---- */}
        {phase === 'setup' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
            <div className="mono" style={{ fontSize: 10, letterSpacing: '0.22em', color: 'var(--text-faint)' }}>
              {limitMin != null ? `COUNTDOWN · ${limitMin} MIN` : 'OPEN RUN · COUNTS UP UNTIL YOU JACK OUT'}
            </div>
            <button className="btn btn-primary" style={{ padding: '14px 38px', fontSize: 13 }} onClick={jackIn}>
              <Icon name="zap" size={15} /> JACK IN
            </button>
          </div>
        )}

        {phase === 'running' && run && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
            <div className="mono" style={{ fontSize: 11, letterSpacing: '0.18em', color: 'var(--text-dim)', textTransform: 'uppercase', maxWidth: '80vw', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              ▸ {run.label}
            </div>
            <div className="mono" style={{ fontSize: 9.5, letterSpacing: '0.22em', color: 'var(--text-faint)' }}>
              {run.limitMin != null ? `LIMIT ${run.limitMin} MIN` : 'OPEN RUN'} · SINCE{' '}
              {new Date(run.startedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                className="btn btn-primary"
                style={{ padding: '13px 34px', fontSize: 13 }}
                disabled={logSession.isPending}
                onClick={jackOut}
              >
                <Icon name="zap" size={15} /> {logSession.isPending ? 'LOGGING…' : 'JACK OUT'}
              </button>
              <button
                className="btn btn-ghost"
                style={{ fontSize: 11 }}
                disabled={logSession.isPending}
                onClick={abort}
                title="Discard this run — nothing is logged"
              >
                ABORT
              </button>
            </div>
            {error && (
              <div className="mono" style={{ fontSize: 10.5, color: 'var(--red)', letterSpacing: '0.08em' }}>✕ {error}</div>
            )}
          </div>
        )}

        {phase === 'done' && done && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
            <div className="ncx-stamp flat" style={{ color: 'var(--lime)' }}>SESSION LOGGED</div>
            <div className="mono" style={{ fontSize: 11, letterSpacing: '0.14em', color: 'var(--text-dim)', textTransform: 'uppercase' }}>
              +{done.minutes} MIN ▸ {done.label}
            </div>
            <button className="btn btn-primary" style={{ padding: '12px 30px' }} onClick={onExit}>
              BACK TO THE HUB
            </button>
          </div>
        )}
      </div>

      {/* bottom serial — pure set dressing */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <span className="ncx-serial">NO FEEDS · NO TICKERS · JUST THE CLOCK</span>
      </div>
    </div>
  );
}
