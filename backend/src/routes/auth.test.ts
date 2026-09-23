import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';

// The router is driven directly (no supertest in the tree): a hand-rolled
// req/res pair goes through the real express Router, the real authMiddleware
// and the route handlers, with prisma, config, logger and the provisioning
// helpers mocked. server.ts boots Express and Prisma on import, so it is
// replaced by the prisma stub below.
const SSO_SECRET = 'sso-secret-for-tests-0123456789';
const JWT_SECRET = 'jwt-secret-for-tests-0123456789';

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
  category: { createMany: vi.fn() },
}));
const log = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

vi.mock('../server', () => ({ prisma: db }));
vi.mock('../utils/logger', () => ({ logger: log }));
vi.mock('../utils/demoSeed', () => ({ seedDemoUser: vi.fn() }));
vi.mock('../utils/provision', async (orig) => ({
  ...(await orig<typeof import('../utils/provision')>()),
  provisionLifeHub: vi.fn(async () => undefined),
}));
vi.mock('../config', () => ({
  config: {
    hinksIdSsoSecret: 'sso-secret-for-tests-0123456789',
    jwt: { secret: 'jwt-secret-for-tests-0123456789', expiresIn: '1h' },
    allowRegistration: false,
  },
}));

import router, { SSO_UNUSABLE_PASSWORD, isSsoBoundPassword, profileUpdateSchema } from './auth';
import { AppError } from '../middleware/errorHandler';

type Row = { id: string; email: string; name?: string | null; tokenVersion: number; password: string; role: string; allowedModuleKeys?: string | null };

/** A plausible bcrypt hash shape: what a password account or a legacy SSO row holds. */
const BCRYPT_LIKE = '$2a$12$' + 'a'.repeat(53);

const sessionToken = (u: Row) => jwt.sign({ id: u.id, email: u.email, tokenVersion: u.tokenVersion }, JWT_SECRET, { expiresIn: '1h' });
const ssoToken = (claims: Record<string, unknown>) => jwt.sign(claims, SSO_SECRET, { algorithm: 'HS256', expiresIn: '5m' });

type Result = { status: number; body: unknown; redirect?: string; cookies: string[]; err?: unknown };

function call(method: string, url: string, opts: { body?: unknown; session?: Row; headers?: Record<string, string> } = {}): Promise<Result> {
  return new Promise(resolve => {
    const out: Result = { status: 200, body: undefined, cookies: [] };
    const headers: Record<string, string | undefined> = { ...(opts.headers ?? {}) };
    if (opts.session) headers.cookie = `token=${sessionToken(opts.session)}`;
    const req: Record<string, unknown> = {
      method, url, originalUrl: url, baseUrl: '', headers, body: opts.body ?? {}, query: {}, secure: false,
    };
    const res: Record<string, unknown> = {
      status(n: number) { out.status = n; return res; },
      json(b: unknown) { out.body = b; resolve(out); },
      redirect(to: string) { out.status = 302; out.redirect = to; resolve(out); },
      cookie(name: string) { out.cookies.push(name); return res; },
      clearCookie() { return res; },
    };
    (router as unknown as (rq: unknown, rs: unknown, nx: (e?: unknown) => void) => void)(req, res, (err?: unknown) => {
      out.err = err;
      out.status = err instanceof AppError ? err.statusCode : 404;
      resolve(out);
    });
  });
}

/** Wire findUnique so an id lookup (authMiddleware) and an email lookup (/sso, clash) both answer. */
function seed(rows: Row[]) {
  db.user.findUnique.mockImplementation(async (args: { where: { id?: string; email?: string } }) => {
    const r = rows.find(x => (args.where.id ? x.id === args.where.id : x.email === args.where.email));
    return r ? { ...r } : null;
  });
}

const KID: Row = { id: 'kid-a', email: 'u7@hinks.local', name: 'KidA', tokenVersion: 0, password: SSO_UNUSABLE_PASSWORD, role: 'user', allowedModuleKeys: '["chores"]' };
const ADMIN: Row = { id: 'adm', email: 'brent@test.local', name: 'Brent', tokenVersion: 0, password: BCRYPT_LIKE, role: 'admin', allowedModuleKeys: null };

beforeEach(() => {
  db.user.findUnique.mockReset(); db.user.create.mockReset(); db.user.update.mockReset(); db.category.createMany.mockReset();
  log.warn.mockReset(); log.info.mockReset();
  db.user.update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: 'x', email: 'x', name: null, createdAt: new Date(), settings: null, ...args.data }));
});

