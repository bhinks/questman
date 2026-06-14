/**
 * MediaEstimator — auto-estimate the *length* of a media item from the web,
 * for the Braindance/Media planner. The redesign cares about exactly four
 * data points and nothing else (no cover art, no blurbs):
 *
 *   book  → page count                         (Open Library, KEYLESS)
 *   movie → runtime in minutes                 (TMDb, needs TMDB_API_KEY)
 *   show  → episode count + per-episode minutes (TMDb, needs TMDB_API_KEY)
 *   game  → main-story hours (time-to-beat)     (IGDB preferred → HLTB fallback)
 *
 * Design constraints:
 *   - Never throw. ANY failure (network, timeout, bad shape, missing key)
 *     returns null so the caller falls back to manual entry.
 *   - global fetch with a ~6s timeout so a slow upstream can't hang a request.
 *   - Reliability first: each source picks the best title match (not just the
 *     first hit) and has a fallback for the one datum that matters.
 *
 * Units convention (mirrors MediaItem): estMinutes = total time commitment;
 * totalUnits = pages (book) / episodes (show). The explicit per-medium fields
 * (pages/episodes/perEpMin/runtimeMin/gameHours) are surfaced so the add form
 * can show "412 pages" / "9 eps · 40m" directly.
 */

export type MediaType = 'movie' | 'show' | 'game' | 'book';

export interface MediaEstimate {
  // Explicit, medium-specific length data — the only thing we care about.
  pages?: number;       // book
  episodes?: number;    // show
  perEpMin?: number;    // show — minutes per episode
  runtimeMin?: number;  // movie
  gameHours?: number;   // game — main-story time-to-beat

  // Derived totals (kept so the existing create route + UI adapter keep working).
  estMinutes?: number;  // total time commitment
  totalUnits?: number;  // pages | episodes

  externalId?: string;
  externalSource?: string;  // "openlibrary" | "tmdb" | "igdb" | "howlongtobeat"
  meta?: Record<string, unknown>; // readingMinPerPage / avgEpisodeRuntime / mainStoryHours / matchedTitle
}

/** Brent reads slowly — default minutes-per-page used for book time estimates. */
export const DEFAULT_READING_MIN_PER_PAGE = 3;

const TIMEOUT_MS = 6000;

/** fetch JSON with an abort timeout. Returns null on ANY failure. */
async function fetchJson<T = any>(url: string, init?: RequestInit): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// --- tiny coercion helpers ----------------------------------------------

