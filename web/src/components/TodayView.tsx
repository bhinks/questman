/**
 * TodayView — landing tab, NIGHT CITY direction (design handoff).
 *
 * Recreates proto-today.jsx bound to real data:
 *   - HUD strip: hex level badge + segmented XP bar + STREAK/EDDIES/CLEARED
 *   - PRIORITY CONTRACT: the planner's top-ranked in-plan pending quest.
 *     JACK IN opens the distraction-free FOCUS CHAMBER (FocusView) seeded
 *     with the contract — focus minutes persist there and flow back into
 *     Quest.actualMinutes server-side.
 *   - CONTRACT LEDGER: remaining in-plan quests (counters get diamond pips
 *     + "+1" check-ins; one-shots get complete / skip / reroll) plus the
 *     day's cleared & skipped rows
 *   - Right rail: ENV.SCAN weather, POWER CELL energy (tap to override),
 *     SIDE JOBS (over-budget quests), SESSION LOG (today's XP ledger
 *     interleaved with today's focus runs)
 */
import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { PlayerSnapshot, Quest, TodayResponse, WeatherToday, DayPlan, PlanQuest, LedgerEntry, FocusSession, HandlerLatestResponse, HandlerPersona } from '../lib/api';
import { getSocket } from '../lib/socket';
import { Icon } from './Icon';
import type { FocusSeed } from './FocusView';

/** Module key → outline icon. NO emoji in this direction (meta.emoji unused). */
const MODULE_ICONS: Record<string, string> = {
  habits: 'check',
  chores: 'list',
  fitness: 'spark',
  finance: 'wallet',
  projects: 'grid',
  media: 'play',
  vitals: 'heart',
  social: 'flag',
};
const moduleIcon = (key: string): string => MODULE_ICONS[key] ?? 'target';

/** Ledger `reason` → terminal-log phrasing (lowercase, diegetic). */
const REASON_LABELS: Record<string, string> = {
  quest_complete: 'contract cleared',
  habit_log: 'habit logged',
  habit_log_undo: 'habit undone',
  workout_log: 'workout logged',
  streak_bonus: 'streak bonus',
  level_up: 'level up',
  shop_purchase: 'shop purchase',
};
const humanizeReason = (r: string): string => REASON_LABELS[r] ?? r.replace(/_/g, ' ');

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** "3H40" style duration for the ledger header serial. */
function fmtHm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}H${String(m).padStart(2, '0')}` : `${h}H`;
}

/** Persona key → display label + accent. */
const PERSONA_META: Record<HandlerPersona, { label: string; accent: string }> = {
  rogue_ai:  { label: 'ROGUE AI',  accent: 'var(--violet)' },
  fixer:     { label: 'FIXER',     accent: 'var(--cyan)' },
  ripperdoc: { label: 'RIPPERDOC', accent: 'var(--magenta)' },
};

/**
 * HandlerCard — the Handler's latest line, full-width under the HUD strip
 * (moved here from the topbar ticker, which truncated on narrow screens).
 * Dismiss marks it seen; a fresh line (socket push) brings the card back.
 */
function HandlerCard() {
  const qc = useQueryClient();
  const handlerQ = useQuery({
    queryKey: ['handler', 'latest'],
    queryFn: () => api.get<HandlerLatestResponse>('/api/handler/latest'),
  });

  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const refresh = () => qc.invalidateQueries({ queryKey: ['handler', 'latest'] });
    s.on('handler-message', refresh);
    return () => { s.off('handler-message', refresh); };
  }, [qc]);

  const dismiss = useMutation({
    mutationFn: (id: string) => api.post('/api/handler/seen', { ids: [id] }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['handler', 'latest'] }),
  });

  // The calibration "HANDLER FEED" toggle (formerly the topbar ticker knob)
  // gates this card.
  const settingsQ = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<{ settings: { tickerEnabled: boolean } }>('/api/settings').then(r => r.settings),
    staleTime: 5 * 60_000,
  });

  const data = handlerQ.data;
  if (settingsQ.data?.tickerEnabled === false) return null;
  if (!data?.enabled) return null;
  const msg = data.message;
  if (!msg || msg.seen) return null;

  const meta = PERSONA_META[(msg.persona ?? data.persona) as HandlerPersona] ?? PERSONA_META.rogue_ai;
  return (
    <div
      className="panel"
      style={{
        padding: '13px 18px', display: 'flex', alignItems: 'flex-start', gap: 12,
        borderLeft: `3px solid ${meta.accent}`,
        background: `linear-gradient(90deg, color-mix(in srgb, ${meta.accent} 7%, transparent), transparent 55%), #0b0c16`,
      }}
    >
      <span className="kicker" style={{ color: meta.accent, flexShrink: 0, marginTop: 2 }}>
        HANDLER · {meta.label}
      </span>
      <span style={{ flex: 1, fontSize: 13.5, lineHeight: 1.55, color: 'var(--text)' }}>
        {msg.text}
      </span>
      <button
        className="btn btn-ghost"
        title="Dismiss"
        disabled={dismiss.isPending}
        onClick={() => dismiss.mutate(msg.id)}
        style={{ padding: '4px 7px', flexShrink: 0, color: 'var(--text-faint)' }}
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}

