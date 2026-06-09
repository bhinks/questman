/**
 * TodayView — landing tab. Player HUD + the DAY PLANNER (roadmap §5).
 *
 * The planner asks the server to rank today's pending quests and fit a
 * subset inside a time budget (4h weekday / 10h weekend by default). We
 * render WHAT to do (ranked, split into "in plan" vs "later"), never
 * WHEN — Brent wants suggestions, not a schedule. Quests support:
 *   - check-in counters (tap +1, drip XP) for targetCount > 1
 *   - a focus timer ("JACK IN/OUT") that logs actual vs estimated time
 *   - must-do / carry-over / best-window badges
 */
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { PlayerSnapshot, Quest, TodayResponse, WeatherToday, DayPlan } from '../lib/api';
import { getSocket } from '../lib/socket';
import { Icon } from './Icon';

export function TodayView() {
  const qc = useQueryClient();
  // The single quest the focus timer is running against (client-side count-up).
  const [focus, setFocus] = useState<{ id: string; start: number } | null>(null);
  const [, force] = useState(0); // ticks the elapsed display while focusing

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

  // Re-render the focus elapsed clock every second while a timer runs.
  useEffect(() => {
    if (!focus) return;
    const t = setInterval(() => force(n => n + 1), 1000);
    return () => clearInterval(t);
  }, [focus]);

  const completeQuest = useMutation({
    mutationFn: (id: string) => api.post(`/api/quests/${id}/complete`),
    onSuccess: invalidateAll,
  });
  const progressQuest = useMutation({
    mutationFn: (id: string) => api.post(`/api/quests/${id}/progress`, { delta: 1 }),
    onSuccess: invalidateAll,
  });
  const skipQuest = useMutation({
    // Skipping now spends a skip token, so refresh the player HUD too.
    mutationFn: (id: string) => api.post(`/api/quests/${id}/skip`),
    onSuccess: invalidateAll,
  });
  const rerollQuest = useMutation({
    // Swap a quest for a fresh candidate; spends a reroll token (server-side,
    // only if a replacement was actually found).
    mutationFn: (id: string) => api.post(`/api/quests/${id}/reroll`),
    onSuccess: invalidateAll,
  });
  const focusLog = useMutation({
    mutationFn: ({ id, minutes }: { id: string; minutes: number }) =>
      api.post(`/api/quests/${id}/focus`, { actualMinutes: minutes }),
    onSuccess: invalidateAll,
  });
  const setEnergy = useMutation({
    mutationFn: (tier: 'low' | 'med' | 'high') => api.post('/api/player/energy', { tier }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['player'] }),
  });

  const jackOut = () => {
    if (!focus) return;
    const minutes = Math.max(1, Math.round((Date.now() - focus.start) / 60000));
    focusLog.mutate({ id: focus.id, minutes });
    setFocus(null);
  };
  const jackIn = (id: string) => {
    // Switching timers: flush the running session's minutes before starting
    // a new one, so they aren't silently discarded.
    if (focus && focus.id !== id) jackOut();
    setFocus({ id, start: Date.now() });
  };

  if (playerQ.isLoading || todayQ.isLoading) {
    return <Splash>LOADING…</Splash>;
  }
  if (playerQ.isError || todayQ.isError) {
    return <Splash color="var(--red)">FAILED TO LOAD</Splash>;
  }

  const player = playerQ.data!;
  const today = todayQ.data!;
  const plan = planQ.data;

  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {weatherQ.data?.weather && <WeatherCard weather={weatherQ.data.weather} />}
      <PlayerHud
        player={player}
        todayXpAvailable={today.xpAvailable}
        todayXpEarned={today.xpEarned}
        onSetEnergy={(tier) => setEnergy.mutate(tier)}
      />
      <QuestPlanner
        today={today}
        plan={plan}
        focus={focus}
        skipTokens={player.skipTokens}
        rerollTokens={player.rerollTokens}
        onComplete={id => completeQuest.mutate(id)}
        onProgress={id => progressQuest.mutate(id)}
        onSkip={id => skipQuest.mutate(id)}
        onReroll={id => rerollQuest.mutate(id)}
        onJackIn={jackIn}
        onJackOut={jackOut}
      />
    </div>
  );
}

