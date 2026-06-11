/**
 * BossesView — "ACTIVE TARGETS" dossiers (NIGHT CITY direction).
 *
 * Big goals rendered as bosses with a segmented HP meter: grind down
 * (debt/project/challenge — bar shows HP left and drains toward 0) or charge
 * up (savings — bar fills toward the target). Deal manual damage (log a
 * payment / progress / contribution with a user-typed amount) or let a linked
 * project's milestones chip it down. Hits do NOT award XP — the payout is
 * server-owned and lands on DEFEAT only, so a defeating hit pops the kill
 * overlay with the reward from the response and invalidates the player +
 * bosses queries to refresh the HUD.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Boss, BossKind, BossDirection, BossHitResponse, Project } from '../lib/api';
import { Icon } from './Icon';

const KIND_META: Record<BossKind, { label: string; color: string; icon: string }> = {
  debt:      { label: 'DEBT',      color: 'var(--red)',     icon: 'wallet' },
  savings:   { label: 'SAVINGS',   color: 'var(--lime)',    icon: 'shield' },
  project:   { label: 'PROJECT',   color: 'var(--violet)',  icon: 'grid' },
  challenge: { label: 'CHALLENGE', color: 'var(--magenta)', icon: 'flame' },
  custom:    { label: 'CUSTOM',    color: 'var(--cyan)',    icon: 'target' },
};

type Threat = 'LOW' | 'MED' | 'HIGH';
const THREAT_PIPS: Record<Threat, number> = { HIGH: 3, MED: 2, LOW: 1 };
const THREAT_PIP_COLOR: Record<Threat, string> = { HIGH: 'var(--red)', MED: 'var(--amber)', LOW: 'var(--teal)' };
const THREAT_LABEL_COLOR: Record<Threat, string> = { HIGH: 'var(--red)', MED: 'var(--amber)', LOW: 'var(--text-faint)' };

/** Threat derives from how much of the fight remains (boss.pct is 0–100 toward defeat). */
function threatOf(boss: Boss): Threat {
  if (boss.direction === 'grind_down') {
    const hpPct = 100 - boss.pct; // HP left
    return hpPct < 34 ? 'LOW' : hpPct < 67 ? 'MED' : 'HIGH';
  }
  const charged = boss.pct; // inverse for charge-up
  return charged < 34 ? 'HIGH' : charged < 67 ? 'MED' : 'LOW';
}

/** Action wording keyed by direction/kind. */
function actionVerb(direction: BossDirection, kind: BossKind): string {
  if (direction === 'charge_up') return 'CONTRIBUTE';
  return kind === 'debt' ? 'LOG PAYMENT' : 'LOG PROGRESS';
}

/** Format a value with an optional unit ("$" prefixes, others suffix). */
function fmt(value: number, unit: string | null): string {
  const n = Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (!unit) return n;
  return unit === '$' ? `$${n}` : `${n} ${unit}`;
}

