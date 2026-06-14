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
  // Night Market consumables.
  streakShields: number;         // banked shields (each absorbs one missed day)
  boosterUntil: string | null;   // Overdrive expiry — 2× eddies while in the future
  budgetBoostOn: string | null;  // Time Dilation day (+2h planner budget)
  cosmetics: string[];           // owned cosmetic keys (themes, fonts, FX, personas, gear)
  equippedTheme: string | null;  // active cosmetic theme key
  equippedFont: string | null;   // active display-font pack key
  equippedFx: string | null;     // LEGACY single-equip FX pack (superseded by fxActive)
  equippedTimer: string | null;  // active CHRONO session-timer style key
  // Night Market v2 gear slots.
  equippedShell: string | null;  // OS shell key ('tty'|'outrun'; null = Night City)
  equippedTitle: string | null;  // vanity title key worn on the runner ID
  equippedPet: string | null;    // data-pet key living in the nav deck
  fxActive: string[];            // STACKABLE visual FX currently online
  focusStims: number;            // banked FOCUS STIMs (effect TBD)
  overclockChips: number;        // banked OVERCLOCK CHIPs (effect TBD)
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
  | 'token_skip' | 'token_reroll' | 'rr_credit' | 'cosmetic' | 'loot_crate' | 'consumable'
  | 'font' | 'fx' | 'persona' | 'timer' | 'shell' | 'title' | 'pet';

// ---- focus timer (JACK IN deep-work chamber) -------------------------

export type FocusTargetType = 'quest' | 'project' | 'habit' | 'chore' | 'workout' | 'other';

/** One selectable row from GET /api/focus/targets. */
export interface FocusTargetOption {
  type: FocusTargetType;
  id: string;
  label: string;
}

/** A persisted focus run (POST/GET /api/focus/sessions). */
export interface FocusSession {
  id: string;
  targetType: FocusTargetType;
  targetId: string | null;
  label: string;
  startedAt: string;
  endedAt: string;
  minutes: number;
  limitMinutes: number | null;
  createdAt: string;
}

/** One row of GET /api/focus/summary — actual minutes per target. */
export interface FocusSummaryRow {
  targetType: FocusTargetType;
  targetId: string | null;
  minutes: number;
  sessions: number;
}