function Splash({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div className="panel hud" style={{ padding: 40, textAlign: 'center', color: color ?? 'var(--text-faint)' }}>
      <div className="mono" style={{ fontSize: 13 }}>{children}</div>
    </div>
  );
}

function WeatherCard({ weather }: { weather: NonNullable<WeatherToday['weather']> }) {
  const stat = (label: string, value: string) => (
    <div className="panel-inset" style={{ padding: '8px 12px', textAlign: 'center', minWidth: 72 }}>
      <div className="kicker" style={{ marginBottom: 4 }}>{label}</div>
      <div className="mono" style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{value}</div>
    </div>
  );
  return (
    <div className="panel hud" style={{ padding: 18, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
      <div style={{ fontSize: 40, lineHeight: 1, flexShrink: 0 }}>{weather.emoji}</div>
      <div style={{ flex: 1, minWidth: 120 }}>
        <div className="kicker" style={{ marginBottom: 4 }}>TODAY&rsquo;S WEATHER</div>
        <div style={{ fontSize: 18, fontWeight: 600, fontFamily: 'var(--font-display)' }}>{weather.label}</div>
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
          {weather.tempMaxF}°F <span style={{ color: 'var(--text-faint)' }}>/ {weather.tempMinF}°F low</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {stat('HIGH', `${weather.tempMaxF}°F`)}
        {stat('RAIN', `${weather.rainTodayIn.toFixed(2)}"`)}
        {stat('WIND', `${weather.windMaxMph} mph`)}
      </div>
    </div>
  );
}

function PlayerHud({
  player, todayXpAvailable, todayXpEarned, onSetEnergy,
}: {
  player: PlayerSnapshot;
  todayXpAvailable: number;
  todayXpEarned: number;
  onSetEnergy: (tier: 'low' | 'med' | 'high') => void;
}) {
  const pct = Math.round(player.progress * 100);
  return (
    <div className="panel hud" style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
        <div style={{
          width: 64, height: 64, borderRadius: 16,
          background: 'linear-gradient(135deg, var(--cyan), var(--violet))',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          boxShadow: 'var(--glow-cyan)', flexShrink: 0,
        }}>
          <div className="kicker" style={{ color: 'rgba(255,255,255,0.7)', fontSize: 9 }}>LVL</div>
          <div style={{ fontSize: 24, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'white' }}>
            {player.level}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span className="kicker">XP</span>
            <span className="mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
              {player.xpIntoLevel} / {player.xpForNextLevel}
            </span>
          </div>
          <div style={{
            height: 10, borderRadius: 5,
            background: 'var(--panel-2)', border: '1px solid var(--line)',
            overflow: 'hidden', position: 'relative',
          }}>
            <div style={{
              width: `${pct}%`, height: '100%',
              background: 'linear-gradient(90deg, var(--cyan), var(--violet))',
              boxShadow: '0 0 8px rgba(28,226,255,0.5)',
              transition: 'width 0.5s ease',
            }} />
          </div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>
            TOTAL XP: {player.totalXp.toLocaleString()}
          </div>
        </div>

        <div className="panel-inset" style={{ padding: 12, minWidth: 110, textAlign: 'center' }}>
          <div className="kicker" style={{ marginBottom: 6 }}>EDDIES</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--amber)', fontFamily: 'var(--font-display)' }}>
            €$ {player.eddies.toLocaleString()}
          </div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>SPENDABLE</div>
        </div>

        <div className="panel-inset" style={{ padding: 12, minWidth: 100, textAlign: 'center' }}>
          <div className="kicker" style={{ marginBottom: 6 }}>STREAK</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--lime)', fontFamily: 'var(--font-display)' }}>
            {player.currentStreak}
          </div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>
            BEST: {player.longestStreak}
          </div>
        </div>

        <div className="panel-inset" style={{ padding: 12, minWidth: 120, textAlign: 'center' }}>
          <div className="kicker" style={{ marginBottom: 6 }}>TODAY</div>
          <div className="mono" style={{ fontSize: 18, color: 'var(--cyan)', fontWeight: 700 }}>
            +{todayXpEarned} <span style={{ color: 'var(--text-faint)', fontSize: 13 }}>/ +{todayXpAvailable}</span>
          </div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>EARNED / AVAILABLE</div>
        </div>

        <OverclockTile streak={player.overclockStreak} mult={player.overclockMultiplier} />
        <ResourcesTile skip={player.skipTokens} reroll={player.rerollTokens} rr={player.rrCredits} />
        {player.energy && <BatteryTile energy={player.energy} onSetEnergy={onSetEnergy} />}
      </div>
    </div>
  );
}

