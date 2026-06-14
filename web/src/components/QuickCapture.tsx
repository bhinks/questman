/**
 * QuickCapture — jot a stray to-do from anywhere (topbar "+" or the global
 * "C" hotkey). Submitting creates a one-off CHORE that surfaces as today's
 * quest immediately (server: POST /api/habits/quick). One-offs are chores,
 * not habits — they land in Operations' Uncategorized bucket and pay a small
 * server-owned reward; they don't gate the day's clear.
 *
 * Controlled: render with `open`; closes on Escape / backdrop. `onAdded` fires
 * after a successful capture (the host uses it to jump to Today).
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Icon } from './Icon';

export function QuickCapture({ open, onClose, onAdded }: {
  open: boolean;
  onClose: () => void;
  onAdded?: () => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const add = useMutation({
    mutationFn: (t: string) => api.post('/api/habits/quick', { title: t }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quests', 'today'] });
      qc.invalidateQueries({ queryKey: ['habits'] });
      setTitle('');
      onClose();
      onAdded?.();
    },
  });

  // Reset + focus the field each time the sheet opens.
  useEffect(() => {
    if (!open) return;
    setTitle('');
    const id = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [open]);

  if (!open) return null;

  const submit = () => {
    const t = title.trim();
    if (!t || add.isPending) return;
    add.mutate(t);
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(2,6,12,0.72)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '14vh 24px 24px',
      }}
    >
      <div
        className="panel hud fade-up"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Quick capture"
        style={{ width: '100%', maxWidth: 480, padding: 22, borderColor: 'var(--cyan)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <div className="ncx-chip" style={{ width: 36, height: 36, color: 'var(--cyan)' }}>
            <Icon name="plus" size={18} />
          </div>
          <div style={{ minWidth: 0 }}>
            <h3 className="ncx-chroma" style={{
              fontSize: 16, fontWeight: 700, margin: 0,
              fontFamily: 'var(--font-display)', color: 'var(--text)',
              textTransform: 'uppercase', letterSpacing: '0.03em',
            }}>
              Quick Capture
            </h3>
            <div className="mono" style={{ fontSize: 9.5, letterSpacing: '0.14em', color: 'var(--text-faint)', marginTop: 2 }}>
              ONE-OFF CHORE · LANDS ON TODAY
            </div>
          </div>
        </div>

        <input
          ref={inputRef}
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') onClose();
          }}
          placeholder="Jot a chore — e.g. call the bank"
          maxLength={200}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: 'var(--panel-2)', border: '1px solid var(--line-2)',
            color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 14,
            padding: '11px 13px', outline: 'none', letterSpacing: '0.01em',
          }}
        />

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={add.isPending}>
            CANCEL
          </button>
          <button
            className="btn btn-primary"
            onClick={submit}
            disabled={!title.trim() || add.isPending}
          >
            {add.isPending ? 'CAPTURING…' : 'ADD CHORE'}
          </button>
        </div>
      </div>
    </div>
  );
}