/** MM.DD.YY — dossier date stamps. */
function fmtDate(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}.${p(d.getDate())}.${String(d.getFullYear()).slice(-2)}`;
}

export function BossesView() {
  const [creating, setCreating] = useState(false);
  const [kill, setKill] = useState<Boss | null>(null);

  const bossesQ = useQuery({
    queryKey: ['bosses'],
    queryFn: () => api.get<{ bosses: Boss[] }>('/api/bosses').then(r => r.bosses),
  });

  if (bossesQ.isLoading) return <Empty>SCANNING FOR TARGETS…</Empty>;
  if (bossesQ.isError) return <Empty color="var(--red)">FAILED TO LOAD</Empty>;

  const bosses = bossesQ.data ?? [];
  const active = bosses.filter(b => b.status === 'active');
  const down = bosses.filter(b => b.status === 'defeated');
  const abandoned = bosses.filter(b => b.status === 'abandoned');

  return (
    <div className="qm-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ---- header ---- */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div className="ncx-glitch ncx-chroma" style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 700, textTransform: 'uppercase' }}>
            ACTIVE TARGETS
          </div>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '0.24em', color: 'var(--text-faint)', marginTop: 4 }}>
            BIG GOALS · RENDERED AS BOSSES · DEAL DAMAGE WEEKLY
          </div>
        </div>
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-dim)', letterSpacing: '0.12em' }}>
          {active.length} ACTIVE · {down.length} DOWN
        </span>
        <button className="btn" onClick={() => setCreating(c => !c)}>
          <Icon name={creating ? 'close' : 'plus'} size={13} /> {creating ? 'CANCEL' : 'SPAWN'}
        </button>
      </div>

      {creating && <BossForm onClose={() => setCreating(false)} />}

      {active.map((b, idx) => (
        <Dossier key={b.id} boss={b} index={idx} focal={idx === 0} onDefeated={setKill} />
      ))}

      {bosses.length === 0 && !creating && (
        <Empty>NO TARGETS ON FILE — SPAWN A BIG GOAL AND START CHIPPING IT DOWN.</Empty>
      )}

      {(down.length > 0 || abandoned.length > 0) && (
        <div className="mono" style={{ fontSize: 10, letterSpacing: '0.26em', color: 'var(--text-dim)', textTransform: 'uppercase', marginTop: 6 }}>
          ARCHIVE — TARGETS DOWN
        </div>
      )}
      {down.map(b => <ArchiveRow key={b.id} boss={b} />)}
      {abandoned.map(b => <ArchiveRow key={b.id} boss={b} />)}

      {kill && <KillOverlay boss={kill} onClose={() => setKill(null)} />}
    </div>
  );
}

// ---- Active dossier --------------------------------------------------

function Dossier({
  boss, index, focal, onDefeated,
}: { boss: Boss; index: number; focal: boolean; onDefeated: (b: Boss) => void }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState<number | ''>('');
  const [note, setNote] = useState('');
  // Debt bosses log either a payment (damage) or the new remaining balance —
  // the server derives the delta from a balance, so the bar still ticks down.
  const balanceMode = boss.kind === 'debt' && boss.direction === 'grind_down';
  const [hitMode, setHitMode] = useState<'payment' | 'balance'>('payment');

  const meta = KIND_META[boss.kind];
  const accent = boss.color || meta.color;
  const threat = threatOf(boss);

  const hit = useMutation({
    mutationFn: (amt: number) =>
      api.post<BossHitResponse>(`/api/bosses/${boss.id}/hit`, {
        ...(balanceMode && hitMode === 'balance' ? { newBalance: amt } : { amount: amt }),
        note: note.trim() || null,
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['bosses'] });
      qc.invalidateQueries({ queryKey: ['player'] });
      qc.invalidateQueries({ queryKey: ['player', 'stats'] });
      setAmount('');
      setNote('');
      if (res.defeated) onDefeated(res.boss);
    },
  });

  const setStatus = useMutation({
    mutationFn: (status: 'active' | 'abandoned') => api.put(`/api/bosses/${boss.id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bosses'] }),
  });

  const remove = useMutation({
    mutationFn: () => api.del(`/api/bosses/${boss.id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bosses'] }),
  });

  // Balance mode accepts 0 (debt cleared → defeat); payment must be > 0.
  const isBalance = balanceMode && hitMode === 'balance';
  const canHit = amount !== '' && (isBalance ? amount >= 0 : amount > 0);
  const submit = () => {
    if (canHit) hit.mutate(amount as number);
  };

  // HP-bar fill semantics: grind_down shows HP left and drains toward 0;
  // charge_up fills toward the target. boss.pct is 0–100 toward defeat.
  const fillPct = Math.max(0, Math.min(100, boss.direction === 'grind_down' ? 100 - boss.pct : boss.pct));
  const logs = (boss.logs ?? []).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 2);
  const verb = isBalance ? 'SET BALANCE' : actionVerb(boss.direction, boss.kind);

  return (
    <div className="ncx-ticks">
      <span className="tick" style={{ top: -4, left: -4, color: focal ? 'var(--cyan)' : undefined }} />
      <span className="tick" style={{ bottom: -4, right: -4, color: focal ? 'var(--cyan)' : undefined }} />
      <div className={'ncx-panel' + (focal ? ' focal ncx-scan' : '')} style={{ padding: '18px 22px' }}>
        {focal && <div className="sweep" />}
        <div style={{ display: 'flex', gap: 20 }}>

          {/* threat block */}
          <div style={{ width: 86, flex: 'none', textAlign: 'center' }}>
            <div
              style={{
                width: 64, height: 64, margin: '0 auto',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                clipPath: 'polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)',
                background: `linear-gradient(160deg, color-mix(in srgb, ${accent} 38%, #0b0c16), #0b0c16)`,
                boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${accent} 50%, transparent)`,
                color: accent,
              }}
            >
              <Icon name={meta.icon} size={26} />
            </div>
            <div className="mono" style={{ fontSize: 9.5, letterSpacing: '0.2em', marginTop: 8, color: THREAT_LABEL_COLOR[threat] }}>
              THREAT {threat}
            </div>
            <div style={{ display: 'flex', gap: 2, justifyContent: 'center', marginTop: 4 }}>
              {[0, 1, 2].map(i => (
                <span key={i} style={{ width: 14, height: 4, background: i < THREAT_PIPS[threat] ? THREAT_PIP_COLOR[threat] : '#13152a' }} />
              ))}
            </div>
          </div>

          {/* dossier body */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span className="ncx-glitch" style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, letterSpacing: '0.02em', textTransform: 'uppercase' }}>
                {boss.name}
              </span>
              <span className="ncx-stamp flat" style={{ color: accent }}>{meta.label}</span>
              <span className="ncx-serial">TGT-{String(index + 1).padStart(3, '0')}</span>
              <span style={{ flex: 1 }} />
              <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>
                {boss.direction === 'charge_up' ? 'CHARGED ' : 'HP '}
                <b className="ncx-val" style={{ color: accent, fontSize: 17 }}>
                  {fmt(boss.direction === 'charge_up' ? boss.currentValue : boss.remaining, boss.unit)}
                </b>
                <span style={{ color: 'var(--text-faint)' }}> / {fmt(boss.targetValue, boss.unit)}</span>
              </span>
              <button
                className="btn btn-ghost"
                style={{ padding: '5px 7px' }}
                title="Delete boss"
                aria-label={`Delete ${boss.name}`}
                onClick={() => remove.mutate()}
              >
                <Icon name="close" size={13} />
              </button>
            </div>

            <div className="mono" style={{ fontSize: 10.5, letterSpacing: '0.1em', color: 'var(--text-dim)', margin: '6px 0 12px' }}>
              {boss.direction === 'grind_down' ? 'GRIND DOWN' : 'CHARGE UP'}
              {boss.linkedProjectId && ' · LINKED PROJECT — MILESTONES DEAL DAMAGE'}
              {(boss.xpReward > 0 || boss.eddieReward > 0) && (
                ` · KILL REWARD${boss.xpReward > 0 ? ` +${boss.xpReward.toLocaleString()} XP` : ''}${boss.eddieReward > 0 ? ` +€$${boss.eddieReward.toLocaleString()}` : ''}`
              )}
            </div>

            <div className="ncx-bar" style={{ height: 16 }}>
              <i
                style={{
                  width: `${fillPct}%`,
                  background: `linear-gradient(90deg, color-mix(in srgb, ${accent} 45%, transparent), ${accent})`,
                  boxShadow: `0 0 16px color-mix(in srgb, ${accent} 60%, transparent)`,
                }}
              />
              <span className="seg-mask" />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 11, flexWrap: 'wrap' }}>
              <span className="mono" style={{ fontSize: 10, color: accent, letterSpacing: '0.14em' }}>
                {Math.round(boss.pct)}% {boss.direction === 'charge_up' ? 'CHARGED' : 'DEFEATED'}
              </span>
              {logs.map(l => (
                <span key={l.id} className="mono" style={{ fontSize: 9.5, color: 'var(--text-faint)', letterSpacing: '0.08em' }}>
                  {fmtDate(l.createdAt)}{' '}
                  <span style={{ color: accent }}>
                    {/* negative grind_down amount = balance grew (newBalance log) — HP went UP */}
                    {(boss.direction === 'charge_up' ? '+' : l.amount < 0 ? '+' : '−') + fmt(Math.abs(l.amount), boss.unit)}
                  </span>
                  {l.note ? ` ${l.note}` : l.source === 'project_milestone' ? ' MILESTONE' : ''}
                </span>
              ))}
              <span style={{ flex: 1 }} />
              <button
                className="btn btn-ghost"
                style={{ fontSize: 9.5, padding: '4px 8px', color: 'var(--text-faint)' }}
                onClick={() => setStatus.mutate('abandoned')}
              >
                ABANDON
              </button>
              {balanceMode && (
                <span style={{ display: 'inline-flex' }} role="group" aria-label="Logging mode">
                  {(['payment', 'balance'] as const).map(m => (
                    <button
                      key={m}
                      className="btn btn-ghost"
                      onClick={() => setHitMode(m)}
                      title={m === 'payment' ? 'Log a payment (damage)' : 'Log the new remaining balance'}
                      style={{
                        fontSize: 9, padding: '5px 8px', letterSpacing: '0.1em',
                        color: hitMode === m ? accent : 'var(--text-faint)',
                        background: hitMode === m ? `color-mix(in srgb, ${accent} 12%, transparent)` : undefined,
                        boxShadow: hitMode === m ? `inset 0 0 0 1px color-mix(in srgb, ${accent} 45%, transparent)` : undefined,
                      }}
                    >
                      {m === 'payment' ? 'PAYMENT' : 'BALANCE'}
                    </button>
                  ))}
                </span>
              )}
              <input
                type="number"
                className="ncx-input"
                min={0}
                step="any"
                placeholder={isBalance ? 'NEW BAL' : 'AMT'}
                title={isBalance ? 'Remaining balance' : 'Hit amount'}
                value={amount}
                onChange={e => setAmount(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                onKeyDown={e => e.key === 'Enter' && submit()}
                style={{ width: 92, padding: '7px 10px', fontSize: 12 }}
              />
              <input
                className="ncx-input"
                placeholder="NOTE"
                title="Note (optional)"
                value={note}
                onChange={e => setNote(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submit()}
                style={{ width: 140, padding: '7px 10px', fontSize: 12 }}
              />
              {/* keyed by state: className flips primary↔plain (stuck-transition pitfall) */}
              <button
                key={boss.id + '-' + (focal ? 'primary' : 'plain')}
                className={'btn' + (focal ? ' btn-primary' : '')}
                style={{ padding: '7px 16px', fontSize: 11 }}
                disabled={!canHit || hit.isPending}
                onClick={submit}
              >
                <Icon name={boss.direction === 'charge_up' ? 'arrowUp' : 'zap'} size={12} />
                {hit.isPending ? 'HITTING…' : verb}
              </button>
            </div>

            {hit.isError && (
              <div className="mono" style={{ fontSize: 10, color: 'var(--red)', marginTop: 6, letterSpacing: '0.08em' }}>
                HIT FAILED — TRY AGAIN.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Archive rows (defeated + abandoned) -----------------------------

function ArchiveRow({ boss }: { boss: Boss }) {
  const qc = useQueryClient();

  const setStatus = useMutation({
    mutationFn: (status: 'active' | 'abandoned') => api.put(`/api/bosses/${boss.id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bosses'] }),
  });

  const remove = useMutation({
    mutationFn: () => api.del(`/api/bosses/${boss.id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bosses'] }),
  });

  const defeated = boss.status === 'defeated';

  return (
    <div className="ncx-panel" style={{ padding: '13px 20px', display: 'flex', alignItems: 'center', gap: 12, opacity: 0.75, flexWrap: 'wrap' }}>
      <Icon name={defeated ? 'trophy' : 'flag'} size={15} style={{ color: defeated ? 'var(--amber)' : 'var(--text-faint)' }} />
      <span className="mono" style={{ fontSize: 10.5, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
        {defeated ? `DOWN — ${boss.name}` : boss.name}
      </span>
      {defeated
        ? <span className="ncx-stamp flat" style={{ color: 'var(--lime)', fontSize: 9.5 }}>FLATLINED</span>
        : <span className="ncx-stamp flat" style={{ color: 'var(--text-faint)', fontSize: 9.5 }}>ABANDONED</span>}
      <span style={{ flex: 1 }} />
      {defeated ? (
        <span className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>
          {boss.defeatedAt ? `${fmtDate(boss.defeatedAt)} · ` : ''}
          <span style={{ color: 'var(--lime)' }}>
            +{boss.xpReward.toLocaleString()} XP · +€${boss.eddieReward.toLocaleString()}
          </span>
        </span>
      ) : (
        <button className="btn btn-ghost" style={{ fontSize: 9.5, padding: '4px 10px' }} onClick={() => setStatus.mutate('active')}>
          <Icon name="repeat" size={11} /> REVIVE
        </button>
      )}
      <button
        className="btn btn-ghost"
        style={{ padding: '4px 7px' }}
        title="Delete boss"
        aria-label={`Delete ${boss.name}`}
        onClick={() => remove.mutate()}
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}

// ---- Kill overlay -----------------------------------------------------

function KillOverlay({ boss, onClose }: { boss: Boss; onClose: () => void }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1200,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(2,4,10,0.72)', backdropFilter: 'blur(3px)',
      }}
      onClick={onClose}
    >
      <div className="ncx-ticks">
        <span className="tick" style={{ top: -4, left: -4, color: 'var(--cyan)' }} />
        <span className="tick" style={{ bottom: -4, right: -4, color: 'var(--cyan)' }} />
        <div
          className="ncx-panel focal"
          style={{ padding: '40px 64px', textAlign: 'center', animation: 'ncx-levelup-in .4s cubic-bezier(.22,.61,.36,1) both' }}
          onClick={e => e.stopPropagation()}
        >
          <div className="kicker" style={{ color: 'var(--lime)', marginBottom: 14 }}>TARGET FLATLINED</div>
          <Icon name="trophy" size={34} style={{ color: 'var(--amber)' }} />
          <div className="ncx-chroma" style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 700, textTransform: 'uppercase', marginTop: 10 }}>
            {boss.name}
          </div>
          <div className="ncx-val" style={{ fontSize: 16, color: 'var(--lime)', marginTop: 14 }}>
            +{boss.xpReward.toLocaleString()} XP · +€${boss.eddieReward.toLocaleString()}
          </div>
          <button className="btn btn-primary" style={{ marginTop: 24, padding: '10px 28px' }} onClick={onClose}>
            <Icon name="check" size={13} /> CLAIM
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Create form ------------------------------------------------------

/** Accent presets — the base Night City palette (hex, not vars, so a boss
 *  keeps its chosen accent across theme skins). Empty = kind default. */
const ACCENT_PRESETS: { label: string; value: string }[] = [
  { label: 'CYAN',    value: '#1ce2ff' },
  { label: 'TEAL',    value: '#2ff5d6' },
  { label: 'LIME',    value: '#43ffa6' },
  { label: 'AMBER',   value: '#ffc24b' },
  { label: 'RED',     value: '#ff4d6d' },
  { label: 'MAGENTA', value: '#ff2e9a' },
  { label: 'VIOLET',  value: '#9d6bff' },
];

function AccentPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }} role="radiogroup" aria-label="Accent color">
      <button
        type="button"
        role="radio"
        aria-checked={value === ''}
        title="Kind default"
        onClick={() => onChange('')}
        className="mono"
        style={{
          height: 24, padding: '0 8px', fontSize: 8.5, letterSpacing: '0.12em',
          background: 'var(--panel-2)', color: value === '' ? 'var(--text)' : 'var(--text-faint)',
          border: value === '' ? '1px solid var(--text-dim)' : '1px solid var(--line-2)',
          cursor: 'pointer',
        }}
      >
        AUTO
      </button>
      {ACCENT_PRESETS.map(p => (
        <button
          key={p.value}
          type="button"
          role="radio"
          aria-checked={value === p.value}
          title={p.label}
          aria-label={p.label}
          onClick={() => onChange(p.value)}
          style={{
            width: 24, height: 24, flexShrink: 0,
            background: p.value,
            border: value === p.value ? '2px solid var(--text)' : '1px solid color-mix(in srgb, ' + p.value + ' 50%, transparent)',
            boxShadow: value === p.value ? `0 0 10px color-mix(in srgb, ${p.value} 70%, transparent)` : 'none',
            cursor: 'pointer',
          }}
        />
      ))}
    </div>
  );
}

function BossForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<BossKind>('debt');
  const [direction, setDirection] = useState<BossDirection>('grind_down');
  const [targetValue, setTargetValue] = useState<number | ''>('');
  const [unit, setUnit] = useState('$');
  const [color, setColor] = useState('');
  const [linkedProjectId, setLinkedProjectId] = useState('');
  const [xpReward, setXpReward] = useState<number>(200);
  const [eddieReward, setEddieReward] = useState<number>(100);

  const projectsQ = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<{ projects: Project[] }>('/api/projects').then(r => r.projects),
  });
  const projects = projectsQ.data ?? [];

  const create = useMutation({
    mutationFn: () => api.post('/api/bosses', {
      name: name.trim(),
      kind,
      direction,
      targetValue: targetValue === '' ? 0 : targetValue,
      unit: unit.trim() || null,
      color: color.trim() || null,
      linkedProjectId: linkedProjectId || null,
      xpReward,
      eddieReward,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bosses'] });
      onClose();
    },
  });

  const canSubmit = name.trim() !== '' && targetValue !== '' && Number(targetValue) > 0;

  return (
    <div className="ncx-panel focal" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="mono" style={{ fontSize: 10, letterSpacing: '0.26em', color: 'var(--text-dim)', textTransform: 'uppercase' }}>
        SPAWN TARGET // NEW DOSSIER
      </div>

      <input
        autoFocus
        className="ncx-input"
        placeholder="TARGET NAME (E.G. CREDIT CARD DEBT)"
        value={name}
        onChange={e => setName(e.target.value)}
      />

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="KIND">
          <select className="ncx-input" value={kind} onChange={e => setKind(e.target.value as BossKind)}>
            <option value="debt">Debt</option>
            <option value="savings">Savings</option>
            <option value="project">Project</option>
            <option value="challenge">Challenge</option>
            <option value="custom">Custom</option>
          </select>
        </Field>
        <Field label="DIRECTION">
          <select className="ncx-input" value={direction} onChange={e => setDirection(e.target.value as BossDirection)}>
            <option value="grind_down">Grind down (start full → 0)</option>
            <option value="charge_up">Charge up (start 0 → target)</option>
          </select>
        </Field>
        <Field label="TARGET">
          <input
            type="number"
            className="ncx-input"
            min={1}
            step="any"
            placeholder="AMOUNT"
            value={targetValue}
            onChange={e => setTargetValue(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
            style={{ width: 120 }}
          />
        </Field>
        <Field label="UNIT">
          <input
            className="ncx-input"
            placeholder="$ / KM / …"
            value={unit}
            onChange={e => setUnit(e.target.value)}
            style={{ width: 90 }}
          />
        </Field>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="LINK PROJECT">
          <select className="ncx-input" value={linkedProjectId} onChange={e => setLinkedProjectId(e.target.value)} style={{ minWidth: 180 }}>
            <option value="">— none (manual only) —</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </Field>
        <Field label="XP REWARD">
          <input
            type="number"
            className="ncx-input"
            min={0}
            max={100000}
            value={xpReward}
            onChange={e => setXpReward(Math.max(0, Math.min(100000, Number(e.target.value))))}
            style={{ width: 100 }}
          />
        </Field>
        <Field label="€$ REWARD">
          <input
            type="number"
            className="ncx-input"
            min={0}
            max={100000}
            value={eddieReward}
            onChange={e => setEddieReward(Math.max(0, Math.min(100000, Number(e.target.value))))}
            style={{ width: 100 }}
          />
        </Field>
        <Field label="ACCENT">
          <AccentPicker value={color} onChange={setColor} />
        </Field>
      </div>

      <div className="mono" style={{ fontSize: 10, letterSpacing: '0.08em', color: 'var(--text-faint)' }}>
        {direction === 'grind_down'
          ? 'STARTS AT FULL TARGET HP; EACH HIT REDUCES IT. DEFEATED AT 0.'
          : 'STARTS EMPTY; EACH CONTRIBUTION RAISES IT. DEFEATED AT TARGET.'}
        {linkedProjectId && ' LINKED-PROJECT MILESTONES DEAL 1 DAMAGE EACH.'}
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost" onClick={onClose}>CANCEL</button>
        <button className="btn btn-primary" disabled={!canSubmit || create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? 'SPAWNING…' : 'SPAWN'}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.26em', color: 'var(--text-dim)', textTransform: 'uppercase' }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function Empty({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <div className="fade-up ncx-panel focal" style={{ padding: 40, textAlign: 'center', color: color ?? 'var(--text-faint)' }}>
      <div className="mono" style={{ fontSize: 12, letterSpacing: '0.14em' }}>{children}</div>
    </div>
  );
}
