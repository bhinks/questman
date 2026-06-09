/**
 * Typed fetch wrapper for the Questman backend.
 *
 * In dev we hit http://localhost:3001 directly (CORS configured to
 * allow http://localhost:5173). In Docker/prod, nginx proxies /api
 * and /socket.io to the backend so this defaults to "" (same origin).
 *
 * Token is read from the auth context's `localStorage` slot on every
 * call so it's always fresh — no need to recreate the client on login.
 */

export const API_BASE: string =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  (import.meta.env.DEV ? 'http://localhost:3001' : '');

export const TOKEN_KEY = 'questman.auth.token';

export function getToken(): string | null {
  return typeof window === 'undefined' ? null : window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  /** `errors` from Zod validation, when present. */
  details?: Array<{ field: string; message: string }>;

  constructor(message: string, status: number, details?: ApiError['details']) {
    super(message);
    this.status = status;
    this.details = details;
  }

  /** True if this is a 401 (token expired / invalid). */
  get isAuthError(): boolean { return this.status === 401; }
}

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  // 204 No Content
  if (res.status === 204) return undefined as T;

  let payload: any = null;
  const text = await res.text();
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }

  if (!res.ok) {
    const msg = (payload && typeof payload === 'object' && 'error' in payload)
      ? String(payload.error)
      : `Request failed: ${res.status}`;
    throw new ApiError(msg, res.status, payload?.errors);
  }

  return payload as T;
}

/**
 * multipart/form-data POST — for file uploads (e.g. CSV import). We let
 * the browser set the Content-Type (with the boundary); setting it by
 * hand breaks the multipart parse. `fields` values that aren't Files are
 * appended as strings, so pass pre-stringified JSON for object fields.
 */
async function upload<T>(
  path: string,
  fields: Record<string, string | Blob>,
): Promise<T> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);

  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers, body: form });

  let payload: any = null;
  const text = await res.text();
  if (text) { try { payload = JSON.parse(text); } catch { payload = text; } }

  if (!res.ok) {
    const msg = (payload && typeof payload === 'object' && 'error' in payload)
      ? String(payload.error)
      : `Upload failed: ${res.status}`;
    throw new ApiError(msg, res.status, payload?.errors);
  }
  return payload as T;
}

export const api = {
  get:  <T = unknown>(path: string)            => request<T>('GET',    path),
  post: <T = unknown>(path: string, body?: unknown) => request<T>('POST',   path, body),
  put:  <T = unknown>(path: string, body?: unknown) => request<T>('PUT',    path, body),
  del:  <T = unknown>(path: string)            => request<T>('DELETE', path),
  upload,
};

// ---- shared response types (a slim subset; routes return more) ------

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
}
export interface LoginResponse {
  message: string;
  user: AuthUser & { createdAt: string; settings?: unknown };
  token: string;
}
export interface PlayerSnapshot {
  level: number;
  totalXp: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  progress: number;
  currentStreak: number;
  longestStreak: number;
  lastActiveOn: string | null;
  domainXp: Record<string, number>;
  title: string | null;
  leveledUp?: boolean;
  previousLevel?: number;
}
export interface Module {
  id: string;
  userId: string;
  key: string;       // "finance" | "fitness" | "habits" | "chores"
  name: string;
  icon: string | null;
  color: string | null;
  isEnabled: boolean;
  sortOrder: number;
  config: string | null;
}
export interface Quest {
  id: string;
  questDate: string;
  title: string;
  description: string;
  difficulty: 'easy' | 'medium' | 'hard';
  xpReward: number;
  source: 'habit' | 'goal' | 'workout' | 'finance' | 'ai' | 'rule';
  sourceId: string | null;
  status: 'pending' | 'completed' | 'skipped' | 'expired';
  target: number;
  progress: number;
  isAiThemed: boolean;
  meta: { emoji?: string; flavor?: string; bestWindow?: string } | null;
  module: { key: string; name: string; color: string | null; icon: string | null };
}

/** Outdoor weather gating stored on a Habit. `outdoor` is the switch. */
export interface WeatherRule {
  outdoor: true;
  dryDaysRequired?: number;
  maxRainTodayIn?: number;
  minTempF?: number;
  maxTempF?: number;
  maxWindMph?: number;
}
export interface TodayResponse {
  questDate: string;
  generated: boolean;
  generator: 'ai' | 'rule' | 'ai-fallback';
  totalCount: number;
  completedCount: number;
  xpAvailable: number;
  xpEarned: number;
  byModule: Record<string, Quest[]>;
}
export interface Habit {
  id: string;
  moduleId: string;
  kind: 'habit' | 'chore';
  title: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  cadence: 'daily' | 'weekly' | 'custom' | 'once';
  schedule: Record<string, unknown> | null;
  dueDate: string | null;
  targetPerDay: number;
  baseXp: number;
  difficulty: 'easy' | 'medium' | 'hard';
  isActive: boolean;
  minIntervalDays: number | null;
  weatherRule: WeatherRule | null;
  currentStreak: number;
  longestStreak: number;
  lastCompletedOn: string | null;
  isCompletedToday: boolean;
  isDueToday: boolean;
}
// ---- finance: transactions + CSV import ----------------------------

export interface ApiTransaction {
  id: string;
  date: string;            // ISO
  description: string;
  amount: number;          // +income, -expense
  categoryId: string | null;
  category: { id: string; name: string; color: string | null; icon: string | null } | null;
  vendor: { id: string; name: string } | null;
  isWasteful: boolean;
  notes: string | null;
}
export interface TransactionListResponse {
  transactions: ApiTransaction[];
  pagination: { page: number; limit: number; total: number; totalPages: number; hasNext: boolean; hasPrev: boolean };
}
export interface ImportPreviewResponse {
  suggestedMapping: { date: string; description: string; amount: string; category?: string; vendor?: string; notes?: string };
  columns: string[];
  detectedFormat: 'csv' | 'excel';
  stats: { totalRows: number; hasHeaders: boolean };
}
export interface ImportResultResponse {
  message: string;
  result: {
    importId: string;
    filename: string;
    totalProcessed: number;
    imported: number;
    duplicatesSkipped: number;
    errors: number;
    warnings: string[];
  };
}

export interface WeatherToday {
  configured: boolean;
  weather: {
    label: string;
    emoji: string;
    tempMaxF: number;
    tempMinF: number;
    rainTodayIn: number;
    windMaxMph: number;
  } | null;
}

export interface Workout {
  id: string;
  moduleId: string;
  title: string | null;
  type: string;
  performedAt: string;
  durationMin: number | null;
  intensity: 'low' | 'moderate' | 'high' | null;
  caloriesEst: number | null;
  notes: string | null;
  exercises: any[] | null;
  metrics: Record<string, unknown> | null;
  xpAwarded: number;
}