/** Daily energy/battery. Tap to cycle a manual override (low→med→high). */
function BatteryTile({
  energy, onSetEnergy,
}: { energy: NonNullable<PlayerSnapshot['energy']>; onSetEnergy: (t: 'low' | 'med' | 'high') => void }) {
  const color = energy.tier === 'high' ? 'var(--lime)' : energy.tier === 'med' ? 'var(--amber)' : 'var(--red)';
  const next = energy.tier === 'low' ? 'med' : energy.tier === 'med' ? 'high' : 'low';
  const label = energy.source === 'sleep' && energy.sleepHours != null
    ? `${energy.sleepHours}h SLEEP`
    : energy.source === 'override' ? 'MANUAL' : 'NO DATA';
  return (
    <button
      className="panel-inset"
      title={`Energy: ${energy.tier.toUpperCase()} (${energy.source}). Click to override → ${next.toUpperCase()}.`}
      onClick={() => onSetEnergy(next)}
      style={{ padding: 12, minWidth: 116, textAlign: 'center', cursor: 'pointer', background: 'var(--bg-2)' }}
    >
      <div className="kicker" style={{ marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
        <Icon name="bolt" size={12} style={{ color }} /> BATTERY
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color, fontFamily: 'var(--font-display)' }}>
        {energy.pct}%
      </div>
      <div style={{ height: 5, borderRadius: 3, background: 'var(--panel-2)', border: '1px solid var(--line)', overflow: 'hidden', margin: '6px 0 4px' }}>
        <div style={{ width: `${energy.pct}%`, height: '100%', background: color, transition: 'width 0.4s ease' }} />
      </div>
      <div className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>{label}</div>
    </button>
  );
}

/** The overclock "heat meter": eddie-earn multiplier that climbs with each
 *  consecutive full-clear day (×1.0 → ×2.0 at a 10-day chain). */
