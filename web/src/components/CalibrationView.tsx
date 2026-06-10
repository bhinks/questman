/**
 * CalibrationView — SYS // CALIBRATION (Night City display tuning).
 *
 * The four per-user "CRT character" knobs from the design handoff: corner
 * cut (panel clip geometry), chroma split (display-type text-shadow), CRT
 * intensity (scanline + sweep alphas) and the topbar handler ticker.
 *
 * Values LIVE-APPLY while dragging by writing the root CSS vars directly
 * (--cut / --cut-sm / --chroma / --scan-a / --sweep-a — same fan-out formula
 * App.tsx uses), then persist via PUT /api/settings on commit (pointer-up /
 * key-up). The ["settings"] query is shared with App + AppShell, so it is
 * invalidated after every write.
 */
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { DisplaySettings, SettingsResponse } from '../lib/api';
import { Icon } from './Icon';

/** Documented baselines from the handoff ("ship as defaults"). */
const FACTORY: DisplaySettings = {
  displayCut: 24,
  displayChroma: 2,
  displayCrt: 75,
  tickerEnabled: true,
};

/** Mirror of App.tsx's root-var fan-out so drags render instantly. */
function applyDisplayVars(s: Pick<DisplaySettings, 'displayCut' | 'displayChroma' | 'displayCrt'>) {
  const el = document.documentElement;
  el.style.setProperty('--cut', `${s.displayCut}px`);
  el.style.setProperty('--cut-sm', `${Math.round(s.displayCut * 0.56)}px`);
  el.style.setProperty('--chroma', `${s.displayChroma}px`);
  el.style.setProperty('--scan-a', String((s.displayCrt / 100) * 0.035));
  el.style.setProperty('--sweep-a', String((s.displayCrt / 100) * 0.14));
}

const SECTION_HEADER: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  letterSpacing: '0.26em',
  color: 'var(--text-dim)',
  textTransform: 'uppercase',
};

