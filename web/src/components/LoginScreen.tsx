/**
 * LoginScreen — "JACK IN" (Night City design handoff, pixel-faithful).
 *
 * Centered 460px focal panel with a scan sweep on near-black: hex Q + chroma
 * wordmark + vertical serial, a 4-line boot terminal with a blinking cursor,
 * HANDLE + PASSKEY chamfered inputs, full-width ⚡ JACK IN. On submit the
 * label flips to AUTHENTICATING… and the terminal line swaps while the REAL
 * auth call runs (no fake delay — actual latency is the beat).
 *
 * Functional bits preserved from the old screen (not in the mock, kept on
 * purpose): the "remember me" persistence toggle and the demo-creds hint.
 * HANDLE binds to the account email.
 */
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Icon } from './Icon';
import { useAuth } from '../context/AuthContext';

export function LoginScreen() {
  const { login, demo } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [demoing, setDemoing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await login(email.trim(), password, remember);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function onDemo() {
    if (demoing) return;
    setDemoing(true);
    setError(null);
    try {
      await demo();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start demo');
    } finally {
      setDemoing(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div className="ncx-ticks">
          <span className="tick" style={{ top: -4, left: -4, color: 'var(--cyan)' }} />
          <span className="tick" style={{ bottom: -4, right: -4, color: 'var(--cyan)' }} />
          <div className="ncx-panel focal ncx-scan qm-stagger" style={{ width: 'min(460px, 92vw)', padding: '34px 38px 28px' }}>
            <div className="sweep" />

            {/* Brand lockup */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 6 }}>
              <div className="ncx-hex" style={{ width: 44, height: 44, fontSize: 18, boxShadow: '0 0 22px -2px rgba(var(--accent-rgb),0.55)' }}><span style={{ fontWeight: 900, fontSize: '1.2em', lineHeight: 1 }}>!</span></div>
              <div className="ncx-glitch ncx-chroma" style={{ fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 700, letterSpacing: '0.03em' }}>
                QUEST<span style={{ color: 'var(--cyan)' }}>MAN</span>
              </div>
              <span className="ncx-serial vert" style={{ marginLeft: 'auto' }}>NC-077 // 2.4.0</span>
            </div>

            {/* Boot terminal */}
            <div className="ncx-term" style={{ margin: '14px 0 20px' }}>
              <div>&gt; init questman.os <span className="ok">[OK]</span></div>
              <div>&gt; mount /vault/local <span className="ok">[ENCRYPTED]</span></div>
              <div>&gt; scan ice <span className="ok">[NONE DETECTED]</span></div>
              <div>
                {error ? (
                  <span style={{ color: 'var(--red)' }}>&gt; auth rejected — {error.toLowerCase()}<span className="cursor-blink">_</span></span>
                ) : submitting ? (
                  <span>&gt; authenticating runner<span className="cursor-blink cy">█</span></span>
                ) : (
                  <span>&gt; awaiting runner credentials<span className="cursor-blink cy">_</span></span>
                )}
              </div>
            </div>

            {/* Credentials */}
            <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span className="kicker" style={{ fontSize: 9.5 }}>HANDLE</span>
                <input
                  className="ncx-input"
                  type="email"
                  required
                  autoComplete="username"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="runner@questman.local"
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span className="kicker" style={{ fontSize: 9.5 }}>PASSKEY</span>
                <input
                  className="ncx-input"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••••"
                />
              </label>
              <button
                key={submitting ? 'auth' : 'idle'}
                type="submit"
                className="btn btn-primary"
                disabled={submitting || demoing}
                style={{ padding: 14, fontSize: 13, marginTop: 6, width: '100%' }}
              >
                {submitting ? 'AUTHENTICATING…' : (<><Icon name="zap" size={15} /> JACK IN</>)}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={submitting || demoing}
                onClick={onDemo}
                style={{ padding: 11, fontSize: 11, width: '100%', letterSpacing: '0.12em' }}
              >
                {demoing ? 'SPINNING UP NIGHT CITY…' : (<><Icon name="play" size={13} /> EXPLORE THE DEMO</>)}
              </button>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={e => setRemember(e.target.checked)}
                  style={{ accentColor: 'var(--cyan)', width: 13, height: 13 }}
                />
                <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.18em', color: 'var(--text-faint)' }}>
                  PERSIST SESSION ON THIS DECK
                </span>
              </label>
            </form>

            <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', marginTop: 22, fontSize: 9, letterSpacing: '0.2em', color: 'var(--text-faint)' }}>
              <span>⬡ LOCAL VAULT</span>
              <span>DATA NEVER LEAVES THIS DEVICE</span>
            </div>
            <div className="mono" style={{ marginTop: 10, fontSize: 9, letterSpacing: '0.12em', color: 'var(--text-ghost)', textAlign: 'center' }}>
              NO ACCOUNT? EXPLORE A SEEDED SANDBOX — NO DATA LEAVES THIS DEVICE
            </div>
          </div>
        </div>
      </div>
      <footer className="ncx-statusbar">
        <span className="lit">● UPLINK READY</span>
        <span>{window.location.host.toUpperCase()}</span>
        <span style={{ marginLeft: 'auto' }}>SINGLE-RUNNER INSTANCE</span>
        <span className="ncx-serial">QTM//BOOT.076</span>
      </footer>
    </div>
  );
}
