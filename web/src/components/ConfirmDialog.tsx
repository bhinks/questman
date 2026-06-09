/**
 * ConfirmDialog — themed replacement for window.confirm(). A fixed
 * overlay + centered panel that matches the cyberpunk design system
 * (.panel/.btn, CSS vars). Controlled: render it with `open` and supply
 * onConfirm / onCancel. `danger` tints the confirm button red for
 * destructive actions.
 *
 * Closes on Escape and on backdrop click (both treated as cancel).
 */
import { useEffect } from 'react';
import { Icon } from './Icon';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open, title, message,
  confirmLabel = 'CONFIRM', cancelLabel = 'CANCEL',
  danger = false, busy = false,
  onConfirm, onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onConfirm, onCancel]);

  if (!open) return null;

  const accent = danger ? 'var(--red)' : 'var(--cyan)';

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(2,6,12,0.72)',
        backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        className="panel hud fade-up"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{
          width: '100%', maxWidth: 420, padding: 24,
          border: `1px solid ${accent}`,
          boxShadow: danger ? '0 0 32px rgba(255,77,109,0.18)' : 'var(--glow-cyan)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 9, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: `color-mix(in srgb, ${accent} 14%, transparent)`,
            border: `1px solid color-mix(in srgb, ${accent} 36%, transparent)`,
            color: accent,
          }}>
            <Icon name={danger ? 'close' : 'spark'} size={18} />
          </div>
          <h3 style={{
            fontSize: 16, fontWeight: 600, margin: 0,
            fontFamily: 'var(--font-display)', color: 'var(--text)',
          }}>
            {title}
          </h3>
        </div>

        {message && (
          <div style={{ fontSize: 13.5, color: 'var(--text-dim)', lineHeight: 1.5, marginBottom: 20 }}>
            {message}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            className="btn"
            onClick={onConfirm}
            disabled={busy}
            autoFocus
            style={{
              background: danger
                ? 'linear-gradient(135deg, var(--red), #b3214a)'
                : 'linear-gradient(135deg, var(--cyan), var(--violet))',
              color: 'white', border: 'none',
            }}
          >
            {busy ? 'WORKING…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
