/**
 * Steam integration — library sync and playtime tracking.
 *
 * Two axes:
 *   1. PLAYTIME AUDIT: How much time did Brent spend gaming this week?
 *      (Source of truth: Steam's playtime_2weeks, pulled on sync.)
 *   2. LIBRARY DISCOVERY: Unplayed or barely-touched games surfaces as
 *      "braindance queue" suggestions. Games can be pushed to the Media
 *      library as a MediaItem (type:'game') with one click.
 *
 * Env vars consumed: STEAM_API_KEY, STEAM_USER_ID.
 * When either is unset, all routes return { configured: false }.
 *
 * Exports buildSteamCandidates() consumed by QuestEngine.
 */
import express from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../server';
import { AuthRequest } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { QuestCandidate } from '../services/anthropic';
import {
  steamConfigured,
  fetchOwnedGames,
  buildIconUrl,
} from '../services/SteamService';

const router = express.Router();

// --- helpers ----------------------------------------------------------------

/** Resolve the 'media' module id for this user. */
async function mediaModuleId(userId: string): Promise<string> {
  const mod = await prisma.module.findUnique({
    where: { userId_key: { userId, key: 'media' } },
    select: { id: true },
  });
  if (!mod) throw new AppError('media module missing — re-run seed', 500);
  return mod.id;
}

// --- GET /api/steam ---------------------------------------------------------

/**
 * Returns config status, sync summary, and playtime stats.
 * The client uses this to decide whether to show the "connect Steam" prompt.
 */
router.get('/', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const configured = steamConfigured();

  if (!configured) {
    return res.json({ configured: false });
  }

  const [totalCount, unplayedCount, lastSyncRow, recentPlayed] = await Promise.all([
    prisma.steamGame.count({ where: { userId } }),
    prisma.steamGame.count({ where: { userId, playtimeTotal: 0 } }),
    prisma.steamGame.findFirst({
      where: { userId },
      orderBy: { lastSyncedAt: 'desc' },
      select: { lastSyncedAt: true },
    }),
    prisma.steamGame.findMany({
      where: { userId, playtime2Weeks: { gt: 0 } },
      orderBy: { playtime2Weeks: 'desc' },
      take: 5,
      select: { appId: true, name: true, playtime2Weeks: true, playtimeTotal: true, iconUrl: true, mediaItemId: true },
    }),
  ]);

  const weeklyMinutes = recentPlayed.reduce((s, g) => s + g.playtime2Weeks, 0);

  res.json({
    configured: true,
    totalGames: totalCount,
    unplayedGames: unplayedCount,
    lastSyncedAt: lastSyncRow?.lastSyncedAt ?? null,
    weeklyMinutes,
    weeklyHours: Math.round(weeklyMinutes / 60 * 10) / 10,
    recentGames: recentPlayed,
  });
}));

// --- POST /api/steam/sync ---------------------------------------------------

/**
 * Sync the Steam library for the logged-in user.
 * Upserts SteamGame rows — adds new entries, updates playtime on existing ones.
 * Returns the new game / unplayed counts.
 */
router.post('/sync', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;

  if (!steamConfigured()) {
    throw new AppError('Steam API not configured (STEAM_API_KEY / STEAM_USER_ID missing)', 400);
  }

  const result = await fetchOwnedGames();
  if (!result) {
    throw new AppError('Steam library fetch failed — check your API key and Steam ID, and ensure the profile is public', 502);
  }

  const now = new Date();
  let added = 0;
  let updated = 0;

  for (const g of result.games) {
    const iconUrl = g.img_icon_url ? buildIconUrl(g.appid, g.img_icon_url) : null;
    const lastPlayedAt = g.rtime_last_played && g.rtime_last_played > 0
      ? new Date(g.rtime_last_played * 1000)
      : null;

    const existing = await prisma.steamGame.findUnique({
      where: { userId_appId: { userId, appId: String(g.appid) } },
      select: { id: true },
    });

    if (existing) {
      await prisma.steamGame.update({
        where: { id: existing.id },
        data: {
          name: g.name,
          playtimeTotal: g.playtime_forever,
          playtime2Weeks: g.playtime_2weeks,
          lastPlayedAt,
          iconUrl,
          lastSyncedAt: now,
        },
      });
      updated++;
    } else {
      await prisma.steamGame.create({
        data: {
          userId,
          appId: String(g.appid),
          name: g.name,
          playtimeTotal: g.playtime_forever,
          playtime2Weeks: g.playtime_2weeks,
          lastPlayedAt,
          iconUrl,
          lastSyncedAt: now,
        },
      });
      added++;
    }
  }

  const [totalCount, unplayedCount] = await Promise.all([
    prisma.steamGame.count({ where: { userId } }),
    prisma.steamGame.count({ where: { userId, playtimeTotal: 0 } }),
  ]);

  res.json({
    synced: result.gameCount,
    added,
    updated,
    totalGames: totalCount,
    unplayedGames: unplayedCount,
    syncedAt: now,
  });
}));

// --- GET /api/steam/games ---------------------------------------------------

const FILTER = z.enum(['all', 'unplayed', 'played', 'recent']).default('all');

/**
 * List synced Steam games with optional filter.
 * Sorted by playtime (unplayed: alphabetical; others: most-played first).
 */
router.get('/games', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const filter = FILTER.parse(req.query.filter ?? 'all');

  const where: Record<string, any> = { userId };
  if (filter === 'unplayed') where.playtimeTotal = 0;
  if (filter === 'played')   where.playtimeTotal = { gt: 0 };
  if (filter === 'recent')   where.playtime2Weeks = { gt: 0 };

  const games = await prisma.steamGame.findMany({
    where,
    orderBy: filter === 'unplayed'
      ? [{ name: 'asc' }]
      : [{ playtime2Weeks: 'desc' }, { playtimeTotal: 'desc' }],
  });

  res.json({ games, count: games.length });
}));

