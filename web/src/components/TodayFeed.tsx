/**
 * TodayFeed — the CITY FEED column on the Today page.
 *
 * Born from Brent's big-monitor pass: Today had a sea of margin past 1320px,
 * while bosses, insights, cold contacts, and (new) the calendar agenda lived
 * on other screens. These compact panels surface them in a third column at
 * ≥1600px (`.today-feed` grid area; below that they stack under the rail).
 *
 * Every panel is best-effort and self-hiding: no data → render nothing, and
 * if EVERYTHING is quiet a single ALL QUIET card keeps the column from being
 * a void. All queries share cache keys with the owning views (['bosses'],
 * ['insights'], ['npcs']) so mutations here keep those screens in sync.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type {
  Boss, CalendarTodayResponse, Insight, InsightsResponse, Npc,
} from '../lib/api';
import { Icon } from './Icon';

const KICKER: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  letterSpacing: '0.26em',
  color: 'var(--text-dim)',
  textTransform: 'uppercase',
};

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function fmtHm(min: number): string {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h > 0 ? `${h}H ${m ? `${m}M` : ''}`.trim() : `${m}M`;
}

export function CityFeed() {
  const calendarQ = useQuery({
    queryKey: ['calendar', 'today'],
    queryFn: () => api.get<CalendarTodayResponse>('/api/calendar/today'),
    staleTime: 5 * 60_000,
  });
  const bossesQ = useQuery({
    queryKey: ['bosses'],
    queryFn: () => api.get<{ bosses: Boss[] }>('/api/bosses').then(r => r.bosses),
  });
  const insightsQ = useQuery({
    queryKey: ['insights'],
    queryFn: () => api.get<InsightsResponse>('/api/insights'),
  });
  const npcsQ = useQuery({
    queryKey: ['npcs'],
    queryFn: () => api.get<{ npcs: Npc[] }>('/api/npcs').then(r => r.npcs),
  });

  const cal = calendarQ.data?.configured ? calendarQ.data.calendar : null;
  const bosses = (bossesQ.data ?? []).filter(b => b.status === 'active').slice(0, 3);
  const patterns = (insightsQ.data?.insights ?? []).filter(i => i.status === 'new').slice(0, 3);
  const cold = (npcsQ.data ?? [])
    .filter(n => n.daysSinceContact == null || n.daysSinceContact >= (n.cadenceDays ?? 21))
    .slice(0, 4);

  const allQuiet = !cal && bosses.length === 0 && patterns.length === 0 && cold.length === 0;
  // Until the first responses land, render nothing rather than ALL QUIET.
  const settled = !calendarQ.isPending && !bossesQ.isPending && !insightsQ.isPending && !npcsQ.isPending;

  if (allQuiet && !settled) return null;
  if (allQuiet) {
    return (
      <div className="panel" style={{ padding: '15px 18px', textAlign: 'center' }}>
        <div style={KICKER}>CITY FEED</div>
        <div className="mono" style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--text-faint)', marginTop: 8 }}>
          ALL QUIET — NO BOSSES, PATTERNS, OR COLD CONTACTS
        </div>
      </div>
    );
  }

  return (
    <>
      {cal && <AgendaPanel cal={cal} />}
      {bosses.length > 0 && <BossOpsPanel bosses={bosses} />}
      {patterns.length > 0 && <PatternWatchPanel patterns={patterns} />}
      {cold.length > 0 && <ColdContactsPanel npcs={cold} />}
    </>
  );
}

/** GRID SCHEDULE — today's calendar agenda from the ICS uplink. */
function AgendaPanel({ cal }: { cal: NonNullable<CalendarTodayResponse['calendar']> }) {
  const shown = cal.events.slice(0, 4);
  const now = Date.now();
  return (
    <div className="panel" style={{ padding: '15px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 11 }}>
        <span style={KICKER}>GRID SCHEDULE</span>
        <span style={{ flex: 1 }} />
        <span className="ncx-serial">CAL.UPLINK</span>
      </div>
      {shown.length === 0 ? (
        <div className="mono" style={{ fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-faint)' }}>
          CLEAR GRID — NO COMMITMENTS TODAY
        </div>
      ) : shown.map((e, i) => {
        const past = !e.allDay && new Date(e.endsAt).getTime() < now;
        return (
          <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '5px 0', opacity: past ? 0.45 : 1 }}>
            <span className="ncx-val mono" style={{ fontSize: 11, color: 'var(--cyan)', flexShrink: 0, minWidth: 86 }}>
              {e.allDay ? 'ALL DAY' : `${hhmm(e.startsAt)}–${hhmm(e.endsAt)}`}
            </span>
            <span style={{ fontSize: 12.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {e.title}
            </span>
          </div>
        );
      })}
      <div className="mono" style={{ display: 'flex', gap: 12, fontSize: 10, letterSpacing: '0.14em', marginTop: 10, paddingTop: 9, borderTop: '1px solid var(--line)' }}>
        <span style={{ color: 'var(--lime)' }}>FREE {fmtHm(cal.freeMin)}</span>
        <span style={{ color: 'var(--text-faint)' }}>BUSY {fmtHm(cal.busyMin)}</span>
        {cal.nextEvent && (
          <span style={{ color: 'var(--amber)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            ▴ NEXT {hhmm(cal.nextEvent.startsAt)}
          </span>
        )}
      </div>
    </div>
  );
}

/** BOSS OPS — active bosses with HP bars (shares ['bosses'] with BossesView). */
function BossOpsPanel({ bosses }: { bosses: Boss[] }) {
  return (
    <div className="panel" style={{ padding: '15px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 11 }}>
        <span style={KICKER}>BOSS OPS</span>
        <span style={{ flex: 1 }} />
        <span className="ncx-serial">{bosses.length} ACTIVE</span>
      </div>
      {bosses.map(b => (
        <div key={b.id} style={{ padding: '6px 0' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 5 }}>
            <span style={{ fontSize: 12.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {b.name}
            </span>
            <span style={{ flex: 1 }} />
            <span className="ncx-val mono" style={{ fontSize: 11, color: b.color ?? 'var(--cyan)' }}>
              {b.pct}% DOWN
            </span>
          </div>
          <div className="ncx-bar">
            <i
              style={{
                width: `${b.pct}%`,
                background: b.color ?? 'linear-gradient(90deg, var(--cyan-deep), var(--cyan))',
              }}
            />
            <span className="seg-mask" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** PATTERN WATCH — new insights with inline ACCEPT/DISMISS (mirrors HandlerView). */
function PatternWatchPanel({ patterns }: { patterns: Insight[] }) {
  const qc = useQueryClient();
  const act = useMutation({
    mutationFn: ({ id, verb }: { id: string; verb: 'accept' | 'dismiss' }) =>
      api.post(`/api/insights/${id}/${verb}`),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['insights'] });
      if (vars.verb === 'accept') {
        // Accept spawns a server-owned quest — refresh the board.
        qc.invalidateQueries({ queryKey: ['quests', 'today'] });
        qc.invalidateQueries({ queryKey: ['quests', 'plan'] });
        qc.invalidateQueries({ queryKey: ['player'] });
      }
    },
  });

  return (
    <div className="panel" style={{ padding: '15px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 11 }}>
        <span style={KICKER}>PATTERN WATCH</span>
        <span style={{ flex: 1 }} />
        <span className="ncx-serial">POSSIBLE — NOT VERDICTS</span>
      </div>
      {patterns.map(p => (
        <div key={p.id} style={{ padding: '7px 0', borderTop: '1px solid var(--line)' }}>
          <div style={{ fontSize: 12.5, color: 'var(--text)' }}>{p.title}</div>
          {p.evidence && (
            <div className="mono" style={{ fontSize: 9.5, letterSpacing: '0.06em', color: 'var(--text-faint)', marginTop: 3, lineHeight: 1.5 }}>
              {p.evidence}
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
            {p.actionType !== 'none' && (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={act.isPending}
                style={{ padding: '4px 10px', fontSize: 9.5, color: 'var(--lime)' }}
                onClick={() => act.mutate({ id: p.id, verb: 'accept' })}
              >
                <Icon name="check" size={11} /> ACCEPT
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost"
              disabled={act.isPending}
              style={{ padding: '4px 10px', fontSize: 9.5, color: 'var(--text-faint)' }}
              onClick={() => act.mutate({ id: p.id, verb: 'dismiss' })}
            >
              <Icon name="close" size={11} /> DISMISS
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** COLD CONTACTS — roster entries past cadence, with a one-tap PING logger. */
function ColdContactsPanel({ npcs }: { npcs: Npc[] }) {
  const qc = useQueryClient();
  const ping = useMutation({
    mutationFn: (id: string) =>
      api.post(`/api/npcs/${id}/interactions`, { date: new Date().toISOString() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['npcs'] });
      // Logging contact may complete a social quest.
      qc.invalidateQueries({ queryKey: ['quests', 'today'] });
    },
  });

  return (
    <div className="panel" style={{ padding: '15px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 11 }}>
        <span style={KICKER}>COLD CONTACTS</span>
        <span style={{ flex: 1 }} />
        <span className="ncx-serial">PAST CADENCE</span>
      </div>
      {npcs.map(n => (
        <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
          <span style={{ fontSize: 12.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {n.name}
          </span>
          <span style={{ flex: 1 }} />
          <span className="ncx-val mono" style={{ fontSize: 11, color: (n.daysSinceContact ?? 99) >= 2 * (n.cadenceDays ?? 21) ? 'var(--red)' : 'var(--amber)', flexShrink: 0 }}>
            {n.daysSinceContact == null ? 'NEVER' : `${n.daysSinceContact}D`}
          </span>
          <button
            type="button"
            className="btn btn-ghost"
            title="Log contact now"
            disabled={ping.isPending}
            style={{ padding: '4px 9px', fontSize: 9.5, flexShrink: 0 }}
            onClick={() => ping.mutate(n.id)}
          >
            <Icon name="zap" size={11} /> PING
          </button>
        </div>
      ))}
    </div>
  );
}
