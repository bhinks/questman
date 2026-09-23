/**
 * requireModule: server-side enforcement of the per-user module allowlist.
 *
 * `User.allowedModuleKeys` is a JSON array string of module keys; null means
 * every module. Admins always pass. Until this middleware existed the
 * allowlist was only read by GET /api/modules (which drives the nav), so a
 * restricted user could still hit every domain route directly. Mounted in
 * server.ts on the domain routers listed in ROUTE_GATES.
 *
 * The SSO route shares the pure helpers below so the claim handling and the
 * gate agree on what a valid key is (MODULE_SEEDS in utils/provision.ts is
 * the single source of truth).
 */
import type { Response, NextFunction } from 'express';
import { prisma } from '../server';
import { logger } from '../utils/logger';
import { AppError } from './errorHandler';
import type { AuthRequest } from './auth';
import { MODULE_SEEDS } from '../utils/provision';

/** Every valid module key, in seed order. */
export const MODULE_KEYS: readonly string[] = MODULE_SEEDS.map(m => m.key);

/** The 403 body contract (NovaHQ creative-hub brief 3.6). */
export const MODULE_DENIED = 'module not enabled';

/**
 * Route prefix to the module keys that unlock it. A route listed with more
 * than one key is "any of": it passes when the allowlist contains at least
 * one. Any-of is deliberate where one screen consumes one router for two
 * modules (Operations reads /api/projects for both projects and chores;
 * Health reads /api/workouts and /api/metrics for both fitness and vitals).
 * Routes not listed here (player, quests, shop, bosses, handler, ...) stay
 * open to every signed-in user.
 */
export const ROUTE_GATES: Readonly<Record<string, readonly string[]>> = {
  '/api/transactions': ['finance'],
  '/api/categories':   ['finance'],
  '/api/import':       ['finance'],
  '/api/budgets':      ['finance'],
  '/api/recurring':    ['finance'],
  '/api/insights':     ['finance'],
  '/api/workouts':     ['fitness', 'vitals'],
  '/api/metrics':      ['fitness', 'vitals'],
  '/api/habits':       ['habits', 'chores'],
  '/api/projects':     ['projects', 'chores'],
  '/api/media':        ['media'],
  '/api/steam':        ['steam'],
  '/api/npcs':         ['social'],
};

/**
 * The /api/settings fields a restricted member may write. Everything else in
 * the PUT schema (the AI breaker and grants, provider, models and the daily
 * token cap, the Ollama URL, calendar and health-pull URLs and tokens) either
 * spends the server-wide AI key or makes the backend fetch a member-supplied
 * URL, so it stays with unrestricted accounts. The two R&R fields are the
 * Media tab's own knobs: a budget string and one of the member's anti-goal ids.
 */
export const RESTRICTED_SETTINGS_KEYS: readonly string[] = [
  'displayCut', 'displayChroma', 'displayCrt', 'rrBudgetByDay', 'rrOverrunAntiGoalId',
];

/**
 * The PUT /api/handler/persona fields a restricted member may write: the
 * persona is a cosmetic the member owns (the Shop equips it); `enabled` is
 * the Handler breaker, which the settings filter above already refuses.
 */
export const RESTRICTED_HANDLER_KEYS: readonly string[] = ['persona'];

/** Pure: the body keys outside `allowed` (empty = fine, or not an object). */
export function disallowedWriteKeys(body: unknown, allowed: readonly string[]): string[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return [];
  return Object.keys(body).filter(k => !allowed.includes(k));
}

/** Pure: the /api/settings body keys a restricted member may not write. */
export function disallowedSettingsKeys(body: unknown): string[] {
  return disallowedWriteKeys(body, RESTRICTED_SETTINGS_KEYS);
}

type UserAccess = { role: string; allowedModuleKeys: string | null };

/**
 * Parse the stored allowlist column. null/undefined means "all modules" and
 * stays null. A malformed value fails closed to [] (zero modules) rather than
 * open, and non-string entries are dropped.
 */
export function parseAllowedModuleKeys(raw: string | null | undefined): string[] | null {
  if (raw === null || raw === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((k): k is string => typeof k === 'string');
  } catch {
    return [];
  }
}

/**
 * Turn the SSO `modules` claim into an allowlist value.
 *   undefined     -> undefined  (claim absent: leave the user untouched)
 *   null          -> null       (all modules)
 *   string[]      -> unique keys filtered against MODULE_KEYS (may be [])
 *   anything else -> undefined  (ignored)
 */
export function moduleClaimToAllowlist(claim: unknown): string[] | null | undefined {
  if (claim === undefined) return undefined;
  if (claim === null) return null;
  if (!Array.isArray(claim)) return undefined;
  const seen = new Set<string>();
  for (const k of claim) {
    if (typeof k === 'string' && MODULE_KEYS.includes(k)) seen.add(k);
  }
  return [...seen];
}

