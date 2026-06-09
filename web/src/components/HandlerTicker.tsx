/**
 * HandlerTicker — the VOICE of the app.
 *
 * A compact, dismissible HUD strip pinned to the top of the Today page that
 * shows the AI Handler's latest line: a sardonic rogue-AI "daily rundown".
 * Subtle, terminal-flavored, never shouty — a single row that wraps on
 * mobile with a faint scanline overlay and a left accent edge.
 *
 * Lifecycle: render NOTHING unless there's a fresh, unseen line and the
 * feature is enabled. Dismissing posts the message id as "seen" so it
 * re-reads as hidden; a socket "handler-message" event re-fetches live so
 * a new rundown surfaces across tabs/devices without a reload.
 *
 * Design system only: .panel / kicker / mono / btn-ghost and CSS color vars.
 */
import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { HandlerLatestResponse, HandlerPersona } from '../lib/api';
import { getSocket } from '../lib/socket';
import { Icon } from './Icon';

/** Persona key → display label + accent glyph/color. */
const PERSONA_META: Record<HandlerPersona, { label: string; icon: 'zap' | 'eye'; accent: string }> = {
  rogue_ai:  { label: 'ROGUE AI',  icon: 'zap', accent: 'var(--violet)' },
  fixer:     { label: 'FIXER',     icon: 'eye', accent: 'var(--cyan)' },
  ripperdoc: { label: 'RIPPERDOC', icon: 'zap', accent: 'var(--magenta)' },
};

export function HandlerTicker() {
  const qc = useQueryClient();

  const handlerQ = useQuery({
    queryKey: ['handler', 'latest'],
    queryFn: () => api.get<HandlerLatestResponse>('/api/handler/latest'),
  });

  // Live: a fresh rundown elsewhere re-fetches this strip.
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const refresh = () => qc.invalidateQueries({ queryKey: ['handler', 'latest'] });
    s.on('handler-message', refresh);
    return () => { s.off('handler-message', refresh); };
  }, [qc]);

  const dismiss = useMutation({
    mutationFn: (id: string) => api.post('/api/handler/seen', { ids: [id] }),
    onMutate: async (id: string) => {
      // Optimistically flag this line seen so the strip hides immediately,
      // even before the server confirms. The refetch below makes it durable.
      await qc.cancelQueries({ queryKey: ['handler', 'latest'] });
      const prev = qc.getQueryData<HandlerLatestResponse>(['handler', 'latest']);
      if (prev?.message && prev.message.id === id) {
        qc.setQueryData<HandlerLatestResponse>(['handler', 'latest'], {
          ...prev,
          message: { ...prev.message, seen: true },
        });
      }
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      // Roll back on failure so the line reappears and can be retried.
      if (ctx?.prev) qc.setQueryData(['handler', 'latest'], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['handler', 'latest'] }),
  });

  const data = handlerQ.data;

  // Stay invisible until there's a genuine, unseen line to deliver.
  if (handlerQ.isLoading || !data || !data.enabled) return null;
  const message = data.message;
  if (!message || message.seen) return null;

  const persona = (message.persona ?? data.persona) as HandlerPersona;
  const meta = PERSONA_META[persona] ?? PERSONA_META.rogue_ai;

  return (
    <div
      className="panel fade-up"
      style={{
        position: 'relative',
        overflow: 'hidden',
        padding: '12px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        borderLeft: `3px solid ${meta.accent}`,
        background: `linear-gradient(90deg, color-mix(in srgb, ${meta.accent} 8%, transparent), transparent 60%)`,
      }}
    >
      {/* Faint scanline overlay for the terminal feel (non-interactive). */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          backgroundImage:
            'repeating-linear-gradient(0deg, color-mix(in srgb, var(--text) 4%, transparent) 0 1px, transparent 1px 3px)',
          opacity: 0.4,
        }}
      />

      {/* Glyph */}
      <div
        style={{
          width: 30, height: 30, borderRadius: 8, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: meta.accent,
          background: `color-mix(in srgb, ${meta.accent} 12%, transparent)`,
          border: `1px solid color-mix(in srgb, ${meta.accent} 35%, transparent)`,
          zIndex: 1,
        }}
      >
        <Icon name={meta.icon} size={16} />
      </div>

      {/* Kicker + persona + the line */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', zIndex: 1 }}>
        <span className="kicker" style={{ color: meta.accent, flexShrink: 0 }}>
          HANDLER · {meta.label}
        </span>
        <span style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.45, minWidth: 0 }}>
          {message.text}
        </span>
      </div>

      {/* Dismiss */}
      <button
        className="btn btn-ghost"
        aria-label="Dismiss handler message"
        title="Dismiss"
        disabled={dismiss.isPending}
        onClick={() => dismiss.mutate(message.id)}
        style={{ padding: '6px 8px', flexShrink: 0, color: 'var(--text-faint)', zIndex: 1 }}
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
