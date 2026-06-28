/**
 * IntegrationsPanel — "LOCATION, CALENDAR & HEALTH" section of SYS // CALIBRATION.
 *
 * These three integrations used to be GLOBAL server env values mapped to a
 * single hub user; they are now PER-USER (UserSettings) and editable here:
 *
 *   - LOCATION: latitude/longitude that feed the weather card + outdoor-quest
 *     gating. Both must be set to be "configured"; blank = no weather.
 *   - CALENDAR: private ICS feed URLs (comma- or newline-separated) for the
 *     Today agenda + day-planner busy time.
 *   - PHONE UPLINK: the phone's local Health Connect server URL/token the
 *     background poller GETs on your own cadence, plus the read-only per-user
 *     ingest token + secret URL the phone bridge POSTs to (managed like an
 *     API key — rotate to revoke).
 *
 * Persistence mirrors AiCalibration: a shared ["settings"] query, blur/Enter
 * commits for text + number fields, and a refetch after every write.
 */
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { AppSettings, SettingsResponse } from '../lib/api';
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
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  gap: 14,
  alignItems: 'center',
  padding: '14px 18px',
  borderTop: '1px solid var(--line)',
};

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

/** The subset of fields editable here (ingestToken/ingestUrl are read-only). */
type IntegrationPatch = Partial<Pick<AppSettings,
  'weatherLat' | 'weatherLon' | 'calendarIcsUrls' | 'healthPullUrl' |
  'healthPullToken' | 'healthPullMinutes' | 'healthBackfillDays'>>;

/** Input-friendly working copy (strings so a half-typed field never fights a
 *  refetch and empty means "unset / null"). */
interface FormState {
  weatherLat: string;
  weatherLon: string;
  icsText: string;
  healthPullUrl: string;
  healthPullToken: string;
  healthPullMinutes: number;
  healthBackfillDays: number;
}

/** Stored comma-separated → one-per-line for the textarea. */
function icsToText(raw: string | null): string {
  return (raw ?? '').split(',').map(s => s.trim()).filter(Boolean).join('\n');
}
/** Textarea (comma- or newline-separated) → stored comma-separated (null if empty). */
function textToIcs(text: string): string | null {
  const list = text.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
  return list.length ? list.join(',') : null;
}

function toForm(s: AppSettings): FormState {
  return {
    weatherLat: s.weatherLat != null ? String(s.weatherLat) : '',
    weatherLon: s.weatherLon != null ? String(s.weatherLon) : '',
    icsText: icsToText(s.calendarIcsUrls),
    healthPullUrl: s.healthPullUrl ?? '',
    healthPullToken: s.healthPullToken ?? '',
    healthPullMinutes: s.healthPullMinutes ?? 30,
    healthBackfillDays: s.healthBackfillDays ?? 365,
  };
}