/** ISO week number (Mon-based — matches the server's isoWeekKey / debrief cadence). */
function isoWeek(d: Date): number {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (x.getDay() + 6) % 7; // Mon=0 .. Sun=6
  x.setDate(x.getDate() - day + 3); // this week's Thursday
  const firstThu = new Date(x.getFullYear(), 0, 4);
  const ft = (firstThu.getDay() + 6) % 7;
  firstThu.setDate(firstThu.getDate() - ft + 3);
  return 1 + Math.round((x.getTime() - firstThu.getTime()) / (7 * 86_400_000));
}

/**
 * CHRONO — temporal grounding for the day (Brent's ask): today's date plus
 * where we sit in the WEEK (ISO, Mon-based — the debrief cadence) and the
 * MONTH (the budget cycle), highlighting how much runway is left for
 * week- and month-bound work. Days-left counts INCLUDE today (it's usable).
 */
function ChronoPanel() {
  const now = new Date();
  const dayOfWeek = ((now.getDay() + 6) % 7) + 1;           // Mon=1 .. Sun=7
  const weekLeft = 7 - dayOfWeek + 1;
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfMonth = now.getDate();
  const monthLeft = daysInMonth - dayOfMonth + 1;

  const dateLabel = now.toLocaleDateString(undefined, { weekday: 'short', month: '2-digit', day: '2-digit' }).toUpperCase();
  const monthName = now.toLocaleDateString(undefined, { month: 'short' }).toUpperCase();

  // Runway turns amber as a window closes (last 2 days of the week / last 5
  // of the month) — the "get the bound tasks done" cue.
  const weekColor = weekLeft <= 2 ? 'var(--amber)' : 'var(--cyan)';
  const monthColor = monthLeft <= 5 ? 'var(--amber)' : 'var(--violet)';

  const row = (label: string, n: number, total: number, left: number, color: string, leftLabel: string) => (
    <div style={{ marginTop: 10 }}>
      <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, letterSpacing: '0.16em', color: 'var(--text-faint)', marginBottom: 5 }}>
        <span>{label} · DAY {n}/{total}</span>
        <span style={{ color }}>{left} {leftLabel} LEFT</span>
      </div>
      <div className="ncx-bar slim">
        <i style={{ width: `${Math.min(100, (n / total) * 100)}%`, background: `linear-gradient(90deg, color-mix(in srgb, ${color} 45%, transparent), ${color})` }} />
        <span className="seg-mask" />
      </div>
    </div>
  );

  return (
    <div className="panel" style={{ padding: '15px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span className="ncx-val" style={{ fontSize: 24 }}>{dateLabel}</span>
        <span style={{ flex: 1 }} />
        <span className="ncx-serial">CHRONO // W{String(isoWeek(now)).padStart(2, '0')}</span>
      </div>
      {row('WEEK', dayOfWeek, 7, weekLeft, weekColor, weekLeft === 1 ? 'DAY' : 'DAYS')}
      {row(monthName, dayOfMonth, daysInMonth, monthLeft, monthColor, monthLeft === 1 ? 'DAY' : 'DAYS')}
    </div>
  );
}

/** Corner "+" tick decorations floated outside a panel (design recipe #2). */
function Ticks({ focal, children }: { focal?: boolean; children: React.ReactNode }) {
  const c = focal ? 'var(--cyan)' : undefined;
  return (
    <div className="ncx-ticks">
      <span className="tick" style={{ top: -4, left: -4, color: c }} />
      <span className="tick" style={{ bottom: -4, right: -4, color: c }} />
      {children}
    </div>
  );
}

export function TodayView({ onJackIn }: { onJackIn: (seed: FocusSeed | null) => void }) {
  const qc = useQueryClient();

  const playerQ = useQuery({
    queryKey: ['player'],
    queryFn: () => api.get<{ player: PlayerSnapshot }>('/api/player').then(r => r.player),
  });
  const todayQ = useQuery({
    queryKey: ['quests', 'today'],
    queryFn: () => api.get<TodayResponse>('/api/quests/today'),
  });
  const planQ = useQuery({
    queryKey: ['quests', 'plan'],
    queryFn: () => api.get<DayPlan>('/api/quests/plan'),
  });
  const weatherQ = useQuery({
    queryKey: ['weather', 'today'],
    queryFn: () => api.get<WeatherToday>('/api/weather/today'),
    staleTime: 30 * 60 * 1000,
  });
  // Today's XP grants for the SESSION LOG terminal. The ['player'] prefix
  // invalidation below refreshes this feed after every action.
  const ledgerQ = useQuery({
    queryKey: ['player', 'ledger', 'today'],
    queryFn: () => api.get<{ entries: LedgerEntry[] }>('/api/player/ledger?currency=xp&limit=60').then(r => r.entries),
  });
  // Today's focus runs, interleaved into the SESSION LOG (FocusView
  // invalidates the ['focus'] prefix after every jack-out).
  const focusQ = useQuery({
    queryKey: ['focus', 'sessions', 'recent'],
    queryFn: () => api.get<{ sessions: FocusSession[] }>('/api/focus/sessions?limit=40').then(r => r.sessions),
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['player'] });
    qc.invalidateQueries({ queryKey: ['quests', 'today'] });
    qc.invalidateQueries({ queryKey: ['quests', 'plan'] });
    qc.invalidateQueries({ queryKey: ['player', 'stats'] });
  };

  // Cross-client sync.
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const refresh = () => invalidateAll();
    const evts = ['player-updated', 'quest-completed', 'quest-progress', 'habit-checked', 'workout-logged'];
    evts.forEach(e => s.on(e, refresh));
    return () => evts.forEach(e => s.off(e, refresh));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc]);

  const completeQuest = useMutation({
    mutationFn: (id: string) => api.post(`/api/quests/${id}/complete`),
    onSuccess: invalidateAll,
  });
  const progressQuest = useMutation({
    mutationFn: (id: string) => api.post(`/api/quests/${id}/progress`, { delta: 1 }),
    onSuccess: invalidateAll,
  });
  const skipQuest = useMutation({
    // Skipping spends a skip token, so refresh the player HUD too.
    mutationFn: (id: string) => api.post(`/api/quests/${id}/skip`),
    onSuccess: invalidateAll,
  });
  const rerollQuest = useMutation({
    // Swap a quest for a fresh candidate; spends a reroll token (server-side,
    // only if a replacement was actually found).
    mutationFn: (id: string) => api.post(`/api/quests/${id}/reroll`),
    onSuccess: invalidateAll,
  });
  const setEnergy = useMutation({
    mutationFn: (tier: 'low' | 'med' | 'high') => api.post('/api/player/energy', { tier }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['player'] }),
  });

  if (playerQ.isLoading || todayQ.isLoading) {
    return <Splash>LOADING…</Splash>;
  }
  if (playerQ.isError || todayQ.isError) {
    return <Splash color="var(--red)">FAILED TO LOAD</Splash>;
  }

  const player = playerQ.data!;
  const today = todayQ.data!;
  const plan = planQ.data;
  const weather = weatherQ.data?.weather ?? null;

  // ---- derive the contract board from real data ----------------------
  const all = Object.values(today.byModule).flat();
  const planOrder = new Map((plan?.quests ?? []).map((q, i) => [q.id, i]));
  const planFlags = new Map((plan?.quests ?? []).map(q => [q.id, q.inPlan]));
  const pending = all
    .filter(q => q.status === 'pending')
    .sort((a, b) => (planOrder.get(a.id) ?? 999) - (planOrder.get(b.id) ?? 999));
  const inPlanPending = pending.filter(q => planFlags.get(q.id) !== false);
  // Priority = top-ranked in-plan one-shot; fall back to any pending quest.
  const priority = inPlanPending.find(q => q.targetCount <= 1) ?? pending[0] ?? null;
  const doneRows = all.filter(q => q.status === 'completed' || q.status === 'skipped');
  const ledgerRows = [...inPlanPending.filter(q => q.id !== priority?.id), ...doneRows];
  const sideJobs: PlanQuest[] = (plan?.quests ?? []).filter(q => !q.inPlan);
  const bestWindowQuest = pending.find(q => q.meta?.bestWindow) ?? null;

  // SESSION LOG: today's XP grants + focus runs, oldest → newest
  // (terminal order), interleaved by timestamp.
  type LogRow =
    | { kind: 'xp'; key: string; t: number; entry: LedgerEntry }
    | { kind: 'focus'; key: string; t: number; session: FocusSession };
  const logRows: LogRow[] = [
    ...(ledgerQ.data ?? []).filter(e => isToday(e.createdAt))
      .map((e): LogRow => ({ kind: 'xp', key: `xp-${e.id}`, t: new Date(e.createdAt).getTime(), entry: e })),
    ...(focusQ.data ?? []).filter(s => isToday(s.endedAt))
      .map((s): LogRow => ({ kind: 'focus', key: `fs-${s.id}`, t: new Date(s.endedAt).getTime(), session: s })),
  ].sort((a, b) => a.t - b.t);
  const xpDayTotal = today.xpEarned + today.xpAvailable;
  const bankedPct = Math.min(100, (today.xpEarned / Math.max(1, xpDayTotal)) * 100);

  const xpPct = Math.min(100, (player.xpIntoLevel / Math.max(1, player.xpForNextLevel)) * 100);

  const hudStats: Array<[string, string, string]> = [
    ['STREAK', `${player.currentStreak}D`, 'var(--lime)'],
    ['EDDIES', `€$${player.eddies.toLocaleString()}`, 'var(--amber)'],
    ['CLEARED', `${today.completedCount}/${today.totalCount}`, 'var(--cyan)'],
  ];

  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ---- HUD strip ---- */}
      <Ticks focal>
        <div className="panel hud ncx-scan" style={{ display: 'flex', alignItems: 'center', gap: 26, padding: '18px 24px' }}>
          <div className="sweep" />
          <div className="ncx-hex" style={{ width: 58, height: 58, fontSize: 23, flex: 'none', boxShadow: '0 0 24px -4px rgba(var(--accent-rgb),0.6)' }}>
            {player.level}
          </div>
          <div style={{ flex: 1.4, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <span className="kicker" style={{ fontSize: 10 }}>LEVEL {player.level} → {player.level + 1}</span>
              <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>
                <b style={{ color: 'var(--cyan)' }}>{player.xpIntoLevel}</b>/{player.xpForNextLevel} XP
              </span>
            </div>
            <div className="ncx-bar">
              <i style={{
                width: `${xpPct}%`,
                background: 'linear-gradient(90deg, var(--cyan-deep), var(--cyan))',
                boxShadow: '0 0 14px rgba(var(--accent-rgb),0.5)',
              }} />
              <span className="seg-mask" />
            </div>
            <div className="mono" style={{ fontSize: 9.5, color: 'var(--text-faint)', letterSpacing: '0.16em', marginTop: 7 }}>
              {player.totalXp.toLocaleString()} LIFETIME · TODAY <span style={{ color: 'var(--lime)' }}>+{today.xpEarned}</span> · {today.xpAvailable} ON THE TABLE
            </div>
          </div>
          {hudStats.map(([k, v, c]) => (
            <div key={k} style={{ textAlign: 'right', paddingLeft: 22, borderLeft: '1px solid var(--line)' }}>
              <div className="kicker" style={{ fontSize: 9 }}>{k}</div>
              <div className="ncx-val" style={{ fontSize: 24, color: c }}>{v}</div>
            </div>
          ))}
        </div>
      </Ticks>

      {/* Handler line — full width, full text (moved here from the topbar). */}
      <HandlerCard />

      {today.totalCount === 0 ? (
        <div className="panel hud" style={{ padding: '34px 24px', textAlign: 'center' }}>
          <div className="ncx-chroma" style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700 }}>NO CONTRACTS ON FILE</div>
          <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-faint)', letterSpacing: '0.18em', marginTop: 10 }}>
            ADD HABITS, PROJECTS, MEDIA, OR VITALS TO START GENERATING DAILY MISSIONS
          </div>
        </div>
      ) : (
        <div className="split-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 330px', gap: 16, alignItems: 'start' }}>
          {/* ---- left: priority contract + ledger ---- */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            {priority ? (
              <Ticks focal>
                <div className="panel hud ncx-scan" style={{ padding: '20px 24px' }}>
                  <div className="sweep" style={{ animationDelay: '-3s' }} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                    <span className="mono" style={{ fontSize: 10, letterSpacing: '0.26em', color: 'var(--cyan)' }}>▸▸ PRIORITY CONTRACT</span>
                    <span className="ncx-serial">CTR-{priority.id.slice(0, 6).toUpperCase()}</span>
                    <span style={{ flex: 1 }} />
                    {priority.mustDo && <span className="ncx-stamp flat" style={{ color: 'var(--red)' }}>MUST-DO</span>}
                    <span className={`ncx-stamp ${priority.difficulty}`}>{priority.difficulty}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 18 }}>
                    <div className="ncx-chip" style={{ width: 54, height: 54, color: 'var(--cyan)' }}>
                      <Icon name={moduleIcon(priority.module.key)} size={26} style={{ filter: 'drop-shadow(0 0 5px var(--cyan))' }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="ncx-glitch ncx-chroma" style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 700, letterSpacing: '0.01em', textTransform: 'uppercase' }}>
                        {priority.title}
                      </div>
                      <div style={{ color: 'var(--text-dim)', fontSize: 13.5, marginTop: 5 }}>{priority.description}</div>
                      <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-faint)', letterSpacing: '0.14em', marginTop: 11 }}>
                        {priority.module.name.toUpperCase()}
                        {priority.estMinutes != null && <> · EST {priority.estMinutes} MIN</>}
                        {' '}· REWARD <span style={{ color: 'var(--lime)' }}>+{priority.xpReward} XP</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 9, justifyContent: 'center' }}>
                      {/* JACK IN → the distraction-free FOCUS CHAMBER, seeded
                          with this contract (focus minutes persist there). */}
                      <button
                        key={priority.id + '-jack'}
                        className="btn btn-primary"
                        style={{ padding: '12px 24px' }}
                        onClick={() => onJackIn({ type: 'quest', id: priority.id, label: priority.title })}
                      >
                        <Icon name="zap" size={14} /> JACK IN
                      </button>
                      <button className="btn" onClick={() => completeQuest.mutate(priority.id)}>COMPLETE</button>
                      {/* Burnout relief applies to the top contract too. */}
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                        <button
                          className="btn btn-ghost"
                          style={{ padding: '5px 10px', fontSize: 10 }}
                          disabled={(player.skipTokens ?? 0) <= 0 || skipQuest.isPending}
                          title={player.skipTokens > 0 ? `Skip (${player.skipTokens} tokens)` : 'No skip tokens — buy more in the Shop'}
                          onClick={() => skipQuest.mutate(priority.id)}
                        >
                          SKIP
                        </button>
                        <button
                          className="btn btn-ghost"
                          style={{ padding: '5px 10px', fontSize: 10 }}
                          disabled={(player.rerollTokens ?? 0) <= 0 || rerollQuest.isPending}
                          title={player.rerollTokens > 0 ? `Reroll (${player.rerollTokens} tokens)` : 'No reroll tokens — buy more in the Shop'}
                          onClick={() => rerollQuest.mutate(priority.id)}
                        >
                          RR
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </Ticks>
            ) : (
              <div className="panel hud" style={{ padding: '34px 24px', textAlign: 'center' }}>
                <div className="ncx-chroma" style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--lime)' }}>
                  ALL CONTRACTS CLEARED
                </div>
                <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-faint)', letterSpacing: '0.18em', marginTop: 10 }}>
                  STREAK DAY {player.currentStreak} IN THE BAG · SEE YOU TOMORROW, RUNNER
                </div>
              </div>
            )}

            {/* ---- contract ledger ---- */}
            <div className="panel">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 18px', borderBottom: '1px solid var(--line-2)' }}>
                <span className="mono" style={{ fontSize: 10, letterSpacing: '0.26em', color: 'var(--text-dim)' }}>CONTRACT LEDGER — IN PLAN</span>
                <span style={{ flex: 1 }} />
                {plan && (
                  <span className="ncx-serial">
                    BUDGET {Math.round(plan.budgetMin / 60)}H // FIT {fmtHm(plan.plannedMin)}
                  </span>
                )}
              </div>
              {ledgerRows.length === 0 && (
                <div className="mono" style={{ padding: '15px 18px', fontSize: 10, letterSpacing: '0.14em', color: 'var(--text-faint)' }}>
                  NO FURTHER CONTRACTS ON FILE
                </div>
              )}
              {ledgerRows.map((q, i) => (
                <LedgerRow
                  key={q.id}
                  quest={q}
                  index={i}
                  skipTokens={player.skipTokens}
                  rerollTokens={player.rerollTokens}
                  onComplete={id => completeQuest.mutate(id)}
                  onProgress={id => progressQuest.mutate(id)}
                  onSkip={id => skipQuest.mutate(id)}
                  onReroll={id => rerollQuest.mutate(id)}
                />
              ))}
            </div>
          </div>

          {/* ---- right column ---- */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <ChronoPanel />
            {weather && (
              <div className="panel" style={{ padding: '15px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <span className="ncx-val" style={{ fontSize: 30 }}>{weather.tempMaxF}°F</span>
                  <span className="mono" style={{ fontSize: 10, letterSpacing: '0.2em', color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                    {weather.label}
                  </span>
                  <span style={{ flex: 1 }} />
                  <span className="ncx-serial">ENV.SCAN</span>
                </div>
                {/* Full conditions readout — high/low, precipitation, wind. */}
                <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                  {[
                    ['HIGH', `${weather.tempMaxF}°F`],
                    ['LOW', `${weather.tempMinF}°F`],
                    ['RAIN', `${weather.rainTodayIn.toFixed(2)}"`],
                    ['WIND', `${weather.windMaxMph} MPH`],
                  ].map(([k, v]) => (
                    <div key={k} className="panel-inset" style={{ flex: 1, padding: '7px 4px', textAlign: 'center' }}>
                      <div className="mono" style={{ fontSize: 8, letterSpacing: '0.2em', color: 'var(--text-ghost)' }}>{k}</div>
                      <div className="ncx-val" style={{ fontSize: 12.5, marginTop: 3 }}>{v}</div>
                    </div>
                  ))}
                </div>
                {bestWindowQuest && (
                  <div className="mono" style={{ fontSize: 10, color: 'var(--teal)', letterSpacing: '0.08em', marginTop: 10, lineHeight: 1.6 }}>
                    ▴ BEST WINDOW · {bestWindowQuest.title.toUpperCase()} {bestWindowQuest.meta!.bestWindow}
                  </div>
                )}
              </div>
            )}

            {player.energy && (
              <EnergyPanel energy={player.energy} onCycle={tier => setEnergy.mutate(tier)} />
            )}

            <div className="panel" style={{ padding: '15px 18px' }}>
              <div className="mono" style={{ fontSize: 10, letterSpacing: '0.26em', color: 'var(--text-dim)', marginBottom: 11 }}>
                SIDE JOBS — NOT IN PLAN
              </div>
              {sideJobs.length === 0 ? (
                <div className="mono" style={{ fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-faint)' }}>
                  NONE — THE PLAN COVERS EVERYTHING
                </div>
              ) : sideJobs.map(q => (
                <div key={q.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: 'var(--text-dim)', padding: '5px 0' }}>
                  <Icon name={moduleIcon(q.module.key)} size={14} style={{ color: 'var(--text-faint)', flex: 'none' }} />
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.title}</span>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>+{q.xpReward}</span>
                  {/* Off-plan ≠ unreachable: counters tick +1, one-shots complete. */}
                  <button
                    className="btn btn-ghost"
                    style={{ padding: '3px 7px', fontSize: 10, flex: 'none' }}
                    title={q.targetCount > 1 ? `Check in (${q.currentCount}/${q.targetCount})` : 'Complete'}
                    onClick={() => (q.targetCount > 1 ? progressQuest.mutate(q.id) : completeQuest.mutate(q.id))}
                  >
                    {q.targetCount > 1 ? `+1 · ${q.currentCount}/${q.targetCount}` : <Icon name="check" size={11} />}
                  </button>
                </div>
              ))}
            </div>

            <div className="panel" style={{ padding: '15px 18px' }}>
              <div className="mono" style={{ fontSize: 10, letterSpacing: '0.26em', color: 'var(--text-dim)', marginBottom: 11 }}>
                SESSION LOG
              </div>
              <div className="ncx-term" style={{ maxHeight: 180, overflowY: 'auto' }}>
                {logRows.map(r => r.kind === 'xp' ? (
                  <div key={r.key}>
                    <span className="cy">{hhmm(r.entry.createdAt)}</span>{' '}
                    {r.entry.amount > 0
                      ? <span className="ok">✓ {humanizeReason(r.entry.reason)}</span>
                      : humanizeReason(r.entry.reason)}
                    {r.entry.amount > 0 && <span> +{r.entry.amount}xp</span>}
                  </div>
                ) : (
                  <div key={r.key}>
                    <span className="cy">{hhmm(r.session.endedAt)}</span>{' '}
                    <span style={{ color: 'var(--violet)' }}>⧗ focus {r.session.minutes}m</span>
                    {' — '}{r.session.label.toLowerCase()}
                  </div>
                ))}
                <div>
                  <span className="cy">now</span> awaiting input<span className="cursor-blink" style={{ color: 'var(--cyan)' }}>_</span>
                </div>
              </div>
              <div className="ncx-bar slim" style={{ marginTop: 13 }}>
                <i style={{ width: `${bankedPct}%`, background: 'linear-gradient(90deg, #1fae5c, var(--lime))' }} />
                <span className="seg-mask" />
              </div>
              <div className="mono" style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.18em', marginTop: 6 }}>
                {today.xpEarned}/{xpDayTotal} XP BANKED
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Splash({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div className="panel hud" style={{ padding: 40, textAlign: 'center', color: color ?? 'var(--text-faint)' }}>
      <div className="mono" style={{ fontSize: 13, letterSpacing: '0.18em' }}>{children}</div>
    </div>
  );
}

/** One CONTRACT LEDGER row. Numbering starts at 02 (01 is the priority). */
function LedgerRow({
  quest, index, skipTokens, rerollTokens, onComplete, onProgress, onSkip, onReroll,
}: {
  quest: Quest;
  index: number;
  skipTokens: number;
  rerollTokens: number;
  onComplete: (id: string) => void;
  onProgress: (id: string) => void;
  onSkip: (id: string) => void;
  onReroll: (id: string) => void;
}) {
  const done = quest.status === 'completed';
  const skipped = quest.status === 'skipped';
  const isCounter = quest.targetCount > 1;

  // Days this quest has been carried forward (0 = generated today).
  const carriedDays = quest.originDate
    ? Math.max(0, Math.round((new Date().setHours(0, 0, 0, 0) - new Date(quest.originDate).setHours(0, 0, 0, 0)) / 86_400_000))
    : 0;

  const meta = skipped
    ? 'SKIPPED — STREAK SAFE'
    : done
      ? 'CLEARED'
      : [
          quest.module.name.toUpperCase(),
          quest.difficulty.toUpperCase(),
          quest.estMinutes != null ? `EST ${quest.estMinutes}M` : null,
          quest.source === 'bill' ? 'DUE' : null,
          quest.meta?.bestWindow ? `BEST WINDOW ${quest.meta.bestWindow}` : null,
          isCounter ? `${quest.currentCount}/${quest.targetCount} CHECKED` : null,
        ].filter(Boolean).join(' · ');

  return (
    <div className={'ncx-contract' + (done || skipped ? ' ncx-row-done' : '')}>
      <span className="num">{String(index + 2).padStart(2, '0')}</span>
      <div className="ncx-chip" style={{ color: done ? 'var(--lime)' : 'var(--cyan)' }}>
        <Icon name={done ? 'check' : moduleIcon(quest.module.key)} size={18} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
          <span className="ncx-row-title-text" style={{ fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {quest.title}
          </span>
          {!done && !skipped && carriedDays > 0 && (
            <span className="mono" style={{ flex: 'none', fontSize: 8.5, letterSpacing: '0.14em', color: 'var(--amber)' }}>
              CARRIED ×{carriedDays}D
            </span>
          )}
        </div>
        {/* The underlying activity — the themed title alone can be cryptic. */}
        {!done && !skipped && quest.description && quest.description !== quest.title && (
          <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {quest.description}
          </div>
        )}
        <div className="mono" style={{ fontSize: 9.5, color: 'var(--text-faint)', letterSpacing: '0.14em', marginTop: 3 }}>
          {meta}
        </div>
      </div>
      {done || skipped ? (
        <span className="mono" style={{ fontSize: 11, color: done ? 'var(--lime)' : 'var(--text-faint)' }}>
          {done ? `+${quest.xpReward} XP` : '—'}
        </span>
      ) : isCounter ? (
        <>
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {Array.from({ length: quest.targetCount }, (_, j) => (
              <span key={j} style={{
                width: 11, height: 11, flex: 'none',
                background: j < quest.currentCount ? 'var(--teal)' : '#10121f',
                boxShadow: j < quest.currentCount ? '0 0 6px rgba(47,245,214,0.6)' : 'inset 0 0 0 1px var(--line-2)',
                clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
                transition: 'background .2s, box-shadow .2s',
              }} />
            ))}
          </div>
          <span className="mono" style={{ fontSize: 11, color: 'var(--teal)' }}>{quest.currentCount}/{quest.targetCount}</span>
          <button
            className="btn"
            style={{ padding: '6px 13px', fontSize: 11 }}
            onClick={() => onProgress(quest.id)}
            disabled={quest.currentCount >= quest.targetCount}
          >
            +1
          </button>
        </>
      ) : (
        <>
          <span className={`ncx-stamp flat ${quest.difficulty}`}>{quest.difficulty}</span>
          <span className="mono" style={{ fontSize: 12, color: 'var(--lime)', width: 44, textAlign: 'right' }}>+{quest.xpReward}</span>
          <button className="btn" style={{ padding: '6px 11px' }} title="Complete" onClick={() => onComplete(quest.id)}>
            <Icon name="check" size={12} />
          </button>
          <button
            className="btn"
            style={{ padding: '6px 11px', fontSize: 10 }}
            title={skipTokens > 0 ? 'Skip this quest (1 skip token)' : 'No skip tokens — buy more in the Shop'}
            disabled={skipTokens <= 0}
            onClick={() => onSkip(quest.id)}
          >
            SKIP
          </button>
          <button
            className="btn btn-ghost"
            style={{ padding: '6px 9px', fontSize: 10 }}
            title={rerollTokens > 0 ? `Reroll: swap for a different quest (1 token, ${rerollTokens} left)` : 'No reroll tokens — buy more in the Shop'}
            disabled={rerollTokens <= 0}
            onClick={() => onReroll(quest.id)}
          >
            RR
          </button>
        </>
      )}
    </div>
  );
}

/** Daily energy/battery → POWER CELL. Tap cycles the manual override
 *  (low→med→high→low) via the existing POST /api/player/energy. */
function EnergyPanel({
  energy, onCycle,
}: {
  energy: NonNullable<PlayerSnapshot['energy']>;
  onCycle: (tier: 'low' | 'med' | 'high') => void;
}) {
  const tierColor = energy.tier === 'high' ? 'var(--lime)' : energy.tier === 'med' ? 'var(--amber)' : 'var(--red)';
  const next: 'low' | 'med' | 'high' = energy.tier === 'low' ? 'med' : energy.tier === 'med' ? 'high' : 'low';
  const source = energy.source === 'sleep' && energy.sleepHours != null
    ? `${energy.sleepHours}H SLEEP`
    : energy.source === 'override' ? 'MANUAL OVERRIDE' : 'NO DATA';
  return (
    <button
      className="panel"
      title={`Energy: ${energy.tier.toUpperCase()} (${energy.source}). Click to override → ${next.toUpperCase()}.`}
      onClick={() => onCycle(next)}
      style={{ display: 'block', width: '100%', padding: '15px 18px', textAlign: 'left', cursor: 'pointer' }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
        <span className="kicker" style={{ fontSize: 10 }}>POWER CELL</span>
        <span style={{ flex: 1 }} />
        <span className="ncx-val" style={{ fontSize: 16, color: tierColor }}>{energy.pct}%</span>
      </div>
      <div className="ncx-bar slim">
        <i style={{ width: `${Math.min(100, energy.pct)}%`, background: tierColor }} />
        <span className="seg-mask" />
      </div>
      <div className="mono" style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.18em', marginTop: 8 }}>
        <span style={{ color: tierColor }}>{energy.tier.toUpperCase()}</span> · {source}
      </div>
    </button>
  );
}
