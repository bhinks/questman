import { describe, it, expect, vi, beforeEach } from 'vitest';

// server.ts boots Express, Prisma and the schedulers on import; mock it so the
// middleware's `prisma` import resolves to a stub and nothing listens.
const findUnique = vi.fn();
vi.mock('../server', () => ({ prisma: { user: { findUnique: (...a: unknown[]) => findUnique(...a) } } }));
vi.mock('../utils/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  MODULE_KEYS, MODULE_DENIED, ROUTE_GATES,
  parseAllowedModuleKeys, moduleClaimToAllowlist, droppedClaimKeys, ssoClaimUpdates,
  isRestricted, isModuleAllowed, requireModule, requireUnrestricted,
  RESTRICTED_SETTINGS_KEYS, disallowedSettingsKeys, restrictSettingsWrite,
  RESTRICTED_HANDLER_KEYS, disallowedWriteKeys, restrictWrittenKeys,
} from './requireModule';
import { MODULE_SEEDS } from '../utils/provision';
import { AppError } from './errorHandler';

const NINE = ['finance', 'fitness', 'habits', 'chores', 'projects', 'media', 'vitals', 'social', 'steam'];

describe('MODULE_KEYS and ROUTE_GATES', () => {
  it('MODULE_KEYS equals the nine seeds in order', () => {
    expect([...MODULE_KEYS]).toEqual(NINE);
    expect(MODULE_KEYS.length).toBe(MODULE_SEEDS.length);
  });
  it('every gated key is a real module key', () => {
    for (const [route, keys] of Object.entries(ROUTE_GATES)) {
      expect(keys.length, route).toBeGreaterThan(0);
      for (const k of keys) expect(MODULE_KEYS, `${route} -> ${k}`).toContain(k);
    }
  });
  it('maps the brief routers as designed', () => {
    expect(ROUTE_GATES['/api/transactions']).toEqual(['finance']);
    expect(ROUTE_GATES['/api/budgets']).toEqual(['finance']);
    expect(ROUTE_GATES['/api/categories']).toEqual(['finance']);
    expect(ROUTE_GATES['/api/recurring']).toEqual(['finance']);
    expect(ROUTE_GATES['/api/import']).toEqual(['finance']);
    expect(ROUTE_GATES['/api/insights']).toEqual(['finance']);
    expect(ROUTE_GATES['/api/habits']).toEqual(['habits', 'chores']);
    expect(ROUTE_GATES['/api/projects']).toEqual(['projects', 'chores']);
    expect(ROUTE_GATES['/api/workouts']).toEqual(['fitness', 'vitals']);
    expect(ROUTE_GATES['/api/metrics']).toEqual(['fitness', 'vitals']);
    expect(ROUTE_GATES['/api/media']).toEqual(['media']);
    expect(ROUTE_GATES['/api/steam']).toEqual(['steam']);
    expect(ROUTE_GATES['/api/npcs']).toEqual(['social']);
  });
  it('the contract string is verbatim', () => {
    expect(MODULE_DENIED).toBe('module not enabled');
  });
});

describe('parseAllowedModuleKeys', () => {
  it('null stays null (all modules)', () => {
    expect(parseAllowedModuleKeys(null)).toBeNull();
    expect(parseAllowedModuleKeys(undefined)).toBeNull();
  });
  it('parses a JSON array', () => {
    expect(parseAllowedModuleKeys('["chores"]')).toEqual(['chores']);
    expect(parseAllowedModuleKeys('[]')).toEqual([]);
  });
  it('fails closed on malformed JSON or a non-array', () => {
    expect(parseAllowedModuleKeys('{')).toEqual([]);
    expect(parseAllowedModuleKeys('{"a":1}')).toEqual([]);
    expect(parseAllowedModuleKeys('["chores", 7, null]')).toEqual(['chores']);
  });
});

describe('moduleClaimToAllowlist', () => {
  it('absent claim leaves the user untouched', () => {
    expect(moduleClaimToAllowlist(undefined)).toBeUndefined();
  });
  it('null claim means all modules', () => {
    expect(moduleClaimToAllowlist(null)).toBeNull();
  });
  it('filters unknown keys and non-strings, de-duplicates', () => {
    expect(moduleClaimToAllowlist(['chores', 'bogus', 7, 'chores'])).toEqual(['chores']);
  });
  it('a non-array claim is ignored', () => {
    expect(moduleClaimToAllowlist('chores')).toBeUndefined();
    expect(moduleClaimToAllowlist({ chores: true })).toBeUndefined();
  });
  it('an all-invalid claim yields an empty allowlist (fail closed) and reports the drops', () => {
    expect(moduleClaimToAllowlist(['health', 'money'])).toEqual([]);
    expect(droppedClaimKeys(['health', 'money'])).toEqual(['health', 'money']);
    expect(droppedClaimKeys(['chores', 'bogus', 7])).toEqual(['bogus', 7]);
    expect(droppedClaimKeys(['chores'])).toEqual([]);
    expect(droppedClaimKeys(null)).toEqual([]);
  });
});