export interface ShopItem {
  key: string;
  name: string;
  description: string;
  category: ShopCategory;
  priceEddies: number;
  /** Minimum player level to buy (server re-validates on /buy). */
  levelReq?: number;
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
  source: 'habit' | 'goal' | 'workout' | 'finance' | 'project' | 'media' | 'npc' | 'vitals' | 'ai' | 'rule' | 'insight' | 'bill';
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
  /** Outdoor quest that passes its weather rule today but not tomorrow. */
  lastClearDay?: boolean;
}
export interface DayPlan {
  budgetMin: number;
  /** Time Dilation: extra minutes already folded into budgetMin (0 = none). */
  budgetBoostMin?: number;
  /** Calendar uplink: busy minutes already subtracted from budgetMin (0 = none). */
  calendarBusyMin?: number;
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
  description: string | null;
  done: boolean;
  estMinutes: number | null;
  priority: number;
  sortOrder: number;
  xpReward: number | null;  // authored override; null = derived from estMinutes
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
  /** Sequenced mode (absorbed questlines): tasks unlock in sortOrder. */
  ordered: boolean;
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

// ---- Media planner: pace + R&R status (GET /api/media/pace) --------------
export interface MediaPace {
  book: { minPerPage: number; pagesPerDay: number; minPerDay: number };
  show: { epsPerDay: number; minPerDay: number };
  game: { minPerDay: number; minPerWeek: number };
  movie: { perWeek: number };
  refEpisodeMin: number;
}
export interface MediaRrStatus {
  dayBudget: number;       // today's day-of-week allowance
  usedToday: number;       // budget credits spent today
  banked: number;          // bought/banked stockpile (rrCredits)
  remaining: number;       // (dayBudget − usedToday) + banked
  overrunTargetId: string | null;
  overrunTargetName: string | null;
}
export interface MediaPaceResponse {
  pace: MediaPace;
  weekMinutes: number;     // minutes consumed in the trailing 7 days
  chargedTodayItemIds: string[]; // titles already charged R&R today (free rest of day)
  rr: MediaRrStatus;
}
/** Response from POST /api/media/:id/session (the consumption logger). */
export interface MediaSessionResult {
  item: MediaItem;
  charged: boolean;
  chargeSource: 'budget' | 'banked' | 'overrun' | null;
  overran: boolean;
  overrunTargetName: string | null;
}
/** AUTO-ESTIMATE result (POST /api/media/lookup) — length data only, no cover art. */
export interface MediaEstimate {
  pages?: number;       // book
  episodes?: number;    // show
  perEpMin?: number;    // show — minutes per episode
  runtimeMin?: number;  // movie
  gameHours?: number;   // game — main-story time-to-beat
  estMinutes?: number;  // total time commitment
  totalUnits?: number;  // pages | episodes
  externalId?: string;
  externalSource?: string;
  meta?: Record<string, unknown>;
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
  // Finance depth: exclusion + chore/project links + source account.
  excluded: boolean;
  account: string | null;
  projectId: string | null;
  choreId: string | null;
  project: { id: string; name: string } | null;
  chore: { id: string; title: string } | null;
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
    /** Today's hourly forecast, local hours 0–23. */
    hours: Array<{ hour: number; tempF: number; precipIn: number; precipProbPct: number }>;
    /** First upcoming likely-wet hour ("rain at 2pm"), null if dry ahead. */
    nextRain: { hour: number; label: string; probPct: number } | null;
    /** Tomorrow's daily rollup, for "tomorrow will be rainy/hot" cues. */
    tomorrow: {
      label: string;
      emoji: string;
      tempMaxF: number;
      tempMinF: number;
      rainSumIn: number;
      windMaxMph: number;
    } | null;
  } | null;
}

/** One weekly workout-plan slot ("push day every Monday"). */
export interface WorkoutPlan {
  id: string;
  dayOfWeek: number;            // 0=Sunday .. 6=Saturday
  title: string;
  type: string;
  targetMin: number | null;
  notes: string | null;
  isActive: boolean;
  sortOrder: number;
}
export interface WorkoutPlanResponse { plans: WorkoutPlan[]; }

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

// ---- calendar uplink (private ICS feed → planner budget + Today agenda) ---

export interface CalEvent {
  title: string;
  startsAt: string;  // ISO
  endsAt: string;    // ISO
  allDay: boolean;
}
export interface CalendarToday {
  events: CalEvent[];      // today's events, sorted by start
  busyMin: number;         // timed-event overlap with the waking window, merged
  freeMin: number;         // waking window minus busy
  nextEvent: CalEvent | null; // first timed event still ahead of now
}
export interface CalendarTodayResponse { configured: boolean; calendar: CalendarToday | null; }

// ---- Night City display calibration (per-user, design handoff) -----------

export interface DisplaySettings {
  displayCut: number;     // panel corner clip 0–28px
  displayChroma: number;  // chroma-split offset 0–4px
  displayCrt: number;     // CRT intensity % 0–100 (→ scanline/sweep alphas)
}

// ---- AI Calibration (SYS//CAL): the user owns every AI decision ----------

export type AiProviderKind = 'anthropic' | 'ollama';
export interface AiSettings {
  aiEnabled: boolean;        // master breaker — off = zero LLM calls anywhere
  aiQuestsEnabled: boolean;  // AI-selected + themed daily quests
  handlerEnabled: boolean;   // Handler daily rundown + weekly debrief
  aiAccessFinance: boolean;  // grant: Vault (finance) data
  aiAccessHealth: boolean;   // grant: Vitals + Workouts data
  aiAccessSocial: boolean;   // grant: Social (contacts) data
  aiAccessCalendar: boolean; // grant: calendar counts/free-busy (default sealed)
  aiProvider: AiProviderKind;
  aiModelQuests: string | null;  // cloud model override; null = server default
  aiModelHandler: string | null; // cloud model override; null = server default
  ollamaUrl: string;
  ollamaModel: string;
  aiDailyTokenCap: number;   // tokens/day across all calls; 0 = unlimited
  // Read-only status, server-computed (ignored on PUT):
  aiCloudKey: boolean;       // ANTHROPIC_API_KEY configured on the server
  aiTokensUsedToday: number; // burned against the cap so far today
}

