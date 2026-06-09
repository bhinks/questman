/**
 * BossesView — "Boss Fights". Big goals rendered as bosses with an HP bar:
 * grind down (debt/project/challenge) or charge up (savings). Deal manual
 * damage (log a hit / payment / contribution) or watch a linked project's
 * milestones chip it down. Defeating one fires a kill screen that pays XP +
 * eddies, so a hit invalidates the player + bosses queries to refresh the HUD.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Boss, BossKind, BossDirection, BossHitResponse, Project } from '../lib/api';
import { Icon } from './Icon';

const KIND_META: Record<BossKind, { label: string; color: string }> = {
  debt:      { label: 'DEBT',      color: 'var(--red)' },
  savings:   { label: 'SAVINGS',   color: 'var(--lime)' },
  project:   { label: 'PROJECT',   color: 'var(--cyan)' },
  challenge: { label: 'CHALLENGE', color: 'var(--magenta)' },
  custom:    { label: 'CUSTOM',    color: 'var(--violet)' },
};

/** Action wording keyed by direction. */
function actionVerb(direction: BossDirection, kind: BossKind): string {
  if (direction === 'charge_up') return 'CONTRIBUTE';
  return kind === 'debt' ? 'LOG PAYMENT' : 'DEAL DAMAGE';
}

/** Format a value with an optional unit ("$" prefixes, others suffix). */
function fmt(value: number, unit: string | null): string {
  const n = Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (!unit) return n;
  return unit === '$' ? `$${n}` : `${n} ${unit}`;
}

export function BossesView() {
  const [creating, setCreating] = useState(false);

  const bossesQ = useQuery({
    queryKey: ['bosses'],
    queryFn: () => api.get<{ bosses: Boss[] }>('/api/bosses').then(r => r.bosses),
  });

  if (bossesQ.isLoading) return <Empty>SCANNING FOR TARGETS…</Empty>;
  if (bossesQ.isError) return <Empty color="var(--red)">FAILED TO LOAD</Empty>;

  const bosses = bossesQ.data ?? [];
  const active = bosses.filter(b => b.status === 'active');
  const cleared = bosses.filter(b => b.status !== 'active');

  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <Header active={active.length} total={bosses.length} />

      {creating
        ? <BossForm onClose={() => setCreating(false)} />
        : (
          <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setCreating(true)}>
            <Icon name="plus" size={14} style={{ marginRight: 6 }} /> SPAWN BOSS
          </button>
        )}

      {active.map(b => <BossCard key={b.id} boss={b} />)}

      {cleared.length > 0 && (
        <div className="kicker" style={{ marginTop: 6 }}>
          <Icon name="trophy" size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />
          DEFEATED
        </div>
      )}
      {cleared.map(b => <BossCard key={b.id} boss={b} />)}

      {bosses.length === 0 && (
        <Empty>No bosses yet — spawn a big goal above and start chipping it down.</Empty>
      )}
    </div>
  );
}

function Header({ active, total }: { active: number; total: number }) {
  return (
    <div className="panel hud" style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
      <Icon name="shield" size={20} style={{ color: 'var(--magenta)' }} />
      <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, fontFamily: 'var(--font-display)' }}>Boss Fights</h2>
      <div
        className="mono"
        style={{
          marginLeft: 'auto', fontSize: 11, color: 'var(--text-dim)',
          padding: '4px 8px', background: 'var(--panel-2)',
          borderRadius: 6, border: '1px solid var(--line)',
        }}
      >
        {active} ACTIVE · {total} TOTAL
      </div>
    </div>
  );
}

// ---- Boss card ------------------------------------------------------

