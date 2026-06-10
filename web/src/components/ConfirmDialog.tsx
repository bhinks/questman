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
          borderColor: accent,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <div
            className="ncx-chip"
            style={{
              width: 36, height: 36,
              color: accent,
              ...(danger ? {
                background: 'rgba(255,77,109,0.12)',
                boxShadow: 'inset 0 0 0 1px rgba(255,77,109,0.35)',
              } : {}),
            }}
          >
            <Icon name={danger ? 'close' : 'spark'} size={18} />
          </div>
          <h3 className="ncx-chroma" style={{
            fontSize: 16, fontWeight: 700, margin: 0,
            fontFamily: 'var(--font-display)', color: 'var(--text)',
            textTransform: 'uppercase', letterSpacing: '0.03em',
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
            key={danger ? 'confirm-danger' : 'confirm-default'}
            className={danger ? 'btn ncx-btn danger' : 'btn btn-primary'}
            onClick={onConfirm}
            disabled={busy}
            autoFocus
          >
            {busy ? 'WORKING…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
