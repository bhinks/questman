/**
 * /api/apikeys — user API key management.
 *
 * One active key per user at all times. The raw key is returned on creation
 * and never stored or re-exposed. Only the SHA-256 hash + a display prefix
 * live in the database.
 *
 * GET    /api/apikeys         — current key metadata (prefix, dates), or empty
 * POST   /api/apikeys         — generate (and return once) a new key; revokes any existing
 * DELETE /api/apikeys/:id     — revoke a specific key
 */
import express from 'express';
import crypto from 'crypto';
import { prisma } from '../server';
import { AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { hashApiKey } from '../middleware/apiKeyAuth';

const router = express.Router();

function generateRawKey(): string {
  return 'qm_' + crypto.randomBytes(24).toString('hex');
}

/** GET /api/apikeys — list the calling user's key metadata. */
router.get('/', asyncHandler(async (req: AuthRequest, res) => {
  const keys = await prisma.apiKey.findMany({
    where: { userId: req.user!.id },
    select: { id: true, keyPrefix: true, createdAt: true, lastUsedAt: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ keys });
}));

/**
 * POST /api/apikeys — generate a new key.
 * Revokes any existing key for this user first (one active key per user).
 * Returns the raw key in `rawKey` — this is the ONLY time it is available.
 */
router.post('/', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;

  // Revoke any existing keys.
  await prisma.apiKey.deleteMany({ where: { userId } });

  const raw = generateRawKey();
  const keyHash = hashApiKey(raw);
  const keyPrefix = raw.slice(0, 10);

  const key = await prisma.apiKey.create({
    data: { userId, keyHash, keyPrefix },
    select: { id: true, keyPrefix: true, createdAt: true, lastUsedAt: true },
  });

  res.status(201).json({ key, rawKey: raw });
}));

/** DELETE /api/apikeys/:id — revoke a specific key. */
router.delete('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const { id } = req.params;
  await prisma.apiKey.deleteMany({ where: { id, userId: req.user!.id } });
  res.status(204).end();
}));

export default router;
