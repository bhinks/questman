-- CreateTable
CREATE TABLE "purchases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priceEddies" INTEGER NOT NULL,
    "grantedJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "purchases_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_achievements" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "unlockedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "meta" TEXT,
    CONSTRAINT "user_achievements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_player_profiles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "totalXp" INTEGER NOT NULL DEFAULT 0,
    "xpIntoLevel" INTEGER NOT NULL DEFAULT 0,
    "eddies" INTEGER NOT NULL DEFAULT 0,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "overclockStreak" INTEGER NOT NULL DEFAULT 0,
    "skipTokens" INTEGER NOT NULL DEFAULT 3,
    "rerollTokens" INTEGER NOT NULL DEFAULT 1,
    "rrCredits" INTEGER NOT NULL DEFAULT 0,
    "lastTokenGrantWeek" TEXT,
    "cosmetics" TEXT,
    "equippedTheme" TEXT,
    "longestStreak" INTEGER NOT NULL DEFAULT 0,
    "lastActiveOn" DATETIME,
    "domainXp" TEXT,
    "title" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "player_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_player_profiles" ("createdAt", "currentStreak", "domainXp", "eddies", "id", "lastActiveOn", "level", "longestStreak", "title", "totalXp", "updatedAt", "userId", "xpIntoLevel") SELECT "createdAt", "currentStreak", "domainXp", "eddies", "id", "lastActiveOn", "level", "longestStreak", "title", "totalXp", "updatedAt", "userId", "xpIntoLevel" FROM "player_profiles";
DROP TABLE "player_profiles";
ALTER TABLE "new_player_profiles" RENAME TO "player_profiles";
CREATE UNIQUE INDEX "player_profiles_userId_key" ON "player_profiles"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "purchases_userId_createdAt_idx" ON "purchases"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "user_achievements_userId_idx" ON "user_achievements"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_achievements_userId_key_key" ON "user_achievements"("userId", "key");
