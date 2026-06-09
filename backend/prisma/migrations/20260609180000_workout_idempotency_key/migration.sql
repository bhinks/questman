-- AlterTable: client idempotency key for workout logging (NULL allowed/distinct in SQLite)
ALTER TABLE "workout_sessions" ADD COLUMN "clientRequestId" TEXT;

-- CreateIndex: dedupe a double-submit/retry that reuses the same key
CREATE UNIQUE INDEX "workout_sessions_userId_clientRequestId_key" ON "workout_sessions"("userId", "clientRequestId");
