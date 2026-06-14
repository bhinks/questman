/**
 * HandlerView — the consolidated "HANDLER" page (merges the old Net +
 * Debrief screens into one comms dashboard).
 *
 * The Handler is the voice / intelligence layer. The page is laid out as a
 * dashboard, not a long scroll:
 *
 *   MASTHEAD (full)      — persona identity + the freshest transmission in the
 *                          persona's voice + ONLINE/MUTED + status readout +
 *                          the voice switcher (owned voices selectable;
 *                          Night-Market voices shown locked + price).
 *   MISSION STRIP (full) — the selected week's KPI tiles + week selector +
 *                          a vitals / top-spend inset (DebriefView's stats grid,
 *                          flattened into a band).
 *   PATTERNS (full)      — a row of slim "possible pattern" insight cards
 *                          (the old Net insights feed, de-duplicated to live
 *                          here once). ACCEPT spawns a quest; DISMISS hides it.
 *   ┌ LEFT (1.5fr) ──────────────┬ RIGHT (1fr) ─────────────────┐
 *   │ TRANSMISSIONS (capped feed) │ AFTER-ACTION narrative        │
 *   │                             │ OPERATOR REFLECTION (file)     │
 *   └─────────────────────────────┴────────────────────────────────┘
 *
 * One persona control (in the masthead) flavors BOTH the live transmission and
 * the after-action narrative. All data contracts are preserved — every endpoint
 * both old pages called is reused, and the page live-refreshes off the same
 * socket events. Design system only (.panel / .panel-inset / .hud / .hdash /
 * .hcol / .hpat / kicker / mono / .btn + CSS color vars). Never hardcodes hex.
 */
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type {
  Insight,
  InsightsResponse,
  HandlerMessage,
  HandlerMessagesResponse,
  HandlerPersona,
  PersonaResponse,
  DebriefLatestResponse,
  DebriefListResponse,
  WeeklyReview,
  WeeklyStats,
  PlayerSnapshot,
} from '../lib/api';
import { getSocket } from '../lib/socket';
import { personaMeta } from '../lib/market';
import { Icon } from './Icon';

/** The persona endpoint flags Night-Market voices with free/owned (+price).
 *  Local extension until lib/api's PersonaOption catches up. */
type PersonaOptionEx = PersonaResponse['options'][number] & {
  free?: boolean;
  owned?: boolean;
  priceEddies?: number;
};

/** Shape returned by POST /api/debrief/:id/submit (not in api.ts types). */
interface SubmitResponse {
  review: WeeklyReview;
  rewarded?: boolean;
  player?: PlayerSnapshot;
}

