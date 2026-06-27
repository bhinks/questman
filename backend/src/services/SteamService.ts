/**
 * Steam Web API integration.
 *
 * Fetches owned games and recent playtime for the configured Steam user.
 * Env vars: STEAM_API_KEY, STEAM_USER_ID (Steam64 account ID).
 *
 * Follows the project integration contract: never throws, returns null on
 * any failure (network, bad shape, missing key). All fetches carry a timeout
 * so a slow Steam API can't hang the server.
 */

const TIMEOUT_MS = 8000;

// --- Public types -----------------------------------------------------------

export interface SteamOwnedGame {
  appid: number;
  name: string;
  playtime_forever: number;  // minutes, all-time
  playtime_2weeks: number;   // minutes, last 14 days (0 when not present)
  img_icon_url: string;      // hash; build full URL via iconUrl()
  rtime_last_played: number; // unix seconds (0 = never played)
}

export interface SteamLibraryResult {
  games: SteamOwnedGame[];
  gameCount: number;
}

export interface SteamRecentGame {
  appid: number;
  name: string;
  playtime_2weeks: number;
  playtime_forever: number;
  img_icon_url: string;
}

export interface SteamRecentResult {
  games: SteamRecentGame[];
  totalRecentMinutes: number;
}

// --- Helpers ----------------------------------------------------------------

export function steamConfigured(): boolean {
  return !!(process.env.STEAM_API_KEY?.trim() && process.env.STEAM_USER_ID?.trim());
}

/** Build a full icon CDN URL from an app id + icon hash. */
export function buildIconUrl(appId: number, iconHash: string): string {
  if (!iconHash) return '';
  return `https://media.steampowered.com/steamcommunity/public/images/apps/${appId}/${iconHash}.jpg`;
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// --- API calls --------------------------------------------------------------

/**
 * Fetch the full owned-game library for the configured Steam user.
 * Returns null when Steam is unconfigured, the user has a private profile,
 * or the request fails for any reason.
 */
export async function fetchOwnedGames(): Promise<SteamLibraryResult | null> {
  if (!steamConfigured()) return null;

  const key = process.env.STEAM_API_KEY!;
  const id  = process.env.STEAM_USER_ID!;
  const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${encodeURIComponent(key)}&steamid=${encodeURIComponent(id)}&include_appinfo=true&include_played_free_games=true&format=json`;

  const data = await fetchJson(url) as any;
  const games: unknown[] = data?.response?.games;
  if (!Array.isArray(games)) return null;

  const normalized: SteamOwnedGame[] = games.map((g: any) => ({
    appid:            Number(g.appid ?? 0),
    name:             String(g.name ?? `App ${g.appid}`),
    playtime_forever: Number(g.playtime_forever ?? 0),
    playtime_2weeks:  Number(g.playtime_2weeks ?? 0),
    img_icon_url:     String(g.img_icon_url ?? ''),
    rtime_last_played: Number(g.rtime_last_played ?? 0),
  }));

  return { games: normalized, gameCount: normalized.length };
}

/**
 * Fetch recently-played games (last ~14 days) for the configured Steam user.
 * Returns null when Steam is unconfigured or the request fails.
 */
export async function fetchRecentGames(): Promise<SteamRecentResult | null> {
  if (!steamConfigured()) return null;

  const key = process.env.STEAM_API_KEY!;
  const id  = process.env.STEAM_USER_ID!;
  const url = `https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v0001/?key=${encodeURIComponent(key)}&steamid=${encodeURIComponent(id)}&count=20&format=json`;

  const data = await fetchJson(url) as any;
  if (!data?.response) return null;

  const raw: any[] = data.response.games ?? [];
  const games: SteamRecentGame[] = raw.map((g: any) => ({
    appid:            Number(g.appid ?? 0),
    name:             String(g.name ?? `App ${g.appid}`),
    playtime_2weeks:  Number(g.playtime_2weeks ?? 0),
    playtime_forever: Number(g.playtime_forever ?? 0),
    img_icon_url:     String(g.img_icon_url ?? ''),
  }));

  const totalRecentMinutes = games.reduce((s, g) => s + g.playtime_2weeks, 0);
  return { games, totalRecentMinutes };
}
