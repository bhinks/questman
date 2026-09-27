/**
 * SteamView — Steam library integration.
 *
 * Two panels:
 *   1. GAMING TIME — weekly hours from Steam's 2-week playtime data, with a
 *      list of recently-played games. Helps evaluate whether cutbacks are needed.
 *   2. LIBRARY SCANNER — browseable list of all synced games, filterable by
 *      played / unplayed / recent. "QUEUE" pushes a game into the Braindance
 *      library as a MediaItem so it generates quests.
 *
 * Data source: local SteamGame cache (POST /api/steam/sync to refresh).
 * Reads: GET /api/steam (status + summary), GET /api/steam/games (full list).
 * Writes: POST /api/steam/sync, POST /api/steam/games/:appId/add-to-media.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Icon } from './Icon';

// --- Types ------------------------------------------------------------------

interface SteamGame {
  id: string;
  appId: string;
  name: string;
  playtimeTotal: number;   // minutes all-time
  playtime2Weeks: number;  // minutes last 14 days
  lastPlayedAt: string | null;
  iconUrl: string | null;
  mediaItemId: string | null;
}

interface SteamStatusResponse {
  configured: boolean;
  serverKey?: boolean;
  totalGames?: number;
  unplayedGames?: number;
  lastSyncedAt?: string | null;
  weeklyMinutes?: number;
  weeklyHours?: number;
  recentGames?: SteamGame[];
}

interface SteamGamesResponse {
  games: SteamGame[];
  count: number;
}

interface SteamSyncResponse {
  synced: number;
  added: number;
  updated: number;
  totalGames: number;
  unplayedGames: number;
  syncedAt: string;
}

interface AddToMediaResponse {
  mediaItem: { id: string; title: string };
  alreadyLinked: boolean;
}

// --- Helpers ----------------------------------------------------------------

function fmtHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function relativeDate(iso: string | null): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

type Filter = 'all' | 'unplayed' | 'played' | 'recent';
type Panel = 'time' | 'library';

const PANEL_LABELS: [Panel, string][] = [['time', 'GAMING TIME'], ['library', 'LIBRARY SCANNER']];
const FILTER_LABELS: [Filter, string][] = [
  ['all', 'ALL'], ['unplayed', 'UNPLAYED'], ['played', 'PLAYED'], ['recent', 'RECENT'],
];

// --- Component --------------------------------------------------------------

export function SteamView() {
  const qc = useQueryClient();
  const [panel, setPanel] = useState<Panel>('time');
  const [filter, setFilter] = useState<Filter>('all');
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [addingId, setAddingId] = useState<string | null>(null);

  const statusQuery = useQuery({
    queryKey: ['steam', 'status'],
    queryFn: () => api.get<SteamStatusResponse>('/api/steam'),
    staleTime: 60_000,
  });

  const gamesQuery = useQuery({
    queryKey: ['steam', 'games', filter],
    queryFn: () => api.get<SteamGamesResponse>(`/api/steam/games?filter=${filter}`),
    staleTime: 60_000,
    enabled: panel === 'library',
  });

  const syncMutation = useMutation({
    mutationFn: () => api.post<SteamSyncResponse>('/api/steam/sync', {}),
    onSuccess: (data) => {
      setSyncMsg(`Synced ${data.synced} games (+${data.added} new)`);
      qc.invalidateQueries({ queryKey: ['steam'] });
      setTimeout(() => setSyncMsg(null), 4000);
    },
    onError: (err: any) => {
      setSyncMsg(`Sync failed: ${err?.message ?? 'unknown error'}`);
    },
  });

  const addToMediaMutation = useMutation({
    mutationFn: (appId: string) =>
      api.post<AddToMediaResponse>(`/api/steam/games/${appId}/add-to-media`, {}),
    onSuccess: (_data, appId) => {
      setAddedIds(prev => new Set([...prev, appId]));
      setAddingId(null);
      qc.invalidateQueries({ queryKey: ['steam'] });
      qc.invalidateQueries({ queryKey: ['media'] });
    },
    onError: () => setAddingId(null),
  });

  const handleAddToMedia = (appId: string) => {
    setAddingId(appId);
    addToMediaMutation.mutate(appId);
  };

  const status = statusQuery.data;

  if (statusQuery.isLoading) {
    return (
      <div className="fade-up" style={{ color: 'var(--text-faint)', padding: '24px 0' }}>
        <span className="mono">UPLINK...</span>
      </div>
    );
  }

  if (!status?.configured) {
    return <SteamConnect serverKey={!!status?.serverKey} onDone={() => qc.invalidateQueries({ queryKey: ['steam'] })} />;
  }

  const games = gamesQuery.data?.games ?? [];

  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Header bar */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <span className="mono" style={{ color: 'var(--cyan)', fontSize: '0.625rem', letterSpacing: '0.1em' }}>
              STEAM // LIBRARY
            </span>
            {status.totalGames != null && (
              <span style={{ color: 'var(--text-faint)', fontSize: '0.75rem' }}>
                {status.totalGames} games · {status.unplayedGames} unplayed
              </span>
            )}
          </div>
          {status.lastSyncedAt && (
            <div style={{ color: 'var(--text-faint)', fontSize: '0.6875rem', marginTop: 2 }}>
              last sync {relativeDate(status.lastSyncedAt)}
            </div>
          )}
        </div>

        <button
          className="btn-ghost mono"
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
          style={{ fontSize: '0.6875rem', letterSpacing: '0.08em' }}
        >
          <Icon name="target" size={12} />
          {syncMutation.isPending ? 'SYNCING...' : 'SYNC LIBRARY'}
        </button>
      </div>

      {syncMsg && (
        <div className="mono" style={{
          fontSize: '0.6875rem', color: 'var(--cyan)', background: 'var(--panel-2)',
          border: '1px solid var(--line-2)', borderRadius: 3, padding: '7px 12px',
        }}>
          {syncMsg}
        </div>
      )}

      {/* Panel switcher */}
      <div style={{ display: 'flex', gap: 6 }}>
        {PANEL_LABELS.map(([p, label]) => (
          <button
            key={p}
            className="mono"
            onClick={() => setPanel(p)}
            style={{
              fontSize: '0.625rem', padding: '5px 14px', cursor: 'pointer', borderRadius: 0,
              border: panel === p ? '1px solid rgba(var(--accent-rgb),0.55)' : '1px solid var(--line-2)',
              background: panel === p ? 'rgba(var(--accent-rgb),0.12)' : 'var(--panel-2)',
              color: panel === p ? 'var(--cyan)' : 'var(--text-dim)',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* GAMING TIME panel */}
      {panel === 'time' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <StatCard
              label="THIS PERIOD"
              value={status.weeklyHours != null ? `${status.weeklyHours}h` : '--'}
              sub="Steam 2-week window"
              accent="var(--cyan)"
            />
            <StatCard
              label="UNPLAYED"
              value={status.unplayedGames != null ? String(status.unplayedGames) : '--'}
              sub="games at 0 min"
              accent="var(--violet)"
            />
            <StatCard
              label="OWNED"
              value={status.totalGames != null ? String(status.totalGames) : '--'}
              sub="total library"
              accent="var(--lime)"
            />
          </div>

          {status.recentGames && status.recentGames.length > 0 ? (
            <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{
                padding: '8px 16px', borderBottom: '1px solid var(--line-2)',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span className="mono" style={{ color: 'var(--text-faint)', fontSize: '0.625rem', letterSpacing: '0.1em' }}>
                  RECENTLY PLAYED
                </span>
              </div>
              {status.recentGames.map(g => (
                <RecentGameRow key={g.appId} game={g} />
              ))}
            </div>
          ) : status.totalGames != null && status.totalGames > 0 ? (
            <div style={{ color: 'var(--text-faint)', fontSize: '0.8125rem', padding: '8px 0' }}>
              No games played in the Steam 2-week window. Sync again after some playtime.
            </div>
          ) : (
            <div style={{ color: 'var(--text-faint)', fontSize: '0.8125rem', padding: '8px 0' }}>
              No data yet. Hit <strong>SYNC LIBRARY</strong> to pull your Steam library.
            </div>
          )}
        </div>
      )}

      {/* LIBRARY SCANNER panel */}
      {panel === 'library' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Filter buttons */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {FILTER_LABELS.map(([f, label]) => (
              <button
                key={f}
                className="mono"
                onClick={() => setFilter(f)}
                style={{
                  fontSize: '0.625rem', padding: '4px 12px', cursor: 'pointer', borderRadius: 0,
                  border: filter === f ? '1px solid rgba(var(--accent-rgb),0.55)' : '1px solid var(--line-2)',
                  background: filter === f ? 'rgba(var(--accent-rgb),0.12)' : 'var(--panel-2)',
                  color: filter === f ? 'var(--cyan)' : 'var(--text-dim)',
                }}
              >
                {label}
              </button>
            ))}
            {gamesQuery.data && (
              <span style={{ color: 'var(--text-faint)', fontSize: '0.6875rem' }}>
                {gamesQuery.data.count} game{gamesQuery.data.count !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {gamesQuery.isLoading && (
            <div className="mono" style={{ color: 'var(--text-faint)', fontSize: '0.6875rem' }}>LOADING...</div>
          )}

          {!gamesQuery.isLoading && games.length === 0 && (
            <div style={{ color: 'var(--text-faint)', fontSize: '0.8125rem' }}>
              {status.totalGames === 0
                ? 'No library synced yet. Hit SYNC LIBRARY above.'
                : 'No games match this filter.'}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {games.map(g => {
              const isAdded = !!(g.mediaItemId || addedIds.has(g.appId));
              const isAdding = addingId === g.appId;
              return (
                <GameRow
                  key={g.appId}
                  game={g}
                  isAdding={isAdding}
                  isAdded={isAdded}
                  onAddToMedia={() => handleAddToMedia(g.appId)}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Sub-components ---------------------------------------------------------

function StatCard({ label, value, sub, accent }: {
  label: string; value: string; sub?: string; accent: string;
}) {
  return (
    <div className="panel" style={{ padding: '14px 16px' }}>
      <div className="mono" style={{ color: accent, fontSize: '0.5625rem', letterSpacing: '0.12em', marginBottom: 6 }}>{label}</div>
      <div className="mono" style={{ fontSize: '1.625rem', fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>
        {value}
      </div>
      {sub && <div style={{ color: 'var(--text-faint)', fontSize: '0.6875rem', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function RecentGameRow({ game }: { game: SteamGame }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
      borderBottom: '1px solid var(--line-2)',
    }}>
      {game.iconUrl ? (
        <img src={game.iconUrl} alt="" width={32} height={32} style={{ borderRadius: 3, flexShrink: 0 }} />
      ) : (
        <div style={{ width: 32, height: 32, borderRadius: 3, background: 'var(--panel-2)', flexShrink: 0 }} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          color: 'var(--text)', fontSize: '0.8125rem', fontWeight: 500,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {game.name}
        </div>
        <div style={{ color: 'var(--text-faint)', fontSize: '0.6875rem' }}>
          {fmtHours(game.playtimeTotal)} total · last played {relativeDate(game.lastPlayedAt)}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div className="mono" style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--cyan)' }}>
          {fmtHours(game.playtime2Weeks)}
        </div>
        <div style={{ color: 'var(--text-faint)', fontSize: '0.625rem' }}>this period</div>
      </div>
    </div>
  );
}

function GameRow({ game, isAdding, isAdded, onAddToMedia }: {
  game: SteamGame;
  isAdding: boolean;
  isAdded: boolean;
  onAddToMedia: () => void;
}) {
  const unplayed = game.playtimeTotal === 0;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px',
      background: 'var(--panel-2)', border: '1px solid var(--line-2)',
    }}>
      {game.iconUrl ? (
        <img
          src={game.iconUrl} alt=""
          width={28} height={28}
          style={{ borderRadius: 2, flexShrink: 0, opacity: unplayed ? 0.55 : 1 }}
        />
      ) : (
        <div style={{ width: 28, height: 28, borderRadius: 2, background: 'var(--panel)', flexShrink: 0 }} />
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          color: unplayed ? 'var(--text-dim)' : 'var(--text)',
          fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {game.name}
        </div>
        <div style={{ color: 'var(--text-faint)', fontSize: '0.625rem' }}>
          {unplayed
            ? 'unplayed'
            : `${fmtHours(game.playtimeTotal)} · last ${relativeDate(game.lastPlayedAt)}`}
        </div>
      </div>

      {unplayed && (
        <span className="mono" style={{
          fontSize: '0.5rem', letterSpacing: '0.1em', color: 'var(--violet)',
          border: '1px solid var(--violet)', borderRadius: 2, padding: '2px 5px',
          flexShrink: 0,
        }}>
          UNPLAYED
        </span>
      )}

      <button
        className="btn-ghost mono"
        style={{
          fontSize: '0.625rem', flexShrink: 0, padding: '3px 8px',
          letterSpacing: '0.06em',
          opacity: isAdded ? 0.6 : 1,
        }}
        disabled={isAdded || isAdding}
        onClick={onAddToMedia}
        title={isAdded ? 'Already in Braindance queue' : 'Add to Braindance queue'}
      >
        {isAdded ? (
          <><Icon name="check" size={10} /> QUEUED</>
        ) : isAdding ? (
          '...'
        ) : (
          <><Icon name="play" size={10} /> QUEUE</>
        )}
      </button>
    </div>
  );
}


/** First-run "connect Steam" form (per-user since 2026-09-27; it used to say
 *  "set STEAM_API_KEY / STEAM_USER_ID on the server"). Saves to /api/settings,
 *  where the same fields live under Settings → Your integrations. */
function SteamConnect({ serverKey, onDone }: { serverKey: boolean; onDone: () => void }) {
  const [id, setId] = useState('');
  const [key, setKey] = useState('');
  const [err, setErr] = useState('');
  const save = useMutation({
    mutationFn: () => api.put('/api/settings', { steamId: id, ...(key.trim() ? { steamApiKey: key.trim() } : {}) }),
    onSuccess: () => { setErr(''); onDone(); },
    onError: (e: Error) => setErr(e.message || 'Could not save'),
  });
  const ready = /^\d{17}$/.test(id) && (serverKey || /^[0-9A-Fa-f]{32}$/.test(key.trim()));
  const field = {
    width: '100%', background: 'transparent', border: '1px solid var(--line)', color: 'var(--text)',
    fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', padding: '10px 12px',
  } as const;
  return (
    <div className="fade-up">
      <div className="panel" style={{ padding: 24, maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="mono" style={{ color: 'var(--cyan)', fontSize: '0.625rem', letterSpacing: '0.1em' }}>
          STEAM // CONNECT YOUR LIBRARY
        </div>
        <p style={{ color: 'var(--text)', lineHeight: 1.6, margin: 0 }}>
          Link your own Steam account to track playtime and get backlog quests. Only you see your library.
        </p>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="mono" style={{ fontSize: '0.625rem', letterSpacing: '0.14em', color: 'var(--text-dim)' }}>YOUR STEAM ID</span>
          <input style={field} inputMode="numeric" placeholder="76561198000000000" value={id}
            onChange={e => setId(e.target.value.replace(/\D/g, '').slice(0, 17))} />
          <span style={{ color: 'var(--text-faint)', fontSize: '0.75rem', lineHeight: 1.5 }}>
            The 17-digit number in your profile address (steamcommunity.com/profiles/…). If your profile uses a
            custom name, <strong style={{ color: 'var(--text-dim)' }}>steamid.io</strong> will look it up.
          </span>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="mono" style={{ fontSize: '0.625rem', letterSpacing: '0.14em', color: 'var(--text-dim)' }}>
            STEAM WEB API KEY {serverKey ? '(OPTIONAL)' : ''}
          </span>
          <input style={field} type="password" autoComplete="off" placeholder={serverKey ? 'Leave blank to use the hub’s key' : '32 letters and numbers'}
            value={key} onChange={e => setKey(e.target.value)} />
          <span style={{ color: 'var(--text-faint)', fontSize: '0.75rem', lineHeight: 1.5 }}>
            {serverKey ? 'The hub already has a key, so your ID is enough. ' : ''}
            Get your own free key at <strong style={{ color: 'var(--text-dim)' }}>steamcommunity.com/dev/apikey</strong>.
            Set <em>Game details</em> to Public in your Steam privacy settings.
          </span>
        </label>
        {err && <div className="mono" style={{ color: 'var(--red)', fontSize: '0.75rem' }}>{err}</div>}
        <div>
          <button type="button" className="btn btn-primary" disabled={!ready || save.isPending} onClick={() => save.mutate()}>
            <Icon name="check" size={13} /> {save.isPending ? 'LINKING…' : 'LINK STEAM'}
          </button>
        </div>
      </div>
    </div>
  );
}
