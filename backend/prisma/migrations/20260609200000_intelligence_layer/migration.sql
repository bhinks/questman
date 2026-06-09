-- AlterTable: AI Handler persona on UserSettings
ALTER TABLE "user_settings" ADD COLUMN "handlerPersona" TEXT NOT NULL DEFAULT 'rogue_ai';
ALTER TABLE "user_settings" ADD COLUMN "handlerEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "handler_messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "persona" TEXT,
    "refType" TEXT,
    "refId" TEXT,
    "meta" TEXT,
    "seen" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "handler_messages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "insights" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "weekOf" DATETIME,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "evidence" TEXT,
    "confidence" TEXT NOT NULL DEFAULT 'low',
    "windowDays" INTEGER,
    "suggestion" TEXT,
    "actionType" TEXT NOT NULL DEFAULT 'none',
    "status" TEXT NOT NULL DEFAULT 'new',
    "spawnedQuestId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "insights_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "weekly_reviews" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "weekOf" DATETIME NOT NULL,
    "statsJson" TEXT NOT NULL,
    "handlerText" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "focusForNext" TEXT,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" DATETIME,
    CONSTRAINT "weekly_reviews_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "handler_messages_userId_createdAt_idx" ON "handler_messages"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "insights_userId_createdAt_idx" ON "insights"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "insights_userId_status_idx" ON "insights"("userId", "status");

-- CreateIndex
CREATE INDEX "weekly_reviews_userId_weekOf_idx" ON "weekly_reviews"("userId", "weekOf");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_reviews_userId_weekOf_key" ON "weekly_reviews"("userId", "weekOf");