describe('ssoClaimUpdates', () => {
  it('no claims -> empty patch', () => {
    expect(ssoClaimUpdates({})).toEqual({});
  });
  it('modules array -> validated JSON string', () => {
    expect(ssoClaimUpdates({ modules: ['chores', 'bogus'] })).toEqual({ allowedModuleKeys: '["chores"]' });
  });
  it('modules null -> allowlist cleared', () => {
    expect(ssoClaimUpdates({ modules: null })).toEqual({ allowedModuleKeys: null });
  });
  it('all-invalid modules -> "[]" (fail closed)', () => {
    expect(ssoClaimUpdates({ modules: ['health'] })).toEqual({ allowedModuleKeys: '[]' });
  });
  it('role admin promotes', () => {
    expect(ssoClaimUpdates({ role: 'admin' })).toEqual({ role: 'admin' });
  });
  it('role user never demotes (writes nothing)', () => {
    expect(ssoClaimUpdates({ role: 'user' })).toEqual({});
    expect(ssoClaimUpdates({ role: 'ADMIN' })).toEqual({});
    expect(ssoClaimUpdates({ role: 42 })).toEqual({});
  });
  it('both claims together', () => {
    expect(ssoClaimUpdates({ modules: ['vitals'], role: 'admin' })).toEqual({ allowedModuleKeys: '["vitals"]', role: 'admin' });
  });
  it('a non-array modules claim is ignored but a role claim still applies', () => {
    expect(ssoClaimUpdates({ modules: 'chores', role: 'admin' })).toEqual({ role: 'admin' });
  });
});

describe('isRestricted / isModuleAllowed', () => {
  it('admin is never restricted and always allowed', () => {
    const u = { role: 'admin', allowedModuleKeys: '["chores"]' };
    expect(isRestricted(u)).toBe(false);
    expect(isModuleAllowed(u, 'finance')).toBe(true);
  });
  it('null allowlist is unrestricted', () => {
    const u = { role: 'user', allowedModuleKeys: null };
    expect(isRestricted(u)).toBe(false);
    expect(isModuleAllowed(u, 'finance')).toBe(true);
  });
  it('array allowlist restricts, any-of semantics', () => {
    const u = { role: 'user', allowedModuleKeys: '["chores"]' };
    expect(isRestricted(u)).toBe(true);
    expect(isModuleAllowed(u, 'finance')).toBe(false);
    expect(isModuleAllowed(u, 'projects', 'chores')).toBe(true);
    expect(isModuleAllowed(u, 'habits', 'chores')).toBe(true);
  });
  it('empty and malformed allowlists deny everything', () => {
    expect(isModuleAllowed({ role: 'user', allowedModuleKeys: '[]' }, 'chores')).toBe(false);
    expect(isModuleAllowed({ role: 'user', allowedModuleKeys: '{' }, 'chores')).toBe(false);
  });
});

type Row = { role: string; allowedModuleKeys: string | null } | null;

function run(gate: ReturnType<typeof requireModule>, row: Row, withUser = true, reqExtra: Record<string, unknown> = {}) {
  findUnique.mockResolvedValueOnce(row);
  const req = { user: withUser ? { id: 'u1', email: 'k@x', name: 'K', role: 'user' } : undefined, method: 'GET', originalUrl: '/api/x', ...reqExtra } as any;
  const status = vi.fn();
  const json = vi.fn();
  status.mockReturnValue({ json });
  const res = { status } as any;
  const next = vi.fn();
  return gate(req, res, next).then(() => ({ status, json, next }));
}

describe('requireModule middleware', () => {
  beforeEach(() => { findUnique.mockReset(); });

  it('admin with a narrow allowlist passes', async () => {
    const { next, status } = await run(requireModule('finance'), { role: 'admin', allowedModuleKeys: '["chores"]' });
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(status).not.toHaveBeenCalled();
  });
  it('user with null allowlist passes', async () => {
    const { next, status } = await run(requireModule('finance'), { role: 'user', allowedModuleKeys: null });
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(status).not.toHaveBeenCalled();
  });
  it('restricted user on a foreign module gets 403 with the contract body and next is not called', async () => {
    const { next, status, json } = await run(requireModule('finance'), { role: 'user', allowedModuleKeys: '["chores"]' });
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ error: 'module not enabled' });
  });
  it('any-of gate passes when one key is allowed', async () => {
    const { next, status } = await run(requireModule('projects', 'chores'), { role: 'user', allowedModuleKeys: '["chores"]' });
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(status).not.toHaveBeenCalled();
  });
  it('empty allowlist denies', async () => {
    const { next, status } = await run(requireModule('chores'), { role: 'user', allowedModuleKeys: '[]' });
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });
  it('malformed allowlist denies (fail closed)', async () => {
    const { next, status } = await run(requireModule('chores'), { role: 'user', allowedModuleKeys: '{' });
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });
  it('missing user row -> next(401 AppError)', async () => {
    const { next, status } = await run(requireModule('chores'), null);
    expect(status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(401);
  });
  it('no req.user -> next(401 AppError) without touching the DB', async () => {
    const { next, status } = await run(requireModule('chores'), null, false);
    expect(status).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(401);
  });
  it('looks the user up by id with a narrow select', async () => {
    await run(requireModule('chores'), { role: 'user', allowedModuleKeys: null });
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'u1' }, select: { role: true, allowedModuleKeys: true } });
  });
});

