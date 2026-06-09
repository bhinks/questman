/**
 * MediaEstimator — auto-estimate the time commitment for a media item
 * using FREE / keyless sources where possible, with graceful fallback to
 * manual entry.
 *
 * Design constraints (see plan.md / media pool spec):
 *   - Never throw. ANY failure (network, timeout, bad shape, missing key)
 *     returns null so the caller falls back to manual entry.
 *   - Use global fetch with a ~6s AbortController timeout so a slow/dead
 *     upstream can never hang a request.
 *   - Keyless first: books use Open Library (no key). Movies/shows use
 *     TMDb ONLY when TMDB_API_KEY is present, else null (manual). Games
 *     have no official API (HowLongToBeat is unofficial), so best-effort
 *     and otherwise null.
 *
 * Units convention (mirrors MediaItem):
 *   - book  → totalUnits = pageCount; estMinutes ≈ pageCount * readingMinPerPage.
 *   - show  → totalUnits = episodeCount; estMinutes ≈ avgEpisodeRuntime * episodeCount.
 *   - movie → estMinutes = runtime (one unit).
 *   - game  → estMinutes ≈ main-story hours * 60 when discoverable.
 */

export type MediaType = 'movie' | 'show' | 'game' | 'book';

export interface MediaEstimate {
  estMinutes?: number;
  totalUnits?: number;
  coverUrl?: string;
  externalId?: string;
  externalSource?: string;
  meta?: Record<string, unknown>;
}

/** Brent reads slowly — default minutes-per-page used for book estimates. */
export const DEFAULT_READING_MIN_PER_PAGE = 3;

const TIMEOUT_MS = 6000;

/** fetch JSON with an abort timeout. Returns null on ANY failure. */
async function fetchJson<T = any>(url: string, headers?: Record<string, string>): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Open Library search (keyless). Returns the first result's page count
 * and cover when available.
 *   https://openlibrary.org/search.json?q=<title>
 */
async function estimateBook(title: string): Promise<MediaEstimate | null> {
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(title)}&limit=5`;
  const data = await fetchJson<{ docs?: any[] }>(url);
  const docs = data?.docs;
  if (!Array.isArray(docs) || docs.length === 0) return null;

  // Prefer the first doc that actually exposes a page count; otherwise
  // fall back to the top hit (so we still capture cover/externalId).
  const withPages = docs.find(d => Number.isFinite(numberOrNan(d?.number_of_pages_median)));
  const doc = withPages ?? docs[0];

  const pageCount = numberOrUndefined(doc?.number_of_pages_median);
  const coverId = numberOrUndefined(doc?.cover_i);
  const olKey: string | undefined = typeof doc?.key === 'string' ? doc.key : undefined; // e.g. "/works/OL12345W"

  const readingMinPerPage = DEFAULT_READING_MIN_PER_PAGE;
  const estMinutes = pageCount != null ? Math.round(pageCount * readingMinPerPage) : undefined;

  // If we found nothing actionable (no pages and no identifying info),
  // treat it as a miss → manual entry.
  if (pageCount == null && coverId == null && !olKey) return null;

  return {
    estMinutes,
    totalUnits: pageCount,
    coverUrl: coverId != null ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg` : undefined,
    externalId: olKey,
    externalSource: 'openlibrary',
    meta: {
      pageCount,
      readingMinPerPage,
      ...(typeof doc?.title === 'string' ? { matchedTitle: doc.title } : {}),
    },
  };
}

/**
 * TMDb movie search — requires TMDB_API_KEY. Fetches the search hit then
 * the movie detail for an authoritative runtime.
 *   https://api.themoviedb.org/3/search/movie?api_key=...&query=...
 */
async function estimateMovie(title: string, apiKey: string): Promise<MediaEstimate | null> {
  const search = await fetchJson<{ results?: any[] }>(
    `https://api.themoviedb.org/3/search/movie?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(title)}`,
  );
  const hit = search?.results?.[0];
  if (!hit?.id) return null;

  const detail = await fetchJson<{ runtime?: number; title?: string; poster_path?: string | null }>(
    `https://api.themoviedb.org/3/movie/${hit.id}?api_key=${encodeURIComponent(apiKey)}`,
  );
  const runtime = numberOrUndefined(detail?.runtime ?? hit?.runtime);
  const posterPath: string | undefined =
    (typeof detail?.poster_path === 'string' && detail.poster_path) ||
    (typeof hit?.poster_path === 'string' && hit.poster_path) || undefined;

  if (runtime == null && !posterPath) return null;

  return {
    estMinutes: runtime,
    coverUrl: posterPath ? `https://image.tmdb.org/t/p/w342${posterPath}` : undefined,
    externalId: String(hit.id),
    externalSource: 'tmdb',
    meta: {
      runtime,
      ...(typeof (detail?.title ?? hit?.title) === 'string' ? { matchedTitle: detail?.title ?? hit.title } : {}),
    },
  };
}

/**
 * TMDb TV search — requires TMDB_API_KEY. estMinutes ≈ avg episode
 * runtime × total episode count.
 *   https://api.themoviedb.org/3/search/tv?api_key=...&query=...
 */
