/**
 * QuickCapture — jot a stray to-do from anywhere (topbar "+" or the global
 * "C" hotkey). Submitting creates a one-off CHORE that surfaces as today's
 * quest immediately (server: POST /api/habits/quick). One-offs are chores,
 * not habits — they land in Operations' Uncategorized bucket and pay a small
 * server-owned reward; they don't gate the day's clear.
 *
 * Controlled: render with `open`; closes on Escape / backdrop / DONE. A
 * successful capture clears the field and KEEPS the palette open (with a
 * brief "logged" tick) so several to-dos can be seeded without reopening.
 * `onAdded` fires per capture (the host uses it to land on Today).
 *
 * FOR: picks who it's for (2026-09-27). "Me" is the classic capture; anyone else
 * in the family turns it into a gift (POST /api/gifts): it lands on THEIR Today
 * as a one-off chore tagged "from <you>", sized small/medium/big (server-owned XP).
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Icon } from './Icon';

export function QuickCapture({ open, onClose, onAdded }: {
  open: boolean;
  onClose: () => void;
  onAdded?: () => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const tickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [forId, setForId] = useState<string>('me');
  const [size, setSize] = useState<'small' | 'medium' | 'big'>('small');
  const [note, setNote] = useState('');
  const crewQ = useQuery({
    queryKey: ['gifts', 'crew'],
    queryFn: () => api.get<{ crew: Array<{ id: string; name: string }> }>('/api/gifts/crew').then(r => r.crew),
    enabled: open,
    staleTime: 5 * 60_000,
  });
  const crew = crewQ.data ?? [];
  const recipient = crew.find(c => c.id === forId) ?? null;

  const flash = (msg: string) => {
    setTitle('');
    setLastAdded(msg);
    if (tickTimer.current) clearTimeout(tickTimer.current);
    tickTimer.current = setTimeout(() => setLastAdded(null), 2500);
    inputRef.current?.focus();
  };
  const gift = useMutation({
    mutationFn: (t: string) => api.post('/api/gifts', { toUserId: forId, title: t, size, ...(note.trim() ? { note: note.trim() } : {}) }),
    onSuccess: (_res, t) => { setNote(''); flash(`SENT TO ${(recipient?.name ?? '').toUpperCase()} — ${t}`); },
  });

  const add = useMutation({
    mutationFn: (t: string) => api.post('/api/habits/quick', { title: t }),
    onSuccess: (_res, t) => {
      qc.invalidateQueries({ queryKey: ['quests', 'today'] });
      qc.invalidateQueries({ queryKey: ['habits'] });
      // Stay open for the next entry — seeding several to-dos shouldn't mean
      // reopening N times. Escape / backdrop / DONE still close.
      setTitle('');
      setLastAdded(t);
      if (tickTimer.current) clearTimeout(tickTimer.current);
      tickTimer.current = setTimeout(() => setLastAdded(null), 2500);
      inputRef.current?.focus();
      onAdded?.();
    },
  });

  // Reset + focus the field each time the sheet opens.
  useEffect(() => {
    if (!open) return;
    setTitle('');
    setLastAdded(null);
    setForId('me');
    setNote('');
    gift.reset();
    const id = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [open]);
  useEffect(() => () => { if (tickTimer.current) clearTimeout(tickTimer.current); }, []);

  if (!open) return null;

  const busy = add.isPending || gift.isPending;
  const submit = () => {
    const t = title.trim();
    if (!t || busy) return;
    if (recipient) gift.mutate(t); else add.mutate(t);
  };
  const chip = (on: boolean) => ({
    padding: '6px 11px', fontSize: '0.6562rem', letterSpacing: '0.1em',
    borderColor: on ? 'var(--cyan)' : 'var(--line-2)', color: on ? 'var(--cyan)' : 'var(--text-dim)',
  });

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
              fontSize: '1rem', fontWeight: 700, margin: 0,
              fontFamily: 'var(--font-display)', color: 'var(--text)',
              textTransform: 'uppercase', letterSpacing: '0.03em',
            }}>
              {recipient ? `Send a quest to ${recipient.name}` : 'Quick Capture'}
            </h3>
            <div className="mono" style={{ fontSize: '0.5938rem', letterSpacing: '0.14em', color: 'var(--text-faint)', marginTop: 2 }}>
              {recipient ? 'LANDS ON THEIR TODAY · TAGGED FROM YOU' : 'ONE-OFF CHORE · LANDS ON TODAY'}
            </div>
          </div>
        </div>

        {crew.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 12 }}>
            <span className="mono" style={{ fontSize: '0.5938rem', letterSpacing: '0.14em', color: 'var(--text-faint)', marginRight: 4 }}>FOR</span>
            <button type="button" className="btn btn-ghost" style={chip(forId === 'me')} onClick={() => setForId('me')}>ME</button>
            {crew.map(c => (
              <button key={c.id} type="button" className="btn btn-ghost" style={chip(forId === c.id)} onClick={() => setForId(c.id)}>
                🎁 {c.name.toUpperCase()}
              </button>
            ))}
          </div>
        )}

        <input
          ref={inputRef}
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') onClose();
          }}
          placeholder={recipient ? `A quest for ${recipient.name} — e.g. build a blanket fort` : 'Jot a chore — e.g. call the bank'}
          maxLength={200}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: 'var(--panel-2)', border: '1px solid var(--line-2)',
            color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: '0.875rem',
            padding: '11px 13px', outline: 'none', letterSpacing: '0.01em',
          }}
        />

        {recipient && (
          <>
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onClose(); }}
              placeholder="Add a note (optional)"
              maxLength={300}
              style={{
                width: '100%', boxSizing: 'border-box', marginTop: 8,
                background: 'var(--panel-2)', border: '1px solid var(--line-2)',
                color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: '0.8125rem',
                padding: '9px 13px', outline: 'none',
              }}
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 10 }}>
              <span className="mono" style={{ fontSize: '0.5938rem', letterSpacing: '0.14em', color: 'var(--text-faint)', marginRight: 4 }}>SIZE</span>
              {([['small', 'SMALL · 8 XP'], ['medium', 'MEDIUM · 15 XP'], ['big', 'BIG · 25 XP']] as const).map(([k, lbl]) => (
                <button key={k} type="button" className="btn btn-ghost" style={chip(size === k)} onClick={() => setSize(k)}>{lbl}</button>
              ))}
            </div>
          </>
        )}

        {gift.isError && (
          <div className="mono" style={{ marginTop: 10, fontSize: '0.6875rem', color: 'var(--red)' }}>
            {(gift.error as Error)?.message ?? 'Could not send that'}
          </div>
        )}

        {lastAdded && (
          <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: '0.6562rem', letterSpacing: '0.08em', color: 'var(--lime)' }}>
            <Icon name="check" size={12} style={{ flex: 'none' }} />
            <span style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>LOGGED — {lastAdded}</span>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            DONE
          </button>
          <button
            className="btn btn-primary"
            onClick={submit}
            disabled={!title.trim() || busy}
          >
            {recipient ? (gift.isPending ? 'SENDING…' : 'SEND QUEST') : (add.isPending ? 'CAPTURING…' : 'ADD CHORE')}
          </button>
        </div>
      </div>
    </div>
  );
}
