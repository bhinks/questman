import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { prisma } from '../server';
import { AppError } from './errorHandler';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string | null;
  };
}

/** Name of the httpOnly session cookie carrying the JWT. */
export const AUTH_COOKIE = 'token';

/** Parse one cookie out of the raw Cookie header (no cookie-parser dependency). */
export function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

interface JwtPayload {
  id: string;
  email: string;
  tokenVersion?: number; // absent on pre-revocation tokens → treated as 0
  iat: number;
  exp: number;
}

/**
 * Verify a JWT and confirm it hasn't been revoked: the user must still exist
 * AND the token's version must match the user's current tokenVersion (bumped
 * by "log out everywhere"). Throws AppError(401) on any failure. Shared by the
 * REST middleware and the socket handshake.
 */
export async function verifyAuthToken(token: string): Promise<{ id: string; email: string; name: string | null }> {
  const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
  const user = await prisma.user.findUnique({
    where: { id: decoded.id },
    select: { id: true, email: true, name: true, tokenVersion: true },
  });
  if (!user) throw new AppError('Invalid token', 401);
  if ((decoded.tokenVersion ?? 0) !== user.tokenVersion) throw new AppError('Token revoked', 401);
  return { id: user.id, email: user.email, name: user.name };
}

/** The session JWT from the httpOnly cookie (primary) or, as a fallback for
 *  API clients/tests, the Authorization header. */
function tokenFromRequest(req: Request): string | undefined {
  return readCookie(req.headers.cookie, AUTH_COOKIE)
    ?? req.headers.authorization?.replace('Bearer ', '');
}

export const authMiddleware = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = tokenFromRequest(req);
    if (!token) throw new AppError('No token provided', 401);
    req.user = await verifyAuthToken(token);
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      next(new AppError('Invalid token', 401));
    } else {
      next(error);
    }
  }
};

export const optionalAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const token = tokenFromRequest(req);
  if (token) {
    try {
      req.user = await verifyAuthToken(token);
    } catch {
      // Continue without auth if the token is invalid/revoked.
    }
  }
  next();
};