async function estimateShow(title: string, apiKey: string): Promise<MediaEstimate | null> {
  const search = await fetchJson<{ results?: any[] }>(
    `https://api.themoviedb.org/3/search/tv?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(title)}`,
  );
  const hit = search?.results?.[0];
  if (!hit?.id) return null;

  const detail = await fetchJson<{
    episode_run_time?: number[];
    number_of_episodes?: number;
    name?: string;
    poster_path?: string | null;
  }>(`https://api.themoviedb.org/3/tv/${hit.id}?api_key=${encodeURIComponent(apiKey)}`);

  const runtimes = Array.isArray(detail?.episode_run_time) ? detail!.episode_run_time : [];
  const avgRuntime = runtimes.length > 0
    ? Math.round(runtimes.reduce((a, b) => a + b, 0) / runtimes.length)
    : undefined;
  const episodeCount = numberOrUndefined(detail?.number_of_episodes);
  const posterPath: string | undefined =
    (typeof detail?.poster_path === 'string' && detail.poster_path) ||
    (typeof hit?.poster_path === 'string' && hit.poster_path) || undefined;

  const estMinutes = avgRuntime != null && episodeCount != null
    ? avgRuntime * episodeCount
    : undefined;

  if (estMinutes == null && episodeCount == null && !posterPath) return null;

  return {
    estMinutes,
    totalUnits: episodeCount,
    coverUrl: posterPath ? `https://image.tmdb.org/t/p/w342${posterPath}` : undefined,
    externalId: String(hit.id),
    externalSource: 'tmdb',
    meta: {
      episodeCount,
      avgEpisodeRuntime: avgRuntime,
      ...(typeof (detail?.name ?? hit?.name) === 'string' ? { matchedTitle: detail?.name ?? hit.name } : {}),
    },
  };
}

/**
 * Game estimate. HowLongToBeat has NO official, documented public API —
 * the commonly-used endpoint is unofficial, rate-limited, and changes its
 * request signature without notice (it expects a hashed search-token from
 * the site bundle). Rather than ship a brittle scraper that breaks
 * silently, we make a single best-effort POST to the known community
 * endpoint and otherwise return null so the UI falls back to manual entry.
 *
 * If the call shape ever drifts, this still degrades cleanly to manual.
 */
async function estimateGame(title: string): Promise<MediaEstimate | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('https://howlongtobeat.com/api/search', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        // HLTB rejects requests without a browser-ish UA + referer.
        'User-Agent': 'Mozilla/5.0 (compatible; Questman/1.0)',
        'Referer': 'https://howlongtobeat.com/',
        Origin: 'https://howlongtobeat.com',
      },
      body: JSON.stringify({
        searchType: 'games',
        searchTerms: title.split(/\s+/).filter(Boolean),
        searchPage: 1,
        size: 5,
        searchOptions: {
          games: { userId: 0, platform: '', sortCategory: 'popular' },
        },
      }),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const hit = data?.data?.[0];
    if (!hit) return null;

    // HLTB returns main-story time in SECONDS under comp_main.
    const compMainSec = numberOrUndefined(hit.comp_main);
    const estMinutes = compMainSec != null && compMainSec > 0
      ? Math.round(compMainSec / 60)
      : undefined;
    const imageId: string | undefined = typeof hit.game_image === 'string' ? hit.game_image : undefined;

    if (estMinutes == null && !imageId) return null;

    return {
      estMinutes,
      coverUrl: imageId ? `https://howlongtobeat.com/games/${imageId}` : undefined,
      externalId: hit.game_id != null ? String(hit.game_id) : undefined,
      externalSource: 'howlongtobeat',
      meta: {
        mainStoryHours: estMinutes != null ? Math.round((estMinutes / 60) * 10) / 10 : undefined,
        ...(typeof hit.game_name === 'string' ? { matchedTitle: hit.game_name } : {}),
      },
    };
  } catch {
    // Network error, abort, shape drift — fall back to manual entry.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Estimate time commitment + metadata for a media item. Returns null when
 * nothing useful can be derived (caller falls back to manual entry).
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
        if (!key) return null; // no key → manual entry
        return await estimateMovie(clean, key);
      }
      case 'show': {
        const key = process.env.TMDB_API_KEY;
        if (!key) return null; // no key → manual entry
        return await estimateShow(clean, key);
      }
      case 'game':
        return await estimateGame(clean);
      default:
        return null;
    }
  } catch {
    // Belt-and-suspenders: never throw out of the estimator.
    return null;
  }
}

// --- tiny numeric coercion helpers --------------------------------------

function numberOrNan(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
}
// Every numeric field we extract here (page counts, runtimes, episode
// counts, cover ids, HLTB seconds) is only meaningful when positive. A 0
// or negative reads as "unknown" so the estimate degrades to manual entry
// rather than producing a bogus 0-minute commitment.
function numberOrUndefined(v: unknown): number | undefined {
  const n = numberOrNan(v);
  return Number.isNaN(n) || n <= 0 ? undefined : n;
}
