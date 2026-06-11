/**
 * FxOverlays — Night Market v2 VISUAL FX (design handoff, ported from
 * proto-fx.jsx).
 *
 * Stackable, pointer-events-none overlay layers driven by
 * PlayerSnapshot.fxActive (any subset of the owned fx keys):
 *   cursor   GHOST CURSOR   — decaying neon wake along the pointer path
 *   dust     HOLO DUST      — motes of light rising through the frame
 *   rain     NEON DOWNPOUR  — 1px accent streaks falling
 *   vhs      VHS TRACKING   — a tracking band crawling the screen
 *   datarain DATA RAIN      — katakana/digit glyph columns falling
 *   glitch   GLITCH PROTOCOL— chromatic burst on every contract clear
 *
 * Layers sit at z-30 (below modals); parameters are randomized per mount
 * (stable via useMemo). All ambient motion is gated behind
 * prefers-reduced-motion in index.css. FX use --accent-rgb, so they
 * re-tint with the equipped skin/shell automatically.
 *
 * <FxPreview k=…/> renders the same effects miniaturized for shop cards.
 * useGlitchBurst() drives the GLITCH PROTOCOL burst: AppShell puts the
 * returned 'fx-burst' class on .app-shell (the jolt animates .ncx-shell).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { getSocket } from '../lib/socket';

/** Stable per-mount randomized params. */
function fxRand<T>(n: number, fn: (i: number) => T): T[] {
  return Array.from({ length: n }, (_, i) => fn(i));
}

const FX_GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽﾀﾁﾂ0123456789Z$#';

type CSSVars = React.CSSProperties & Record<`--${string}`, string>;

/* ---------- NEON DOWNPOUR ---------- */
function FxRain({ preview }: { preview?: boolean }) {
  const drops = useMemo(() => fxRand(preview ? 12 : 28, () => ({
    left: Math.random() * 100,
    h: preview ? 14 + Math.random() * 18 : 60 + Math.random() * 70,
    dur: 0.8 + Math.random() * 0.9,
    delay: -Math.random() * 2,
    o: 0.25 + Math.random() * 0.5,
  })), [preview]);
  return (
    <div className={'fxo' + (preview ? ' prev' : '')} style={preview ? { inset: 0 } : undefined}>
      {drops.map((d, i) => (
        <i key={i} className="fx-drop" style={{
          left: d.left + '%', height: d.h, opacity: d.o,
          top: preview ? -40 : -140,
          '--fall': preview ? '130px' : '115vh',
          '--dur': d.dur + 's', animationDelay: d.delay + 's',
        } as CSSVars} />
      ))}
    </div>
  );
}

/* ---------- DATA RAIN ---------- */
function FxDataRain({ preview }: { preview?: boolean }) {
  const cols = useMemo(() => fxRand(preview ? 5 : 14, () => ({
    left: 2 + Math.random() * 96,
    dur: 6 + Math.random() * 8,
    delay: -Math.random() * 12,
    o: 0.35 + Math.random() * 0.5,
    chars: fxRand(preview ? 9 : 26, () => FX_GLYPHS[Math.floor(Math.random() * FX_GLYPHS.length)]).join('\n'),
  })), [preview]);
  return (
    <div className={'fxo' + (preview ? ' prev' : '')} style={preview ? { inset: 0 } : undefined}>
      {cols.map((c, i) => (
        <span key={i} className="fx-mtxcol" style={{
          left: c.left + '%', opacity: c.o,
          top: preview ? -110 : -520,
          fontSize: preview ? 9 : 12,
          '--fall': preview ? '240px' : '140vh',
          '--dur': c.dur + 's', animationDelay: c.delay + 's',
        } as CSSVars}>{c.chars}</span>
      ))}
    </div>
  );
}

/* ---------- HOLO DUST ---------- */
function FxDust({ preview }: { preview?: boolean }) {
  const motes = useMemo(() => fxRand(preview ? 9 : 22, () => ({
    left: Math.random() * 100,
    size: 2 + Math.random() * 1.8,
    dur: 8 + Math.random() * 9,
    delay: -Math.random() * 16,
    sway: (Math.random() - 0.5) * 60,
    o: 0.3 + Math.random() * 0.45,
  })), [preview]);
  return (
    <div className={'fxo' + (preview ? ' prev' : '')} style={preview ? { inset: 0 } : undefined}>
      {motes.map((m, i) => (
        <i key={i} className="fx-mote" style={{
          left: m.left + '%', width: m.size, height: m.size,
          '--rise': preview ? '-86px' : '-108vh',
          '--sway': m.sway + 'px', '--o': String(m.o),
          '--dur': m.dur + 's', animationDelay: m.delay + 's',
        } as CSSVars} />
      ))}
    </div>
  );
}

