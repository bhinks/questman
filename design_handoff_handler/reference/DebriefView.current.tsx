/**
 * DebriefView — the weekly "DEBRIEF" terminal (intelligence layer, phase 6).
 *
 * An after-action report on the previous week. Mission stats are laid out as
 * panel-inset tiles (PlayerHud style), the Handler narrates the run in a
 * mono terminal block, cross-domain "possible patterns" (Insights) are listed
 * read-only, and the operator writes a reflection + orders for next cycle and
 * FILES it. Filing the first time pays a small reward; later edits just save.
 *
 * Design system only — .panel / .panel-inset / .hud / kicker / mono / .btn /
 * .fade-up and CSS color vars. Never hardcodes hex.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type {
  DebriefLatestResponse,
  DebriefListResponse,
  WeeklyReview,
  WeeklyStats,
  Insight,
  PlayerSnapshot,
} from '../lib/api';
import { getSocket } from '../lib/socket';
import { Icon } from './Icon';

/** Shape returned by POST /api/debrief/:id/submit (not in api.ts types). */
interface SubmitResponse {
  review: WeeklyReview;
  rewarded?: boolean;
  player?: PlayerSnapshot;
}

export function DebriefView() {
  const qc = useQueryClient();

  // Which past week is on screen. null = the latest review.
  const [viewId, setViewId] = useState<string | null>(null);

  const latestQ = useQuery({
    queryKey: ['debrief', 'latest'],
    queryFn: () => api.get<DebriefLatestResponse>('/api/debrief/latest'),
  });
  // Past-weeks selector (optional). Used only to switch which review shows.
  const listQ = useQuery({
    queryKey: ['debrief', 'list'],
    queryFn: () => api.get<DebriefListResponse>('/api/debrief?limit=12'),
    staleTime: 5 * 60 * 1000,
  });

  // A debrief can be generated server-side at week roll-over; refresh on any
  // player-updated push so a brand-new report appears without a reload.
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const refresh = () => {
      qc.invalidateQueries({ queryKey: ['debrief', 'latest'] });
      qc.invalidateQueries({ queryKey: ['debrief', 'list'] });
    };
    // 'handler-message' is what ensureWeeklyReview actually broadcasts when a
    // fresh debrief lands; the others are belt-and-suspenders.
    const evts = ['handler-message', 'debrief-generated', 'player-updated'];
    evts.forEach(e => s.on(e, refresh));
    return () => evts.forEach(e => s.off(e, refresh));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc]);

  if (latestQ.isLoading) return <Empty>BOOTING DEBRIEF TERMINAL…</Empty>;
  if (latestQ.isError) return <Empty color="var(--red)">FAILED TO LOAD DEBRIEF</Empty>;

  const latest = latestQ.data?.review ?? null;
  const reviews = listQ.data?.reviews ?? [];

  // Resolve which review is on screen: the selected one, else the latest, else
  // the newest from the list (covers the case where /latest is null but the
  // archive still holds older filed reviews).
  const selected =
    (viewId && reviews.find(r => r.id === viewId)) ||
    latest ||
    reviews[0] ||
    null;

  if (!selected) {
    return (
      <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <Header review={null} />
        <Empty>
          NO DEBRIEF YET. A debrief is generated at the start of each week from the
          previous week&rsquo;s activity. Come back after a week of logging.
        </Empty>
      </div>
    );
  }

  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <Header review={selected} />

      {reviews.length > 1 && (
        <WeekSelector
          reviews={reviews}
          activeId={selected.id}
          onPick={id => setViewId(id)}
        />
      )}

      <HandlerNarrative text={selected.handlerText} />

      <StatsGrid stats={selected.stats} />

      {selected.insights && selected.insights.length > 0 && (
        <PatternList insights={selected.insights} />
      )}

      {/* Reflection form is keyed by review id so its draft resets when you
          switch weeks rather than leaking text across reports. */}
      <ReflectionForm key={selected.id} review={selected} />
    </div>
  );
}