export function CalibrationView() {
  const qc = useQueryClient();

  const settingsQ = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<SettingsResponse>('/api/settings').then(r => r.settings),
  });

  // Local working copy: sliders bind here so dragging never waits on the
  // network. Seeded once from the server; refs let commit handlers read the
  // latest values without re-binding listeners.
  const [local, setLocal] = useState<DisplaySettings | null>(null);
  const localRef = useRef<DisplaySettings | null>(null);
  localRef.current = local;
  const committedRef = useRef<DisplaySettings | null>(null);

  useEffect(() => {
    if (settingsQ.data && localRef.current === null) {
      setLocal(settingsQ.data);
      committedRef.current = settingsQ.data;
    }
  }, [settingsQ.data]);

  const save = useMutation({
    mutationFn: (patch: Partial<DisplaySettings>) => api.put('/api/settings', patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });

  /** Slider drag: update local state + live-apply the root vars. */
  const tune = (patch: Partial<Pick<DisplaySettings, 'displayCut' | 'displayChroma' | 'displayCrt'>>) => {
    setLocal(prev => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      applyDisplayVars(next);
      return next;
    });
  };

  /** Commit (pointer-up / key-up / blur): persist the field if it changed. */
  const commit = (field: keyof DisplaySettings) => {
    const cur = localRef.current;
    const base = committedRef.current;
    if (!cur || !base || cur[field] === base[field]) return;
    committedRef.current = { ...base, [field]: cur[field] };
    // Keep the shared cache warm so App/AppShell readers stay in sync until
    // the invalidated refetch lands.
    qc.setQueryData<DisplaySettings>(['settings'], old => (old ? { ...old, [field]: cur[field] } : old));
    save.mutate({ [field]: cur[field] });
  };

  const setTicker = (on: boolean) => {
    const cur = localRef.current;
    if (!cur || cur.tickerEnabled === on) return;
    setLocal({ ...cur, tickerEnabled: on });
    committedRef.current = { ...(committedRef.current ?? cur), tickerEnabled: on };
    qc.setQueryData<DisplaySettings>(['settings'], old => (old ? { ...old, tickerEnabled: on } : old));
    save.mutate({ tickerEnabled: on });
  };

  const resetFactory = () => {
    setLocal(FACTORY);
    committedRef.current = FACTORY;
    applyDisplayVars(FACTORY);
    qc.setQueryData<DisplaySettings>(['settings'], old => (old ? { ...old, ...FACTORY } : old));
    save.mutate({ ...FACTORY });
  };

  if (settingsQ.isError) {
    return (
      <div className="panel" style={{ padding: 28, textAlign: 'center' }}>
        <span className="mono" style={{ fontSize: 12, letterSpacing: '0.2em', color: 'var(--red)' }}>
          CALIBRATION BUS OFFLINE — SETTINGS UNAVAILABLE
        </span>
      </div>
    );
  }
  if (!local) {
    return (
      <div className="panel" style={{ padding: 28, textAlign: 'center' }}>
        <span className="mono" style={{ fontSize: 12, letterSpacing: '0.2em', color: 'var(--text-faint)' }}>
          READING DISPLAY PROFILE…
        </span>
      </div>
    );
  }

  const { displayCut, displayChroma, displayCrt, tickerEnabled } = local;
  const cutSm = Math.round(displayCut * 0.56);
  const scanA = ((displayCrt / 100) * 0.035).toFixed(4);
  const sweepA = ((displayCrt / 100) * 0.14).toFixed(3);

  return (
    <div className="qm-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {/* ---- Header ---- */}
      <div className="panel hud" style={{ padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <div className="ncx-chip" style={{ width: 48, height: 48 }}>
          <Icon name="tv" size={22} style={{ color: 'var(--cyan)' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2
            className="ncx-chroma ncx-glitch"
            style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.02em' }}
          >
            Display Calibration
          </h2>
          <div style={{ ...SECTION_HEADER, marginTop: 5 }}>
            CRT CHARACTER · PERSISTED TO YOUR PROFILE
          </div>
        </div>
        <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
          <span className="ncx-serial">SYS-CAL-01</span>
          <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.18em', color: save.isPending ? 'var(--amber)' : 'var(--lime)' }}>
            {save.isPending ? '▴ WRITING…' : '● SYNCED'}
          </span>
        </div>
      </div>

      <div className="split-grid" style={{ display: 'grid', gridTemplateColumns: '1.15fr 0.85fr', gap: 16, alignItems: 'start' }}>
        {/* ---- Controls ---- */}
        <div className="ncx-panel">
          <div style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <span style={SECTION_HEADER}>TUNING PARAMETERS</span>
            <span className="ncx-serial">4 CHANNELS</span>
          </div>

          <KnobRow
            label="CORNER CUT"
            hint="PANEL CLIP GEOMETRY"
            value={displayCut}
            display={`${displayCut}px`}
            min={0}
            max={28}
            step={1}
            onChange={v => tune({ displayCut: v })}
            onCommit={() => commit('displayCut')}
          />
          <KnobRow
            label="CHROMA SPLIT"
            hint="DISPLAY-TYPE FRINGE"
            value={displayChroma}
            display={`${displayChroma}px`}
            min={0}
            max={4}
            step={0.5}
            onChange={v => tune({ displayChroma: v })}
            onCommit={() => commit('displayChroma')}
          />
          <KnobRow
            label="CRT INTENSITY"
            hint="SCANLINE + SWEEP"
            value={displayCrt}
            display={`${displayCrt}%`}
            min={0}
            max={100}
            step={1}
            onChange={v => tune({ displayCrt: v })}
            onCommit={() => commit('displayCrt')}
          />

          {/* Ticker: chamfered ON/OFF pair. The className flips primary ↔ plain,
              so each button is keyed by state — React remounts instead of
              morphing (verified stuck-transition pitfall). */}
          <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr 64px', gap: 14, alignItems: 'center', padding: '14px 18px', borderTop: '1px solid var(--line)' }}>
            <div>
              <div style={SECTION_HEADER}>HANDLER FEED</div>
              <div className="ncx-serial" style={{ marginTop: 4 }}>TODAY-PAGE HANDLER CARD</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                key={`ticker-on-${tickerEnabled ? 'p' : 'n'}`}
                type="button"
                className={tickerEnabled ? 'btn btn-primary' : 'btn'}
                style={{ padding: '8px 16px', fontSize: 11 }}
                aria-pressed={tickerEnabled}
                onClick={() => setTicker(true)}
              >
                ON
              </button>
              <button
                key={`ticker-off-${tickerEnabled ? 'n' : 'p'}`}
                type="button"
                className={tickerEnabled ? 'btn' : 'btn btn-primary'}
                style={{ padding: '8px 16px', fontSize: 11 }}
                aria-pressed={!tickerEnabled}
                onClick={() => setTicker(false)}
              >
                OFF
              </button>
            </div>
            <span className="ncx-val mono" style={{ fontSize: 13, textAlign: 'right', color: tickerEnabled ? 'var(--cyan)' : 'var(--text-faint)' }}>
              {tickerEnabled ? 'LIVE' : 'MUTE'}
            </span>
          </div>

          <div style={{ padding: '14px 18px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span className="ncx-serial">
              CUT-SM {cutSm}PX · SCAN-A {scanA} · SWEEP-A {sweepA}
            </span>
            <button type="button" className="btn btn-ghost" style={{ padding: '8px 14px', fontSize: 11 }} onClick={resetFactory}>
              <Icon name="repeat" size={13} /> RESET TO FACTORY
            </button>
          </div>
        </div>

        {/* ---- Live preview: a test pattern exercising every knob ---- */}
        <div className="ncx-panel focal ncx-scan">
          <div className="sweep" />
          <div style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--line)' }}>
            <span style={SECTION_HEADER}>LIVE PREVIEW</span>
            <span className="ncx-serial">CAL-TEST-PATTERN</span>
          </div>
          <div style={{ padding: '20px 22px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div
                className="ncx-chroma"
                style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.02em' }}
              >
                Questman.OS
              </div>
              <span className="ncx-stamp medium">SIGNAL</span>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                <span style={SECTION_HEADER}>CRT INTENSITY</span>
                <span className="ncx-val mono" style={{ fontSize: 12, color: 'var(--cyan)' }}>{displayCrt}/100</span>
              </div>
              <div className="ncx-bar">
                <i
                  style={{
                    width: `${displayCrt}%`,
                    background: 'linear-gradient(90deg, var(--cyan-deep), var(--cyan))',
                    boxShadow: '0 0 12px rgba(var(--accent-rgb),0.5)',
                  }}
                />
                <span className="seg-mask" />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="btn btn-primary" style={{ padding: '9px 16px', fontSize: 11 }}>
                <Icon name="zap" size={13} /> PRIMARY
              </button>
              <button type="button" className="btn" style={{ padding: '9px 16px', fontSize: 11 }}>
                STANDARD
              </button>
            </div>

            <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.18em', color: 'var(--text-ghost)' }}>
              PANEL CLIP · CHROMA FRINGE · SWEEP RESPOND LIVE
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** One slider channel: kicker label + native range + mono readout. */
function KnobRow(props: {
  label: string;
  hint: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  onCommit: () => void;
}) {
  const { label, hint, value, display, min, max, step, onChange, onCommit } = props;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr 64px', gap: 14, alignItems: 'center', padding: '14px 18px', borderTop: '1px solid var(--line)' }}>
      <div>
        <div style={SECTION_HEADER}>{label}</div>
        <div className="ncx-serial" style={{ marginTop: 4 }}>{hint}</div>
      </div>
      {/* Native range, minimally styled — accent-color + dark color-scheme;
          commit persists on pointer-up / key-up / blur. */}
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        onBlur={onCommit}
        style={{ width: '100%', accentColor: 'var(--cyan)', colorScheme: 'dark', background: 'transparent' }}
      />
      <span className="ncx-val mono" style={{ fontSize: 14, textAlign: 'right', color: 'var(--cyan)' }}>{display}</span>
    </div>
  );
}
