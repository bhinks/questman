/**
 * TodayView — landing tab for the life-hub. Player HUD + today's quests.
 *
 * Phase 4 ships a working but minimal layout. Phase 5 will:
 *   - Add the full Mission card with progress ring (reusing primitives
 *     from SavingsMissions.tsx)
 *   - Add an animated XP bar / level-up confetti on completion
 *   - Add the streak flame + last-7-days dot calendar
 *
 * For now: HUD strip with level/streak/xp, then grouped quest cards.
 */
import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { PlayerSnapshot, Quest, TodayResponse, WeatherToday } from '../lib/api';
import { getSocket } from '../lib/socket';
import { Icon } from './Icon';

export function TodayView() {
  const qc = useQueryClient();

  const playerQ = useQuery({
    queryKey: ['player'],
    queryFn: () => api.get<{ player: PlayerSnapshot }>('/api/player').then(r => r.player),
  });

  const todayQ = useQuery({
    queryKey: ['quests', 'today'],
    queryFn: () => api.get<TodayResponse>('/api/quests/today'),
  });

  const weatherQ = useQuery({
    queryKey: ['weather', 'today'],
    queryFn: () => api.get<WeatherToday>('/api/weather/today'),
    staleTime: 30 * 60 * 1000, // forecast is per-day; don't refetch often
  });

  // Socket-driven invalidation: when another tab/device completes a
  // quest, refresh ours. The HTTP response is the source of truth for
  // OUR action; this is only for cross-client sync.
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const refresh = () => {
      qc.invalidateQueries({ queryKey: ['player'] });
      qc.invalidateQueries({ queryKey: ['quests', 'today'] });
    };
    s.on('player-updated', refresh);
    s.on('quest-completed', refresh);
    s.on('habit-checked', refresh);
    s.on('workout-logged', refresh);
    return () => {
      s.off('player-updated', refresh);
      s.off('quest-completed', refresh);
      s.off('habit-checked', refresh);
      s.off('workout-logged', refresh);
    };
  }, [qc]);

  const completeQuest = useMutation({
    mutationFn: (questId: string) =>
      api.post(`/api/quests/${questId}/complete`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['player'] });
      qc.invalidateQueries({ queryKey: ['quests', 'today'] });
    },
  });

  const skipQuest = useMutation({
    mutationFn: (questId: string) =>
      api.post(`/api/quests/${questId}/skip`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quests', 'today'] });
    },
  });

  if (playerQ.isLoading || todayQ.isLoading) {
    return (
      <div className="panel hud" style={{ padding: 40, textAlign: 'center', color: 'var(--text-faint)' }}>
        <div className="mono" style={{ fontSize: 13 }}>LOADING…</div>
      </div>
    );
  }
  if (playerQ.isError || todayQ.isError) {
    return (
      <div className="panel hud" style={{ padding: 40, textAlign: 'center', color: 'var(--red)' }}>
        <div className="mono" style={{ fontSize: 13 }}>FAILED TO LOAD</div>
      </div>
    );
  }

  const player = playerQ.data!;
  const today = todayQ.data!;

  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {weatherQ.data?.weather && <WeatherCard weather={weatherQ.data.weather} />}
      <PlayerHud player={player} todayXpAvailable={today.xpAvailable} todayXpEarned={today.xpEarned} />
      <QuestList
        today={today}
        onComplete={id => completeQuest.mutate(id)}
        onSkip={id => skipQuest.mutate(id)}
      />
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
  player, todayXpAvailable, todayXpEarned,
}: { player: PlayerSnapshot; todayXpAvailable: number; todayXpEarned: number }) {
  const pct = Math.round(player.progress * 100);
  return (
    <div className="panel hud" style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
        {/* Level badge */}
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

        {/* XP bar */}
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

        {/* Streak */}
        <div className="panel-inset" style={{ padding: 12, minWidth: 100, textAlign: 'center' }}>
          <div className="kicker" style={{ marginBottom: 6 }}>STREAK</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--lime)', fontFamily: 'var(--font-display)' }}>
            {player.currentStreak}
          </div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>
            BEST: {player.longestStreak}
          </div>
        </div>

        {/* Today XP earned/available */}
        <div className="panel-inset" style={{ padding: 12, minWidth: 120, textAlign: 'center' }}>
          <div className="kicker" style={{ marginBottom: 6 }}>TODAY</div>
          <div className="mono" style={{ fontSize: 18, color: 'var(--cyan)', fontWeight: 700 }}>
            +{todayXpEarned} <span style={{ color: 'var(--text-faint)', fontSize: 13 }}>/ +{todayXpAvailable}</span>
          </div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>
            EARNED / AVAILABLE
          </div>
        </div>
      </div>
    </div>
  );
}