/** A finite POSITIVE number, else undefined (0 / negative / NaN read as "unknown"). */
function pos(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
function norm(s: unknown): string {
  return String(s ?? '').trim().toLowerCase();
}
/** Pick the search hit that best matches the query: exact title first, then by
 *  popularity (TMDb returns it), else the first result. */
function bestMatch<T extends Record<string, any>>(results: T[] | undefined, title: string, nameKey: 'title' | 'name'): T | undefined {
  if (!Array.isArray(results) || results.length === 0) return undefined;
  const want = norm(title);
  const exact = results.filter(r => norm(r[nameKey]) === want);
  const pool = exact.length ? exact : results;
  return [...pool].sort((a, b) => (pos(b.popularity) ?? 0) - (pos(a.popularity) ?? 0))[0];
}
const median = (nums: number[]): number | undefined =>
  nums.length ? [...nums].sort((a, b) => a - b)[Math.floor(nums.length / 2)] : undefined;

// --- books: Open Library (keyless) --------------------------------------

/**
 * Open Library. Search by title for the best page count; if the top hit's
 * median page count is missing, fall back to scanning its work editions.
 */
async function estimateBook(title: string): Promise<MediaEstimate | null> {
  const url = `https://openlibrary.org/search.json?title=${encodeURIComponent(title)}`
    + `&fields=key,title,number_of_pages_median,edition_count&limit=10`;
  const docs = (await fetchJson<{ docs?: any[] }>(url))?.docs;
  if (!Array.isArray(docs) || docs.length === 0) return null;

  // Prefer an exact-ish title match that exposes pages; else the first with pages.
  const want = norm(title);
  const ranked = [...docs].sort((a, b) => {
    const ax = norm(a.title) === want ? 1 : 0, bx = norm(b.title) === want ? 1 : 0;
    if (ax !== bx) return bx - ax;
    return (pos(b.edition_count) ?? 0) - (pos(a.edition_count) ?? 0);
  });
  let doc = ranked.find(d => pos(d.number_of_pages_median)) ?? ranked[0];
  let pages = pos(doc?.number_of_pages_median);

  // Fallback: scan the top work's editions for a real page count (median).
  if (pages == null && typeof ranked[0]?.key === 'string') {
    doc = ranked[0];
    pages = await pagesFromEditions(ranked[0].key);
  }
  if (pages == null) return null;

  pages = Math.round(pages);
  return {
    pages,
    totalUnits: pages,
    estMinutes: Math.round(pages * DEFAULT_READING_MIN_PER_PAGE),
    externalId: typeof doc?.key === 'string' ? doc.key : undefined,
    externalSource: 'openlibrary',
    meta: {
      pageCount: pages,
      readingMinPerPage: DEFAULT_READING_MIN_PER_PAGE,
      ...(typeof doc?.title === 'string' ? { matchedTitle: doc.title } : {}),
    },
  };
}

/** Median page count across a work's editions (workKey like "/works/OL..W"). */
async function pagesFromEditions(workKey: string): Promise<number | undefined> {
  const data = await fetchJson<{ entries?: any[] }>(`https://openlibrary.org${workKey}/editions.json?limit=50`);
  const counts = (data?.entries ?? [])
    .map(e => pos(e?.number_of_pages))
    .filter((n): n is number => n != null);
  return median(counts);
}

// --- movies + shows: TMDb (TMDB_API_KEY) --------------------------------

/** TMDb movie → authoritative runtime from the detail endpoint. */
async function estimateMovie(title: string, apiKey: string): Promise<MediaEstimate | null> {
  const search = await fetchJson<{ results?: any[] }>(
    `https://api.themoviedb.org/3/search/movie?api_key=${encodeURIComponent(apiKey)}`
    + `&query=${encodeURIComponent(title)}&include_adult=false`,
  );
  const hit = bestMatch(search?.results, title, 'title');
  if (!hit?.id) return null;

  const detail = await fetchJson<{ runtime?: number; title?: string }>(
    `https://api.themoviedb.org/3/movie/${hit.id}?api_key=${encodeURIComponent(apiKey)}`,
  );
  const runtimeMin = pos(detail?.runtime);
  if (runtimeMin == null) return null; // runtime is the entire point for a movie

  return {
    runtimeMin,
    estMinutes: runtimeMin,
    externalId: String(hit.id),
    externalSource: 'tmdb',
    meta: { runtime: runtimeMin, ...(detail?.title ? { matchedTitle: detail.title } : {}) },
  };
}

/** TMDb show → episode count + per-episode minutes (with robust fallbacks). */
async function estimateShow(title: string, apiKey: string): Promise<MediaEstimate | null> {
  const search = await fetchJson<{ results?: any[] }>(
    `https://api.themoviedb.org/3/search/tv?api_key=${encodeURIComponent(apiKey)}`
    + `&query=${encodeURIComponent(title)}&include_adult=false`,
  );
  const hit = bestMatch(search?.results, title, 'name');
  if (!hit?.id) return null;

  const detail = await fetchJson<{
    episode_run_time?: number[];
    number_of_episodes?: number;
    last_episode_to_air?: { runtime?: number };
    next_episode_to_air?: { runtime?: number };
    name?: string;
  }>(`https://api.themoviedb.org/3/tv/${hit.id}?api_key=${encodeURIComponent(apiKey)}`);

  const episodes = pos(detail?.number_of_episodes);
  if (episodes == null) return null; // episode count is the key datum

  // episode_run_time is often empty on modern/streaming shows — fall back to a
  // concrete recent-episode runtime, then to a sane default so we still answer.
  const runtimes = Array.isArray(detail?.episode_run_time) ? detail!.episode_run_time.filter(n => pos(n)) : [];
  const perEpMin = runtimes.length
    ? Math.round(runtimes.reduce((a, b) => a + b, 0) / runtimes.length)
    : (pos(detail?.last_episode_to_air?.runtime) ?? pos(detail?.next_episode_to_air?.runtime) ?? 45);

  return {
    episodes: Math.round(episodes),
    perEpMin,
    totalUnits: Math.round(episodes),
    estMinutes: Math.round(episodes) * perEpMin,
    externalId: String(hit.id),
    externalSource: 'tmdb',
    meta: { episodeCount: Math.round(episodes), avgEpisodeRuntime: perEpMin, ...(detail?.name ? { matchedTitle: detail.name } : {}) },
  };
}

// --- games: IGDB (preferred) → HowLongToBeat (fallback) ------------------

/** Build a game estimate from main-story hours. */
function gameEstimate(hours: number, source: string, externalId?: string, matchedTitle?: string): MediaEstimate {
  const gameHours = Math.round(hours * 10) / 10;
  return {
    gameHours,
    estMinutes: Math.round(gameHours * 60),
    externalId,
    externalSource: source,
    meta: { mainStoryHours: gameHours, ...(matchedTitle ? { matchedTitle } : {}) },
  };
}

// IGDB app-access-token cache (Twitch client-credentials flow).
let igdbToken: { value: string; expiresAt: number } | null = null;
async function getIgdbToken(clientId: string, clientSecret: string): Promise<string | null> {
  if (igdbToken && igdbToken.expiresAt > Date.now() + 60_000) return igdbToken.value;
  const data = await fetchJson<{ access_token?: string; expires_in?: number }>(
    `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(clientId)}`
    + `&client_secret=${encodeURIComponent(clientSecret)}&grant_type=client_credentials`,
    { method: 'POST' },
  );
  if (!data?.access_token) return null;
  igdbToken = { value: data.access_token, expiresAt: Date.now() + (pos(data.expires_in) ?? 3600) * 1000 };
  return igdbToken.value;
}

/**
 * IGDB — the reliable, documented game-length source. Search the game, then
 * read its time-to-beat (`normally`, seconds). Needs a free Twitch app
 * (TWITCH_CLIENT_ID + TWITCH_CLIENT_SECRET).
 */
async function estimateGameIgdb(title: string): Promise<MediaEstimate | null> {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const token = await getIgdbToken(clientId, clientSecret);
  if (!token) return null;
  const headers = { 'Client-ID': clientId, Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' };

  const games = await fetchJson<any[]>('https://api.igdb.com/v4/games', {
    method: 'POST', headers,
    body: `search "${title.replace(/"/g, '')}"; fields id,name; limit 5;`,
  });
  const game = bestMatch(games ?? undefined, title, 'name');
  if (!game?.id) return null;

  // game_time_to_beats: seconds for hastily / normally / completely.
  const ttb = await fetchJson<any[]>('https://api.igdb.com/v4/game_time_to_beats', {
    method: 'POST', headers,
    body: `fields normally,hastily,completely; where game_id = ${game.id}; limit 1;`,
  });
  const seconds = pos(ttb?.[0]?.normally) ?? pos(ttb?.[0]?.hastily) ?? pos(ttb?.[0]?.completely);
  if (seconds == null) return null;

  return gameEstimate(seconds / 3600, 'igdb', String(game.id), typeof game.name === 'string' ? game.name : undefined);
}

/**
 * HowLongToBeat fallback. HLTB has no official API and changes its request
 * signature without notice, so this is best-effort and degrades to null. IGDB
 * above is the reliable path; this only runs when Twitch creds aren't set.
 */
async function estimateGameHltb(title: string): Promise<MediaEstimate | null> {
  const data = await fetchJson<{ data?: any[] }>('https://howlongtobeat.com/api/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; Questman/1.0)',
      Referer: 'https://howlongtobeat.com/',
      Origin: 'https://howlongtobeat.com',
    },
    body: JSON.stringify({
      searchType: 'games',
      searchTerms: title.split(/\s+/).filter(Boolean),
      searchPage: 1, size: 5,
      searchOptions: { games: { userId: 0, platform: '', sortCategory: 'popular' } },
    }),
  });
  const hit = bestMatch(data?.data, title, 'name' as any) ?? data?.data?.[0];
  const seconds = pos(hit?.comp_main); // HLTB returns main-story time in seconds
  if (seconds == null) return null;
  return gameEstimate(seconds / 3600, 'howlongtobeat', hit?.game_id != null ? String(hit.game_id) : undefined,
    typeof hit?.game_name === 'string' ? hit.game_name : undefined);
}

async function estimateGame(title: string): Promise<MediaEstimate | null> {
  return (await estimateGameIgdb(title)) ?? (await estimateGameHltb(title));
}

// --- dispatcher ----------------------------------------------------------

/**
 * Estimate the length of a media item. Returns null when nothing useful can be
 * derived (caller falls back to manual entry). Never throws.
 */
export async function estimateMedia(type: MediaType, title: string): Promise<MediaEstimate | null> {
  const clean = title?.trim();
  if (!clean) return null;

  try {
    switch (type) {
      case 'book':
        return await estimateBook(clean);
      case 'movie': {
        const key = process.env.TMDB_API_KEY;
        return key ? await estimateMovie(clean, key) : null;
      }
      case 'show': {
        const key = process.env.TMDB_API_KEY;
        return key ? await estimateShow(clean, key) : null;
      }
      case 'game':
        return await estimateGame(clean);
      default:
        return null;
    }
  } catch {
    return null; // belt-and-suspenders: never throw out of the estimator
  }
}