// ---- R&R "earn your leisure" budget (Media page) -------------------------
export interface RrSettings {
  rrBudgetByDay: string;             // JSON of 7 ints (getDay() Sun..Sat)
  rrOverrunAntiGoalId: string | null; // soft-gate target anti-goal (null = inert)
}

/** The full /api/settings payload: display + AI calibration + R&R blocks. */
export interface AppSettings extends DisplaySettings, AiSettings, RrSettings {}
export interface SettingsResponse { settings: AppSettings; }

// ---- intelligence layer (phase 6): Handler, insights, weekly debrief -----

export type HandlerPersona =
  | 'rogue_ai' | 'fixer' | 'ripperdoc'                       // free trio
  | 'hrbot' | 'drill' | 'zen' | 'noir' | 'motherboard' | 'patch' // Night Market v2
  | 'showman';                                               // retired stock
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

// ---- finance depth (phase 7): categories, budgets, bills ------------

/** A spending category (with optional monthly budget cap). */
export interface FinanceCategory {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  budget: number | null;
  parentId: string | null;
  isSystem: boolean;
  isActive: boolean;
  transactionCount?: number;
}
export interface CategoriesResponse { categories: FinanceCategory[]; }

export type BudgetStatus = 'ok' | 'warn' | 'over';
export interface BudgetItem {
  categoryId: string;
  name: string;
  color: string | null;
  icon: string | null;
  cap: number;
  spent: number;
  remaining: number;
  pct: number;
  status: BudgetStatus;
}
export interface BudgetOverview {
  month: string;                 // "YYYY-MM"
  budgets: BudgetItem[];         // sorted most-under-budget first (the leaderboard)
  totals: { totalCap: number; totalSpent: number; totalRemaining: number };
  overCount: number;
  warnCount: number;
  unbudgetedCount: number;
  suggestion: string | null;     // leftover-surplus nudge near month-end
}
export interface BudgetHistoryCell { month: string; spent: number; cap: number; under: boolean; pct: number; }
export interface BudgetHistoryCategory {
  categoryId: string;
  name: string;
  color: string | null;
  cap: number;
  cells: BudgetHistoryCell[];
  underRate: number | null;      // % of complete months under cap
}
export interface BudgetHistory { months: string[]; categories: BudgetHistoryCategory[]; }

export type Cadence = 'weekly' | 'monthly' | 'yearly';
export interface RecurringExpense {
  id: string;
  name: string;
  amount: number;
  cadence: Cadence;
  dueDay: number | null;
  categoryId: string | null;
  category?: { id: string; name: string; color: string | null } | null;
  active: boolean;
  isSubscription: boolean;
  source: 'manual' | 'detected';
  lastPaidOn: string | null;
  notes: string | null;
  // Server-decorated:
  monthlyEquivalent: number;
  nextDueDate: string | null;
  dueInDays: number | null;
  createdAt: string;
}
export interface RecurringListResponse { recurring: RecurringExpense[]; monthlyTotal: number; }
export interface RecurringCandidate {
  name: string;
  key: string;
  amount: number;
  cadence: Cadence;
  dueDay: number | null;
  categoryId: string | null;
  isSubscription: boolean;
  matchCount: number;
  lastChargedOn: string;
}
export interface DetectResponse { candidates: RecurringCandidate[]; }
export interface SubscriptionAudit {
  subscriptions: RecurringExpense[];
  count: number;
  monthlySubCost: number;
  annualSubCost: number;
}

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
