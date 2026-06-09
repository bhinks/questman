import { useState } from 'react';
import type { FormEvent } from 'react';
import { Brandmark } from './Brandmark';
import { useAuth } from '../context/AuthContext';

/**
 * Single-user self-hosted: just a login form, no signup CTA. Visually
 * a HUD-bracketed panel that sits center-screen on the existing grid
 * backdrop. Reuses .panel, .hud, .btn, .btn-primary, and the design
 * tokens — no new CSS.
 */
export function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email.trim(), password, remember);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        className="panel hud fade-up"
        style={{ width: '100%', maxWidth: 420, padding: 32 }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
          <Brandmark />
        </div>

        <div className="kicker" style={{ textAlign: 'center', marginBottom: 6 }}>
          AUTHENTICATE
        </div>
        <h1 style={{
          fontSize: 22,
          fontWeight: 600,
          textAlign: 'center',
          marginBottom: 24,
          fontFamily: 'var(--font-display)',
        }}>
          Sign in to your hub
        </h1>

        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="kicker">EMAIL</span>
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={e => setEmail(e.target.value)}
              style={inputStyle}
              placeholder="you@example.com"
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="kicker">PASSWORD</span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              style={inputStyle}
              placeholder="••••••••"
            />
          </label>

          <label style={{
            display: 'flex', alignItems: 'center', gap: 8,
            cursor: 'pointer', marginTop: 2,
          }}>
            <input
              type="checkbox"
              checked={remember}
              onChange={e => setRemember(e.target.checked)}
              style={{ accentColor: 'var(--cyan)', width: 15, height: 15 }}
            />
            <span style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>
              Keep me jacked in on this device
            </span>
          </label>

          {error && (
            <div
              style={{
                fontSize: 12.5,
                color: 'var(--red)',
                border: '1px solid rgba(255,77,109,0.35)',
                background: 'rgba(255,77,109,0.06)',
                borderRadius: 'var(--r-sm)',
                padding: '8px 12px',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting}
            style={{ justifyContent: 'center', marginTop: 8, opacity: submitting ? 0.6 : 1 }}
          >
            {submitting ? 'AUTHENTICATING…' : 'JACK IN'}
          </button>
        </form>

        <div
          className="mono"
          style={{
            marginTop: 24,
            fontSize: 11,
            color: 'var(--text-faint)',
            textAlign: 'center',
            letterSpacing: '0.05em',
          }}
        >
          DEMO: demo@questman.app / demo123
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  background: 'var(--panel-2)',
  border: '1px solid var(--line-2)',
  borderRadius: 'var(--r)',
  color: 'var(--text)',
  fontFamily: 'var(--font-mono)',
  fontSize: 13,
  outline: 'none',
  transition: 'border-color 0.15s',
};
