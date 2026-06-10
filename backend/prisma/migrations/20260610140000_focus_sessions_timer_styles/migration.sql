-- AlterTable: timer-style cosmetic slot (Night Market focus line)
ALTER TABLE "player_profiles" ADD COLUMN "equippedTimer" TEXT;

-- CreateTable: persisted focus-timer sessions (JACK IN deep-work log)
CREATE TABLE "focus_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL DEFAULT 'other',
    "targetId" TEXT,
    "label" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "endedAt" DATETIME NOT NULL,
    "minutes" INTEGER NOT NULL,
    "limitMinutes" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "focus_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "focus_sessions_userId_startedAt_idx" ON "focus_sessions"("userId", "startedAt");
CREATE INDEX "focus_sessions_userId_targetType_targetId_idx" ON "focus_sessions"("userId", "targetType", "targetId");
