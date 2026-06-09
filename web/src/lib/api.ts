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
  if (typeof window === 'undefined') return null;
  // "Remember me" stores in localStorage (survives restart); otherwise
  // sessionStorage (cleared when the browser/tab closes). Read both.
  return window.localStorage.getItem(TOKEN_KEY)
    ?? window.sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null, remember = true): void {
  if (typeof window === 'undefined') return;
  // Always clear both stores first so toggling "remember" never leaves a
  // stale copy behind in the other one.
  window.localStorage.removeItem(TOKEN_KEY);
  window.sessionStorage.removeItem(TOKEN_KEY);
  if (token) {
    (remember ? window.localStorage : window.sessionStorage).setItem(TOKEN_KEY, token);
  }
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
  eddies: number;        // spendable currency (€$) balance
  currentStreak: number;
  longestStreak: number;
  lastActiveOn: string | null;
  domainXp: Record<string, number>;
  title: string | null;
  // ---- Economy & rewards (mechanics bundle) ----
  overclockStreak: number;       // consecutive full-clear days
  overclockMultiplier: number;   // eddie earn multiplier, 1.0 .. 2.0
  skipTokens: number;            // free skips remaining
  rerollTokens: number;          // quest rerolls remaining
  rrCredits: number;             // R&R downtime credits (activate backlog media)
  cosmetics: string[];           // owned cosmetic theme keys
  equippedTheme: string | null;  // active cosmetic theme key
  // World mechanics: daily energy/battery (only present on GET /api/player).
  energy?: {
    tier: 'low' | 'med' | 'high';
    pct: number;                 // 0–100 battery bar
    source: 'override' | 'sleep' | 'default';
    sleepHours: number | null;
  };
  leveledUp?: boolean;
  previousLevel?: number;
  /** Set on an awardXp response when the overclock multiplier boosted the eddie earn. */
  eddieMultiplierApplied?: number;
}

// ---- economy & rewards: shop + achievements ------------------------

export type ShopCategory =
  | 'token_skip' | 'token_reroll' | 'rr_credit' | 'cosmetic' | 'loot_crate';

export interface ShopItem {
  key: string;
  name: string;
  description: string;
  category: ShopCategory;
  priceEddies: number;
  payload?: Record<string, unknown>;
  /** Server-computed: cosmetic already owned (so the UI disables "buy"). */
  owned?: boolean;
}
export interface ShopResponse {
  items: ShopItem[];
  player: PlayerSnapshot;
}
export interface Purchase {
  id: string;
  itemKey: string;
  name: string;
  category: ShopCategory;
  priceEddies: number;
  createdAt: string;
}
/** Result of POST /api/shop/buy — updated balances + what the purchase granted. */
export interface BuyResponse {
  purchase: Purchase;
  player: PlayerSnapshot;
  /** Category-specific result, e.g. { tokens: 1 } or a loot-crate reward. */
  granted?: Record<string, unknown>;
  message?: string;
}

export interface Achievement {
  key: string;
  name: string;
  description: string;
  icon: string;
  tier?: 'bronze' | 'silver' | 'gold' | 'platinum';
  xpReward?: number;
  eddieReward?: number;
  unlocked: boolean;
  unlockedAt: string | null;
  /** Progress toward unlock (0..1), when measurable. */
  progress?: number;
  progressLabel?: string;
}
export interface AchievementsResponse {
  achievements: Achievement[];
  unlockedCount: number;
  totalCount: number;
}
/** One newly-unlocked achievement, returned by GET /api/player for a toast. */
export interface UnlockedAchievement {
  key: string;
  name: string;
  icon?: string;
  xpReward?: number;
  eddieReward?: number;
}
export interface PlayerResponse {
  player: PlayerSnapshot;
  newAchievements?: UnlockedAchievement[];
}

