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
    "streakShields" INTEGER NOT NULL DEFAULT 0,
    "boosterUntil" DATETIME,
    "budgetBoostOn" DATETIME,
    "lastTokenGrantWeek" TEXT,
    "cosmetics" TEXT,
    "equippedTheme" TEXT,
    "equippedFont" TEXT,
    "equippedFx" TEXT,
    "equippedTimer" TEXT,
    "equippedShell" TEXT,
    "equippedTitle" TEXT,
    "equippedPet" TEXT,
    "fxActive" TEXT,
    "focusStims" INTEGER NOT NULL DEFAULT 0,
    "overclockChips" INTEGER NOT NULL DEFAULT 0,
    "energyOverride" TEXT,
    "energyOverrideOn" DATETIME,
    "longestStreak" INTEGER NOT NULL DEFAULT 0,
    "lastActiveOn" DATETIME,
    "domainXp" TEXT,
    "title" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "player_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_player_profiles" ("boosterUntil", "budgetBoostOn", "cosmetics", "createdAt", "currentStreak", "domainXp", "eddies", "energyOverride", "energyOverrideOn", "equippedFont", "equippedFx", "equippedTheme", "equippedTimer", "id", "lastActiveOn", "lastTokenGrantWeek", "level", "longestStreak", "overclockStreak", "rerollTokens", "rrCredits", "skipTokens", "streakShields", "title", "totalXp", "updatedAt", "userId", "xpIntoLevel") SELECT "boosterUntil", "budgetBoostOn", "cosmetics", "createdAt", "currentStreak", "domainXp", "eddies", "energyOverride", "energyOverrideOn", "equippedFont", "equippedFx", "equippedTheme", "equippedTimer", "id", "lastActiveOn", "lastTokenGrantWeek", "level", "longestStreak", "overclockStreak", "rerollTokens", "rrCredits", "skipTokens", "streakShields", "title", "totalXp", "updatedAt", "userId", "xpIntoLevel" FROM "player_profiles";
DROP TABLE "player_profiles";
ALTER TABLE "new_player_profiles" RENAME TO "player_profiles";
CREATE UNIQUE INDEX "player_profiles_userId_key" ON "player_profiles"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