/* ----------------------------------------------------------------- header -- */

function fmtWeekOf(weekOf: string): string {
  const d = new Date(weekOf);
  if (Number.isNaN(d.getTime())) return weekOf;
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

function Header({ review }: { review: WeeklyReview | null }) {
  const submitted = review?.status === 'submitted';
  const chipColor = submitted ? 'var(--lime)' : 'var(--amber)';
  const chipLabel = submitted ? 'FILED' : 'AWAITING DEBRIEF';

  return (
    <div className="panel hud" style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <Icon name="file" size={20} style={{ color: 'var(--cyan)' }} />
      <div>
        <h2 className="ncx-chroma" style={{ fontSize: 18, fontWeight: 700, margin: 0, fontFamily: 'var(--font-display)', letterSpacing: '0.02em' }}>
          {review ? `AFTER-ACTION // WEEK OF ${fmtWeekOf(review.weekOf)}` : 'AFTER-ACTION'}
        </h2>
        <div className="mono" style={{ fontSize: 10, letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--text-faint)', marginTop: 3 }}>
          weekly debrief · the run, reviewed
        </div>
      </div>
      {review && (
        <span
          className="ncx-stamp flat"
          style={{
            marginLeft: 'auto',
            color: chipColor,
            background: `color-mix(in srgb, ${chipColor} 10%, transparent)`,
          }}
        >
          {chipLabel}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- selector --- */

function WeekSelector({
  reviews, activeId, onPick,
}: { reviews: WeeklyReview[]; activeId: string; onPick: (id: string) => void }) {
  return (
    <div className="panel" style={{ padding: 14 }}>
      <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="clock" size={12} style={{ color: 'var(--text-faint)' }} />
        <span className="mono" style={{ fontSize: 10, letterSpacing: '0.26em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>PAST CYCLES</span>
        <span className="ncx-serial">{reviews.length} ON FILE</span>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {reviews.map(r => {
          const active = r.id === activeId;
          const filed = r.status === 'submitted';
          return (
            <button
              key={r.id}
              className="btn btn-ghost"
              onClick={() => onPick(r.id)}
              title={filed ? 'Filed' : 'Awaiting debrief'}
              style={{
                padding: '6px 12px', fontSize: 11,
                color: active ? 'var(--cyan)' : 'var(--text-dim)',
                background: active ? 'rgba(var(--accent-rgb), 0.10)' : undefined,
                boxShadow: active ? 'inset 0 0 0 1px rgba(var(--accent-rgb), 0.5)' : undefined,
              }}
            >
              <span style={{ color: filed ? 'var(--lime)' : 'var(--amber)', marginRight: 6 }}>
                {filed ? '●' : '○'}
              </span>
              {fmtWeekOf(r.weekOf)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- narrative -- */

function HandlerNarrative({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div
      className="panel"
      style={{
        padding: 18,
        borderLeft: '3px solid var(--violet)',
        background: 'linear-gradient(180deg, color-mix(in srgb, var(--violet) 7%, transparent), transparent)',
      }}
    >
      <div className="mono" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, letterSpacing: '0.26em', textTransform: 'uppercase', color: 'var(--violet)' }}>
        <Icon name="eye" size={12} style={{ color: 'var(--violet)' }} /> &gt; HANDLER
      </div>
      <div
        className="mono"
        style={{
          fontSize: 13, lineHeight: 1.6, color: 'var(--text)',
          whiteSpace: 'pre-wrap',
        }}
      >
        {text}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- stats -- */

function StatsGrid({ stats }: { stats: WeeklyStats | null }) {
  if (!stats) {
    return (
      <div className="panel" style={{ padding: 24 }}>
        <div className="mono" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, letterSpacing: '0.26em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
          <Icon name="trend" size={13} style={{ color: 'var(--cyan)' }} /> MISSION STATS
        </div>
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-faint)' }}>
          No stats recorded for this cycle.
        </div>
      </div>
    );
  }

  // completionRate is already a 0-100 integer percent from the server digest
  // (buildWeeklyDigest) — do NOT multiply by 100 again.
  const completionPct = Math.round(stats.completionRate ?? 0);
  const v = stats.vitals;
  const hasVitals = v && (v.sleepAvg != null || v.moodAvg != null || v.weightDelta != null);
  const topCats = stats.topCategories ?? [];

  return (
    <div className="panel" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, letterSpacing: '0.26em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
        <Icon name="trend" size={13} style={{ color: 'var(--cyan)' }} /> MISSION STATS
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))',
          gap: 12,
        }}
      >
        <StatTile label="XP EARNED" value={`+${stats.xpEarned.toLocaleString()}`} color="var(--cyan)" icon="bolt" />
        <StatTile label="EDDIES" value={`€$ ${stats.eddiesEarned.toLocaleString()}`} color="var(--amber)" icon="spark" />
        <StatTile
          label="QUESTS CLEARED"
          value={stats.questsCompleted.toLocaleString()}
          sub={`${completionPct}% rate`}
          color="var(--lime)"
          icon="check"
        />
        <StatTile label="EXPIRED" value={stats.questsExpired.toLocaleString()} color="var(--red)" icon="clock" />
        <StatTile label="WORKOUTS" value={stats.workouts.toLocaleString()} color="var(--magenta)" icon="flame" />
        <StatTile label="BOSSES DOWN" value={stats.bossesDefeated.toLocaleString()} color="var(--violet)" icon="target" />
        <StatTile label="ACHIEVEMENTS" value={stats.achievementsUnlocked.toLocaleString()} color="var(--amber)" icon="trophy" />
        <StatTile label="SPEND" value={`$${stats.spendTotal.toLocaleString()}`} color="var(--text-dim)" icon="trend" />
        <StatTile label="ACTIVE DAYS" value={`${stats.activeDays} / 7`} color="var(--cyan)" icon="flag" />
      </div>

      {hasVitals && (
        <div className="panel-inset" style={{ padding: '10px 14px', display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="kicker" style={{ color: 'var(--text-faint)' }}>VITALS</span>
          {v!.sleepAvg != null && <Vital label="SLEEP" value={`${v!.sleepAvg.toFixed(1)} h`} />}
          {v!.moodAvg != null && <Vital label="MOOD" value={v!.moodAvg.toFixed(1)} />}
          {v!.weightDelta != null && (
            <Vital
              label="WEIGHT Δ"
              value={`${v!.weightDelta > 0 ? '+' : ''}${v!.weightDelta.toFixed(1)}`}
            />
          )}
        </div>
      )}

      {topCats.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="kicker" style={{ color: 'var(--text-faint)' }}>TOP SPEND CATEGORIES</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {topCats.map((c, i) => (
              <span
                key={`${c.name}-${i}`}
                className="mono"
                style={{
                  fontSize: 11, padding: '4px 10px', borderRadius: 6,
                  color: 'var(--text-dim)',
                  background: 'var(--panel-2)',
                  border: '1px solid var(--line)',
                }}
              >
                {c.name} <span style={{ color: 'var(--amber)', fontWeight: 700 }}>${c.amount.toLocaleString()}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatTile({
  label, value, sub, color, icon,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
  icon: string;
}) {
  return (
    <div className="panel-inset" style={{ padding: 12, textAlign: 'center' }}>
      <div className="kicker" style={{ marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
        <Icon name={icon as any} size={11} style={{ color }} /> {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color, fontFamily: 'var(--font-display)' }}>
        {value}
      </div>
      {sub && (
        <div className="mono" style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 2 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function Vital({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
      <span className="mono" style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.05em' }}>{label}</span>
      <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{value}</span>
    </div>
  );
}

/* -------------------------------------------------------------- patterns -- */

function PatternList({ insights }: { insights: Insight[] }) {
  return (
    <div className="panel" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="kicker" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon name="spark" size={13} style={{ color: 'var(--violet)' }} /> POSSIBLE PATTERNS
      </div>
      {insights.map(ins => (
        <div
          key={ins.id}
          className="panel-inset"
          style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 6, borderLeft: '2px solid var(--violet)' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{ins.title}</span>
            <span
              className="mono"
              style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
                color: 'var(--violet)',
                padding: '2px 6px', borderRadius: 4,
                background: 'color-mix(in srgb, var(--violet) 12%, transparent)',
                border: '1px solid color-mix(in srgb, var(--violet) 30%, transparent)',
              }}
            >
              POSSIBLE PATTERN
            </span>
          </div>
          {ins.body && (
            <div style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>{ins.body}</div>
          )}
          {ins.evidence && (
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-faint)' }}>
              {ins.evidence}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ reflection -- */

function ReflectionForm({ review }: { review: WeeklyReview }) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState(review.notes ?? '');
  const [focusForNext, setFocusForNext] = useState(review.focusForNext ?? '');
  const [toast, setToast] = useState<string | null>(null);

  const submitted = review.status === 'submitted';

  const submit = useMutation({
    mutationFn: () =>
      api.post<SubmitResponse>(`/api/debrief/${review.id}/submit`, {
        notes: notes.trim(),
        focusForNext: focusForNext.trim(),
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['debrief', 'latest'] });
      qc.invalidateQueries({ queryKey: ['debrief', 'list'] });
      qc.invalidateQueries({ queryKey: ['player'] });
      setToast(res?.rewarded ? '+40 XP / +20 €$ — debrief filed' : 'Reflection saved.');
    },
  });

  // Auto-dismiss the toast after a few seconds.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const submitLabel = useMemo(() => {
    if (submit.isPending) return submitted ? 'SAVING…' : 'FILING…';
    return submitted ? 'UPDATE REFLECTION' : 'FILE DEBRIEF';
  }, [submit.isPending, submitted]);

  return (
    <div className="panel" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="kicker" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon name="flag" size={13} style={{ color: 'var(--cyan)' }} /> OPERATOR REFLECTION
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="kicker" style={{ color: 'var(--text-faint)' }}>DEBRIEF</span>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="What actually happened this week?"
          rows={5}
          style={{ ...inputStyle, resize: 'vertical', minHeight: 96, lineHeight: 1.5 }}
        />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="kicker" style={{ color: 'var(--text-faint)' }}>ORDERS FOR NEXT CYCLE</span>
        <input
          value={focusForNext}
          onChange={e => setFocusForNext(e.target.value)}
          placeholder="Orders for next cycle — one focus."
          style={inputStyle}
        />
      </label>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button
          className="btn btn-primary"
          disabled={submit.isPending}
          onClick={() => submit.mutate()}
          style={{ padding: '9px 18px', fontSize: 12, fontWeight: 700, letterSpacing: '0.06em' }}
        >
          <Icon name="check" size={13} /> {submitLabel}
        </button>

        {submit.isError && (
          <span className="mono" style={{ fontSize: 11, color: 'var(--red)' }}>
            COULDN&rsquo;T FILE — TRY AGAIN
          </span>
        )}

        {toast && (
          <span
            className="mono"
            style={{
              fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
              color: 'var(--lime)',
              padding: '4px 10px', borderRadius: 6,
              background: 'color-mix(in srgb, var(--lime) 12%, transparent)',
              border: '1px solid color-mix(in srgb, var(--lime) 35%, transparent)',
            }}
          >
            {toast}
          </span>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- shared -- */

function Empty({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div className="panel hud" style={{ padding: 48, textAlign: 'center', color: color ?? 'var(--text-faint)' }}>
      <div className="mono" style={{ fontSize: 13, lineHeight: 1.6, maxWidth: 560, margin: '0 auto' }}>
        {children}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '10px 12px',
  background: 'var(--panel-2)',
  border: '1px solid var(--line-2)',
  borderRadius: 'var(--r-sm)',
  color: 'var(--text)',
  fontFamily: 'var(--font-mono)',
  fontSize: 13,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};