/** One row of the player's economy history (XP grant or eddie movement). */
export interface LedgerEntry {
  id: string;
  currency: 'xp' | 'eddies';
  amount: number;
  reason: string;
  module: string | null;
  refType: string | null;
  refId: string | null;
  createdAt: string;
}
export interface PlayerStats {
  player: PlayerSnapshot;
  xpLast7Days: number;
  xpLast30Days: number;
  completionsLast30Days: number;
  xpByModule: Record<string, number>;
  recent: Array<Omit<LedgerEntry, 'currency'>>;
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
  source: 'habit' | 'goal' | 'workout' | 'finance' | 'project' | 'media' | 'npc' | 'vitals' | 'ai' | 'rule' | 'chain' | 'insight';
  sourceId: string | null;
  status: 'pending' | 'completed' | 'skipped' | 'expired';
  target: number;
  progress: number;
  isAiThemed: boolean;
  meta: { emoji?: string; flavor?: string; bestWindow?: string } | null;
  module: { key: string; name: string; color: string | null; icon: string | null };
  // Planner / check-in fields (roadmap §5).
  estMinutes: number | null;
  targetCount: number;
  currentCount: number;
  carryOver: boolean;
  mustDo: boolean;
  originDate: string | null;
  actualMinutes: number | null;
}

/** One quest in the day planner, flagged whether it fits the budget. */
export interface PlanQuest {
  id: string;
  title: string;
  description: string;
  difficulty: 'easy' | 'medium' | 'hard';
  xpReward: number;
  estMinutes: number | null;
  assumedMinutes: number;
  mustDo: boolean;
  carryOver: boolean;
  targetCount: number;
  currentCount: number;
  source: string;
  module: { key: string; name: string; color: string | null; icon: string | null };
  meta: { emoji?: string; flavor?: string; bestWindow?: string } | null;
  inPlan: boolean;
}
export interface DayPlan {
  budgetMin: number;
  isWeekend: boolean;
  plannedMin: number;
  totalEstMin: number;
  estimatedMissing: number;
  quests: PlanQuest[];
}

// ---- new quest pools (phase 2) -------------------------------------

export interface ProjectTask {
  id: string;
  projectId: string;
  title: string;
  done: boolean;
  estMinutes: number | null;
  priority: number;
  sortOrder: number;
  completedAt: string | null;
}
export interface Milestone {
  id: string;
  projectId: string;
  title: string;
  done: boolean;
  dueDate: string | null;
  bonusXp: number;
  sortOrder: number;
  completedAt: string | null;
}
export interface Project {
  id: string;
  moduleId: string;
  name: string;
  description: string | null;
  status: 'active' | 'paused' | 'done' | 'archived';
  color: string | null;
  tasks?: ProjectTask[];
  milestones?: Milestone[];
  createdAt: string;
  updatedAt: string;
}