/**
 * The keys of an array claim that were dropped by validation (unknown keys
 * and non-strings), so the SSO route can warn when a claim silently shrinks.
 */
export function droppedClaimKeys(claim: unknown): unknown[] {
  if (!Array.isArray(claim)) return [];
  return claim.filter(k => !(typeof k === 'string' && MODULE_KEYS.includes(k)));
}

/**
 * The user patch an SSO login applies from its claims:
 *   - `allowedModuleKeys` only when `modules` is present in the payload
 *     (JSON string of the validated list, or null for "all").
 *   - `role: 'admin'` only when `role === 'admin'`. Promote-only: any other
 *     role value writes nothing, so a claim can never demote an admin.
 */
export function ssoClaimUpdates(payload: { modules?: unknown; role?: unknown }): { allowedModuleKeys?: string | null; role?: 'admin' } {
  const patch: { allowedModuleKeys?: string | null; role?: 'admin' } = {};
  if ('modules' in payload) {
    const list = moduleClaimToAllowlist(payload.modules);
    if (list === null) patch.allowedModuleKeys = null;
    else if (list !== undefined) patch.allowedModuleKeys = JSON.stringify(list);
  }
  if (payload.role === 'admin') patch.role = 'admin';
  return patch;
}

/** Restricted = a non-admin whose allowlist is set (even an empty one). */
export function isRestricted(u: UserAccess): boolean {
  return u.role !== 'admin' && u.allowedModuleKeys !== null;
}

/** Admin or null allowlist passes; otherwise any listed key must be allowed. */
export function isModuleAllowed(u: UserAccess, ...keys: string[]): boolean {
  if (u.role === 'admin') return true;
  const allowed = parseAllowedModuleKeys(u.allowedModuleKeys);
  if (allowed === null) return true;
  return keys.some(k => allowed.includes(k));
}

type Gate = (req: AuthRequest, res: Response, next: NextFunction) => Promise<void>;

async function loadAccess(req: AuthRequest): Promise<UserAccess> {
  if (!req.user) throw new AppError('Authentication required', 401);
  const row = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { role: true, allowedModuleKeys: true },
  });
  if (!row) throw new AppError('Invalid token', 401);
  return row;
}

/**
 * Deny straight from the middleware (not via next(err)) so the errorHandler
 * does not log every gated hit at error level with a stack: the Today page
 * of a restricted user polls a few gated routes by design.
 */
function deny(req: AuthRequest, res: Response): void {
  logger.debug(`[requireModule] denied ${req.method} ${req.originalUrl ?? req.url} for user ${req.user?.id}`);
  res.status(403).json({ error: MODULE_DENIED });
}

/**
 * Express gate: pass when the user is admin, has a null allowlist, or the
 * allowlist contains at least one of `keys`; else 403 { error: MODULE_DENIED }.
 */
export function requireModule(...keys: string[]): Gate {
  return async (req, res, next) => {
    try {
      const access = await loadAccess(req);
      if (isModuleAllowed(access, ...keys)) return next();
      deny(req, res);
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Express gate for surfaces that have no module of their own but must not be
 * reachable by a restricted user (API key minting: a v1 bearer key would
 * bypass these gates). Admins and null-allowlist users pass.
 */
export function requireUnrestricted(): Gate {
  return async (req, res, next) => {
    try {
      const access = await loadAccess(req);
      if (!isRestricted(access)) return next();
      deny(req, res);
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Express gate for a PUT router: a restricted member may write only the keys
 * in `allowed`. Any other key in the body is a 403 with the contract body
 * rather than a silent strip, so a client that sends one learns why nothing
 * changed. Other methods pass untouched (the route's own zod schema still
 * validates the values that get through).
 */
export function restrictWrittenKeys(allowed: readonly string[]): Gate {
  return async (req, res, next) => {
    try {
      if (req.method !== 'PUT') return next();
      const access = await loadAccess(req);
      if (!isRestricted(access)) return next();
      const blocked = disallowedWriteKeys(req.body, allowed);
      if (blocked.length === 0) return next();
      logger.debug(`[requireModule] restricted write blocked keys ${blocked.join(',')} on ${req.originalUrl ?? req.url} for user ${req.user?.id}`);
      deny(req, res);
    } catch (err) {
      next(err);
    }
  };
}

/**
 * PUT /api/settings for a restricted member: RESTRICTED_SETTINGS_KEYS only.
 * The ingest-token and model-discovery sub-paths take requireUnrestricted()
 * in server.ts.
 */
export function restrictSettingsWrite(): Gate {
  return restrictWrittenKeys(RESTRICTED_SETTINGS_KEYS);
}
