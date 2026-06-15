/**
 * AiCalibration — SYS // CALIBRATION's AI panel (the "neural governor").
 *
 * Questman's AI layer is flavor, never load-bearing — this panel is where the
 * user decides exactly how much of it runs and what it may see:
 *
 *   - MASTER BREAKER: aiEnabled. Off = zero LLM calls anywhere; every AI
 *     feature degrades to its deterministic path.
 *   - SUBSYSTEMS: the Handler (daily rundown + weekly debrief) and Quest
 *     Synthesis (AI-selected + themed daily missions).
 *   - DATA ACCESS GRANTS: per-domain consent — Vault (finance), Biometrics
 *     (vitals + workouts), Contacts (social). Revoked domains are never sent
 *     to the model; their quests still generate deterministically.
 *   - PROVIDER & BUDGET: Anthropic cloud (with per-tier model overrides) or
 *     a local Ollama node (URL + model), plus the daily token cap.
 *
 * Persistence mirrors CalibrationView: shared ["settings"] query, instant
 * commits for toggles/selects, blur/Enter commits for text + number fields.
 */
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { AiSettings, AppSettings, SettingsResponse } from '../lib/api';
import { getSocket } from '../lib/socket';
import { Icon } from './Icon';

const SECTION_HEADER: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  letterSpacing: '0.26em',
  color: 'var(--text-dim)',
  textTransform: 'uppercase',
};

const ROW: CSSProperties = {
  display: 'grid',
  // Flexible label column (min 0 so it contains its own text instead of sliding
  // the subtext under the controls), controls sized to content, fixed readout.
  gridTemplateColumns: 'minmax(0, 1fr) auto 64px',
  gap: 14,
  alignItems: 'center',
  padding: '14px 18px',
  borderTop: '1px solid var(--line)',
};

/** The label + subtext cell — minWidth:0 lets it shrink within its grid track,
 *  and the hint wraps instead of overflowing into the control column. */
const ROW_LABEL: CSSProperties = { minWidth: 0 };
const ROW_HINT: CSSProperties = { marginTop: 4, whiteSpace: 'normal', lineHeight: 1.4 };

const INPUT: CSSProperties = {
  width: '100%',
  background: 'transparent',
  border: '1px solid var(--line)',
  color: 'var(--text)',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  padding: '8px 10px',
  colorScheme: 'dark',
};

/** Curated cloud picks; the server defaults live in backend config. */
const CLOUD_MODELS = [
  { id: 'claude-opus-4-8', label: 'OPUS 4.8 — FLAGSHIP' },
  { id: 'claude-sonnet-4-6', label: 'SONNET 4.6 — BALANCED' },
  { id: 'claude-haiku-4-5', label: 'HAIKU 4.5 — FAST + CHEAP' },
];

/** The editable AI fields (excludes the server-computed status fields). */
type AiPatch = Partial<Omit<AiSettings, 'aiCloudKey' | 'aiTokensUsedToday'>>;