export function IntegrationsPanel() {
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);

  const settingsQ = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<SettingsResponse>('/api/settings').then(r => r.settings),
  });

  // Seed the working copy once (same pattern as AiCalibration).
  const [form, setForm] = useState<FormState | null>(null);
  const formRef = useRef<FormState | null>(null);
  formRef.current = form;

  useEffect(() => {
    if (settingsQ.data && formRef.current === null) setForm(toForm(settingsQ.data));
  }, [settingsQ.data]);

  const save = useMutation({
    mutationFn: (patch: IntegrationPatch) => api.put('/api/settings', patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });

  const rotate = useMutation({
    mutationFn: () => api.post<SettingsResponse>('/api/settings/ingest-token'),
    onSuccess: () => { setCopied(false); qc.invalidateQueries({ queryKey: ['settings'] }); },
  });

  if (settingsQ.isError || !form) return null; // CalibrationView owns the bus-offline / loading UI

  const s = settingsQ.data!;
  const tune = (patch: Partial<FormState>) => setForm(prev => (prev ? { ...prev, ...patch } : prev));

  /** Persist a field if it actually changed against the last server value. */
  const persist = (patch: IntegrationPatch) => save.mutate(patch);

  const commitCoord = (field: 'weatherLat' | 'weatherLon') => {
    const raw = (formRef.current?.[field] ?? '').trim();
    const next = raw === '' ? null : Number(raw);
    if (next !== null && !Number.isFinite(next)) return; // ignore garbage; leave field as-is
    if ((s[field] ?? null) === next) return;
    persist({ [field]: next } as IntegrationPatch);
  };

  const commitIcs = () => {
    const next = textToIcs(formRef.current?.icsText ?? '');
    if ((s.calendarIcsUrls ?? null) === next) return;
    persist({ calendarIcsUrls: next });
  };

  const commitText = (field: 'healthPullUrl' | 'healthPullToken') => {
    const raw = (formRef.current?.[field] ?? '').trim();
    const next = raw === '' ? null : raw;
    if ((s[field] ?? null) === next) return;
    persist({ [field]: next } as IntegrationPatch);
  };

  const commitInt = (field: 'healthPullMinutes' | 'healthBackfillDays', min: number, max: number) => {
    const val = formRef.current?.[field] ?? min;
    const next = Math.max(min, Math.min(max, Math.round(Number(val) || min)));
    if (s[field] === next) return;
    persist({ [field]: next } as IntegrationPatch);
  };

  const copyUrl = async () => {
    if (!s.ingestUrl) return;
    try {
      await navigator.clipboard.writeText(s.ingestUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch { /* clipboard unavailable */ }
  };

  const locConfigured = s.weatherLat != null && s.weatherLon != null;
  const calConfigured = !!s.calendarIcsUrls;
  const healthConfigured = !!s.healthPullUrl;

  return (
    <div className="ncx-panel">
      {/* ---- Header ---- */}
      <div style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <span style={SECTION_HEADER}>LOCATION · CALENDAR · HEALTH</span>
        <span className="ncx-serial" style={{ color: save.isPending || rotate.isPending ? 'var(--amber)' : 'var(--lime)' }}>
          {save.isPending || rotate.isPending ? '▴ WRITING…' : '● SYNCED'}
        </span>
      </div>

      {/* ---- Location ---- */}
      <div style={{ padding: '12px 18px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, borderTop: '1px solid var(--line)' }}>
        <span style={SECTION_HEADER}>LOCATION</span>
        <span className="ncx-serial" style={{ color: locConfigured ? 'var(--cyan)' : 'var(--text-ghost)' }}>
          {locConfigured ? 'WEATHER LIVE' : 'NO COORDS'}
        </span>
      </div>
      <div style={ROW}>
        <div style={ROW_LABEL}>
          <div style={SECTION_HEADER}>LATITUDE</div>
          <div className="ncx-serial" style={ROW_HINT}>-90 … 90 · BLANK = NO WEATHER</div>
        </div>
        <input
          type="number" inputMode="decimal" step="any" min={-90} max={90}
          aria-label="Latitude"
          value={form.weatherLat}
          placeholder="47.61"
          style={{ ...INPUT, width: 160 }}
          onChange={e => tune({ weatherLat: e.target.value })}
          onBlur={() => commitCoord('weatherLat')}
          onKeyUp={e => e.key === 'Enter' && commitCoord('weatherLat')}
        />
      </div>
      <div style={ROW}>
        <div style={ROW_LABEL}>
          <div style={SECTION_HEADER}>LONGITUDE</div>
          <div className="ncx-serial" style={ROW_HINT}>-180 … 180</div>
        </div>
        <input
          type="number" inputMode="decimal" step="any" min={-180} max={180}
          aria-label="Longitude"
          value={form.weatherLon}
          placeholder="-122.33"
          style={{ ...INPUT, width: 160 }}
          onChange={e => tune({ weatherLon: e.target.value })}
          onBlur={() => commitCoord('weatherLon')}
          onKeyUp={e => e.key === 'Enter' && commitCoord('weatherLon')}
        />
      </div>

      {/* ---- Calendar ---- */}
      <div style={{ padding: '14px 18px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, borderTop: '1px solid var(--line)' }}>
        <span style={SECTION_HEADER}>CALENDAR FEEDS</span>
        <span className="ncx-serial" style={{ color: calConfigured ? 'var(--cyan)' : 'var(--text-ghost)' }}>
          {calConfigured ? 'AGENDA LIVE' : 'NO FEEDS'}
        </span>
      </div>
      <div style={{ padding: '14px 18px', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={SECTION_HEADER}>PRIVATE ICS URLS</div>
        <div className="ncx-serial">ONE PER LINE (OR COMMA-SEPARATED) · E.G. GOOGLE "SECRET ADDRESS IN ICAL FORMAT"</div>
        <textarea
          aria-label="Calendar ICS URLs"
          value={form.icsText}
          placeholder={'https://calendar.google.com/…/basic.ics'}
          rows={3}
          style={{ ...INPUT, resize: 'vertical', minHeight: 64 }}
          onChange={e => tune({ icsText: e.target.value })}
          onBlur={commitIcs}
        />
      </div>

      {/* ---- Phone uplink: pull config ---- */}
      <div style={{ padding: '14px 18px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, borderTop: '1px solid var(--line)' }}>
        <span style={SECTION_HEADER}>PHONE UPLINK · PULL</span>
        <span className="ncx-serial" style={{ color: healthConfigured ? 'var(--cyan)' : 'var(--text-ghost)' }}>
          {healthConfigured ? 'POLLING' : 'OFF'}
        </span>
      </div>
      <div style={{ padding: '14px 18px', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={SECTION_HEADER}>LOCAL SERVER URL</div>
        <div className="ncx-serial">THE HEALTH-CONNECT APP'S LAN HTTP SERVER · E.G. http://192.168.0.42:8787</div>
        <input
          type="url"
          aria-label="Health pull URL"
          value={form.healthPullUrl}
          placeholder="http://192.168.0.42:8787"
          style={INPUT}
          onChange={e => tune({ healthPullUrl: e.target.value })}
          onBlur={() => commitText('healthPullUrl')}
          onKeyUp={e => e.key === 'Enter' && commitText('healthPullUrl')}
        />
      </div>
      <div style={{ padding: '14px 18px', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={SECTION_HEADER}>LOCAL SERVER TOKEN</div>
        <div className="ncx-serial">OPTIONAL BEARER FOR THE PHONE'S "LOCAL HTTP AUTH" · BLANK = NONE</div>
        <input
          type="password"
          aria-label="Health pull token"
          value={form.healthPullToken}
          placeholder="(none)"
          autoComplete="off"
          style={INPUT}
          onChange={e => tune({ healthPullToken: e.target.value })}
          onBlur={() => commitText('healthPullToken')}
          onKeyUp={e => e.key === 'Enter' && commitText('healthPullToken')}
        />
      </div>
      <div style={ROW}>
        <div style={ROW_LABEL}>
          <div style={SECTION_HEADER}>POLL INTERVAL</div>
          <div className="ncx-serial" style={ROW_HINT}>MINUTES BETWEEN PULLS · MIN 5</div>
        </div>
        <input
          type="number" min={5} max={1440} step={5}
          aria-label="Poll interval minutes"
          value={form.healthPullMinutes}
          style={{ ...INPUT, width: 110 }}
          onChange={e => tune({ healthPullMinutes: Math.max(5, Math.floor(Number(e.target.value) || 5)) })}
          onBlur={() => commitInt('healthPullMinutes', 5, 1440)}
          onKeyUp={e => e.key === 'Enter' && commitInt('healthPullMinutes', 5, 1440)}
        />
      </div>
      <div style={ROW}>
        <div style={ROW_LABEL}>
          <div style={SECTION_HEADER}>BACKFILL WINDOW</div>
          <div className="ncx-serial" style={ROW_HINT}>DAYS OF HISTORY ON FIRST PULL · 2 … 3650</div>
        </div>
        <input
          type="number" min={2} max={3650} step={1}
          aria-label="Backfill days"
          value={form.healthBackfillDays}
          style={{ ...INPUT, width: 110 }}
          onChange={e => tune({ healthBackfillDays: Math.max(2, Math.floor(Number(e.target.value) || 2)) })}
          onBlur={() => commitInt('healthBackfillDays', 2, 3650)}
          onKeyUp={e => e.key === 'Enter' && commitInt('healthBackfillDays', 2, 3650)}
        />
      </div>

      {/* ---- Phone uplink: push (ingest secret URL) ---- */}
      <div style={{ padding: '14px 18px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, borderTop: '1px solid var(--line)' }}>
        <span style={SECTION_HEADER}>PHONE UPLINK · PUSH (INGEST)</span>
        <span className="ncx-serial" style={{ color: s.ingestToken ? 'var(--lime)' : 'var(--text-ghost)' }}>
          {s.ingestToken ? '● TOKEN ACTIVE' : '○ NO TOKEN'}
        </span>
      </div>
      <div style={{ padding: '12px 18px', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={SECTION_HEADER}>SECRET INGEST URL — PASTE INTO YOUR PHONE BRIDGE</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <code
            className="mono"
            style={{
              flex: 1, minWidth: 0, fontSize: 12, wordBreak: 'break-all',
              background: 'var(--bg-panel)', border: '1px solid var(--line)',
              padding: '8px 10px', color: 'var(--text)', userSelect: 'all',
            }}
          >
            {s.ingestUrl ?? '(no token)'}
          </code>
          <button
            type="button"
            className={`btn${copied ? ' btn-primary' : ''}`}
            style={{ padding: '8px 14px', fontSize: 11, flexShrink: 0 }}
            disabled={!s.ingestUrl}
            onClick={copyUrl}
          >
            <Icon name={copied ? 'check' : 'copy'} size={13} />
            {copied ? 'COPIED' : 'COPY'}
          </button>
        </div>
        <div className="ncx-serial">
          TREAT LIKE A PASSWORD · ANYONE WITH THIS URL CAN WRITE YOUR VITALS · ROTATE TO REVOKE
        </div>
      </div>
      <div style={{ padding: '12px 18px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="btn"
          style={{ padding: '8px 16px', fontSize: 11, color: 'var(--amber)', borderColor: 'var(--amber)' }}
          disabled={rotate.isPending}
          onClick={() => rotate.mutate()}
        >
          <Icon name="repeat" size={13} /> {s.ingestToken ? 'ROTATE TOKEN' : 'GENERATE TOKEN'}
        </button>
      </div>

      {save.isError && (
        <div style={{ padding: '8px 18px', borderTop: '1px solid var(--line)' }}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--red)' }}>
            {(save.error as Error)?.message ?? 'Save failed'}
          </span>
        </div>
      )}
    </div>
  );
}
