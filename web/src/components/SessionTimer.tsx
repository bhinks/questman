/**
 * SessionTimer — Night Market v2 CHRONO styles (design handoff, ported
 * from proto-fx.jsx PSessionTimer).
 *
 * The compact session-timer row: kicker + digits + style furniture
 * (progress rail / fuse bar / EKG / orbit / EST label) in a flex row
 * (.tmr — padding 11×16, gap 14). Counts DOWN from `estMin`; past zero it
 * flips to red `+MM:SS` with the kicker reading OVERTIME.
 *
 * Used two ways:
 *   - Shop cards: <SessionTimerPreview k=…/> — the actual component
 *     ticking live from a fake mid-session state (design contract).
 *   - Focus chamber: rendered under the big clock with `hideDigits`
 *     (the chamber clock IS the digits; this row carries the furniture).
 */
import { useEffect, useMemo, useReducer } from 'react';

export type ChronoStyle = 'standard' | 'fuse' | 'flatline' | 'orbital' | 'detonator';

/** The EKG polyline — 3 beats over a 220×34 viewBox (design spec). */
const EKG_POINTS = '0,17 28,17 36,17 42,6 48,29 54,11 60,17 96,17 104,17 110,6 116,29 122,11 128,17 164,17 172,17 178,6 184,29 190,11 196,17 220,17';

export function SessionTimer({ styleKey, start, estMin, preview, hideDigits }: {
  styleKey: string;
  start: number;           // epoch ms the session started
  estMin: number;          // estimated minutes (the countdown length)
  preview?: boolean;       // shop-card mode (borderless, fills the inset)
  hideDigits?: boolean;    // chamber mode — the big clock carries the digits
}) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const id = setInterval(force, 1000);
    return () => clearInterval(id);
  }, []);

  const total = Math.max(60, (estMin || 25) * 60);
  const elapsed = Math.max(0, Math.floor((Date.now() - (start || Date.now())) / 1000));
  const remain = total - elapsed;
  const over = remain < 0;
  const t = Math.abs(remain);
  const txt = (over ? '+' : '') + String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
  const prog = Math.min(1, elapsed / total);
  const accent = over ? 'var(--red)' : 'var(--cyan)';
  const cls = 'panel-inset tmr' + (preview ? ' prev' : '');
  const tag = (label: string) => (
    <span className="kicker" style={{ fontSize: 9, flex: 'none' }}>{over ? 'OVERTIME' : label}</span>
  );

  if (styleKey === 'flatline') {
    return (
      <div className={cls}>
        {tag('VITALS')}
        <svg className="tmr-ekg" width="100%" height="34" viewBox="0 0 220 34" preserveAspectRatio="none" style={{ flex: 1, minWidth: 0, overflow: 'visible' }}>
          <polyline className="base" fill="none" strokeWidth="1.5" points={EKG_POINTS} />
          <polyline className="trace" fill="none" stroke={accent} strokeWidth="1.8"
            style={{ filter: 'drop-shadow(0 0 5px rgba(var(--accent-rgb),0.8))' }}
            points={EKG_POINTS} />
        </svg>
        {!hideDigits && <span className="tmr-digits" style={{ fontSize: 22, color: accent }}>{txt}</span>}
      </div>
    );
  }

  if (styleKey === 'fuse') {
    return (
      <div className={cls}>
        {tag('FUSE')}
        <div style={{ position: 'relative', flex: 1, height: 8, background: '#0a0b14', boxShadow: 'inset 0 0 0 1px var(--line-2)' }}>
          {/* The bar DEPLETES right→left (red→amber) with a spark at the burn point. */}
          <i style={{ position: 'absolute', right: 1, top: 1, bottom: 1, width: ((1 - prog) * 100) + '%', background: 'linear-gradient(90deg, var(--red), var(--amber))', transition: 'width 1s linear' }} />
          {!over && <span className="tmr-fusetip" style={{ left: (prog * 100) + '%' }} />}
        </div>
        {!hideDigits && <span className="tmr-digits" style={{ fontSize: 22, color: over ? 'var(--red)' : 'var(--amber)' }}>{txt}</span>}
      </div>
    );
  }

  if (styleKey === 'detonator') {
    const hot = over || remain < 60;
    return (
      <div className={cls} style={{ justifyContent: 'center', gap: 18 }}>
        {tag('ARMED')}
        {!hideDigits && (
          <span className={'tmr-digits' + (hot ? ' tmr-blink' : '')} style={{
            fontSize: 30, letterSpacing: '0.1em', color: 'var(--red)',
            textShadow: '0 0 16px rgba(255,77,109,0.65)',
          }}>⟦ {txt} ⟧</span>
        )}
        <span className="mono" style={{ fontSize: 9, letterSpacing: '0.22em', color: 'var(--text-faint)' }}>
          {over ? 'BOOM. KEEP WORKING' : 'EST ' + (estMin || 25) + 'M'}
        </span>
      </div>
    );
  }

  if (styleKey === 'orbital') {
    const C = 2 * Math.PI * 21;
    const a = prog * 2 * Math.PI - Math.PI / 2;
    return (
      <div className={cls}>
        {tag('ORBIT')}
        <svg width="52" height="52" viewBox="0 0 52 52" style={{ flex: 'none' }}>
          <circle cx="26" cy="26" r="21" fill="none" stroke="var(--line-2)" strokeWidth="1.5" />
          <circle cx="26" cy="26" r="21" fill="none" stroke={accent} strokeWidth="2"
            strokeDasharray={C} strokeDashoffset={C * (1 - prog)}
            transform="rotate(-90 26 26)" style={{ filter: 'drop-shadow(0 0 4px rgba(var(--accent-rgb),0.7))', transition: 'stroke-dashoffset 1s linear' }} />
          <circle cx={26 + 21 * Math.cos(a)} cy={26 + 21 * Math.sin(a)} r="3.2" fill={accent}
            style={{ filter: 'drop-shadow(0 0 5px rgba(var(--accent-rgb),0.9))', transition: 'cx 1s linear, cy 1s linear' }} />
        </svg>
        {!hideDigits && <span className="tmr-digits" style={{ fontSize: 24, color: accent }}>{txt}</span>}
        <span className="mono" style={{ fontSize: 9, letterSpacing: '0.2em', color: 'var(--text-faint)', marginLeft: 'auto' }}>
          {Math.round(prog * 100)}% OF EST
        </span>
      </div>
    );
  }

  /* standard issue */
  return (
    <div className={cls}>
      {tag('SESSION')}
      {!hideDigits && <span className="tmr-digits" style={{ fontSize: 24, color: accent }}>{txt}</span>}
      <div className="ncx-bar slim" style={{ flex: 1 }}>
        <i style={{ width: (prog * 100) + '%', background: 'linear-gradient(90deg, var(--cyan-deep), var(--cyan))', transition: 'width 1s linear' }} />
        <span className="seg-mask" />
      </div>
      <span className="mono" style={{ fontSize: 9, letterSpacing: '0.2em', color: 'var(--text-faint)' }}>EST {estMin || 25}M</span>
    </div>
  );
}

/** Shop preview wrapper — mid-session demo state, ticking live. */
export function SessionTimerPreview({ k }: { k: string }) {
  const demoStart = useMemo(() => Date.now() - (9 * 60 + 37) * 1000, []);
  return (
    <div className="panel-inset mkt-prev" style={{ display: 'flex', alignItems: 'stretch' }}>
      <SessionTimer styleKey={k} start={demoStart} estMin={25} preview />
    </div>
  );
}
