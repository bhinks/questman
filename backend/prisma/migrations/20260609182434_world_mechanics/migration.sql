-- AlterTable
ALTER TABLE "player_profiles" ADD COLUMN "energyOverride" TEXT;
ALTER TABLE "player_profiles" ADD COLUMN "energyOverrideOn" DATETIME;

-- CreateTable
CREATE TABLE "bosses" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'custom',
    "direction" TEXT NOT NULL DEFAULT 'grind_down',
    "targetValue" REAL NOT NULL,
    "currentValue" REAL NOT NULL DEFAULT 0,
    "unit" TEXT,
    "color" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "linkedProjectId" TEXT,
    "xpReward" INTEGER NOT NULL DEFAULT 200,
    "eddieReward" INTEGER NOT NULL DEFAULT 100,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "defeatedAt" DATETIME,
    CONSTRAINT "bosses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "bosses_linkedProjectId_fkey" FOREIGN KEY ("linkedProjectId") REFERENCES "projects" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "boss_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bossId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "note" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "boss_logs_bossId_fkey" FOREIGN KEY ("bossId") REFERENCES "bosses" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "quest_chains" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "color" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "quest_chains_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "chain_steps" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chainId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "difficulty" TEXT NOT NULL DEFAULT 'medium',
    "xpReward" INTEGER NOT NULL DEFAULT 30,
    "estMinutes" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'locked',
    "questId" TEXT,
    "completedAt" DATETIME,
    CONSTRAINT "chain_steps_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "quest_chains" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_habits" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'habit',
    "polarity" TEXT NOT NULL DEFAULT 'do',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "color" TEXT,
    "cadence" TEXT NOT NULL DEFAULT 'daily',
    "schedule" TEXT,
    "dueDate" DATETIME,
    "targetPerDay" INTEGER NOT NULL DEFAULT 1,
    "baseXp" INTEGER NOT NULL DEFAULT 10,
    "difficulty" TEXT NOT NULL DEFAULT 'easy',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "estMinutes" INTEGER,
    "minIntervalDays" INTEGER,
    "weatherRule" TEXT,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "longestStreak" INTEGER NOT NULL DEFAULT 0,
    "lastCompletedOn" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "habits_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "habits_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "modules" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_habits" ("baseXp", "cadence", "color", "createdAt", "currentStreak", "description", "difficulty", "dueDate", "estMinutes", "icon", "id", "isActive", "kind", "lastCompletedOn", "longestStreak", "minIntervalDays", "moduleId", "schedule", "targetPerDay", "title", "updatedAt", "userId", "weatherRule") SELECT "baseXp", "cadence", "color", "createdAt", "currentStreak", "description", "difficulty", "dueDate", "estMinutes", "icon", "id", "isActive", "kind", "lastCompletedOn", "longestStreak", "minIntervalDays", "moduleId", "schedule", "targetPerDay", "title", "updatedAt", "userId", "weatherRule" FROM "habits";
DROP TABLE "habits";
ALTER TABLE "new_habits" RENAME TO "habits";
CREATE INDEX "habits_userId_kind_isActive_idx" ON "habits"("userId", "kind", "isActive");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "bosses_userId_status_idx" ON "bosses"("userId", "status");

-- CreateIndex
CREATE INDEX "boss_logs_bossId_createdAt_idx" ON "boss_logs"("bossId", "createdAt");

-- CreateIndex
CREATE INDEX "quest_chains_userId_status_idx" ON "quest_chains"("userId", "status");

-- CreateIndex
CREATE INDEX "chain_steps_chainId_order_idx" ON "chain_steps"("chainId", "order");
