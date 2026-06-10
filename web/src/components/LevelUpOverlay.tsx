/**
 * LevelUpOverlay — "RUNNER ADVANCEMENT".
 *
 * Listens on the socket for any award that crossed a level boundary
 * (player-updated carries the snapshot with leveledUp/level) and throws up
 * the blurred-backdrop focal panel. Per Brent: no shop plug — instead the
 * ceremony shows WHERE the XP came from (lifetime per-module breakdown from
 * the snapshot's domainXp), so each level-up is a tiny retrospective.
 * Dismiss on click anywhere. The HTTP responses remain the source of truth
 * for the award itself — this is pure ceremony.
 */
import { useEffect, useState } from 'react';
import { getSocket } from '../lib/socket';

const MODULE_COLORS: Record<string, string> = {
  fitness:  'var(--lime)',
  finance:  'var(--cyan)',
  habits:   'var(--violet)',
  chores:   'var(--teal)',
  projects: 'var(--blue)',
  media:    'var(--pink)',
  vitals:   'var(--lime)',
  social:   'var(--magenta)',
};

interface LevelUpInfo {
  level: number;
  totalXp: number;
  domainXp: Record<string, number>;
}

export function LevelUpOverlay() {
  const [info, setInfo] = useState<LevelUpInfo | null>(null);

  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const onPlayer = (payload: { player?: { leveledUp?: boolean; level?: number; totalXp?: number; domainXp?: Record<string, number> } }) => {
      const p = payload?.player;
      if (p?.leveledUp && typeof p.level === 'number') {
        setInfo({ level: p.level, totalXp: p.totalXp ?? 0, domainXp: p.domainXp ?? {} });
      }
    };
    s.on('player-updated', onPlayer);
    return () => { s.off('player-updated', onPlayer); };
  }, []);

  if (info === null) return null;

  // Where the cred came from: top modules by lifetime XP.
  const sources = Object.entries(info.domainXp)
    .filter(([, xp]) => xp > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const maxXp = Math.max(...sources.map(([, xp]) => xp), 1);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1200,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(2,4,10,0.72)', backdropFilter: 'blur(3px)',
      }}
      onClick={() => setInfo(null)}
    >
      <div className="ncx-ticks">
        <span className="tick" style={{ top: -4, left: -4, color: 'var(--cyan)' }} />
        <span className="tick" style={{ bottom: -4, right: -4, color: 'var(--cyan)' }} />
        <div
          className="ncx-panel focal"
          style={{ padding: '38px 56px', textAlign: 'center', minWidth: 380, animation: 'ncx-levelup-in .4s cubic-bezier(.22,.61,.36,1) both' }}
        >
          <div className="kicker" style={{ color: 'var(--cyan)', marginBottom: 14 }}>RUNNER ADVANCEMENT</div>
          <div className="ncx-chroma" style={{ fontFamily: 'var(--font-display)', fontSize: 54, fontWeight: 700, lineHeight: 1 }}>
            LEVEL {info.level}
          </div>
          <div className="mono" style={{ fontSize: 10.5, letterSpacing: '0.2em', color: 'var(--text-dim)', marginTop: 14 }}>
            {info.totalXp.toLocaleString()} LIFETIME XP
          </div>

          {/* The retrospective: where the cred came from. */}
          {sources.length > 0 && (
            <div style={{ marginTop: 22, textAlign: 'left' }}>
              <div className="mono" style={{ fontSize: 9.5, letterSpacing: '0.26em', color: 'var(--text-faint)', textTransform: 'uppercase', marginBottom: 10 }}>
                CRED SOURCES
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {sources.map(([mod, xp]) => (
                  <div key={mod} style={{ display: 'grid', gridTemplateColumns: '76px 1fr 56px', gap: 10, alignItems: 'center' }}>
                    <span className="mono" style={{ fontSize: 9, letterSpacing: '0.16em', color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                      {mod}
                    </span>
                    <div className="ncx-bar slim">
                      <i style={{ width: `${(xp / maxXp) * 100}%`, background: MODULE_COLORS[mod] ?? 'var(--cyan)', opacity: 0.9 }} />
                      <span className="seg-mask" />
                    </div>
                    <span className="mono" style={{ fontSize: 9.5, color: 'var(--text-faint)', textAlign: 'right' }}>
                      {xp.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button className="btn btn-primary" style={{ marginTop: 26, padding: '10px 28px' }} onClick={() => setInfo(null)}>
            CONTINUE
          </button>
        </div>
      </div>
    </div>
  );
}
