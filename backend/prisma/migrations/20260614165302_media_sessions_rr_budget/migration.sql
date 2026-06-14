-- CreateTable
CREATE TABLE "media_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "mediaItemId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL DEFAULT 0,
    "units" INTEGER,
    "kind" TEXT NOT NULL DEFAULT 'progress',
    "charged" BOOLEAN NOT NULL DEFAULT false,
    "chargeSource" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "media_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "media_sessions_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "media_items" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_user_settings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "dateFormat" TEXT NOT NULL DEFAULT 'MM/dd/yyyy',
    "theme" TEXT NOT NULL DEFAULT 'cyberpunk',
    "autoCategoriztion" BOOLEAN NOT NULL DEFAULT true,
    "notifications" BOOLEAN NOT NULL DEFAULT true,
    "dataRetention" INTEGER NOT NULL DEFAULT 365,
    "shareAnalytics" BOOLEAN NOT NULL DEFAULT false,
    "weekdayBudgetMin" INTEGER NOT NULL DEFAULT 240,
    "weekendBudgetMin" INTEGER NOT NULL DEFAULT 600,
    "rrBudgetByDay" TEXT NOT NULL DEFAULT '[2,1,1,1,1,2,3]',
    "rrOverrunAntiGoalId" TEXT,
    "handlerPersona" TEXT NOT NULL DEFAULT 'rogue_ai',
    "handlerEnabled" BOOLEAN NOT NULL DEFAULT false,
    "aiEnabled" BOOLEAN NOT NULL DEFAULT false,
    "aiQuestsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "aiAccessFinance" BOOLEAN NOT NULL DEFAULT false,
    "aiAccessHealth" BOOLEAN NOT NULL DEFAULT false,
    "aiAccessSocial" BOOLEAN NOT NULL DEFAULT false,
    "aiAccessCalendar" BOOLEAN NOT NULL DEFAULT false,
    "aiProvider" TEXT NOT NULL DEFAULT 'anthropic',
    "aiModelQuests" TEXT,
    "aiModelHandler" TEXT,
    "ollamaUrl" TEXT NOT NULL DEFAULT 'http://localhost:11434',
    "ollamaModel" TEXT NOT NULL DEFAULT 'llama3.1',
    "aiDailyTokenCap" INTEGER NOT NULL DEFAULT 100000,
    "aiTokensUsed" INTEGER NOT NULL DEFAULT 0,
    "aiTokensUsedOn" DATETIME,
    "displayCut" INTEGER NOT NULL DEFAULT 24,
    "displayChroma" REAL NOT NULL DEFAULT 2,
    "displayCrt" INTEGER NOT NULL DEFAULT 75,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "user_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_user_settings" ("aiAccessCalendar", "aiAccessFinance", "aiAccessHealth", "aiAccessSocial", "aiDailyTokenCap", "aiEnabled", "aiModelHandler", "aiModelQuests", "aiProvider", "aiQuestsEnabled", "aiTokensUsed", "aiTokensUsedOn", "autoCategoriztion", "createdAt", "currency", "dataRetention", "dateFormat", "displayChroma", "displayCrt", "displayCut", "handlerEnabled", "handlerPersona", "id", "notifications", "ollamaModel", "ollamaUrl", "shareAnalytics", "theme", "updatedAt", "userId", "weekdayBudgetMin", "weekendBudgetMin") SELECT "aiAccessCalendar", "aiAccessFinance", "aiAccessHealth", "aiAccessSocial", "aiDailyTokenCap", "aiEnabled", "aiModelHandler", "aiModelQuests", "aiProvider", "aiQuestsEnabled", "aiTokensUsed", "aiTokensUsedOn", "autoCategoriztion", "createdAt", "currency", "dataRetention", "dateFormat", "displayChroma", "displayCrt", "displayCut", "handlerEnabled", "handlerPersona", "id", "notifications", "ollamaModel", "ollamaUrl", "shareAnalytics", "theme", "updatedAt", "userId", "weekdayBudgetMin", "weekendBudgetMin" FROM "user_settings";
DROP TABLE "user_settings";
ALTER TABLE "new_user_settings" RENAME TO "user_settings";
CREATE UNIQUE INDEX "user_settings_userId_key" ON "user_settings"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "media_sessions_userId_createdAt_idx" ON "media_sessions"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "media_sessions_mediaItemId_createdAt_idx" ON "media_sessions"("mediaItemId", "createdAt");