function OverclockTile({ streak, mult }: { streak: number; mult: number }) {
  const pct = Math.min(100, streak * 10); // maxes at a 10-day chain (×2.0)
  const hot = mult >= 1.8 ? 'var(--red)' : mult >= 1.4 ? 'var(--amber)' : mult > 1 ? 'var(--cyan)' : 'var(--text-faint)';
  return (
    <div className="panel-inset" style={{ padding: 12, minWidth: 132, textAlign: 'center' }}>
      <div className="kicker" style={{ marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
        <Icon name="flame" size={12} style={{ color: hot }} /> OVERCLOCK
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: hot, fontFamily: 'var(--font-display)', textShadow: mult > 1 ? `0 0 10px ${hot}` : undefined }}>
        ×{mult.toFixed(1)}
      </div>
      <div style={{ height: 5, borderRadius: 3, background: 'var(--panel-2)', border: '1px solid var(--line)', overflow: 'hidden', margin: '6px 0 4px' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg, var(--cyan), var(--amber), var(--red))', transition: 'width 0.4s ease' }} />
      </div>
      <div className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>
        {streak > 0 ? `${streak}-DAY CHAIN` : 'NO CHAIN'}
      </div>
    </div>
  );
}

/** Spendable mechanics: skip / reroll tokens + R&R downtime credits. */
function ResourcesTile({ skip, reroll, rr }: { skip: number; reroll: number; rr: number }) {
  const row = (label: string, value: number, color: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
      <span className="mono" style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.05em' }}>{label}</span>
      <span className="mono" style={{ fontSize: 13, fontWeight: 700, color }}>{value}</span>
    </div>
  );
  return (
    <div className="panel-inset" style={{ padding: 12, minWidth: 116 }}>
      <div className="kicker" style={{ marginBottom: 7, textAlign: 'center' }}>RESOURCES</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {row('SKIP', skip, 'var(--text-dim)')}
        {row('REROLL', reroll, 'var(--violet)')}
        {row('R&R', rr, 'var(--teal)')}
      </div>
    </div>
  );
}

function fmtMin(n: number): string {
  if (n < 60) return `${n}m`;
  const h = Math.floor(n / 60), m = n % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** The day planner: budget bar + quests split into "in plan" / "later". */
function QuestPlanner({
  today, plan, focus, skipTokens, rerollTokens, onComplete, onProgress, onSkip, onReroll, onJackIn, onJackOut,
}: {
  today: TodayResponse;
  plan: DayPlan | undefined;
  focus: { id: string; start: number } | null;
  skipTokens: number;
  rerollTokens: number;
  onComplete: (id: string) => void;
  onProgress: (id: string) => void;
  onSkip: (id: string) => void;
  onReroll: (id: string) => void;
  onJackIn: (id: string) => void;
  onJackOut: () => void;
}) {
  const all = Object.values(today.byModule).flat();
  const flavor = all.find(q => q.meta?.flavor)?.meta?.flavor ?? null;
  const completed = all.filter(q => q.status === 'completed');
  const skipped = all.filter(q => q.status === 'skipped');

  if (today.totalCount === 0) {
    return (
      <div className="panel hud" style={{ padding: 60, textAlign: 'center', color: 'var(--text-faint)' }}>
        <Icon name="check" size={32} style={{ color: 'var(--lime)', marginBottom: 16 }} />
        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>No quests today</div>
        <div className="mono" style={{ fontSize: 13 }}>
          Add habits, projects, media, or vitals to start generating daily missions.
        </div>
      </div>
    );
  }

  // Order pending quests by the planner's ranking; tag inPlan from /plan.
  const planOrder = new Map((plan?.quests ?? []).map((q, i) => [q.id, i]));
  const planFlags = new Map((plan?.quests ?? []).map(q => [q.id, q.inPlan]));
  const pending = all
    .filter(q => q.status === 'pending')
    .sort((a, b) => (planOrder.get(a.id) ?? 999) - (planOrder.get(b.id) ?? 999));
  const inPlan = pending.filter(q => planFlags.get(q.id) !== false);
  const later = pending.filter(q => planFlags.get(q.id) === false);

  const renderCard = (q: Quest) => (
    <QuestCard
      key={q.id} quest={q} focus={focus}
      skipTokens={skipTokens} rerollTokens={rerollTokens}
      onComplete={onComplete} onProgress={onProgress} onSkip={onSkip} onReroll={onReroll}
      onJackIn={onJackIn} onJackOut={onJackOut}
    />
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header + budget bar */}
      <div className="panel hud" style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: flavor ? 8 : 0, flexWrap: 'wrap' }}>
          <Icon name="target" size={20} style={{ color: 'var(--cyan)' }} />
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, fontFamily: 'var(--font-display)' }}>
            Today&rsquo;s Plan
          </h2>
          <div className="mono" style={{
            marginLeft: 'auto', fontSize: 11, color: 'var(--text-dim)',
            padding: '4px 8px', background: 'var(--panel-2)', borderRadius: 6, border: '1px solid var(--line)',
          }}>
            {completed.length} / {all.length} CLEARED · {today.generator.toUpperCase()}
          </div>
        </div>
        {flavor && (
          <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', fontStyle: 'italic', marginBottom: plan ? 12 : 0 }}>
            {flavor}
          </div>
        )}
        {plan && <BudgetBar plan={plan} />}
      </div>

      {inPlan.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="kicker" style={{ paddingLeft: 4 }}>IN THE PLAN · {fmtMin(plan?.plannedMin ?? 0)}</div>
          {inPlan.map(renderCard)}
        </section>
      )}

      {later.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="kicker" style={{ paddingLeft: 4 }}>LATER · OVER BUDGET (OPTIONAL)</div>
          {later.map(renderCard)}
        </section>
      )}

      {(completed.length > 0 || skipped.length > 0) && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="kicker" style={{ paddingLeft: 4 }}>DONE</div>
          {[...completed, ...skipped].map(renderCard)}
        </section>
      )}
    </div>
  );
}

