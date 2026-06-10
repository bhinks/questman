/**
 * NetView — the "Net" tab: your data-shadow, read back to you.
 *
 * Two stacked sections:
 *   1. INSIGHTS FEED — cross-domain "possible patterns" the analyzer surfaces
 *      from your own logged data (sleep, mood, spend, gym, social). These are
 *      honest correlations, NOT causation — every card carries a persistent
 *      "POSSIBLE PATTERN — not a verdict" label and we never editorialize
 *      beyond the server-provided text. Actionable insights can be ACCEPTed
 *      (spawns a quest) or DISMISSed.
 *   2. HANDLER LOG — the Handler's message feed (daily rundowns / weekly
 *      debriefs) styled like a terminal log, with a persona selector and an
 *      on/off toggle.
 *
 * Design system only: .panel / .panel-inset / .hud / kicker / mono / .btn /
 * .btn-ghost and CSS color vars. Live-refreshes off the same socket events
 * TodayView uses, plus handler-specific broadcasts when present.
 */
import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type {
  Insight,
  InsightsResponse,
  HandlerMessage,
  HandlerMessagesResponse,
  HandlerPersona,
  PersonaResponse,
} from '../lib/api';
import { getSocket } from '../lib/socket';
import { Icon } from './Icon';

export function NetView() {
  const qc = useQueryClient();

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

  // Live refresh: new insights/handler lines can land from the spine on another
  // tab/device. Refetch on the broad activity events plus any handler-specific
  // ones the backend may emit.
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const refreshInsights = () => qc.invalidateQueries({ queryKey: ['insights'] });
    const refreshHandler = () => {
      qc.invalidateQueries({ queryKey: ['handler', 'messages'] });
      qc.invalidateQueries({ queryKey: ['handler', 'persona'] });
    };
    // The weekly insight batch co-emits 'handler-message', so refresh insights on it too.
    const insightEvts = ['insight-created', 'handler-message', 'player-updated'];
    const handlerEvts = ['handler-message', 'daily-generated', 'weekly-debrief'];
    insightEvts.forEach(e => s.on(e, refreshInsights));
    handlerEvts.forEach(e => s.on(e, refreshHandler));
    return () => {
      insightEvts.forEach(e => s.off(e, refreshInsights));
      handlerEvts.forEach(e => s.off(e, refreshHandler));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc]);

  const insights = insightsQ.data?.insights ?? [];
  const newCount = insightsQ.data?.newCount ?? 0;

  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <Header newCount={newCount} />

      <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <SectionLabel
          icon="trend"
          color="var(--violet)"
          title="INSIGHTS"
          sub="pattern analysis from your data-shadow"
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {insights.map(i => <InsightCard key={i.id} insight={i} />)}
          </div>
        )}
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <SectionLabel
          icon="bell"
          color="var(--cyan)"
          title="HANDLER LOG"
          sub="lines from the voice in your ear"
        />
        <PersonaControl
          data={personaQ.data}
          loading={personaQ.isLoading}
          error={personaQ.isError}
        />
        {messagesQ.isLoading ? (
          <Splash>OPENING CHANNEL…</Splash>
        ) : messagesQ.isError ? (
          <Splash color="var(--red)">CHANNEL DOWN</Splash>
        ) : (messagesQ.data?.messages ?? []).length === 0 ? (
          <Splash>Handler is quiet. Lines appear when your day generates or a week wraps.</Splash>
        ) : (
          <MessageLog messages={messagesQ.data!.messages} />
        )}
      </section>
    </div>
  );
}

function Header({ newCount }: { newCount: number }) {
  return (
    <div className="panel hud" style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
      <Icon name="eye" size={20} style={{ color: 'var(--violet)' }} />
      <div>
        <h2 className="ncx-chroma" style={{ fontSize: 18, fontWeight: 700, margin: 0, fontFamily: 'var(--font-display)', letterSpacing: '0.02em' }}>
          NET // DATA-SHADOW
        </h2>
        <div className="mono" style={{ fontSize: 10, letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--text-faint)', marginTop: 3 }}>
          the patterns your own data leaves behind
        </div>
      </div>
      <span
        className="ncx-stamp flat"
        style={{
          marginLeft: 'auto',
          color: newCount > 0 ? 'var(--cyan)' : 'var(--text-dim)',
          background: newCount > 0 ? 'rgba(var(--accent-rgb), 0.10)' : undefined,
        }}
      >
        {newCount > 0 ? `${newCount} FRESH` : 'NO NEW SIGNAL'}
      </span>
    </div>
  );
}

function SectionLabel({
  icon, color, title, sub,
}: { icon: string; color: string; title: string; sub: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 2 }}>
      <Icon name={icon} size={14} style={{ color }} />
      <span className="mono" style={{ fontSize: 10, letterSpacing: '0.26em', textTransform: 'uppercase', color }}>{title}</span>
      <span className="ncx-serial">{sub}</span>
    </div>
  );
}