function BossCard({ boss }: { boss: Boss }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState<number | ''>('');
  const [note, setNote] = useState('');
  const [killScreen, setKillScreen] = useState(false);

  const kindMeta = KIND_META[boss.kind];
  const accent = boss.color || kindMeta.color;
  const defeated = boss.status === 'defeated';
  const abandoned = boss.status === 'abandoned';
  const isActive = boss.status === 'active';

  const hit = useMutation({
    mutationFn: (amt: number) =>
      api.post<BossHitResponse>(`/api/bosses/${boss.id}/hit`, {
        amount: amt,
        note: note.trim() || null,
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['bosses'] });
      qc.invalidateQueries({ queryKey: ['player'] });
      qc.invalidateQueries({ queryKey: ['player', 'stats'] });
      setAmount('');
      setNote('');
      if (res.defeated) setKillScreen(true);
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

  const submit = () => {
    if (amount !== '' && amount > 0) hit.mutate(amount);
  };

  const verb = actionVerb(boss.direction, boss.kind);
  // HP-bar fill semantics: grind_down empties as you win (show HP left);
  // charge_up fills as you contribute (show progress toward target).
  const barFill = boss.direction === 'grind_down' ? (100 - boss.pct) : boss.pct;

  return (
    <div
      className="panel"
      style={{
        padding: 18,
        display: 'flex', flexDirection: 'column', gap: 14,
        borderLeft: `3px solid ${accent}`,
        opacity: abandoned ? 0.55 : defeated ? 0.85 : 1,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Icon name="shield" size={16} style={{ color: accent }} />
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, fontFamily: 'var(--font-display)', color: 'var(--text)' }}>
              {boss.name}
            </h3>
            <KindPill kind={boss.kind} />
            {defeated && <StatusTag color="var(--lime)" label="DEFEATED" />}
            {abandoned && <StatusTag color="var(--text-faint)" label="ABANDONED" />}
          </div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 5 }}>
            {boss.direction === 'grind_down' ? 'GRIND DOWN' : 'CHARGE UP'}
            {boss.linkedProjectId && ' · LINKED PROJECT'}
            {boss.xpReward > 0 && ` · +${boss.xpReward} XP`}
            {boss.eddieReward > 0 && ` · +${boss.eddieReward} €$`}
          </div>
        </div>
        <button onClick={() => remove.mutate()} className="btn btn-ghost" style={{ padding: '6px 8px' }} title="Delete boss" aria-label={`Delete ${boss.name}`}>
          <Icon name="close" size={14} />
        </button>
      </div>

      {/* HP / charge bar */}
      <HpBar
        fillPct={barFill}
        accent={accent}
        defeated={defeated}
      />

      {/* Gauge readout */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <span className="mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          {boss.direction === 'grind_down'
            ? <>HP LEFT <span style={{ color: 'var(--text)' }}>{fmt(boss.remaining, boss.unit)}</span> / {fmt(boss.targetValue, boss.unit)}</>
            : <><span style={{ color: 'var(--text)' }}>{fmt(boss.currentValue, boss.unit)}</span> / {fmt(boss.targetValue, boss.unit)} · {fmt(boss.remaining, boss.unit)} TO GO</>}
        </span>
        <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: accent }}>
          {boss.pct}%
        </span>
      </div>

      {/* Action zone */}
      {isActive ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="number"
              min={0}
              step="any"
              placeholder={boss.unit === '$' ? 'amount' : 'amount'}
              value={amount}
              onChange={e => setAmount(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
              onKeyDown={e => e.key === 'Enter' && submit()}
              style={{ ...inputStyle, width: 120 }}
            />
            <input
              placeholder="note (optional)"
              value={note}
              onChange={e => setNote(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submit()}
              style={{ ...inputStyle, flex: 1, minWidth: 120 }}
            />
            <button
              className="btn btn-primary"
              disabled={amount === '' || amount <= 0 || hit.isPending}
              onClick={submit}
              style={{ borderColor: accent }}
            >
              <Icon name="bolt" size={13} style={{ marginRight: 5, verticalAlign: 'middle' }} />
              {hit.isPending ? 'HITTING…' : verb}
            </button>
          </div>
          {hit.isError && (
            <div className="mono" style={{ fontSize: 11, color: 'var(--red)' }}>
              Hit failed — try again.
            </div>
          )}
        </div>
      ) : abandoned ? (
        <button className="btn btn-ghost" style={{ alignSelf: 'flex-start', fontSize: 11 }} onClick={() => setStatus.mutate('active')}>
          <Icon name="repeat" size={12} style={{ marginRight: 4 }} /> REACTIVATE
        </button>
      ) : null}

      {/* Abandon control (active only) */}
      {isActive && (
        <button
          className="btn btn-ghost"
          style={{ alignSelf: 'flex-start', fontSize: 10, padding: '4px 8px', color: 'var(--text-faint)' }}
          onClick={() => setStatus.mutate('abandoned')}
        >
          ABANDON FIGHT
        </button>
      )}

      {/* Kill screen overlay */}
      {killScreen && defeated && (
        <KillScreen boss={boss} onClose={() => setKillScreen(false)} />
      )}
    </div>
  );
}