/* ---------- VHS TRACKING ---------- */
function FxVhs({ preview }: { preview?: boolean }) {
  return (
    <div className={'fxo' + (preview ? ' prev' : '')} style={preview ? { inset: 0 } : undefined}>
      <div className="fx-vhsband" style={{ '--dur': preview ? '3.5s' : '7s' } as CSSVars} />
      <div className="fx-vhsband" style={{
        '--dur': preview ? '3.5s' : '7s',
        animationDelay: preview ? '-1.6s' : '-3.2s',
        height: '3%', opacity: 0,
      } as CSSVars} />
    </div>
  );
}

/* ---------- GHOST CURSOR (live only) ---------- */
function FxGhostCursor() {
  const [dots, setDots] = useState<Array<{ id: number; x: number; y: number }>>([]);
  const idRef = useRef(0);
  const lastRef = useRef<[number, number]>([-99, -99]);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const [lx, ly] = lastRef.current;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      if (dx * dx + dy * dy < 520) return;   // min ~23px spacing
      lastRef.current = [e.clientX, e.clientY];
      const id = idRef.current++;
      setDots(d => [...d.slice(-12), { id, x: e.clientX, y: e.clientY }]);
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);
  return (
    <>
      {dots.map(d => <span key={d.id} className="fx-ghostdot" style={{ left: d.x, top: d.y }} />)}
    </>
  );
}

/* static preview for the cursor card */
function FxCursorPreview() {
  const pts: Array<[number, number]> = [[18, 48], [34, 38], [52, 30], [72, 26], [92, 28], [112, 34]];
  return (
    <div className="fxo prev" style={{ inset: 0 }}>
      {pts.map(([x, y], i) => (
        <span key={i} style={{
          position: 'absolute', left: x, top: y,
          width: 4 + i * 1.2, height: 4 + i * 1.2,
          background: `rgba(var(--accent-rgb),${0.15 + i * 0.14})`,
          clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
          boxShadow: i === pts.length - 1 ? '0 0 8px rgba(var(--accent-rgb),0.7)' : 'none',
        }} />
      ))}
    </div>
  );
}

/* glitch preview — looping jitter on a sample row */
function FxGlitchPreview() {
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span className="fx-glitchprev ncx-chroma mono" style={{ fontSize: 11, letterSpacing: '0.22em', color: 'var(--text-dim)' }}>
        ✓ CONTRACT CLEARED
      </span>
    </div>
  );
}

/** Shop-card preview dispatcher (rendered inside a .panel-inset.mkt-prev). */
export function FxPreview({ k }: { k: string }) {
  return (
    <div className="panel-inset mkt-prev">
      {k === 'rain' && <FxRain preview />}
      {k === 'datarain' && <FxDataRain preview />}
      {k === 'dust' && <FxDust preview />}
      {k === 'vhs' && <FxVhs preview />}
      {k === 'cursor' && <FxCursorPreview />}
      {k === 'glitch' && <FxGlitchPreview />}
    </div>
  );
}

/**
 * GLITCH PROTOCOL trigger: pulses true for ~520ms whenever a contract
 * clears (socket 'quest-completed' — counter completions emit it too)
 * while the glitch FX is online. AppShell maps it to the 'fx-burst' class.
 */
export function useGlitchBurst(fxActive: string[]): boolean {
  const [burst, setBurst] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(false);
  activeRef.current = fxActive.includes('glitch');

  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const onClear = () => {
      if (!activeRef.current) return;
      setBurst(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setBurst(false), 520);
    };
    s.on('quest-completed', onClear);
    return () => {
      s.off('quest-completed', onClear);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return burst;
}

/** The live overlay stack — mounted once in AppShell, inside .app-shell. */
export function FxLayer({ fxActive }: { fxActive: string[] }) {
  return (
    <>
      {fxActive.includes('rain') && <FxRain />}
      {fxActive.includes('datarain') && <FxDataRain />}
      {fxActive.includes('dust') && <FxDust />}
      {fxActive.includes('vhs') && <FxVhs />}
      {fxActive.includes('cursor') && <FxGhostCursor />}
      <div className="fx-burst-veil" />
    </>
  );
}