export interface MediaItem {
  id: string;
  moduleId: string;
  type: 'movie' | 'show' | 'game' | 'book';
  title: string;
  status: 'backlog' | 'active' | 'done' | 'dropped';
  estMinutes: number | null;
  totalUnits: number | null;
  unitsDone: number;
  externalId: string | null;
  externalSource: string | null;
  coverUrl: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface MetricDef {
  id: string;
  key: string;
  label: string;
  unit: string | null;
  kind: 'number' | 'scale' | 'integer';
  enabled: boolean;
  sortOrder: number;
  min: number | null;
  max: number | null;
}
export interface DailyMetric {
  id: string;
  date: string;
  key: string;
  value: number;
}

export interface Interaction {
  id: string;
  npcId: string;
  date: string;
  minutes: number | null;
  planned: boolean;
  note: string | null;
}
export interface Npc {
  id: string;
  moduleId: string;
  name: string;
  relationship: string | null;
  cadenceDays: number | null;
  lastContactOn: string | null;
  notes: string | null;
  daysSinceContact?: number | null;
  interactions?: Interaction[];
  createdAt: string;
  updatedAt: string;
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
  polarity: 'do' | 'avoid';   // "avoid" = anti-goal / ICE
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
  estMinutes: number | null;
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

// ---- World mechanics (phase 5) -------------------------------------

export type BossKind = 'debt' | 'savings' | 'project' | 'challenge' | 'custom';
export type BossDirection = 'grind_down' | 'charge_up';
export interface BossLog {
  id: string;
  amount: number;
  note: string | null;
  source: 'manual' | 'project_milestone';
  createdAt: string;
}
export interface Boss {
  id: string;
  name: string;
  kind: BossKind;
  direction: BossDirection;
  targetValue: number;
  currentValue: number;
  unit: string | null;
  color: string | null;
  status: 'active' | 'defeated' | 'abandoned';
  linkedProjectId: string | null;
  xpReward: number;
  eddieReward: number;
  createdAt: string;
  defeatedAt: string | null;
  // Server-computed convenience for the HP bar:
  pct: number;          // 0–100 toward defeat
  remaining: number;    // grind_down: HP left; charge_up: amount still to charge
  logs?: BossLog[];
}
/** Result of POST /api/bosses/:id/hit — updated boss + (on defeat) the reward. */
export interface BossHitResponse {
  boss: Boss;
  defeated: boolean;
  player?: PlayerSnapshot;  // present only when this hit defeated the boss
}

export interface ChainStep {
  id: string;
  order: number;
  title: string;
  description: string | null;
  difficulty: 'easy' | 'medium' | 'hard';
  xpReward: number;
  estMinutes: number | null;
  status: 'locked' | 'available' | 'done';
  questId: string | null;
  completedAt: string | null;
}
export interface QuestChain {
  id: string;
  name: string;
  description: string | null;
  status: 'active' | 'done' | 'abandoned';
  color: string | null;
  steps: ChainStep[];
  createdAt: string;
}

// ---- intelligence layer (phase 6): Handler, insights, weekly debrief -----

export type HandlerPersona = 'rogue_ai' | 'fixer' | 'ripperdoc';
export type HandlerKind = 'daily_rundown' | 'weekly_debrief' | 'event';

/** One line of Handler banter (the sardonic rogue-AI voice). */
export interface HandlerMessage {
  id: string;
  kind: HandlerKind;
  text: string;
  persona: HandlerPersona | null;
  refType: string | null;
  refId: string | null;
  meta: Record<string, unknown> | null;
  seen: boolean;
  createdAt: string;
}
export interface HandlerLatestResponse {
  message: HandlerMessage | null;
  enabled: boolean;     // feature on AND user hasn't toggled it off
  persona: HandlerPersona;
  available: boolean;   // an API key is configured (else no new lines generate)
}
export interface HandlerMessagesResponse { messages: HandlerMessage[]; }
export interface PersonaOption { key: HandlerPersona; label: string; blurb: string; }
export interface PersonaResponse { persona: HandlerPersona; enabled: boolean; options: PersonaOption[]; }

export type InsightActionType = 'none' | 'reach_out' | 'review_budget' | 'log_sleep' | 'review_spend';
export type InsightStatus = 'new' | 'accepted' | 'dismissed' | 'spawned';
/** A cross-domain "possible pattern" surfaced from the user's own data. */
export interface Insight {
  id: string;
  weekOf: string | null;
  kind: string;          // "sleep_spend"|"sleep_mood"|"gym_mood"|"budget"|"social"
  title: string;
  body: string;
  evidence: string | null;
  confidence: 'low' | 'medium';
  windowDays: number | null;
  suggestion: string | null;
  actionType: InsightActionType;
  status: InsightStatus;
  spawnedQuestId: string | null;
  createdAt: string;
}
export interface InsightsResponse { insights: Insight[]; newCount: number; }

/** The server-computed weekly digest snapshot (numbers only). */
export interface WeeklyStats {
  weekOf: string;
  weekEnd: string;
  xpEarned: number;
  eddiesEarned: number;
  eddiesSpent: number;
  questsCompleted: number;
  questsSkipped: number;
  questsExpired: number;
  completionRate: number;
  currentStreak: number;
  overclockStreak: number;
  workouts: number;
  bossDamageEvents: number;
  bossesDefeated: number;
  achievementsUnlocked: number;
  spendTotal: number;
  topCategories: { name: string; amount: number }[];
  vitals: { sleepAvg: number | null; moodAvg: number | null; weightDelta: number | null };
  activeDays: number;
}
export interface WeeklyReview {
  id: string;
  weekOf: string;
  stats: WeeklyStats | null;
  statsJson?: string;
  handlerText: string | null;
  status: 'draft' | 'submitted';
  notes: string | null;
  focusForNext: string | null;
  generatedAt: string;
  submittedAt: string | null;
  insights?: Insight[];
}
export interface DebriefLatestResponse { review: WeeklyReview | null; }
export interface DebriefListResponse { reviews: WeeklyReview[]; }

/** An anti-goal ("ICE") — a Habit with polarity:"avoid". You log only slips. */
export interface AntiGoal {
  id: string;
  moduleId: string;
  title: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  baseXp: number;
  difficulty: 'easy' | 'medium' | 'hard';
  isActive: boolean;
  currentStreak: number;          // avoidance streak (clean days)
  longestStreak: number;
  breachedToday: boolean;         // a slip logged today
  lastCompletedOn: string | null; // last clean day credited at roll-over
}
