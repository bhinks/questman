/**
 * Admin user-management routes. All guarded by adminAuth (JWT with admin role
 * OR ADMIN_API_KEY header). Used by the operator and by NovaHQ.
 *
 * /api/admin/users
 *   GET    — list all users (id, email, name, role, allowedModuleKeys, createdAt)
 *   POST   — create a new user (admin-only path; bypasses ALLOW_REGISTRATION)
 *   GET /:id   — single user detail
 *   PUT /:id   — update name / email / password / role / allowedModuleKeys
 *   DELETE /:id — delete (cannot delete self or the last admin)
 */
import express from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../server';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import { provisionLifeHub, MODULE_SEEDS } from '../utils/provision';

const router = express.Router();

/** All valid module keys the system knows about. */
const VALID_MODULE_KEYS = MODULE_SEEDS.map(m => m.key) as string[];

// Shared validation for module keys array.
const moduleKeysSchema = z.array(z.string().refine(
  k => VALID_MODULE_KEYS.includes(k),
  k => ({ message: `Unknown module key: ${k}` }),
)).nullable();

// ---- GET /api/admin/users -----------------------------------------------

router.get('/users', asyncHandler(async (_req, res) => {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      allowedModuleKeys: true,
      createdAt: true,
    },
  });
  // Parse allowedModuleKeys from JSON string to array for the response.
  const out = users.map(u => ({
    ...u,
    allowedModuleKeys: u.allowedModuleKeys
      ? (JSON.parse(u.allowedModuleKeys) as string[])
      : null,
  }));
  res.json({ users: out });
}));

// ---- GET /api/admin/users/:id -------------------------------------------

router.get('/users/:id', asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: { id: true, email: true, name: true, role: true, allowedModuleKeys: true, createdAt: true, updatedAt: true },
  });
  if (!user) throw new AppError('User not found', 404);
  res.json({
    user: {
      ...user,
      allowedModuleKeys: user.allowedModuleKeys
        ? (JSON.parse(user.allowedModuleKeys) as string[])
        : null,
    },
  });
}));

// ---- POST /api/admin/users ----------------------------------------------

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).optional(),
  role: z.enum(['admin', 'user']).default('user'),
  // null = all modules; array = specific modules
  allowedModuleKeys: moduleKeysSchema.optional(),
});

router.post('/users', asyncHandler(async (req: AuthRequest, res) => {
  const body = createSchema.parse(req.body);

  const existing = await prisma.user.findUnique({ where: { email: body.email } });
  if (existing) throw new AppError('A user with that email already exists', 409);

  const hashed = await bcrypt.hash(body.password, 12);
  const keysJson = body.allowedModuleKeys !== undefined && body.allowedModuleKeys !== null
    ? JSON.stringify(body.allowedModuleKeys)
    : null;

  const user = await prisma.user.create({
    data: {
      email: body.email,
      password: hashed,
      name: body.name,
      role: body.role,
      allowedModuleKeys: keysJson,
      settings: { create: {} },
    },
    select: { id: true, email: true, name: true, role: true, allowedModuleKeys: true, createdAt: true },
  });

  // Provision modules + player profile for the new user so they can log in.
  await provisionLifeHub(prisma, user.id);

  res.status(201).json({
    user: {
      ...user,
      allowedModuleKeys: user.allowedModuleKeys
        ? (JSON.parse(user.allowedModuleKeys) as string[])
        : null,
    },
  });
}));

// ---- PUT /api/admin/users/:id -------------------------------------------

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  role: z.enum(['admin', 'user']).optional(),
  allowedModuleKeys: moduleKeysSchema.optional(),
});

router.put('/users/:id', asyncHandler(async (req: AuthRequest, res) => {
  const target = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: { id: true, role: true },
  });
  if (!target) throw new AppError('User not found', 404);

  const body = updateSchema.parse(req.body);

  // Prevent stripping the last admin's role.
  if (body.role === 'user' && target.role === 'admin') {
    const adminCount = await prisma.user.count({ where: { role: 'admin' } });
    if (adminCount <= 1) throw new AppError('Cannot demote the last admin', 409);
  }

  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.email !== undefined) {
    const clash = await prisma.user.findUnique({ where: { email: body.email } });
    if (clash && clash.id !== target.id) throw new AppError('Email already in use', 409);
    data.email = body.email;
  }
  if (body.password !== undefined) data.password = await bcrypt.hash(body.password, 12);
  if (body.role !== undefined) data.role = body.role;
  if ('allowedModuleKeys' in body) {
    data.allowedModuleKeys = body.allowedModuleKeys !== null && body.allowedModuleKeys !== undefined
      ? JSON.stringify(body.allowedModuleKeys)
      : null;
  }

  const updated = await prisma.user.update({
    where: { id: target.id },
    data,
    select: { id: true, email: true, name: true, role: true, allowedModuleKeys: true, updatedAt: true },
  });

  res.json({
    user: {
      ...updated,
      allowedModuleKeys: updated.allowedModuleKeys
        ? (JSON.parse(updated.allowedModuleKeys) as string[])
        : null,
    },
  });
}));

// ---- DELETE /api/admin/users/:id ----------------------------------------

router.delete('/users/:id', asyncHandler(async (req: AuthRequest, res) => {
  const callerId = req.user?.id;
  if (callerId === req.params.id) throw new AppError('Cannot delete your own account', 409);

  const target = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: { id: true, role: true },
  });
  if (!target) throw new AppError('User not found', 404);

  if (target.role === 'admin') {
    const adminCount = await prisma.user.count({ where: { role: 'admin' } });
    if (adminCount <= 1) throw new AppError('Cannot delete the last admin', 409);
  }

  await prisma.user.delete({ where: { id: target.id } });
  res.json({ message: 'User deleted' });
}));

// ---- GET /api/admin/modules ---------------------------------------------
// Convenience: return the full list of valid module keys so callers
// (NovaHQ, etc.) can populate a picker without hard-coding the list.

router.get('/modules', asyncHandler(async (_req, res) => {
  res.json({ modules: MODULE_SEEDS.map(m => ({ key: m.key, name: m.name, icon: m.icon })) });
}));

export default router;