describe('SSO password marker', () => {
  it('is not a bcrypt hash and only the marker counts as SSO-bound', () => {
    expect(SSO_UNUSABLE_PASSWORD.length).not.toBe(60);
    expect(isSsoBoundPassword(SSO_UNUSABLE_PASSWORD)).toBe(true);
    expect(isSsoBoundPassword(BCRYPT_LIKE)).toBe(false);
    expect(isSsoBoundPassword('')).toBe(false);
  });
});

describe('PUT /me', () => {
  it('schema accepts name and email only (role and allowedModuleKeys are stripped)', () => {
    expect(profileUpdateSchema.parse({ name: 'K', role: 'admin', allowedModuleKeys: null })).toEqual({ name: 'K' });
    expect(() => profileUpdateSchema.parse({ email: 'nope' })).toThrow();
  });
  it('a non-admin may not change their email (403, nothing written)', async () => {
    seed([KID, ADMIN]);
    const r = await call('PUT', '/me', { session: KID, body: { email: 'u1@hinks.local' } });
    expect(r.status).toBe(403);
    expect((r.err as AppError).message).toMatch(/admin-only/);
    expect(db.user.update).not.toHaveBeenCalled();
  });
  it('a non-admin may still rename themselves', async () => {
    seed([KID]);
    const r = await call('PUT', '/me', { session: KID, body: { name: 'Kid Alpha' } });
    expect(r.status).toBe(200);
    expect(db.user.update).toHaveBeenCalledTimes(1);
    expect(db.user.update.mock.calls[0][0]).toMatchObject({ where: { id: 'kid-a' }, data: { name: 'Kid Alpha' } });
  });
  it('an admin may change their own email when it is free', async () => {
    seed([ADMIN, KID]);
    const r = await call('PUT', '/me', { session: ADMIN, body: { email: 'brent2@test.local' } });
    expect(r.status).toBe(200);
    expect(db.user.update.mock.calls[0][0]).toMatchObject({ where: { id: 'adm' }, data: { email: 'brent2@test.local' } });
  });
  it('an admin taking an address another row holds gets 409', async () => {
    seed([ADMIN, KID]);
    const r = await call('PUT', '/me', { session: ADMIN, body: { email: KID.email } });
    expect(r.status).toBe(409);
    expect(db.user.update).not.toHaveBeenCalled();
  });
  it('no session -> 401', async () => {
    seed([KID]);
    const r = await call('PUT', '/me', { body: { name: 'x' } });
    expect(r.status).toBe(401);
  });
});