function QuestList({
  today, onComplete, onSkip,
}: { today: TodayResponse; onComplete: (id: string) => void; onSkip: (id: string) => void }) {
  const modules = Object.keys(today.byModule);
  if (today.totalCount === 0) {
    return (
      <div className="panel hud" style={{ padding: 60, textAlign: 'center', color: 'var(--text-faint)' }}>
        <Icon name="check" size={32} style={{ color: 'var(--lime)', marginBottom: 16 }} />
        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
          No quests today
        </div>
        <div className="mono" style={{ fontSize: 13 }}>
          Add habits or workouts to start generating daily missions.
        </div>
      </div>
    );
  }

  // Flatten across modules for a single ordered list.
  const all = modules.flatMap(k => today.byModule[k]);
  const pending = all.filter(q => q.status === 'pending');
  const done = all.filter(q => q.status === 'completed');
  const flavor = (all.find(q => q.meta?.flavor)?.meta?.flavor) ?? null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="panel hud" style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: flavor ? 8 : 0 }}>
          <Icon name="target" size={20} style={{ color: 'var(--cyan)' }} />
          <h2 style={{
            fontSize: 18, fontWeight: 600, margin: 0,
            fontFamily: 'var(--font-display)',
          }}>
            Today&rsquo;s Missions
          </h2>
          <div
            className="mono"
            style={{
              marginLeft: 'auto', fontSize: 11, color: 'var(--text-dim)',
              padding: '4px 8px', background: 'var(--panel-2)',
              borderRadius: 6, border: '1px solid var(--line)',
            }}
          >
            {done.length} / {all.length} COMPLETE · {today.generator.toUpperCase()}
          </div>
        </div>
        {flavor && (
          <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', fontStyle: 'italic' }}>
            {flavor}
          </div>
        )}
      </div>

      {[...pending, ...done].map(q => (
        <QuestCard key={q.id} quest={q} onComplete={onComplete} onSkip={onSkip} />
      ))}
    </div>
  );
}

function QuestCard({
  quest, onComplete, onSkip,
}: { quest: Quest; onComplete: (id: string) => void; onSkip: (id: string) => void }) {
  const isCompleted = quest.status === 'completed';
  const isSkipped = quest.status === 'skipped';
  const emoji = quest.meta?.emoji;

  const diffColor = quest.difficulty === 'hard' ? 'var(--red)'
    : quest.difficulty === 'medium' ? 'var(--amber)'
    : 'var(--lime)';

  return (
    <div
      className="panel"
      style={{
        padding: 18,
        border: isCompleted
          ? '1px solid var(--lime)'
          : isSkipped
          ? '1px solid var(--line)'
          : '1px solid var(--line)',
        background: isCompleted
          ? 'linear-gradient(180deg, rgba(67,255,166,0.06), rgba(67,255,166,0.02))'
          : undefined,
        opacity: isSkipped ? 0.5 : 1,
        position: 'relative',
      }}
    >
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* Emoji / icon */}
        <div
          style={{
            width: 42, height: 42, borderRadius: 10,
            background: isCompleted
              ? 'linear-gradient(135deg, var(--lime), var(--teal))'
              : 'linear-gradient(135deg, var(--cyan), var(--violet))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
            boxShadow: isCompleted ? 'var(--glow-lime)' : 'var(--glow-cyan)',
            fontSize: 20,
          }}
        >
          {isCompleted ? <Icon name="check" size={18} style={{ color: 'white' }} /> : (emoji || '•')}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
            <h3 style={{
              fontSize: 15, fontWeight: 600, margin: 0,
              color: isCompleted ? 'var(--lime)' : 'var(--text)',
            }}>
              {quest.title}
            </h3>
            <span
              className="mono"
              style={{
                fontSize: 10, padding: '2px 6px', borderRadius: 4,
                color: diffColor,
                background: `color-mix(in srgb, ${diffColor} 12%, transparent)`,
                border: `1px solid color-mix(in srgb, ${diffColor} 30%, transparent)`,
                letterSpacing: '0.08em',
              }}
            >
              {quest.difficulty.toUpperCase()}
            </span>
            <span className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>
              {quest.module.name.toUpperCase()}
            </span>
            {quest.meta?.bestWindow && (
              <span
                className="mono"
                title="Best weather window today"
                style={{
                  fontSize: 10, padding: '2px 6px', borderRadius: 4,
                  color: 'var(--cyan)',
                  background: 'color-mix(in srgb, var(--cyan) 12%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--cyan) 30%, transparent)',
                  letterSpacing: '0.04em',
                }}
              >
                🌤 {quest.meta.bestWindow}
              </span>
            )}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.4 }}>
            {quest.description}
          </div>
        </div>

        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <div className="mono" style={{ fontSize: 14, fontWeight: 600, color: 'var(--lime)' }}>
            +{quest.xpReward} XP
          </div>
          {!isCompleted && !isSkipped && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                className="btn btn-ghost"
                style={{ padding: '6px 10px', fontSize: 11 }}
                onClick={() => onSkip(quest.id)}
              >
                SKIP
              </button>
              <button
                className="btn btn-primary"
                style={{ padding: '6px 12px', fontSize: 11 }}
                onClick={() => onComplete(quest.id)}
              >
                COMPLETE
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