function BudgetBar({ plan }: { plan: DayPlan }) {
  const pct = plan.budgetMin > 0 ? Math.min(100, Math.round((plan.plannedMin / plan.budgetMin) * 100)) : 0;
  const over = plan.plannedMin > plan.budgetMin;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span className="kicker">TIME BUDGET · {plan.isWeekend ? 'WEEKEND' : 'WEEKDAY'}</span>
        <span className="mono" style={{ fontSize: 12, color: over ? 'var(--amber)' : 'var(--text-dim)' }}>
          {fmtMin(plan.plannedMin)} / {fmtMin(plan.budgetMin)}
        </span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: 'var(--panel-2)', border: '1px solid var(--line)', overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          background: over ? 'var(--amber)' : 'linear-gradient(90deg, var(--lime), var(--teal))',
          transition: 'width 0.4s ease',
        }} />
      </div>
      {plan.estimatedMissing > 0 && (
        <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-faint)', marginTop: 5 }}>
          {plan.estimatedMissing} quest{plan.estimatedMissing > 1 ? 's' : ''} missing a time estimate (assumed ~20m each)
        </div>
      )}
    </div>
  );
}

function QuestCard({
  quest, focus, skipTokens, rerollTokens, onComplete, onProgress, onSkip, onReroll, onJackIn, onJackOut,
}: {
  quest: Quest;
  focus: { id: string; start: number } | null;
  skipTokens: number;
  rerollTokens: number;
  onComplete: (id: string) => void;
  onProgress: (id: string) => void;
  onSkip: (id: string) => void;
  onReroll: (id: string) => void;
  onJackIn: (id: string) => void;
  onJackOut: () => void;
}) {
  const isCompleted = quest.status === 'completed';
  const isSkipped = quest.status === 'skipped';
  const isCounter = quest.targetCount > 1;
  const emoji = quest.meta?.emoji;
  const focusing = focus?.id === quest.id;
  const elapsedMin = focusing ? Math.max(0, Math.round((Date.now() - focus!.start) / 60000)) : 0;

  const diffColor = quest.difficulty === 'hard' ? 'var(--red)'
    : quest.difficulty === 'medium' ? 'var(--amber)' : 'var(--lime)';

  return (
    <div className="panel" style={{
      padding: 18,
      border: isCompleted ? '1px solid var(--lime)'
        : quest.mustDo ? '1px solid var(--magenta)' : '1px solid var(--line)',
      background: isCompleted ? 'linear-gradient(180deg, rgba(67,255,166,0.06), rgba(67,255,166,0.02))' : undefined,
      opacity: isSkipped ? 0.5 : 1,
    }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{
          width: 42, height: 42, borderRadius: 10,
          background: isCompleted ? 'linear-gradient(135deg, var(--lime), var(--teal))'
            : 'linear-gradient(135deg, var(--cyan), var(--violet))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, boxShadow: isCompleted ? 'var(--glow-lime)' : 'var(--glow-cyan)', fontSize: 20,
        }}>
          {isCompleted ? <Icon name="check" size={18} style={{ color: 'white' }} /> : (emoji || '•')}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: isCompleted ? 'var(--lime)' : 'var(--text)' }}>
              {quest.title}
            </h3>
            {quest.mustDo && <Badge color="var(--magenta)">MUST-DO</Badge>}
            <Badge color={diffColor}>{quest.difficulty.toUpperCase()}</Badge>
            <span className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>
              {quest.module.name.toUpperCase()}
            </span>
            {quest.estMinutes != null && <Badge color="var(--violet)">⏱ {fmtMin(quest.estMinutes)}</Badge>}
            {quest.carryOver && <Badge color="var(--cyan)">↻ CARRIES</Badge>}
            {quest.meta?.bestWindow && <Badge color="var(--cyan)">🌤 {quest.meta.bestWindow}</Badge>}
            {quest.originDate && quest.originDate.slice(0, 10) !== quest.questDate.slice(0, 10) && (
              <Badge color="var(--amber)">CARRIED</Badge>
            )}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.4 }}>{quest.description}</div>
          {quest.actualMinutes != null && (
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>
              logged {fmtMin(quest.actualMinutes)}{quest.estMinutes != null ? ` of ~${fmtMin(quest.estMinutes)}` : ''}
            </div>
          )}
          {isCounter && (
            <CounterRing current={quest.currentCount} target={quest.targetCount} />
          )}
        </div>

        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <div className="mono" style={{ fontSize: 14, fontWeight: 600, color: 'var(--lime)' }}>
            +{quest.xpReward} XP
          </div>
          {!isCompleted && !isSkipped && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {/* Focus timer */}
              {focusing ? (
                <button className="btn" style={{ padding: '6px 10px', fontSize: 11, borderColor: 'var(--magenta)', color: 'var(--magenta)' }}
                  onClick={onJackOut}>
                  ◼ JACK OUT · {elapsedMin}m
                </button>
              ) : (
                <button className="btn btn-ghost" style={{ padding: '6px 10px', fontSize: 11 }} onClick={() => onJackIn(quest.id)} title="Start focus timer">
                  ▸ JACK IN
                </button>
              )}
              <button
                className="btn btn-ghost"
                style={{ padding: '6px 10px', fontSize: 11, opacity: rerollTokens > 0 ? 1 : 0.4, color: 'var(--violet)' }}
                disabled={rerollTokens <= 0}
                title={rerollTokens > 0 ? 'Swap for a different quest (1 reroll token)' : 'No reroll tokens — buy more in the Shop'}
                onClick={() => onReroll(quest.id)}
              >
                ↻ REROLL · {rerollTokens}
              </button>
              <button
                className="btn btn-ghost"
                style={{ padding: '6px 10px', fontSize: 11, opacity: skipTokens > 0 ? 1 : 0.4 }}
                disabled={skipTokens <= 0}
                title={skipTokens > 0 ? 'Skip this quest (1 skip token)' : 'No skip tokens — buy more in the Shop'}
                onClick={() => onSkip(quest.id)}
              >
                SKIP · {skipTokens}
              </button>
              {isCounter ? (
                <button className="btn btn-primary" style={{ padding: '6px 12px', fontSize: 11 }} onClick={() => onProgress(quest.id)}>
                  +1
                </button>
              ) : (
                <button className="btn btn-primary" style={{ padding: '6px 12px', fontSize: 11 }} onClick={() => onComplete(quest.id)}>
                  COMPLETE
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="mono" style={{
      fontSize: 10, padding: '2px 6px', borderRadius: 4, color,
      background: `color-mix(in srgb, ${color} 12%, transparent)`,
      border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
      letterSpacing: '0.06em',
    }}>
      {children}
    </span>
  );
}

/** A compact progress meter for check-in counter quests (e.g. 5/8). */
function CounterRing({ current, target }: { current: number; target: number }) {
  const pct = Math.min(100, Math.round((current / Math.max(1, target)) * 100));
  return (
    <div style={{ marginTop: 8, maxWidth: 240 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span className="kicker">PROGRESS</span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--cyan)' }}>{current} / {target}</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'var(--panel-2)', border: '1px solid var(--line)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg, var(--cyan), var(--violet))', transition: 'width 0.3s ease' }} />
      </div>
    </div>
  );
}
