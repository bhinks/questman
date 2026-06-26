import { Response, NextFunction } from 'express';
import crypto from 'crypto';
import { prisma } from '../server';
import { AppError } from './errorHandler';
import { AuthRequest } from './auth';

export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Authenticate requests using a user-generated API key.
 *
 * Expects: Authorization: Bearer <key>
 * On success: populates req.user identically to authMiddleware so all
 * downstream handlers are interchangeable.
 */
export const apiKeyAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError('API key required — use Authorization: Bearer <key>', 401);
    }
    const raw = authHeader.slice(7).trim();
    if (!raw) throw new AppError('API key required', 401);

    const keyHash = hashApiKey(raw);
    const apiKey = await prisma.apiKey.findUnique({
      where: { keyHash },
      include: {
        user: { select: { id: true, email: true, name: true, role: true } },
      },
    });

    if (!apiKey) throw new AppError('Invalid API key', 401);

    // Touch lastUsedAt without blocking the response.
    void prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    });

    req.user = {
      id: apiKey.user.id,
      email: apiKey.user.email,
      name: apiKey.user.name,
      role: apiKey.user.role,
    };
    next();
  } catch (error) {
    next(error);
  }
};