// ---- Insights ------------------------------------------------------------

const CONFIDENCE_COLOR: Record<Insight['confidence'], string> = {
  low: 'var(--amber)',
  medium: 'var(--cyan)',
};

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
  const confColor = CONFIDENCE_COLOR[insight.confidence];
  // Show actions only for actionable insights that are still open.
  const actionable = insight.actionType !== 'none'
    && (insight.status === 'new' || insight.status === 'accepted');

  return (
    <div
      className="panel"
      style={{
        padding: 18,
        display: 'flex', flexDirection: 'column', gap: 10,
        opacity: dismissed ? 0.5 : 1,
        border: spawned
          ? '1px solid color-mix(in srgb, var(--lime) 45%, transparent)'
          : '1px solid var(--line)',
        background: spawned
          ? 'linear-gradient(180deg, color-mix(in srgb, var(--lime) 7%, transparent), transparent)'
          : undefined,
      }}
    >
      {/* Persistent honesty label — these are correlations, never verdicts. */}
      <div
        className="mono"
        title="Correlation surfaced from your own logs — not a diagnosis."
        style={{
          alignSelf: 'flex-start',
          fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
          color: 'var(--text-faint)',
          padding: '2px 7px',
          border: '1px dashed var(--line-2)',
          textTransform: 'uppercase',
        }}
      >
        POSSIBLE PATTERN — not a verdict
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: 'var(--text)' }}>
          {insight.title}
        </h3>
        <Chip color={confColor}>{insight.confidence.toUpperCase()} CONFIDENCE</Chip>
        {insight.windowDays != null && (
          <span className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>
            <Icon name="clock" size={10} style={{ marginRight: 4, color: 'var(--text-faint)' }} />
            {insight.windowDays}d window
          </span>
        )}
        {spawned && <Chip color="var(--lime)">QUEST ADDED</Chip>}
        {dismissed && (
          <span className="mono" style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.06em' }}>
            DISMISSED
          </span>
        )}
      </div>

      <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5 }}>
        {insight.body}
      </div>

      {insight.evidence && (
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', lineHeight: 1.4 }}>
          {insight.evidence}
        </div>
      )}

      {insight.suggestion && (
        <div
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 8,
            fontSize: 12.5, color: 'var(--text)',
            padding: '8px 10px',
            background: `color-mix(in srgb, ${confColor} 8%, transparent)`,
            border: `1px solid color-mix(in srgb, ${confColor} 25%, transparent)`,
          }}
        >
          <Icon name="spark" size={14} style={{ color: confColor, flexShrink: 0, marginTop: 1 }} />
          <span style={{ lineHeight: 1.45 }}>{insight.suggestion}</span>
        </div>
      )}

      {actionable && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
          <button
            className="btn btn-primary"
            style={{ padding: '6px 14px', fontSize: 11 }}
            disabled={accept.isPending || dismiss.isPending}
            onClick={() => accept.mutate()}
            title="Spawn a quest from this pattern"
          >
            <Icon name="check" size={13} /> {accept.isPending ? 'ACCEPTING…' : 'ACCEPT'}
          </button>
          <button
            className="btn btn-ghost"
            style={{ padding: '6px 14px', fontSize: 11 }}
            disabled={accept.isPending || dismiss.isPending}
            onClick={() => dismiss.mutate()}
            title="Hide this pattern"
          >
            <Icon name="close" size={13} /> DISMISS
          </button>
          {accept.isSuccess && (
            <span className="mono" style={{ fontSize: 11, color: 'var(--lime)', display: 'flex', alignItems: 'center', gap: 5 }}>
              <Icon name="check" size={12} style={{ color: 'var(--lime)' }} /> quest added
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Handler: persona + log ---------------------------------------------

/** The persona endpoint now flags Night-Market voices with free/owned (+price).
 *  Local extension until lib/api's PersonaOption catches up. */
type PersonaOptionEx = PersonaResponse['options'][number] & {
  free?: boolean;
  owned?: boolean;
  priceEddies?: number;
};

function PersonaControl({
  data, loading, error,
}: { data: PersonaResponse | undefined; loading: boolean; error: boolean }) {
  const qc = useQueryClient();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['handler', 'persona'] });
    qc.invalidateQueries({ queryKey: ['handler', 'latest'] });
  };
  const setPersona = useMutation({
    mutationFn: (persona: HandlerPersona) => api.put('/api/handler/persona', { persona }),
    onSuccess: invalidate,
  });
  const toggleEnabled = useMutation({
    mutationFn: (enabled: boolean) => api.put('/api/handler/persona', { enabled }),
    onSuccess: invalidate,
  });

  if (loading) return <Splash>LOADING HANDLER…</Splash>;
  if (error || !data) return <Splash color="var(--red)">HANDLER CONFIG UNREACHABLE</Splash>;

  const busy = setPersona.isPending || toggleEnabled.isPending;

  return (
    <div className="panel hud" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span className="mono" style={{ fontSize: 10, letterSpacing: '0.26em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>PERSONA</span>
        <button
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => toggleEnabled.mutate(!data.enabled)}
          title={data.enabled ? 'Silence the Handler' : 'Bring the Handler online'}
          style={{
            marginLeft: 'auto', padding: '4px 12px', fontSize: 11,
            color: data.enabled ? 'var(--lime)' : 'var(--text-faint)',
          }}
        >
          <Icon name="bolt" size={12} /> {data.enabled ? 'ONLINE' : 'MUTED'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {(data.options as PersonaOptionEx[]).map(opt => {
          const selected = opt.key === data.persona;
          // owned === false marks a Night-Market voice not yet bought; free /
          // legacy responses (no flag) stay selectable.
          const locked = opt.owned === false;

          if (locked) {
            return (
              <div
                key={opt.key}
                className="panel-inset"
                title="Unlock in the Night Market"
                style={{
                  flex: '1 1 180px', minWidth: 160, textAlign: 'left',
                  padding: '10px 12px', cursor: 'not-allowed',
                  opacity: 0.55,
                  border: '1px dashed var(--line-2)',
                  background: 'var(--panel-2)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <Icon name="lock" size={12} style={{ color: 'var(--text-faint)' }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-dim)' }}>
                    {opt.label}
                  </span>
                  {opt.priceEddies != null && (
                    <span className="mono" style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--amber)' }}>
                      €${opt.priceEddies.toLocaleString()}
                    </span>
                  )}
                </div>
                <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-faint)', lineHeight: 1.4 }}>
                  {opt.blurb}
                </div>
              </div>
            );
          }

          return (
            <button
              key={opt.key}
              className="panel-inset"
              disabled={busy}
              onClick={() => { if (!selected) setPersona.mutate(opt.key); }}
              title={opt.blurb}
              style={{
                flex: '1 1 180px', minWidth: 160, textAlign: 'left',
                padding: '10px 12px', cursor: selected ? 'default' : 'pointer',
                opacity: data.enabled ? 1 : 0.55,
                border: selected
                  ? '1px solid var(--cyan)'
                  : '1px solid var(--line)',
                background: selected
                  ? 'color-mix(in srgb, var(--cyan) 10%, transparent)'
                  : 'var(--panel-2)',
                boxShadow: selected ? '0 0 12px color-mix(in srgb, var(--cyan) 22%, transparent)' : undefined,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{
                  fontSize: 13, fontWeight: 600,
                  color: selected ? 'var(--cyan)' : 'var(--text)',
                }}>
                  {opt.label}
                </span>
                {selected && <Icon name="check" size={13} style={{ color: 'var(--cyan)' }} />}
              </div>
              <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-faint)', lineHeight: 1.4 }}>
                {opt.blurb}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const KIND_META: Record<HandlerMessage['kind'], { label: string; color: string }> = {
  daily_rundown:  { label: 'RUNDOWN', color: 'var(--cyan)' },
  weekly_debrief: { label: 'DEBRIEF', color: 'var(--violet)' },
  event:          { label: 'EVENT',   color: 'var(--amber)' },
};

function MessageLog({ messages }: { messages: HandlerMessage[] }) {
  // Newest-first; defensive copy so we never mutate the query cache array.
  const ordered = [...messages].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  return (
    <div
      className="panel"
      style={{ padding: 0, overflow: 'hidden', border: '1px solid var(--line)' }}
    >
      {ordered.map((m, i) => {
        const meta = KIND_META[m.kind] ?? { label: m.kind.toUpperCase(), color: 'var(--text-dim)' };
        return (
          <div
            key={m.id}
            style={{
              display: 'flex', gap: 12, alignItems: 'flex-start',
              padding: '12px 16px',
              borderTop: i === 0 ? undefined : '1px solid var(--line)',
              opacity: m.seen ? 0.82 : 1,
            }}
          >
            <Chip color={meta.color}>{meta.label}</Chip>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="mono" style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}>
                <span style={{ color: meta.color, userSelect: 'none' }}>&gt; </span>
                {m.text}
              </div>
              <div className="mono" style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 4 }}>
                {timeAgo(m.createdAt)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- shared bits ---------------------------------------------------------

function Chip({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span
      className="ncx-stamp flat"
      style={{
        flexShrink: 0, color,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
      }}
    >
      {children}
    </span>
  );
}

function Splash({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div className="panel hud" style={{ padding: 40, textAlign: 'center', color: color ?? 'var(--text-faint)' }}>
      <div className="mono" style={{ fontSize: 13, lineHeight: 1.5, maxWidth: 480, margin: '0 auto' }}>
        {children}
      </div>
    </div>
  );
}

/** Short relative timestamp for the log ("3h ago", "Jun 4"). */
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const min = Math.round(diffMs / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
