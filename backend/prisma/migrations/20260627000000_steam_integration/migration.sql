-- CreateTable: steam_games — local cache of the user's Steam library.
-- Synced on demand via POST /api/steam/sync. Tracks all-time and
-- recent (2-week) playtime from the Steam Web API. Optional mediaItemId
-- links a game into the Braindance media queue.
CREATE TABLE "steam_games" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "playtimeTotal" INTEGER NOT NULL DEFAULT 0,
    "playtime2Weeks" INTEGER NOT NULL DEFAULT 0,
    "lastPlayedAt" DATETIME,
    "iconUrl" TEXT,
    "mediaItemId" TEXT,
    "lastSyncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "steam_games_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "steam_games_mediaItemId_key" ON "steam_games"("mediaItemId");

-- CreateIndex
CREATE UNIQUE INDEX "steam_games_userId_appId_key" ON "steam_games"("userId", "appId");

-- CreateIndex
CREATE INDEX "steam_games_userId_playtimeTotal_idx" ON "steam_games"("userId", "playtimeTotal");

-- CreateIndex
CREATE INDEX "steam_games_userId_lastPlayedAt_idx" ON "steam_games"("userId", "lastPlayedAt");
