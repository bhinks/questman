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
    "projectId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "habits_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "habits_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "modules" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "habits_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_habits" ("baseXp", "cadence", "color", "createdAt", "currentStreak", "description", "difficulty", "dueDate", "estMinutes", "icon", "id", "isActive", "kind", "lastCompletedOn", "longestStreak", "minIntervalDays", "moduleId", "polarity", "schedule", "targetPerDay", "title", "updatedAt", "userId", "weatherRule") SELECT "baseXp", "cadence", "color", "createdAt", "currentStreak", "description", "difficulty", "dueDate", "estMinutes", "icon", "id", "isActive", "kind", "lastCompletedOn", "longestStreak", "minIntervalDays", "moduleId", "polarity", "schedule", "targetPerDay", "title", "updatedAt", "userId", "weatherRule" FROM "habits";
DROP TABLE "habits";
ALTER TABLE "new_habits" RENAME TO "habits";
CREATE INDEX "habits_userId_kind_isActive_idx" ON "habits"("userId", "kind", "isActive");
CREATE INDEX "habits_projectId_idx" ON "habits"("projectId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
