-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_habit_completions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "habitId" TEXT NOT NULL,
    "completedOn" DATETIME NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "note" TEXT,
    "xpAwarded" INTEGER NOT NULL DEFAULT 0,
    "eddiesAwarded" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "habit_completions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "habit_completions_habitId_fkey" FOREIGN KEY ("habitId") REFERENCES "habits" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_habit_completions" ("completedOn", "count", "createdAt", "habitId", "id", "note", "source", "userId", "xpAwarded") SELECT "completedOn", "count", "createdAt", "habitId", "id", "note", "source", "userId", "xpAwarded" FROM "habit_completions";
DROP TABLE "habit_completions";
ALTER TABLE "new_habit_completions" RENAME TO "habit_completions";
CREATE INDEX "habit_completions_userId_completedOn_idx" ON "habit_completions"("userId", "completedOn");
CREATE UNIQUE INDEX "habit_completions_habitId_completedOn_key" ON "habit_completions"("habitId", "completedOn");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