describe('POST /sso', () => {
  const NEW_ROW = (over: Partial<Row>): Row => ({ id: 'new', email: 'u9@hinks.local', tokenVersion: 0, password: SSO_UNUSABLE_PASSWORD, role: 'user', ...over });

  it('a brand-new non-admin account with no modules claim starts chores-only, with the SSO password marker', async () => {
    seed([]);
    db.user.create.mockImplementation(async (args: { data: Record<string, unknown> }) => NEW_ROW({ email: args.data.email as string }));
    const r = await call('POST', '/sso', { body: { token: ssoToken({ sub: '9', email: 'U9@hinks.local', name: 'KidC' }) } });
    expect(r.status).toBe(302);
    expect(r.redirect).toBe('/');
    expect(r.cookies).toEqual(['token']);
    expect(db.user.create).toHaveBeenCalledTimes(1);
    const data = db.user.create.mock.calls[0][0].data as Record<string, unknown>;
    expect(data).toMatchObject({ email: 'u9@hinks.local', password: SSO_UNUSABLE_PASSWORD, name: 'KidC', role: 'user', allowedModuleKeys: '["chores"]' });
    expect(db.category.createMany).toHaveBeenCalledTimes(1);
    expect(db.user.update).not.toHaveBeenCalled();
  });
  it('a brand-new admin account with modules null gets no chores default and is promoted', async () => {
    seed([]);
    db.user.create.mockImplementation(async () => NEW_ROW({ email: 'u1@hinks.local' }));
    const r = await call('POST', '/sso', { body: { token: ssoToken({ sub: '1', email: 'u1@hinks.local', name: 'Brent', role: 'admin', modules: null }) } });
    expect(r.status).toBe(302);
    const data = db.user.create.mock.calls[0][0].data as Record<string, unknown>;
    expect('allowedModuleKeys' in data).toBe(false);
    expect(db.user.update).toHaveBeenCalledTimes(1);
    expect(db.user.update.mock.calls[0][0]).toEqual({ where: { id: 'new' }, data: { allowedModuleKeys: null, role: 'admin' } });
  });
  it('the name is trimmed and capped at 80 chars, falling back to the email local part', async () => {
    seed([]);
    db.user.create.mockImplementation(async () => NEW_ROW({}));
    await call('POST', '/sso', { body: { token: ssoToken({ sub: '9', email: 'u9@hinks.local', name: ' ' + 'n'.repeat(120) + ' ' }) } });
    expect((db.user.create.mock.calls[0][0].data as Record<string, unknown>).name).toBe('n'.repeat(80));
    db.user.create.mockClear();
    await call('POST', '/sso', { body: { token: ssoToken({ sub: '9', email: 'u9@hinks.local', name: '   ' }) } });
    expect((db.user.create.mock.calls[0][0].data as Record<string, unknown>).name).toBe('u9');
  });
  it('an existing SSO-bound account is promoted by role: admin', async () => {
    seed([KID]);
    const r = await call('POST', '/sso', { body: { token: ssoToken({ sub: '7', email: KID.email, role: 'admin' }) } });
    expect(r.status).toBe(302);
    expect(db.user.create).not.toHaveBeenCalled();
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 'kid-a' }, data: { role: 'admin' } });
    expect(log.info).toHaveBeenCalledWith(expect.objectContaining({ msg: expect.stringContaining('promoted') }));
  });
  it('an existing account that SSO did not create is never promoted (logged), modules still apply', async () => {
    const hijacked: Row = { ...KID, password: BCRYPT_LIKE, email: 'u1@hinks.local' };
    seed([hijacked]);
    const r = await call('POST', '/sso', { body: { token: ssoToken({ sub: '1', email: 'u1@hinks.local', role: 'admin', modules: null }) } });
    expect(r.status).toBe(302);
    expect(db.user.update).toHaveBeenCalledTimes(1);
    expect(db.user.update.mock.calls[0][0]).toEqual({ where: { id: 'kid-a' }, data: { allowedModuleKeys: null } });
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ msg: expect.stringContaining('not SSO-bound'), userId: 'kid-a' }));
  });
  it('a non-bound row with only a role claim writes nothing at all', async () => {
    seed([{ ...KID, password: BCRYPT_LIKE }]);
    await call('POST', '/sso', { body: { token: ssoToken({ sub: '7', email: KID.email, role: 'admin' }) } });
    expect(db.user.update).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledTimes(1);
  });
  it('an admin row is never demoted by role: user and gets no promotion log', async () => {
    seed([{ ...ADMIN, password: SSO_UNUSABLE_PASSWORD }]);
    await call('POST', '/sso', { body: { token: ssoToken({ sub: '1', email: ADMIN.email, role: 'user', modules: ['chores'] }) } });
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 'adm' }, data: { allowedModuleKeys: '["chores"]' } });
    expect(log.info).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });
  it('modules claim is validated against the module keys and unknown keys are logged', async () => {
    seed([KID]);
    await call('POST', '/sso', { body: { token: ssoToken({ sub: '7', email: KID.email, modules: ['chores', 'rootkit', 'finance', 42] }) } });
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 'kid-a' }, data: { allowedModuleKeys: '["chores","finance"]' } });
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ dropped: ['rootkit', 42] }));
  });
  it('an existing account with no modules and no role claim is left untouched', async () => {
    seed([KID]);
    const r = await call('POST', '/sso', { body: { token: ssoToken({ sub: '7', email: KID.email }) } });
    expect(r.status).toBe(302);
    expect(db.user.update).not.toHaveBeenCalled();
    expect(db.user.create).not.toHaveBeenCalled();
  });
  it('rejects a token signed with the wrong secret, a missing token and a missing email claim', async () => {
    seed([]);
    const bad = jwt.sign({ email: 'u7@hinks.local', role: 'admin' }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '5m' });
    expect((await call('POST', '/sso', { body: { token: bad } })).status).toBe(401);
    expect((await call('POST', '/sso', { body: {} })).status).toBe(400);
    expect((await call('POST', '/sso', { body: { token: ssoToken({ sub: '7' }) } })).status).toBe(400);
    expect(db.user.create).not.toHaveBeenCalled();
  });
  it('honors a single-segment X-Forwarded-Prefix and ignores a traversal one', async () => {
    seed([KID]);
    const ok = await call('POST', '/sso', { body: { token: ssoToken({ sub: '7', email: KID.email }) }, headers: { 'x-forwarded-prefix': '/questman' } });
    expect(ok.redirect).toBe('/questman/');
    const evil = await call('POST', '/sso', { body: { token: ssoToken({ sub: '7', email: KID.email }) }, headers: { 'x-forwarded-prefix': '/questman/../evil' } });
    expect(evil.redirect).toBe('/');
  });
});