function HpBar({
  fillPct, accent, defeated,
}: { fillPct: number; accent: string; defeated: boolean }) {
  const clamped = Math.max(0, Math.min(100, fillPct));
  // grind_down: the bar is HP — drains to empty as you win.
  // charge_up:  the bar is progress — fills toward the goal.
  // Either way it goes lime once the boss is dead.
  const barColor = defeated ? 'var(--lime)' : accent;
  return (
    <div
      style={{
        height: 16, borderRadius: 8,
        background: 'var(--panel-2)',
        border: '1px solid var(--line-2)',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <div
        style={{
          position: 'absolute', inset: 0,
          width: `${clamped}%`,
          background: `linear-gradient(90deg, color-mix(in srgb, ${barColor} 70%, transparent), ${barColor})`,
          boxShadow: clamped > 0 ? `0 0 12px color-mix(in srgb, ${barColor} 60%, transparent)` : 'none',
          transition: 'width 0.4s ease',
        }}
      />
    </div>
  );
}

function KindPill({ kind }: { kind: BossKind }) {
  const meta = KIND_META[kind];
  return (
    <span
      className="mono"
      style={{
        fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
        color: meta.color,
        padding: '3px 8px', borderRadius: 6,
        background: `color-mix(in srgb, ${meta.color} 10%, transparent)`,
        border: `1px solid color-mix(in srgb, ${meta.color} 35%, transparent)`,
      }}
    >
      {meta.label}
    </span>
  );
}

function StatusTag({ color, label }: { color: string; label: string }) {
  return (
    <span
      className="mono"
      style={{
        fontSize: 10, fontWeight: 700, letterSpacing: 0.5, color,
        padding: '3px 8px', borderRadius: 6,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
      }}
    >
      {label}
    </span>
  );
}

function KillScreen({ boss, onClose }: { boss: Boss; onClose: () => void }) {
  return (
    <div
      style={{
        position: 'absolute', inset: 0,
        background: 'color-mix(in srgb, var(--panel) 88%, transparent)',
        backdropFilter: 'blur(2px)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 10, textAlign: 'center', padding: 20,
        zIndex: 2,
      }}
    >
      <div className="mono" style={{ fontSize: 12, letterSpacing: 2, color: 'var(--lime)' }}>BOSS DEFEATED</div>
      <Icon name="trophy" size={40} style={{ color: 'var(--lime)' }} />
      <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--text)' }}>
        {boss.name}
      </div>
      <div className="mono" style={{ fontSize: 13, color: 'var(--amber)' }}>
        +{boss.xpReward} XP · +{boss.eddieReward} €$
      </div>
      <button className="btn btn-primary" style={{ marginTop: 6 }} onClick={onClose}>
        <Icon name="check" size={13} style={{ marginRight: 5, verticalAlign: 'middle' }} /> CLAIM
      </button>
    </div>
  );
}

// ---- Create form ----------------------------------------------------

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
    <div className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, borderLeft: '3px solid var(--magenta)' }}>
      <input
        autoFocus
        placeholder="Boss name (e.g. Credit card debt)"
        value={name}
        onChange={e => setName(e.target.value)}
        style={inputStyle}
      />

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="kicker">KIND</span>
          <select value={kind} onChange={e => setKind(e.target.value as BossKind)} style={inputStyle}>
            <option value="debt">Debt</option>
            <option value="savings">Savings</option>
            <option value="project">Project</option>
            <option value="challenge">Challenge</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="kicker">DIRECTION</span>
          <select value={direction} onChange={e => setDirection(e.target.value as BossDirection)} style={inputStyle}>
            <option value="grind_down">Grind down (start full → 0)</option>
            <option value="charge_up">Charge up (start 0 → target)</option>
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="kicker">TARGET</span>
          <input
            type="number"
            min={1}
            step="any"
            placeholder="amount"
            value={targetValue}
            onChange={e => setTargetValue(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
            style={{ ...inputStyle, width: 120 }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="kicker">UNIT</span>
          <input
            placeholder="$ / days / …"
            value={unit}
            onChange={e => setUnit(e.target.value)}
            style={{ ...inputStyle, width: 90 }}
          />
        </label>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="kicker">LINK PROJECT</span>
          <select value={linkedProjectId} onChange={e => setLinkedProjectId(e.target.value)} style={{ ...inputStyle, minWidth: 180 }}>
            <option value="">— none (manual only) —</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="kicker">XP REWARD</span>
          <input
            type="number"
            min={0}
            max={100000}
            value={xpReward}
            onChange={e => setXpReward(Math.max(0, Math.min(100000, Number(e.target.value))))}
            style={{ ...inputStyle, width: 100 }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="kicker">€$ REWARD</span>
          <input
            type="number"
            min={0}
            max={100000}
            value={eddieReward}
            onChange={e => setEddieReward(Math.max(0, Math.min(100000, Number(e.target.value))))}
            style={{ ...inputStyle, width: 100 }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="kicker">ACCENT</span>
          <input
            placeholder="#ff3b6b"
            value={color}
            onChange={e => setColor(e.target.value)}
            style={{ ...inputStyle, width: 110 }}
          />
        </label>
      </div>

      <div className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>
        {direction === 'grind_down'
          ? 'Starts at full target HP; each hit reduces it. Defeated at 0.'
          : 'Starts empty; each contribution raises it. Defeated at target.'}
        {linkedProjectId && ' Linked-project milestones deal 1 damage each.'}
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

function Empty({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div className="fade-up panel hud" style={{ padding: 40, textAlign: 'center', color: color ?? 'var(--text-faint)' }}>
      <div className="mono" style={{ fontSize: 13 }}>{children}</div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '8px 12px',
  background: 'var(--panel-2)',
  border: '1px solid var(--line-2)',
  borderRadius: 'var(--r-sm)',
  color: 'var(--text)',
  fontFamily: 'var(--font-mono)',
  fontSize: 13,
  outline: 'none',
};