describe('requireUnrestricted middleware', () => {
  beforeEach(() => { findUnique.mockReset(); });

  it('admin passes', async () => {
    const { next, status } = await run(requireUnrestricted(), { role: 'admin', allowedModuleKeys: '["chores"]' });
    expect(next).toHaveBeenCalledWith();
    expect(status).not.toHaveBeenCalled();
  });
  it('null allowlist passes', async () => {
    const { next, status } = await run(requireUnrestricted(), { role: 'user', allowedModuleKeys: null });
    expect(next).toHaveBeenCalledWith();
    expect(status).not.toHaveBeenCalled();
  });
  it('array allowlist gets 403', async () => {
    const { next, status, json } = await run(requireUnrestricted(), { role: 'user', allowedModuleKeys: '["chores","vitals"]' });
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ error: MODULE_DENIED });
  });
});

describe('disallowedSettingsKeys', () => {
  it('the writable set is exactly the display and R&R knobs', () => {
    expect([...RESTRICTED_SETTINGS_KEYS].sort()).toEqual(
      ['displayChroma', 'displayCrt', 'displayCut', 'rrBudgetByDay', 'rrOverrunAntiGoalId'].sort(),
    );
  });
  it('display-only bodies are clean', () => {
    expect(disallowedSettingsKeys({ displayCut: 12, displayChroma: 1, displayCrt: 50 })).toEqual([]);
    expect(disallowedSettingsKeys({})).toEqual([]);
    expect(disallowedSettingsKeys(undefined)).toEqual([]);
    expect(disallowedSettingsKeys(null)).toEqual([]);
    expect(disallowedSettingsKeys('x')).toEqual([]);
    expect(disallowedSettingsKeys([1])).toEqual([]);
  });
  it('names every AI, integration and unknown key in the body', () => {
    expect(disallowedSettingsKeys({
      displayCut: 1, aiEnabled: true, handlerEnabled: true, aiAccessFinance: true,
      aiDailyTokenCap: 10_000_000, ollamaUrl: 'http://127.0.0.1:1/', healthPullUrl: 'http://127.0.0.1:1/x',
      healthPullToken: 't', calendarIcsUrls: 'http://127.0.0.1:1/c', ingestToken: 'x', bogus: 1,
    })).toEqual([
      'aiEnabled', 'handlerEnabled', 'aiAccessFinance', 'aiDailyTokenCap', 'ollamaUrl',
      'healthPullUrl', 'healthPullToken', 'calendarIcsUrls', 'ingestToken', 'bogus',
    ]);
  });
});

