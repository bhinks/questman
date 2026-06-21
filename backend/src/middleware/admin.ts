import { Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { config } from '../config';
import { AppError } from './errorHandler';
import { AuthRequest, verifyAuthToken, readCookie, AUTH_COOKIE } from './auth';

/**
 * Dual-mode admin gate:
 *  1. X-Admin-Key header matching ADMIN_API_KEY — service-to-service calls
 *     (e.g. from NovaHQ). Sets req.isApiKeyAuth=true, no req.user.
 *  2. Valid JWT belonging to a user with role="admin" — regular browser session.
 *
 * Reject everything else with 401/403.
 */
export const adminAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  // Path 1: API key for service-to-service calls.
  if (config.adminApiKey) {
    const provided = req.headers['x-admin-key'] as string | undefined;
    if (provided) {
      try {
        const a = Buffer.from(provided);
        const b = Buffer.from(config.adminApiKey);
        if (a.length === b.length && timingSafeEqual(a, b)) {
          req.isApiKeyAuth = true;
          return next();
        }
      } catch {
        // Buffer length mismatch or encoding error — fall through to JWT path.
      }
      return next(new AppError('Invalid admin API key', 401));
    }
  }

  // Path 2: JWT bearer / cookie.
  try {
    const token = readCookie(req.headers.cookie, AUTH_COOKIE)
      ?? req.headers.authorization?.replace('Bearer ', '');
    if (!token) throw new AppError('Authentication required', 401);
    const user = await verifyAuthToken(token);
    if (user.role !== 'admin') throw new AppError('Admin access required', 403);
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};