// --- GET /api/steam/playtime ------------------------------------------------

/**
 * Returns a playtime summary for the "evaluate cutbacks" view.
 * Pulls from the local SteamGame cache (no live API call — use /sync first).
 */
router.get('/playtime', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;

  const allGames = await prisma.steamGame.findMany({
    where: { userId },
    select: {
      appId: true, name: true, iconUrl: true,
      playtimeTotal: true, playtime2Weeks: true, lastPlayedAt: true,
    },
    orderBy: { playtime2Weeks: 'desc' },
  });

  const recentGames = allGames.filter(g => g.playtime2Weeks > 0);
  const weeklyMinutes = recentGames.reduce((s, g) => s + g.playtime2Weeks, 0);
  const allTimeMinutes = allGames.reduce((s, g) => s + g.playtimeTotal, 0);

  // Top 5 all-time for context
  const topAllTime = [...allGames]
    .sort((a, b) => b.playtimeTotal - a.playtimeTotal)
    .slice(0, 5);

  res.json({
    weeklyMinutes,
    weeklyHours: Math.round(weeklyMinutes / 60 * 10) / 10,
    allTimeMinutes,
    allTimeHours: Math.round(allTimeMinutes / 60),
    recentGames,
    topAllTimeGames: topAllTime,
    lastSyncedAt: allGames.length > 0
      ? await prisma.steamGame.findFirst({ where: { userId }, orderBy: { lastSyncedAt: 'desc' }, select: { lastSyncedAt: true } }).then(r => r?.lastSyncedAt ?? null)
      : null,
  });
}));

// --- POST /api/steam/games/:appId/add-to-media ------------------------------

/**
 * Push a Steam game into the Media library as a MediaItem (type:'game',
 * status:'backlog'). Sets the steamGame.mediaItemId pointer so the UI can
 * show "already in queue". Idempotent: calling again returns the existing
 * MediaItem rather than creating a duplicate.
 */
router.post('/games/:appId/add-to-media', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const appId = req.params.appId;

  const steamGame = await prisma.steamGame.findUnique({
    where: { userId_appId: { userId, appId } },
  });
  if (!steamGame) throw new AppError('Steam game not found in library', 404);

  // Already linked — return the existing MediaItem.
  if (steamGame.mediaItemId) {
    const existing = await prisma.mediaItem.findUnique({ where: { id: steamGame.mediaItemId } });
    if (existing) {
      return res.json({ mediaItem: existing, alreadyLinked: true });
    }
    // Stale pointer — clear it and fall through to create.
    await prisma.steamGame.update({ where: { id: steamGame.id }, data: { mediaItemId: null } });
  }

  const moduleId = await mediaModuleId(userId);

  // Estimate playtime from all-time minutes (rough heuristic: use as estMinutes).
  // If the game has been played, this over-estimates (it tracks playtime not
  // time-to-beat). For unplayed games it stays null so the user can auto-estimate
  // via IGDB/HowLongToBeat on the Media page.
  const estMinutes = steamGame.playtimeTotal > 0 ? steamGame.playtimeTotal : null;

  const metaJson = JSON.stringify({
    steamAppId: steamGame.appId,
    steamPlaytimeMin: steamGame.playtimeTotal,
    source: 'steam',
  });

  const mediaItem = await prisma.$transaction(async (tx) => {
    const item = await tx.mediaItem.create({
      data: {
        userId,
        moduleId,
        type: 'game',
        title: steamGame.name,
        status: 'backlog',
        estMinutes,
        coverUrl: steamGame.iconUrl ?? null,
        externalId: steamGame.appId,
        externalSource: 'steam',
        metaJson,
      },
    });
    await tx.steamGame.update({
      where: { id: steamGame.id },
      data: { mediaItemId: item.id },
    });
    return item;
  });

  res.status(201).json({ mediaItem, alreadyLinked: false });
}));

// --- candidate builder (consumed by QuestEngine) ----------------------------

/**
 * Suggests a quest to explore the Steam backlog when there are unplayed games.
 * Fires at most once per 3 days (checks for a recent steam quest in the ledger)
 * so it doesn't nag daily. Returns [] when Steam isn't synced or there's nothing
 * unplayed.
 */
export async function buildSteamCandidates(
  prismaClient: PrismaClient,
  userId: string,
  date: Date,
  nextId: () => string,
): Promise<QuestCandidate[]> {
  const unplayedCount = await prismaClient.steamGame.count({
    where: { userId, playtimeTotal: 0 },
  });
  if (unplayedCount === 0) return [];

  // Throttle: skip if a steam quest exists in the last 3 days (to avoid nagging).
  const threeDaysAgo = new Date(date);
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  const recentQuest = await prismaClient.quest.findFirst({
    where: { userId, source: 'steam', questDate: { gte: threeDaysAgo } },
    select: { id: true },
  });
  if (recentQuest) return [];

  return [{
    candidateId: nextId(),
    source: 'steam',
    sourceId: 'explore_backlog',
    moduleKey: 'steam',
    baseTitle: `Browse your Steam backlog (${unplayedCount} unplayed game${unplayedCount === 1 ? '' : 's'})`,
    difficulty: 'easy',
    xpReward: 10,
    estMinutes: 15,
    carryOver: false,
    context: `${unplayedCount} unplayed game${unplayedCount === 1 ? '' : 's'} in your Steam library`,
  }];
}

export default router;
