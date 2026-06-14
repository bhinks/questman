// handler-view.jsx — the consolidated HANDLER page, laid out as a COMMS
// DASHBOARD (not a long list):
//   MASTHEAD (full)         — identity + voice control + status
//   MISSION STRIP (full)    — weekly KPI tiles + week selector + vitals/spend
//   ┌ LEFT (feed) ──────────┬ RIGHT (rail) ───────────┐
//   │ TRANSMISSIONS (capped │ PATTERNS (slim cards,    │
//   │  internal scroll)     │  2-up grid)              │
//   │ AFTER-ACTION narrative│ OPERATOR REFLECTION      │
//   └───────────────────────┴──────────────────────────┘
// Reads window.QM_HANDLER + window.Icon.

const { useState, useEffect } = React;

/* ---------- shared bits ---------- */
function Chip({ children, color }) {
  return <span className="ncx-stamp flat" style={{ flexShrink: 0, color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}>{children}</span>;
}
function timeAgo(iso) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const min = Math.round((Date.now() - then) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function fmtWeekOf(s) {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}
function PanelHead({ icon, color, title, sub, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <Icon name={icon} size={14} style={{ color }} />
      <span className="mono" style={{ fontSize: 10, letterSpacing: '0.26em', textTransform: 'uppercase', color }}>{title}</span>
      {sub && <span className="ncx-serial">{sub}</span>}
      {right && <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>{right}</span>}
    </div>
  );
}

/* ---------- persona masthead ---------- */
function PersonaMasthead({ personas, personaKey, setPersonaKey, enabled, setEnabled, player, freshSignal, weekStatus }) {
  const persona = personas.find(p => p.key === personaKey) || personas[0];
  const accent = persona.color;
  return (
    <div className="panel hud ncx-scan" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16, position: 'relative', overflow: 'hidden' }}>
      <div className="sweep" />
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div className="ncx-hex" style={{ width: 52, height: 52, fontSize: 18, flex: 'none', background: `linear-gradient(160deg, ${accent}, var(--violet) 75%, var(--magenta))` }}>
          {persona.label[0]}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h2 className="ncx-glitch ncx-chroma" style={{ fontSize: 22, fontWeight: 700, margin: 0, fontFamily: 'var(--font-display)', letterSpacing: '0.03em', textTransform: 'uppercase' }}>HANDLER</h2>
            <span className="mono" style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--text)' }}>{persona.label}</span>
            <Chip color={accent}>{persona.tag}</Chip>
          </div>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--text-faint)', marginTop: 4 }}>{persona.blurb}</div>
          <div className="ncx-term" style={{ fontSize: 12.5, lineHeight: 1.6, marginTop: 10, color: enabled ? 'var(--text)' : 'var(--text-faint)' }}>
            <span style={{ color: accent }}>{persona.label}&gt;</span> {enabled ? persona.latest(player) : 'Channel muted. Bring the Handler online to resume transmissions.'}
            {enabled && <span className="cursor-blink" style={{ color: accent }}>_</span>}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 9, flex: 'none' }}>
          <button className="btn btn-ghost" key={`en-${enabled}`} onClick={() => setEnabled(!enabled)}
            style={{ padding: '5px 13px', fontSize: 11, color: enabled ? 'var(--lime)' : 'var(--text-faint)', boxShadow: `inset 0 0 0 1px ${enabled ? 'color-mix(in srgb, var(--lime) 45%, transparent)' : 'var(--line-2)'}` }}>
            <span className={enabled ? 'cursor-blink' : ''} style={{ width: 6, height: 6, borderRadius: '50%', background: enabled ? 'var(--lime)' : 'var(--text-faint)', boxShadow: enabled ? '0 0 6px var(--lime)' : 'none' }} />
            {enabled ? 'ONLINE' : 'MUTED'}
          </button>
          <div className="mono" style={{ fontSize: 9.5, letterSpacing: '0.14em', color: 'var(--text-faint)', textAlign: 'right', lineHeight: 1.7 }}>
            <div><span style={{ color: freshSignal > 0 ? accent : 'var(--text-faint)' }}>{freshSignal}</span> FRESH SIGNAL</div>
            <div>WEEK · <span style={{ color: weekStatus === 'awaiting' ? 'var(--amber)' : 'var(--lime)' }}>{weekStatus === 'awaiting' ? 'AWAITING' : 'FILED'}</span></div>
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: '1px solid var(--line)', paddingTop: 13 }}>
        <span className="kicker" style={{ fontSize: 9, alignSelf: 'center', marginRight: 2 }}>VOICE</span>
        {personas.map(opt => {
          const sel = opt.key === personaKey;
          const locked = opt.owned === false;
          return (
            <button key={opt.key} disabled={locked} onClick={() => !locked && setPersonaKey(opt.key)}
              title={locked ? 'Unlock in the Night Market' : opt.blurb} className="mono"
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '5px 11px', fontSize: 10.5, letterSpacing: '0.06em',
                cursor: locked ? 'not-allowed' : (sel ? 'default' : 'pointer'), borderRadius: 0,
                border: sel ? `1px solid ${opt.color}` : locked ? '1px dashed var(--line-2)' : '1px solid var(--line-2)',
                background: sel ? `color-mix(in srgb, ${opt.color} 14%, transparent)` : 'var(--panel-2)',
                color: sel ? opt.color : locked ? 'var(--text-faint)' : 'var(--text-dim)', opacity: locked ? 0.6 : 1,
              }}>
              {locked && <Icon name="lock" size={10} style={{ color: 'var(--text-faint)' }} />}
              {sel && <Icon name="check" size={11} style={{ color: opt.color }} />}
              {opt.label}
              {locked && opt.priceEddies != null && <span style={{ color: 'var(--amber)', marginLeft: 2 }}>€${opt.priceEddies}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- MISSION STRIP — full-width weekly KPIs + week selector ---------- */
function StatTile({ label, value, sub, color, icon }) {
  return (
    <div className="panel-inset" style={{ padding: '10px 8px', textAlign: 'center' }}>
      <div className="kicker" style={{ fontSize: 8.5, marginBottom: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
        <Icon name={icon} size={10} style={{ color }} /> {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color, fontFamily: 'var(--font-display)' }}>{value}</div>
      {sub && <div className="mono" style={{ fontSize: 9, color: 'var(--text-faint)', marginTop: 1 }}>{sub}</div>}
    </div>
  );
}
function Vital({ label, value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
      <span className="mono" style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.05em' }}>{label}</span>
      <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{value}</span>
    </div>
  );
}

function MissionStrip({ debriefs, selected, setViewId, filed }) {
  const s = selected.stats;
  const v = s.vitals;
  const weekPills = (
    <React.Fragment>
      {debriefs.map(r => {
        const active = r.id === selected.id;
        const rFiled = r.status === 'submitted' || filed[r.id];
        return (
          <button key={r.id} onClick={() => setViewId(r.id)} className="mono"
            style={{
              padding: '4px 9px', fontSize: 10, letterSpacing: '0.04em', cursor: 'pointer', borderRadius: 0,
              border: active ? '1px solid rgba(var(--accent-rgb),0.55)' : '1px solid var(--line-2)',
              background: active ? 'rgba(var(--accent-rgb), 0.12)' : 'var(--panel-2)',
              color: active ? 'var(--cyan)' : 'var(--text-dim)',
            }}>
            <span style={{ color: rFiled ? 'var(--lime)' : 'var(--amber)', marginRight: 5 }}>{rFiled ? '●' : '○'}</span>
            {fmtWeekOf(r.weekOf).replace(/, \d{4}$/, '')}
          </button>
        );
      })}
    </React.Fragment>
  );
  return (
    <div className="panel" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PanelHead icon="trend" color="var(--cyan)" title="MISSION STATS" sub={`WEEK OF ${fmtWeekOf(selected.weekOf).toUpperCase()}`} right={weekPills} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(94px, 1fr))', gap: 10 }}>
        <StatTile label="XP" value={`+${s.xpEarned.toLocaleString()}`} color="var(--cyan)" icon="bolt" />
        <StatTile label="EDDIES" value={`€$${s.eddiesEarned.toLocaleString()}`} color="var(--amber)" icon="spark" />
        <StatTile label="CLEARED" value={s.questsCompleted} sub={`${Math.round(s.completionRate)}%`} color="var(--lime)" icon="check" />
        <StatTile label="EXPIRED" value={s.questsExpired} color="var(--red)" icon="clock" />
        <StatTile label="WORKOUTS" value={s.workouts} color="var(--magenta)" icon="flame" />
        <StatTile label="BOSSES" value={s.bossesDefeated} color="var(--violet)" icon="target" />
        <StatTile label="BADGES" value={s.achievementsUnlocked} color="var(--amber)" icon="trophy" />
        <StatTile label="SPEND" value={`$${s.spendTotal.toLocaleString()}`} color="var(--text-dim)" icon="trend" />
        <StatTile label="ACTIVE" value={`${s.activeDays}/7`} color="var(--cyan)" icon="flag" />
      </div>
      <div className="panel-inset" style={{ padding: '9px 14px', display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        {v && <span className="kicker" style={{ color: 'var(--text-faint)' }}>VITALS</span>}
        {v?.sleepAvg != null && <Vital label="SLEEP" value={`${v.sleepAvg.toFixed(1)} h`} />}
        {v?.moodAvg != null && <Vital label="MOOD" value={v.moodAvg.toFixed(1)} />}
        {v?.weightDelta != null && <Vital label="WEIGHT Δ" value={`${v.weightDelta > 0 ? '+' : ''}${v.weightDelta.toFixed(1)}`} />}
        {s.topCategories?.length > 0 && <span className="kicker" style={{ color: 'var(--text-faint)', marginLeft: 'auto' }}>TOP SPEND</span>}
        {s.topCategories?.map((c, i) => (
          <span key={i} className="mono" style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>
            {c.name} <span style={{ color: 'var(--amber)', fontWeight: 700 }}>${c.amount.toLocaleString()}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------- TRANSMISSIONS feed (capped, internal scroll) ---------- */
const KIND_META = {
  daily_rundown: { label: 'RUNDOWN', color: 'var(--cyan)' },
  weekly_debrief: { label: 'DEBRIEF', color: 'var(--violet)' },
  event: { label: 'EVENT', color: 'var(--amber)' },
};
function TransmissionsPanel({ messages, persona, enabled }) {
  const ordered = [...messages].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return (
    <div className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <PanelHead icon="bell" color="var(--cyan)" title="TRANSMISSIONS" sub={`${messages.filter(m => !m.seen).length} new`} />
      <div className="noscroll" style={{ maxHeight: 520, overflowY: 'auto', margin: '0 -16px -4px', borderTop: '1px solid var(--line)' }}>
        {ordered.map((m, i) => {
          const meta = KIND_META[m.kind] || { label: m.kind.toUpperCase(), color: 'var(--text-dim)' };
          return (
            <div key={m.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 16px', borderTop: i === 0 ? undefined : '1px solid var(--line)', opacity: enabled ? (m.seen ? 0.72 : 1) : 0.5 }}>
              <Chip color={meta.color}>{meta.label}</Chip>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="mono" style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.55 }}>
                  <span style={{ color: meta.color, userSelect: 'none' }}>&gt; </span>{m.text}
                </div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 4 }}>
                  {!m.seen && <span style={{ color: persona.color, marginRight: 8 }}>● NEW</span>}{timeAgo(m.createdAt)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- PATTERNS — slim, narrow insight cards ---------- */
const CONF_COLOR = { low: 'var(--amber)', medium: 'var(--cyan)' };
function InsightCard({ insight, onAccept, onDismiss }) {
  const dismissed = insight.status === 'dismissed';
  const spawned = insight.status === 'spawned';
  const conf = CONF_COLOR[insight.confidence] || 'var(--cyan)';
  const actionable = insight.actionType !== 'none' && (insight.status === 'new' || insight.status === 'accepted');
  return (
    <div className="panel" style={{
      padding: 13, display: 'flex', flexDirection: 'column', gap: 7, opacity: dismissed ? 0.5 : 1, minWidth: 0,
      border: spawned ? '1px solid color-mix(in srgb, var(--lime) 45%, transparent)' : '1px solid var(--line)',
      background: spawned ? 'linear-gradient(180deg, color-mix(in srgb, var(--lime) 7%, transparent), transparent)' : undefined,
    }}>
      {/* compact meta line — honesty label kept, inline */}
      <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 8.5, letterSpacing: '0.08em', flexWrap: 'wrap' }}>
        <span title="Correlation from your own logs — not a diagnosis." style={{ color: 'var(--text-faint)', borderBottom: '1px dashed var(--line-2)', textTransform: 'uppercase' }}>POSSIBLE PATTERN</span>
        <span style={{ color: conf, fontWeight: 700 }}>{insight.confidence.toUpperCase()}</span>
        {insight.windowDays != null && <span style={{ color: 'var(--text-ghost)' }}>{insight.windowDays}d</span>}
        {spawned && <span style={{ marginLeft: 'auto', color: 'var(--lime)', fontWeight: 700 }}>● QUEST ADDED</span>}
        {dismissed && <span style={{ marginLeft: 'auto', color: 'var(--text-faint)' }}>DISMISSED</span>}
      </div>
      <h3 style={{ fontSize: 13.5, fontWeight: 700, margin: 0, color: 'var(--text)', lineHeight: 1.3 }}>{insight.title}</h3>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.45 }}>{insight.body}</div>
      {insight.evidence && <div className="mono" style={{ fontSize: 10, color: 'var(--text-faint)', lineHeight: 1.4 }}>{insight.evidence}</div>}
      {insight.suggestion && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 11.5, color: 'var(--text)', lineHeight: 1.4, paddingLeft: 9, borderLeft: `2px solid ${conf}` }}>
          <Icon name="spark" size={12} style={{ color: conf, flexShrink: 0, marginTop: 2 }} />
          <span>{insight.suggestion}</span>
        </div>
      )}
      {actionable && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 1 }}>
          <button className="btn btn-primary" style={{ padding: '5px 11px', fontSize: 10 }} onClick={onAccept}>
            <Icon name="check" size={12} /> ACCEPT
          </button>
          <button className="btn btn-ghost" style={{ padding: '5px 11px', fontSize: 10 }} onClick={onDismiss}>
            <Icon name="close" size={12} /> DISMISS
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------- AFTER-ACTION narrative + operator reflection ---------- */
function NarrativeCard({ persona, stats }) {
  return (
    <div className="panel" style={{ padding: 16, borderLeft: `3px solid ${persona.color}`, background: `linear-gradient(180deg, color-mix(in srgb, ${persona.color} 7%, transparent), transparent)` }}>
      <div className="mono" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8, fontSize: 9.5, letterSpacing: '0.24em', textTransform: 'uppercase', color: persona.color }}>
        <Icon name="eye" size={12} style={{ color: persona.color }} /> &gt; {persona.label} · AFTER-ACTION
      </div>
      <div className="mono" style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--text)' }}>{persona.debriefIntro(stats)}</div>
    </div>
  );
}

const inputStyle = {
  padding: '10px 12px', background: 'var(--panel-2)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-sm)',
  color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box',
};
function ReflectionCard({ selected, draft, setDraft, filed, onFile }) {
  const submitted = selected.status === 'submitted' || filed[selected.id];
  return (
    <div className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <PanelHead icon="flag" color="var(--cyan)" title="OPERATOR REFLECTION" sub={fmtWeekOf(selected.weekOf).replace(/, \d{4}$/, '')} />
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="kicker" style={{ color: 'var(--text-faint)' }}>DEBRIEF</span>
        <textarea value={draft.notes} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))}
          placeholder="What actually happened this week?" rows={4}
          style={{ ...inputStyle, resize: 'vertical', minHeight: 84, lineHeight: 1.5 }} />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="kicker" style={{ color: 'var(--text-faint)' }}>ORDERS FOR NEXT CYCLE</span>
        <input value={draft.focusForNext} onChange={e => setDraft(d => ({ ...d, focusForNext: e.target.value }))}
          placeholder="One focus." style={inputStyle} />
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={() => onFile(selected.id)} style={{ padding: '8px 16px', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em' }}>
          <Icon name="check" size={13} /> {submitted ? 'UPDATE REFLECTION' : 'FILE DEBRIEF'}
        </button>
        {filed[selected.id] && (
          <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--lime)', padding: '4px 9px', background: 'color-mix(in srgb, var(--lime) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--lime) 35%, transparent)' }}>
            +40 XP / +20 €$ — filed
          </span>
        )}
      </div>
    </div>
  );
}

/* ---------- the page ---------- */
function HandlerView({ tweaks }) {
  const { PERSONAS, TRANSMISSIONS, INSIGHTS, DEBRIEFS, PLAYER } = window.QM_HANDLER;
  const t = tweaks || {};
  const [personaKey, setPersonaKey] = useState(t.persona || 'v1ktor');
  const [enabled, setEnabled] = useState(true);
  const [insights, setInsights] = useState(INSIGHTS);
  const [viewId, setViewId] = useState(DEBRIEFS[0].id);
  const [filed, setFiled] = useState({});
  const [draft, setDraft] = useState({ notes: '', focusForNext: '' });

  useEffect(() => { if (t.persona) setPersonaKey(t.persona); }, [t.persona]);

  const persona = PERSONAS.find(p => p.key === personaKey) || PERSONAS[0];
  const selected = DEBRIEFS.find(d => d.id === viewId) || DEBRIEFS[0];
  const freshSignal = TRANSMISSIONS.filter(m => !m.seen).length + insights.filter(i => i.status === 'new').length;
  const weekStatus = (DEBRIEFS[0].status === 'submitted' || filed[DEBRIEFS[0].id]) ? 'filed' : 'awaiting';
  const freshPatterns = insights.filter(i => i.status === 'new').length;
  const setStatus = (id, status) => setInsights(list => list.map(i => i.id === id ? { ...i, status } : i));

  return (
    <div className="qm-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PersonaMasthead personas={PERSONAS} personaKey={personaKey} setPersonaKey={setPersonaKey}
        enabled={enabled} setEnabled={setEnabled} player={PLAYER} freshSignal={freshSignal} weekStatus={weekStatus} />

      <MissionStrip debriefs={DEBRIEFS} selected={selected} setViewId={setViewId} filed={filed} />

      {/* PATTERNS — full-width row of slim, narrow cards */}
      <div className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <PanelHead icon="trend" color="var(--violet)" title="PATTERNS" sub={`${freshPatterns} fresh · possible signals from your data-shadow`} />
        <div className="hpat">
          {insights.map(i => <InsightCard key={i.id} insight={i} onAccept={() => setStatus(i.id, 'spawned')} onDismiss={() => setStatus(i.id, 'dismissed')} />)}
        </div>
      </div>

      <div className="hdash">
        {/* LEFT — transmissions feed */}
        <div className="hcol">
          <TransmissionsPanel messages={TRANSMISSIONS} persona={persona} enabled={enabled} />
        </div>
        {/* RIGHT — after-action narrative + operator reflection */}
        <div className="hcol">
          <NarrativeCard persona={persona} stats={selected.stats} />
          <ReflectionCard selected={selected} draft={draft} setDraft={setDraft} filed={filed} onFile={id => setFiled(f => ({ ...f, [id]: true }))} />
        </div>
      </div>
    </div>
  );
}

window.HandlerView = HandlerView;
