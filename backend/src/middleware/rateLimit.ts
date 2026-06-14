import { Request, Response, NextFunction } from 'express';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Minimal in-memory fixed-window rate limiter.
 *
 * Deliberately dependency-free: a single-user, self-hosted hub on a trusted
 * LAN doesn't need a distributed store, and pulling in express-rate-limit for
 * one limiter isn't worth it. Keyed by client IP; on breach returns 429 with a
 * Retry-After header. Buckets are pruned lazily so the map can't grow unbounded.
 */
export function rateLimit(opts: { windowMs: number; max: number; message?: string }) {
  const { windowMs, max } = opts;
  const message = opts.message ?? 'Too many requests — slow down and try again later.';
  const buckets = new Map<string, Bucket>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || 'unknown';

    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    // Lazy prune so a churn of client IPs can't leak memory.
    if (buckets.size > 10_000) {
      for (const [k, b] of buckets) {
        if (now >= b.resetAt) buckets.delete(k);
      }
    }

    if (bucket.count > max) {
      res.set('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      res.status(429).json({ error: message });
      return;
    }
    next();
  };
}