export function AiCalibrationPanel() {
  const qc = useQueryClient();

  const settingsQ = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<SettingsResponse>('/api/settings').then(r => r.settings),
  });

  // Local working copy (same pattern as CalibrationView): seeded once so
  // typing in a field never fights a refetch.
  const [local, setLocal] = useState<AppSettings | null>(null);
  const localRef = useRef<AppSettings | null>(null);
  localRef.current = local;
  const committedRef = useRef<AppSettings | null>(null);

  useEffect(() => {
    if (settingsQ.data && localRef.current === null) {
      setLocal(settingsQ.data);
      committedRef.current = settingsQ.data;
    }
  }, [settingsQ.data]);

  // Generating a rundown / debrief / handler line can burn AI tokens, so
  // refetch settings on those socket events to keep the BURNED TODAY meter
  // (read live from settingsQ.data below) honest.
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const refresh = () => qc.invalidateQueries({ queryKey: ['settings'] });
    const evts = ['handler-message', 'daily-generated', 'weekly-debrief'];
    evts.forEach(e => s.on(e, refresh));
    return () => evts.forEach(e => s.off(e, refresh));
  }, [qc]);

  const save = useMutation({
    mutationFn: (patch: AiPatch) => api.put('/api/settings', patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });

  /** Toggles/selects: apply locally + persist in one step. */
  const apply = (patch: AiPatch) => {
    setLocal(prev => (prev ? { ...prev, ...patch } : prev));
    committedRef.current = committedRef.current ? { ...committedRef.current, ...patch } : committedRef.current;
    qc.setQueryData<AppSettings>(['settings'], old => (old ? { ...old, ...patch } : old));
    save.mutate(patch);
  };

  /** Text/number fields: edit locally, commit on blur/Enter if changed. */
  const tune = (patch: AiPatch) => setLocal(prev => (prev ? { ...prev, ...patch } : prev));
  const commit = (field: keyof AiPatch) => {
    const cur = localRef.current;
    const base = committedRef.current;
    if (!cur || !base || cur[field] === base[field]) return;
    apply({ [field]: cur[field] } as AiPatch);
  };

  if (settingsQ.isError || !local) return null; // CalibrationView renders the bus-offline / loading states

  const cap = local.aiDailyTokenCap;
  // Read-only counter — take it live from the query (refreshed on AI socket
  // events) rather than the seeded-once local copy so the meter isn't stale.
  const used = settingsQ.data?.aiTokensUsedToday ?? local.aiTokensUsedToday;
  const usedPct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  const cloud = local.aiProvider === 'anthropic';
  const cloudOffline = cloud && !local.aiCloudKey;

  const dimWhenOff: CSSProperties = local.aiEnabled
    ? {}
    : { opacity: 0.4, pointerEvents: 'none', filter: 'saturate(0.4)' };

  return (
    <>
      {/* ---- Header ---- */}
      <div className="panel hud" style={{ padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <div className="ncx-chip" style={{ width: 48, height: 48 }}>
          <Icon name="eye" size={22} style={{ color: 'var(--cyan)' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2
            className="ncx-chroma ncx-glitch"
            style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.02em' }}
          >
            AI Calibration
          </h2>
          <div style={{ ...SECTION_HEADER, marginTop: 5 }}>
            NEURAL GOVERNOR · YOU DECIDE WHAT THE AI DOES — AND WHAT IT SEES
          </div>
        </div>
        <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
          <span className="ncx-serial">SYS-CAL-AI</span>
          <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.18em', color: save.isPending ? 'var(--amber)' : 'var(--lime)' }}>
            {save.isPending ? '▴ WRITING…' : '● SYNCED'}
          </span>
        </div>
      </div>

      <div className="split-grid" style={{ display: 'grid', gridTemplateColumns: '1.05fr 0.95fr', gap: 16, alignItems: 'start' }}>
        {/* ---- Left: master breaker + subsystems + data grants ---- */}
        <div className="ncx-panel">
          <div style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <span style={SECTION_HEADER}>CONTROL PLANE</span>
            <span className="ncx-serial">{local.aiEnabled ? 'AI ENGAGED' : 'AI SEVERED'}</span>
          </div>

          <ToggleRow
            label="AI SYSTEMS"
            hint="MASTER BREAKER · ALL LLM CALLS"
            on={local.aiEnabled}
            readoutOn="LIVE"
            readoutOff="CUT"
            onSet={v => apply({ aiEnabled: v })}
          />

          <div style={dimWhenOff}>
            <SubHeader label="SUBSYSTEMS" serial="2 UNITS" />
            <ToggleRow
              label="HANDLER UPLINK"
              hint="DAILY RUNDOWN + WEEKLY DEBRIEF"
              on={local.handlerEnabled}
              onSet={v => apply({ handlerEnabled: v })}
            />
            <ToggleRow
              label="QUEST SYNTHESIS"
              hint="AI-PICKED + THEMED MISSIONS"
              on={local.aiQuestsEnabled}
              onSet={v => apply({ aiQuestsEnabled: v })}
            />

            <SubHeader label="DATA ACCESS GRANTS" serial="PER-DOMAIN CONSENT" />
            <ToggleRow
              label="VAULT"
              hint="FINANCIALS · SPEND / BUDGETS / BILLS"
              on={local.aiAccessFinance}
              readoutOn="OPEN"
              readoutOff="SEALED"
              onSet={v => apply({ aiAccessFinance: v })}
            />
            <ToggleRow
              label="BIOMETRICS"
              hint="VITALS + WORKOUTS"
              on={local.aiAccessHealth}
              readoutOn="OPEN"
              readoutOff="SEALED"
              onSet={v => apply({ aiAccessHealth: v })}
            />
            <ToggleRow
              label="CONTACTS"
              hint="SOCIAL · NPC ROSTER"
              on={local.aiAccessSocial}
              readoutOn="OPEN"
              readoutOff="SEALED"
              onSet={v => apply({ aiAccessSocial: v })}
            />
            <ToggleRow
              label="GRID SCHEDULE"
              hint="CALENDAR · COUNTS + FREE/BUSY ONLY"
              on={local.aiAccessCalendar}
              readoutOn="OPEN"
              readoutOff="SEALED"
              onSet={v => apply({ aiAccessCalendar: v })}
            />

            <div style={{ padding: '12px 18px', borderTop: '1px solid var(--line)' }}>
              <span className="ncx-serial">
                SEALED DOMAINS ARE NEVER SENT TO ANY MODEL · THEIR QUESTS STILL GENERATE, UNTHEMED
              </span>
            </div>
          </div>
        </div>

        {/* ---- Right: provider, models, daily token budget ---- */}
        <div className="ncx-panel" style={dimWhenOff}>
          <div style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <span style={SECTION_HEADER}>PROVIDER &amp; BUDGET</span>
            <span className="ncx-serial">{cloud ? 'UPLINK: ANTHROPIC' : 'UPLINK: LOCAL NODE'}</span>
          </div>

          {/* Provider pair — same keyed ON/OFF pattern as the ticker toggle. */}
          <div style={ROW}>
            <div>
              <div style={SECTION_HEADER}>UPLINK</div>
              <div className="ncx-serial" style={{ marginTop: 4 }}>WHERE INFERENCE RUNS</div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                key={`prov-cloud-${cloud ? 'p' : 'n'}`}
                type="button"
                className={cloud ? 'btn btn-primary' : 'btn'}
                style={{ padding: '8px 14px', fontSize: 11 }}
                aria-pressed={cloud}
                onClick={() => apply({ aiProvider: 'anthropic' })}
              >
                CLOUD
              </button>
              <button
                key={`prov-local-${cloud ? 'n' : 'p'}`}
                type="button"
                className={cloud ? 'btn' : 'btn btn-primary'}
                style={{ padding: '8px 14px', fontSize: 11 }}
                aria-pressed={!cloud}
                onClick={() => apply({ aiProvider: 'ollama' })}
              >
                OLLAMA
              </button>
            </div>
            <span className="ncx-val mono" style={{ fontSize: 11, textAlign: 'right', color: cloudOffline ? 'var(--red)' : 'var(--cyan)' }}>
              {cloud ? (cloudOffline ? 'NO KEY' : 'KEYED') : 'LOCAL'}
            </span>
          </div>

          {cloud ? (
            <>
              <SelectRow
                label="QUEST MODEL"
                hint="MISSION SYNTHESIS TIER"
                value={local.aiModelQuests ?? ''}
                defaultLabel="SERVER DEFAULT (OPUS 4.8)"
                onChange={v => apply({ aiModelQuests: v || null })}
              />
              <SelectRow
                label="HANDLER MODEL"
                hint="RUNDOWN + DEBRIEF TIER"
                value={local.aiModelHandler ?? ''}
                defaultLabel="SERVER DEFAULT (HAIKU 4.5)"
                onChange={v => apply({ aiModelHandler: v || null })}
              />
              {cloudOffline && (
                <div style={{ padding: '12px 18px', borderTop: '1px solid var(--line)' }}>
                  <span className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--red)' }}>
                    ⚠ NO ANTHROPIC_API_KEY ON THE SERVER — CLOUD AI OFFLINE, DETERMINISTIC MODE
                  </span>
                </div>
              )}
            </>
          ) : (
            <>
              <div style={ROW}>
                <div>
                  <div style={SECTION_HEADER}>NODE URL</div>
                  <div className="ncx-serial" style={{ marginTop: 4 }}>OLLAMA ENDPOINT</div>
                </div>
                <input
                  type="url"
                  aria-label="Ollama URL"
                  value={local.ollamaUrl}
                  placeholder="http://localhost:11434"
                  style={INPUT}
                  onChange={e => tune({ ollamaUrl: e.target.value })}
                  onBlur={() => commit('ollamaUrl')}
                  onKeyUp={e => e.key === 'Enter' && commit('ollamaUrl')}
                />
                <span />
              </div>
              <div style={ROW}>
                <div>
                  <div style={SECTION_HEADER}>LOCAL MODEL</div>
                  <div className="ncx-serial" style={{ marginTop: 4 }}>E.G. LLAMA3.1 · QWEN3</div>
                </div>
                <input
                  type="text"
                  aria-label="Ollama model"
                  value={local.ollamaModel}
                  placeholder="llama3.1"
                  style={INPUT}
                  onChange={e => tune({ ollamaModel: e.target.value })}
                  onBlur={() => commit('ollamaModel')}
                  onKeyUp={e => e.key === 'Enter' && commit('ollamaModel')}
                />
                <span />
              </div>
              <div style={{ padding: '12px 18px', borderTop: '1px solid var(--line)' }}>
                <span className="ncx-serial">
                  RUNS FULLY OFF-GRID · NOTHING LEAVES YOUR NETWORK
                </span>
              </div>
            </>
          )}

          <SubHeader label="DAILY TOKEN BUDGET" serial={cap > 0 ? `${cap.toLocaleString()} / DAY` : 'UNCAPPED'} />
          <div style={ROW}>
            <div>
              <div style={SECTION_HEADER}>TOKEN CAP</div>
              <div className="ncx-serial" style={{ marginTop: 4 }}>0 = UNLIMITED</div>
            </div>
            <input
              type="number"
              aria-label="Daily token cap"
              min={0}
              max={10_000_000}
              step={1000}
              value={cap}
              style={INPUT}
              onChange={e => tune({ aiDailyTokenCap: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
              onBlur={() => commit('aiDailyTokenCap')}
              onKeyUp={e => e.key === 'Enter' && commit('aiDailyTokenCap')}
            />
            <span className="ncx-val mono" style={{ fontSize: 11, textAlign: 'right', color: 'var(--text-dim)' }}>TKN</span>
          </div>

          <div style={{ padding: '14px 18px', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={SECTION_HEADER}>BURNED TODAY</span>
              <span className="ncx-val mono" style={{ fontSize: 12, color: usedPct >= 100 ? 'var(--red)' : usedPct >= 80 ? 'var(--amber)' : 'var(--cyan)' }}>
                {used.toLocaleString()}{cap > 0 ? ` / ${cap.toLocaleString()}` : ' TKN'}
              </span>
            </div>
            {cap > 0 && (
              <div className="ncx-bar">
                <i
                  style={{
                    width: `${usedPct}%`,
                    background: usedPct >= 100
                      ? 'var(--red)'
                      : 'linear-gradient(90deg, var(--cyan-deep), var(--cyan))',
                    boxShadow: '0 0 12px rgba(var(--accent-rgb),0.5)',
                  }}
                />
                <span className="seg-mask" />
              </div>
            )}
            <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.18em', color: 'var(--text-ghost)' }}>
              CAP REACHED → AI YIELDS TO DETERMINISTIC MODE UNTIL MIDNIGHT
            </span>
          </div>
        </div>
      </div>
    </>
  );
}

/** Section divider row inside an ncx-panel. */
function SubHeader({ label, serial }: { label: string; serial?: string }) {
  return (
    <div style={{ padding: '14px 18px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, borderTop: '1px solid var(--line)' }}>
      <span style={SECTION_HEADER}>{label}</span>
      {serial && <span className="ncx-serial">{serial}</span>}
    </div>
  );
}

/**
 * Chamfered ON/OFF pair (same keyed-remount pattern as the ticker toggle —
 * className flips primary ↔ plain, key forces a remount instead of a morph).
 */
function ToggleRow(props: {
  label: string;
  hint: string;
  on: boolean;
  onSet: (v: boolean) => void;
  readoutOn?: string;
  readoutOff?: string;
}) {
  const { label, hint, on, onSet, readoutOn = 'LIVE', readoutOff = 'MUTE' } = props;
  return (
    <div style={ROW}>
      <div style={ROW_LABEL}>
        <div style={SECTION_HEADER}>{label}</div>
        <div className="ncx-serial" style={ROW_HINT}>{hint}</div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          key={`${label}-on-${on ? 'p' : 'n'}`}
          type="button"
          className={on ? 'btn btn-primary' : 'btn'}
          style={{ padding: '8px 16px', fontSize: 11 }}
          aria-pressed={on}
          onClick={() => !on && onSet(true)}
        >
          ON
        </button>
        <button
          key={`${label}-off-${on ? 'n' : 'p'}`}
          type="button"
          className={on ? 'btn' : 'btn btn-primary'}
          style={{ padding: '8px 16px', fontSize: 11 }}
          aria-pressed={!on}
          onClick={() => on && onSet(false)}
        >
          OFF
        </button>
      </div>
      <span className="ncx-val mono" style={{ fontSize: 12, textAlign: 'right', color: on ? 'var(--cyan)' : 'var(--text-faint)' }}>
        {on ? readoutOn : readoutOff}
      </span>
    </div>
  );
}

/** Labeled native select for the cloud model overrides. */
function SelectRow(props: {
  label: string;
  hint: string;
  value: string;
  defaultLabel: string;
  onChange: (v: string) => void;
}) {
  const { label, hint, value, defaultLabel, onChange } = props;
  return (
    <div style={ROW}>
      <div style={ROW_LABEL}>
        <div style={SECTION_HEADER}>{label}</div>
        <div className="ncx-serial" style={ROW_HINT}>{hint}</div>
      </div>
      <select
        aria-label={label}
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ ...INPUT, appearance: 'auto', minWidth: 170 }}
      >
        <option value="">{defaultLabel}</option>
        {CLOUD_MODELS.map(m => (
          <option key={m.id} value={m.id}>{m.label}</option>
        ))}
      </select>
      <span />
    </div>
  );
}