export function HandlerView() {
  const qc = useQueryClient();

  // Which past week is on screen (drives the mission strip, narrative, and
  // reflection together). null = the latest review.
  const [viewId, setViewId] = useState<string | null>(null);

  const insightsQ = useQuery({
    queryKey: ['insights'],
    queryFn: () => api.get<InsightsResponse>('/api/insights'),
  });
  const personaQ = useQuery({
    queryKey: ['handler', 'persona'],
    queryFn: () => api.get<PersonaResponse>('/api/handler/persona'),
  });
  const messagesQ = useQuery({
    queryKey: ['handler', 'messages'],
    queryFn: () => api.get<HandlerMessagesResponse>('/api/handler/messages?limit=30'),
  });
  const latestQ = useQuery({
    queryKey: ['debrief', 'latest'],
    queryFn: () => api.get<DebriefLatestResponse>('/api/debrief/latest'),
  });
  const listQ = useQuery({
    queryKey: ['debrief', 'list'],
    queryFn: () => api.get<DebriefListResponse>('/api/debrief?limit=12'),
    staleTime: 5 * 60 * 1000,
  });

  // Live refresh — the union of what the two old pages subscribed to. New
  // insights, handler lines, or a freshly-generated debrief can land from the
  // spine on another tab/device, so refetch on the broad activity events plus
  // the handler/debrief-specific ones.
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const refreshInsights = () => qc.invalidateQueries({ queryKey: ['insights'] });
    const refreshHandler = () => {
      qc.invalidateQueries({ queryKey: ['handler', 'messages'] });
      qc.invalidateQueries({ queryKey: ['handler', 'persona'] });
    };
    const refreshDebrief = () => {
      qc.invalidateQueries({ queryKey: ['debrief', 'latest'] });
      qc.invalidateQueries({ queryKey: ['debrief', 'list'] });
    };
    // The weekly insight batch co-emits 'handler-message', so refresh insights on it too.
    const insightEvts = ['insight-created', 'handler-message', 'player-updated'];
    const handlerEvts = ['handler-message', 'daily-generated', 'weekly-debrief'];
    const debriefEvts = ['handler-message', 'debrief-generated', 'player-updated'];
    insightEvts.forEach(e => s.on(e, refreshInsights));
    handlerEvts.forEach(e => s.on(e, refreshHandler));
    debriefEvts.forEach(e => s.on(e, refreshDebrief));
    return () => {
      insightEvts.forEach(e => s.off(e, refreshInsights));
      handlerEvts.forEach(e => s.off(e, refreshHandler));
      debriefEvts.forEach(e => s.off(e, refreshDebrief));
    };
  }, [qc]);

  const insights = insightsQ.data?.insights ?? [];
  const messages = messagesQ.data?.messages ?? [];
  const orderedMessages = [...messages].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  // Persona binds straight to the server (no local mirror) so the masthead and
  // the Today feed stay in lockstep. Fall back to the rogue-AI shape so the
  // identity never blanks while loading / on error.
  const persona: HandlerPersona = personaQ.data?.persona ?? 'rogue_ai';
  const enabled = personaQ.data?.enabled ?? true;
  const options = (personaQ.data?.options ?? []) as PersonaOptionEx[];
  const meta = personaMeta(persona);
  const personaOpt = options.find(o => o.key === persona);
  const personaLabel = personaOpt?.label ?? meta.name;
  const personaBlurb = personaOpt?.blurb ?? '';

  // Resolve which review is on screen: the selected one, else the latest, else
  // the newest on file (covers /latest === null but the archive still holds
  // older filed reviews).
  const latest = latestQ.data?.review ?? null;
  const reviews = listQ.data?.reviews ?? [];
  const selected =
    (viewId && reviews.find(r => r.id === viewId)) || latest || reviews[0] || null;
  const latestReview = latest || reviews[0] || null;

  const newInsightCount = insights.filter(i => i.status === 'new').length;
  const freshSignal = orderedMessages.filter(m => !m.seen).length + newInsightCount;
  const weekStatus: 'filed' | 'awaiting' =
    latestReview?.status === 'submitted' ? 'filed' : 'awaiting';

  // Freshest transmission, in the persona's voice. Muted swaps the line for a
  // channel-muted notice (dim, doesn't hide).
  const latestMsg = orderedMessages[0] ?? null;
  const transmission = !enabled
    ? 'Channel muted. Bring the Handler online to resume transmissions.'
    : messagesQ.isLoading
      ? 'Opening channel…'
      : messagesQ.isError
        ? 'Channel down — could not reach the Handler.'
        : latestMsg
          ? latestMsg.text
          : 'No transmissions yet. Lines appear when your day generates or a week wraps.';

  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PersonaMasthead
        persona={persona}
        personaLabel={personaLabel}
        personaBlurb={personaBlurb}
        accent={meta.accent}
        tag={meta.tag}
        enabled={enabled}
        options={options}
        transmission={transmission}
        transmissionPersona={enabled && latestMsg ? latestMsg.persona : null}
        freshSignal={freshSignal}
        weekStatus={weekStatus}
        loading={personaQ.isLoading}
        error={personaQ.isError}
      />

      {selected ? (
        <MissionStrip
          selected={selected}
          reviews={reviews}
          onPickWeek={id => setViewId(id)}
        />
      ) : (
        <Splash>
          NO DEBRIEF YET — a debrief is generated at the start of each week from the
          previous week&rsquo;s activity. Come back after a week of logging.
        </Splash>
      )}

      {/* PATTERNS — full-width row of slim, narrow cards. */}
      <div className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <PanelHead
          icon="trend"
          color="var(--violet)"
          title="PATTERNS"
          sub={`${newInsightCount} fresh · possible signals from your data-shadow`}
        />
        {insightsQ.isLoading ? (
          <Splash>SCANNING DATA-SHADOW…</Splash>
        ) : insightsQ.isError ? (
          <Splash color="var(--red)">ANALYZER OFFLINE</Splash>
        ) : insights.length === 0 ? (
          <Splash>
            NO PATTERNS DETECTED — the analyzer needs ~2 weeks of logged data
            (sleep, mood, spend) before it surfaces anything.
          </Splash>
        ) : (
          <div className="hpat">
            {insights.map(i => <InsightCard key={i.id} insight={i} />)}
          </div>
        )}
      </div>

      <div className="hdash">
        {/* LEFT — transmissions feed */}
        <div className="hcol">
          <TransmissionsPanel
            messages={orderedMessages}
            accent={meta.accent}
            enabled={enabled}
            loading={messagesQ.isLoading}
            error={messagesQ.isError}
          />
        </div>
        {/* RIGHT — after-action narrative + operator reflection */}
        <div className="hcol">
          {selected ? (
            <>
              <NarrativeCard accent={meta.accent} label={personaLabel} text={selected.handlerText} />
              <ReflectionCard key={selected.id} review={selected} />
            </>
          ) : (
            <Splash>The after-action narrative and your reflection appear once a week is on file.</Splash>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- masthead -- */

function PersonaMasthead({
  persona, personaLabel, personaBlurb, accent, tag, enabled, options,
  transmission, transmissionPersona, freshSignal, weekStatus, loading, error,
}: {
  persona: HandlerPersona;
  personaLabel: string;
  personaBlurb: string;
  accent: string;
  tag: string;
  enabled: boolean;
  options: PersonaOptionEx[];
  transmission: string;
  /** The voice that actually produced the freshest line (may differ from the
   *  currently-selected persona if the user switched). null → attribute to the
   *  current persona. */
  transmissionPersona: HandlerPersona | null;
  freshSignal: number;
  weekStatus: 'filed' | 'awaiting';
  loading: boolean;
  error: boolean;
}) {
  // Attribute the line to whoever actually spoke it.
  const voiceName = transmissionPersona ? personaMeta(transmissionPersona).name : personaLabel;
  const voiceColor = transmissionPersona ? personaMeta(transmissionPersona).accent : accent;
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['handler', 'persona'] });
    qc.invalidateQueries({ queryKey: ['handler', 'latest'] });
    qc.invalidateQueries({ queryKey: ['handler', 'messages'] });
  };
  const setPersona = useMutation({
    mutationFn: (p: HandlerPersona) => api.put('/api/handler/persona', { persona: p }),
    onSuccess: invalidate,
  });
  const toggleEnabled = useMutation({
    mutationFn: (e: boolean) => api.put('/api/handler/persona', { enabled: e }),
    onSuccess: invalidate,
  });
  const busy = setPersona.isPending || toggleEnabled.isPending;

  return (
    <div
      className="panel hud ncx-scan"
      style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16, position: 'relative', overflow: 'hidden' }}
    >
      <div className="sweep" />
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div
          className="ncx-hex"
          style={{ width: 52, height: 52, fontSize: 18, flex: 'none', background: `linear-gradient(160deg, ${accent}, var(--violet) 75%, var(--magenta))` }}
        >
          {personaLabel[0] ?? 'H'}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h2
              className="ncx-glitch ncx-chroma"
              style={{ fontSize: 22, fontWeight: 700, margin: 0, fontFamily: 'var(--font-display)', letterSpacing: '0.03em', textTransform: 'uppercase' }}
            >
              HANDLER
            </h2>
            <span className="mono" style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--text)' }}>{personaLabel}</span>
            <Chip color={accent}>{tag}</Chip>
          </div>
          {personaBlurb && (
            <div className="mono" style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--text-faint)', marginTop: 4 }}>
              {personaBlurb}
            </div>
          )}
          <div
            className="ncx-term"
            style={{ fontSize: 12.5, lineHeight: 1.6, marginTop: 10, color: enabled ? 'var(--text)' : 'var(--text-faint)' }}
          >
            <span style={{ color: voiceColor }}>{voiceName}&gt;</span> {transmission}
            {enabled && <span className="cursor-blink" style={{ color: accent }}>_</span>}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 9, flex: 'none' }}>
          <button
            className="btn btn-ghost"
            key={`en-${enabled}`}
            disabled={busy || loading || error}
            onClick={() => toggleEnabled.mutate(!enabled)}
            title={enabled ? 'Silence the Handler' : 'Bring the Handler online'}
            style={{
              padding: '5px 13px', fontSize: 11,
              color: enabled ? 'var(--lime)' : 'var(--text-faint)',
              boxShadow: `inset 0 0 0 1px ${enabled ? 'color-mix(in srgb, var(--lime) 45%, transparent)' : 'var(--line-2)'}`,
            }}
          >
            <span
              className={enabled ? 'cursor-blink' : ''}
              style={{ width: 6, height: 6, borderRadius: '50%', background: enabled ? 'var(--lime)' : 'var(--text-faint)', boxShadow: enabled ? '0 0 6px var(--lime)' : 'none' }}
            />
            {enabled ? 'ONLINE' : 'MUTED'}
          </button>
          <div className="mono" style={{ fontSize: 9.5, letterSpacing: '0.14em', color: 'var(--text-faint)', textAlign: 'right', lineHeight: 1.7 }}>
            <div><span style={{ color: freshSignal > 0 ? accent : 'var(--text-faint)' }}>{freshSignal}</span> FRESH SIGNAL</div>
            <div>WEEK · <span style={{ color: weekStatus === 'awaiting' ? 'var(--amber)' : 'var(--lime)' }}>{weekStatus === 'awaiting' ? 'AWAITING' : 'FILED'}</span></div>
          </div>
        </div>
      </div>

      {options.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: '1px solid var(--line)', paddingTop: 13 }}>
          <span className="kicker" style={{ fontSize: 9, alignSelf: 'center', marginRight: 2 }}>VOICE</span>
          {options.map(opt => {
            const sel = opt.key === persona;
            const locked = opt.owned === false;
            const c = personaMeta(opt.key).accent;
            return (
              <button
                key={opt.key}
                disabled={locked || busy}
                onClick={() => { if (!locked && !sel) setPersona.mutate(opt.key); }}
                title={locked ? 'Unlock in the Night Market' : opt.blurb}
                className="mono"
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '5px 11px', fontSize: 10.5, letterSpacing: '0.06em',
                  cursor: locked ? 'not-allowed' : (sel ? 'default' : 'pointer'), borderRadius: 0,
                  border: sel ? `1px solid ${c}` : locked ? '1px dashed var(--line-2)' : '1px solid var(--line-2)',
                  background: sel ? `color-mix(in srgb, ${c} 14%, transparent)` : 'var(--panel-2)',
                  color: sel ? c : locked ? 'var(--text-faint)' : 'var(--text-dim)', opacity: locked ? 0.6 : 1,
                }}
              >
                {locked && <Icon name="lock" size={10} style={{ color: 'var(--text-faint)' }} />}
                {sel && <Icon name="check" size={11} style={{ color: c }} />}
                {opt.label}
                {locked && opt.priceEddies != null && (
                  <span style={{ color: 'var(--amber)', marginLeft: 2 }}>€${opt.priceEddies.toLocaleString()}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- mission strip -- */

function MissionStrip({
  selected, reviews, onPickWeek,
}: {
  selected: WeeklyReview;
  reviews: WeeklyReview[];
  onPickWeek: (id: string) => void;
}) {
  const weekPills = reviews.length > 1 ? (
    <>
      {reviews.map(r => {
        const active = r.id === selected.id;
        const filed = r.status === 'submitted';
        return (
          <button
            key={r.id}
            onClick={() => onPickWeek(r.id)}
            className="mono"
            title={filed ? 'Filed' : 'Awaiting debrief'}
            style={{
              padding: '4px 9px', fontSize: 10, letterSpacing: '0.04em', cursor: 'pointer', borderRadius: 0,
              border: active ? '1px solid rgba(var(--accent-rgb),0.55)' : '1px solid var(--line-2)',
              background: active ? 'rgba(var(--accent-rgb), 0.12)' : 'var(--panel-2)',
              color: active ? 'var(--cyan)' : 'var(--text-dim)',
            }}
          >
            <span style={{ color: filed ? 'var(--lime)' : 'var(--amber)', marginRight: 5 }}>{filed ? '●' : '○'}</span>
            {fmtWeekOf(r.weekOf).replace(/, \d{4}$/, '')}
          </button>
        );
      })}
    </>
  ) : null;

  return (
    <div className="panel" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PanelHead
        icon="trend"
        color="var(--cyan)"
        title="MISSION STATS"
        sub={`WEEK OF ${fmtWeekOf(selected.weekOf).toUpperCase()}`}
        right={weekPills}
      />
      <MissionTiles stats={selected.stats} />
    </div>
  );
}

function MissionTiles({ stats }: { stats: WeeklyStats | null }) {
  if (!stats) {
    return (
      <div className="mono" style={{ fontSize: 12, color: 'var(--text-faint)' }}>
        No stats recorded for this cycle.
      </div>
    );
  }
  // completionRate is already a 0-100 integer percent from the server digest
  // (buildWeeklyDigest) — do NOT multiply by 100 again.
  const completionPct = Math.round(stats.completionRate ?? 0);
  const v = stats.vitals;
  const hasVitals = v && (v.sleepAvg != null || v.moodAvg != null || v.weightDelta != null);
  const topCats = stats.topCategories ?? [];

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(94px, 1fr))', gap: 10 }}>
        <StatTile label="XP" value={`+${stats.xpEarned.toLocaleString()}`} color="var(--cyan)" icon="bolt" />
        <StatTile label="EDDIES" value={`€$${stats.eddiesEarned.toLocaleString()}`} color="var(--amber)" icon="spark" />
        <StatTile label="CLEARED" value={stats.questsCompleted.toLocaleString()} sub={`${completionPct}%`} color="var(--lime)" icon="check" />
        <StatTile label="EXPIRED" value={stats.questsExpired.toLocaleString()} color="var(--red)" icon="clock" />
        <StatTile label="WORKOUTS" value={stats.workouts.toLocaleString()} color="var(--magenta)" icon="flame" />
        <StatTile label="BOSSES" value={stats.bossesDefeated.toLocaleString()} color="var(--violet)" icon="target" />
        <StatTile label="BADGES" value={stats.achievementsUnlocked.toLocaleString()} color="var(--amber)" icon="trophy" />
        <StatTile label="SPEND" value={`$${stats.spendTotal.toLocaleString()}`} color="var(--text-dim)" icon="trend" />
        <StatTile label="ACTIVE" value={`${stats.activeDays}/7`} color="var(--cyan)" icon="flag" />
      </div>
      <div className="panel-inset" style={{ padding: '9px 14px', display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        {hasVitals && <span className="kicker" style={{ color: 'var(--text-faint)' }}>VITALS</span>}
        {v?.sleepAvg != null && <Vital label="SLEEP" value={`${v.sleepAvg.toFixed(1)} h`} />}
        {v?.moodAvg != null && <Vital label="MOOD" value={v.moodAvg.toFixed(1)} />}
        {v?.weightDelta != null && <Vital label="WEIGHT Δ" value={`${v.weightDelta > 0 ? '+' : ''}${v.weightDelta.toFixed(1)}`} />}
        {topCats.length > 0 && <span className="kicker" style={{ color: 'var(--text-faint)', marginLeft: 'auto' }}>TOP SPEND</span>}
        {topCats.map((c, i) => (
          <span key={`${c.name}-${i}`} className="mono" style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>
            {c.name} <span style={{ color: 'var(--amber)', fontWeight: 700 }}>${c.amount.toLocaleString()}</span>
          </span>
        ))}
      </div>
    </>
  );
}

function StatTile({
  label, value, sub, color, icon,
}: { label: string; value: string; sub?: string; color: string; icon: string }) {
  return (
    <div className="panel-inset" style={{ padding: '10px 8px', textAlign: 'center' }}>
      <div className="kicker" style={{ fontSize: 8.5, marginBottom: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
        <Icon name={icon} size={10} style={{ color }} /> {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color, fontFamily: 'var(--font-display)' }}>{value}</div>
      {sub && <div className="mono" style={{ fontSize: 9, color: 'var(--text-faint)', marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

function Vital({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
      <span className="mono" style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.05em' }}>{label}</span>
      <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{value}</span>
    </div>
  );
}

/* -------------------------------------------------------------- patterns -- */

const CONFIDENCE_COLOR: Record<Insight['confidence'], string> = {
  low: 'var(--amber)',
  medium: 'var(--cyan)',
};

/** One slim "possible pattern" card. Honesty label persists; ACCEPT spawns a
 *  quest (invalidate quests/player), DISMISS hides it. */
function InsightCard({ insight }: { insight: Insight }) {
  const qc = useQueryClient();

  const accept = useMutation({
    mutationFn: () => api.post(`/api/insights/${insight.id}/accept`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['insights'] });
      qc.invalidateQueries({ queryKey: ['quests', 'today'] });
      qc.invalidateQueries({ queryKey: ['quests', 'plan'] });
      qc.invalidateQueries({ queryKey: ['player'] });
    },
  });
  const dismiss = useMutation({
    mutationFn: () => api.post(`/api/insights/${insight.id}/dismiss`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['insights'] }),
  });

  const dismissed = insight.status === 'dismissed';
  const spawned = insight.status === 'spawned';
  const conf = CONFIDENCE_COLOR[insight.confidence] ?? 'var(--cyan)';
  const actionable = insight.actionType !== 'none'
    && (insight.status === 'new' || insight.status === 'accepted');
  const busy = accept.isPending || dismiss.isPending;

  return (
    <div
      className="panel"
      style={{
        padding: 13, display: 'flex', flexDirection: 'column', gap: 7, opacity: dismissed ? 0.5 : 1, minWidth: 0,
        border: spawned ? '1px solid color-mix(in srgb, var(--lime) 45%, transparent)' : '1px solid var(--line)',
        background: spawned ? 'linear-gradient(180deg, color-mix(in srgb, var(--lime) 7%, transparent), transparent)' : undefined,
      }}
    >
      {/* compact meta line — honesty label kept, inline */}
      <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 8.5, letterSpacing: '0.08em', flexWrap: 'wrap' }}>
        <span
          title="Correlation from your own logs — not a diagnosis."
          style={{ color: 'var(--text-faint)', borderBottom: '1px dashed var(--line-2)', textTransform: 'uppercase' }}
        >
          POSSIBLE PATTERN
        </span>
        <span style={{ color: conf, fontWeight: 700 }}>{insight.confidence.toUpperCase()}</span>
        {insight.windowDays != null && <span style={{ color: 'var(--text-ghost)' }}>{insight.windowDays}d</span>}
        {spawned && <span style={{ marginLeft: 'auto', color: 'var(--lime)', fontWeight: 700 }}>● QUEST ADDED</span>}
        {dismissed && <span style={{ marginLeft: 'auto', color: 'var(--text-faint)' }}>DISMISSED</span>}
      </div>
      <h3 style={{ fontSize: 13.5, fontWeight: 700, margin: 0, color: 'var(--text)', lineHeight: 1.3 }}>{insight.title}</h3>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.45 }}>{insight.body}</div>
      {insight.evidence && (
        <div className="mono" style={{ fontSize: 10, color: 'var(--text-faint)', lineHeight: 1.4 }}>{insight.evidence}</div>
      )}
      {insight.suggestion && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 11.5, color: 'var(--text)', lineHeight: 1.4, paddingLeft: 9, borderLeft: `2px solid ${conf}` }}>
          <Icon name="spark" size={12} style={{ color: conf, flexShrink: 0, marginTop: 2 }} />
          <span>{insight.suggestion}</span>
        </div>
      )}
      {actionable && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 1 }}>
          <button
            className="btn btn-primary"
            style={{ padding: '5px 11px', fontSize: 10 }}
            disabled={busy}
            onClick={() => accept.mutate()}
            title="Spawn a quest from this pattern"
          >
            <Icon name="check" size={12} /> {accept.isPending ? 'ACCEPTING…' : 'ACCEPT'}
          </button>
          <button
            className="btn btn-ghost"
            style={{ padding: '5px 11px', fontSize: 10 }}
            disabled={busy}
            onClick={() => dismiss.mutate()}
            title="Hide this pattern"
          >
            <Icon name="close" size={12} /> DISMISS
          </button>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------- transmissions -- */

const KIND_META: Record<HandlerMessage['kind'], { label: string; color: string }> = {
  daily_rundown:  { label: 'RUNDOWN', color: 'var(--cyan)' },
  weekly_debrief: { label: 'DEBRIEF', color: 'var(--violet)' },
  event:          { label: 'EVENT',   color: 'var(--amber)' },
};

function TransmissionsPanel({
  messages, accent, enabled, loading, error,
}: {
  messages: HandlerMessage[];
  accent: string;
  enabled: boolean;
  loading: boolean;
  error: boolean;
}) {
  const newCount = messages.filter(m => !m.seen).length;
  return (
    <div className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <PanelHead icon="bell" color="var(--cyan)" title="TRANSMISSIONS" sub={`${newCount} new`} />
      {loading ? (
        <Splash>OPENING CHANNEL…</Splash>
      ) : error ? (
        <Splash color="var(--red)">CHANNEL DOWN</Splash>
      ) : messages.length === 0 ? (
        <Splash>Handler is quiet. Lines appear when your day generates or a week wraps.</Splash>
      ) : (
        <div className="noscroll" style={{ maxHeight: 520, overflowY: 'auto', margin: '0 -16px -4px', borderTop: '1px solid var(--line)' }}>
          {messages.map((m, i) => {
            const meta = KIND_META[m.kind] ?? { label: m.kind.toUpperCase(), color: 'var(--text-dim)' };
            return (
              <div
                key={m.id}
                style={{
                  display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 16px',
                  borderTop: i === 0 ? undefined : '1px solid var(--line)',
                  opacity: enabled ? (m.seen ? 0.72 : 1) : 0.5,
                }}
              >
                <Chip color={meta.color}>{meta.label}</Chip>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mono" style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.55 }}>
                    <span style={{ color: meta.color, userSelect: 'none' }}>&gt; </span>{m.text}
                  </div>
                  <div className="mono" style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 4 }}>
                    {!m.seen && <span style={{ color: accent, marginRight: 8 }}>● NEW</span>}{timeAgo(m.createdAt)}
                    {m.persona && (
                      <> · <span style={{ color: personaMeta(m.persona).accent }}>{personaMeta(m.persona).name}</span></>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------- narrative + reflection -- */

function NarrativeCard({ accent, label, text }: { accent: string; label: string; text: string | null }) {
  return (
    <div
      className="panel"
      style={{ padding: 16, borderLeft: `3px solid ${accent}`, background: `linear-gradient(180deg, color-mix(in srgb, ${accent} 7%, transparent), transparent)` }}
    >
      <div className="mono" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8, fontSize: 9.5, letterSpacing: '0.24em', textTransform: 'uppercase', color: accent }}>
        <Icon name="eye" size={12} style={{ color: accent }} /> &gt; {label} · AFTER-ACTION
      </div>
      <div
        className="mono"
        style={{ fontSize: 12.5, lineHeight: 1.6, color: text ? 'var(--text)' : 'var(--text-faint)', whiteSpace: 'pre-wrap' }}
      >
        {text || 'Awaiting the Handler’s read on this cycle. The narrative lands once the week is digested.'}
      </div>
    </div>
  );
}

function ReflectionCard({ review }: { review: WeeklyReview }) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState(review.notes ?? '');
  const [focusForNext, setFocusForNext] = useState(review.focusForNext ?? '');
  const [toast, setToast] = useState<string | null>(null);

  const submitted = review.status === 'submitted';

  const submit = useMutation({
    mutationFn: () =>
      api.post<SubmitResponse>(`/api/debrief/${review.id}/submit`, {
        notes: notes.trim(),
        focusForNext: focusForNext.trim(),
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['debrief', 'latest'] });
      qc.invalidateQueries({ queryKey: ['debrief', 'list'] });
      qc.invalidateQueries({ queryKey: ['player'] });
      // Filing the first time pays the reward; later edits just save.
      setToast(res?.rewarded ? '+40 XP / +20 €$ — filed' : 'Reflection saved.');
    },
  });

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const submitLabel = submit.isPending
    ? (submitted ? 'SAVING…' : 'FILING…')
    : (submitted ? 'UPDATE REFLECTION' : 'FILE DEBRIEF');

  return (
    <div className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <PanelHead icon="flag" color="var(--cyan)" title="OPERATOR REFLECTION" sub={fmtWeekOf(review.weekOf).replace(/, \d{4}$/, '')} />
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="kicker" style={{ color: 'var(--text-faint)' }}>DEBRIEF</span>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="What actually happened this week?"
          rows={4}
          style={{ ...inputStyle, resize: 'vertical', minHeight: 84, lineHeight: 1.5 }}
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="kicker" style={{ color: 'var(--text-faint)' }}>ORDERS FOR NEXT CYCLE</span>
        <input
          value={focusForNext}
          onChange={e => setFocusForNext(e.target.value)}
          placeholder="One focus."
          style={inputStyle}
        />
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button
          className="btn btn-primary"
          disabled={submit.isPending}
          onClick={() => submit.mutate()}
          style={{ padding: '8px 16px', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em' }}
        >
          <Icon name="check" size={13} /> {submitLabel}
        </button>
        {submit.isError && (
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--red)' }}>
            COULDN&rsquo;T FILE — TRY AGAIN
          </span>
        )}
        {toast && (
          <span
            className="mono"
            style={{
              fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--lime)',
              padding: '4px 9px', background: 'color-mix(in srgb, var(--lime) 12%, transparent)',
              border: '1px solid color-mix(in srgb, var(--lime) 35%, transparent)',
            }}
          >
            {toast}
          </span>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- shared -- */

function PanelHead({
  icon, color, title, sub, right,
}: { icon: string; color: string; title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <Icon name={icon} size={14} style={{ color }} />
      <span className="mono" style={{ fontSize: 10, letterSpacing: '0.26em', textTransform: 'uppercase', color }}>{title}</span>
      {sub && <span className="ncx-serial">{sub}</span>}
      {right && (
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {right}
        </span>
      )}
    </div>
  );
}

function Chip({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span className="ncx-stamp flat" style={{ flexShrink: 0, color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}>
      {children}
    </span>
  );
}

function Splash({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div className="panel hud" style={{ padding: 32, textAlign: 'center', color: color ?? 'var(--text-faint)' }}>
      <div className="mono" style={{ fontSize: 13, lineHeight: 1.5, maxWidth: 480, margin: '0 auto' }}>
        {children}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '10px 12px',
  background: 'var(--panel-2)',
  border: '1px solid var(--line-2)',
  borderRadius: 'var(--r-sm)',
  color: 'var(--text)',
  fontFamily: 'var(--font-mono)',
  fontSize: 13,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

function fmtWeekOf(weekOf: string): string {
  const d = new Date(weekOf);
  if (Number.isNaN(d.getTime())) return weekOf;
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

/** Short relative timestamp for the feed ("3h ago", "Jun 4"). */
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const min = Math.round((Date.now() - then) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