describe('restrictSettingsWrite middleware', () => {
  beforeEach(() => { findUnique.mockReset(); });
  const KID: Row = { role: 'user', allowedModuleKeys: '["chores"]' };
  const AI_BODY = { aiEnabled: true, handlerEnabled: true, aiAccessFinance: true, healthPullUrl: 'http://127.0.0.1:1/x' };

  it('restricted PUT with AI or integration keys gets 403 with the contract body and never reaches the route', async () => {
    const { next, status, json } = await run(restrictSettingsWrite(), KID, true, { method: 'PUT', body: AI_BODY });
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ error: MODULE_DENIED });
  });
  it('restricted PUT of a single foreign key alongside display knobs is refused (no silent strip)', async () => {
    const { next, status } = await run(restrictSettingsWrite(), KID, true, { method: 'PUT', body: { displayCut: 10, aiDailyTokenCap: 10_000_000 } });
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });
  it('restricted PUT of display knobs passes with the body intact', async () => {
    const body = { displayCut: 10, displayChroma: 1.5, displayCrt: 40 };
    const req = { method: 'PUT', body };
    const { next, status } = await run(restrictSettingsWrite(), KID, true, req);
    expect(next).toHaveBeenCalledWith();
    expect(status).not.toHaveBeenCalled();
    expect(req.body).toEqual({ displayCut: 10, displayChroma: 1.5, displayCrt: 40 });
  });
  it('restricted PUT of the R&R knobs passes (Media tab)', async () => {
    const { next } = await run(restrictSettingsWrite(), KID, true, { method: 'PUT', body: { rrOverrunAntiGoalId: null, rrBudgetByDay: '{}' } });
    expect(next).toHaveBeenCalledWith();
  });
  it('restricted GET passes without a DB lookup', async () => {
    const { next, status } = await run(restrictSettingsWrite(), KID, true, { method: 'GET' });
    expect(next).toHaveBeenCalledWith();
    expect(status).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });
  it('admin and null-allowlist PUTs of AI keys pass', async () => {
    const a = await run(restrictSettingsWrite(), { role: 'admin', allowedModuleKeys: '["chores"]' }, true, { method: 'PUT', body: AI_BODY });
    expect(a.next).toHaveBeenCalledWith();
    const b = await run(restrictSettingsWrite(), { role: 'user', allowedModuleKeys: null }, true, { method: 'PUT', body: AI_BODY });
    expect(b.next).toHaveBeenCalledWith();
  });
  it('empty allowlist is restricted too', async () => {
    const { status } = await run(restrictSettingsWrite(), { role: 'user', allowedModuleKeys: '[]' }, true, { method: 'PUT', body: { aiEnabled: true } });
    expect(status).toHaveBeenCalledWith(403);
  });
  it('no req.user on a PUT -> next(401 AppError)', async () => {
    const { next, status } = await run(restrictSettingsWrite(), KID, false, { method: 'PUT', body: AI_BODY });
    expect(status).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toBeInstanceOf(AppError);
    expect((next.mock.calls[0][0] as AppError).statusCode).toBe(401);
  });
});

describe('disallowedWriteKeys / RESTRICTED_HANDLER_KEYS', () => {
  it('the handler PUT allows only the persona', () => {
    expect([...RESTRICTED_HANDLER_KEYS]).toEqual(['persona']);
  });
  it('lists the keys outside the allowed set', () => {
    expect(disallowedWriteKeys({ persona: 'x', enabled: true }, RESTRICTED_HANDLER_KEYS)).toEqual(['enabled']);
    expect(disallowedWriteKeys({ persona: 'x' }, RESTRICTED_HANDLER_KEYS)).toEqual([]);
    expect(disallowedWriteKeys(null, RESTRICTED_HANDLER_KEYS)).toEqual([]);
    expect(disallowedWriteKeys([{ enabled: true }], RESTRICTED_HANDLER_KEYS)).toEqual([]);
  });
  it('the settings helper is the same function over RESTRICTED_SETTINGS_KEYS', () => {
    const body = { displayCut: 1, aiEnabled: true };
    expect(disallowedSettingsKeys(body)).toEqual(disallowedWriteKeys(body, RESTRICTED_SETTINGS_KEYS));
  });
});

describe('restrictWrittenKeys middleware (handler persona)', () => {
  beforeEach(() => { findUnique.mockReset(); });
  const KID: Row = { role: 'user', allowedModuleKeys: '["chores"]' };
  const gate = () => restrictWrittenKeys(RESTRICTED_HANDLER_KEYS);

  it('restricted PUT flipping the Handler breaker is refused with the contract body', async () => {
    const { next, status, json } = await run(gate(), KID, true, { method: 'PUT', body: { enabled: true } });
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ error: MODULE_DENIED });
  });
  it('restricted PUT of persona together with enabled is refused (no silent strip)', async () => {
    const { status } = await run(gate(), KID, true, { method: 'PUT', body: { persona: 'fixer', enabled: false } });
    expect(status).toHaveBeenCalledWith(403);
  });
  it('restricted PUT equipping a persona passes with the body intact', async () => {
    const req = { method: 'PUT', body: { persona: 'fixer' } };
    const { next, status } = await run(gate(), KID, true, req);
    expect(next).toHaveBeenCalledWith();
    expect(status).not.toHaveBeenCalled();
    expect(req.body).toEqual({ persona: 'fixer' });
  });
  it('restricted GET passes without a DB lookup', async () => {
    const { next } = await run(gate(), KID, true, { method: 'GET' });
    expect(next).toHaveBeenCalledWith();
    expect(findUnique).not.toHaveBeenCalled();
  });
  it('admin and null-allowlist PUTs of enabled pass', async () => {
    const a = await run(gate(), { role: 'admin', allowedModuleKeys: '["chores"]' }, true, { method: 'PUT', body: { enabled: true } });
    expect(a.next).toHaveBeenCalledWith();
    const b = await run(gate(), { role: 'user', allowedModuleKeys: null }, true, { method: 'PUT', body: { enabled: true } });
    expect(b.next).toHaveBeenCalledWith();
  });
});
