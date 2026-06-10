/**
 * LevelUpOverlay — "RUNNER ADVANCEMENT" (design handoff interaction).
 *
 * Listens on the socket for any award that crossed a level boundary
 * (player-updated carries the snapshot with leveledUp/level) and throws up
 * the blurred-backdrop focal panel: kicker, 54px chroma LEVEL n, CONTINUE.
 * Dismiss on click anywhere. The HTTP responses remain the source of truth
 * for the award itself — this is pure ceremony.
 */
import { useEffect, useState } from 'react';
import { getSocket } from '../lib/socket';

export function LevelUpOverlay() {
  const [level, setLevel] = useState<number | null>(null);

  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const onPlayer = (payload: { player?: { leveledUp?: boolean; level?: number } }) => {
      if (payload?.player?.leveledUp && typeof payload.player.level === 'number') {
        setLevel(payload.player.level);
      }
    };
    s.on('player-updated', onPlayer);
    return () => { s.off('player-updated', onPlayer); };
  }, []);

  if (level === null) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1200,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(2,4,10,0.72)', backdropFilter: 'blur(3px)',
      }}
      onClick={() => setLevel(null)}
    >
      <div className="ncx-ticks">
        <span className="tick" style={{ top: -4, left: -4, color: 'var(--cyan)' }} />
        <span className="tick" style={{ bottom: -4, right: -4, color: 'var(--cyan)' }} />
        <div
          className="ncx-panel focal"
          style={{ padding: '40px 64px', textAlign: 'center', animation: 'ncx-levelup-in .4s cubic-bezier(.22,.61,.36,1) both' }}
        >
          <div className="kicker" style={{ color: 'var(--cyan)', marginBottom: 14 }}>RUNNER ADVANCEMENT</div>
          <div className="ncx-chroma" style={{ fontFamily: 'var(--font-display)', fontSize: 54, fontWeight: 700, lineHeight: 1 }}>
            LEVEL {level}
          </div>
          <div className="mono" style={{ fontSize: 11, letterSpacing: '0.2em', color: 'var(--text-dim)', marginTop: 16 }}>
            STREET CRED RISING · NEW SKINS AT THE MARKET
          </div>
          <button className="btn btn-primary" style={{ marginTop: 24, padding: '10px 28px' }} onClick={() => setLevel(null)}>
            CONTINUE
          </button>
        </div>
      </div>
    </div>
  );
}
