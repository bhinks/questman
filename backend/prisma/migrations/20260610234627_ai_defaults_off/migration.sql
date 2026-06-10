-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_transactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "description" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "categoryId" TEXT,
    "vendorId" TEXT,
    "originalDescription" TEXT,
    "confidence" REAL,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "isWasteful" BOOLEAN NOT NULL DEFAULT false,
    "isSuspicious" BOOLEAN NOT NULL DEFAULT false,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "projectId" TEXT,
    "choreId" TEXT,
    "importId" TEXT,
    "account" TEXT,
    "notes" TEXT,
    "tags" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "transactions_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "transactions_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "transactions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "transactions_choreId_fkey" FOREIGN KEY ("choreId") REFERENCES "habits" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "transactions_importId_fkey" FOREIGN KEY ("importId") REFERENCES "imports" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_transactions" ("account", "amount", "categoryId", "choreId", "confidence", "createdAt", "date", "description", "excluded", "id", "importId", "isManual", "isRecurring", "isSuspicious", "isWasteful", "notes", "originalDescription", "projectId", "tags", "updatedAt", "userId", "vendorId") SELECT "account", "amount", "categoryId", "choreId", "confidence", "createdAt", "date", "description", "excluded", "id", "importId", "isManual", "isRecurring", "isSuspicious", "isWasteful", "notes", "originalDescription", "projectId", "tags", "updatedAt", "userId", "vendorId" FROM "transactions";
DROP TABLE "transactions";
ALTER TABLE "new_transactions" RENAME TO "transactions";
CREATE INDEX "transactions_userId_date_idx" ON "transactions"("userId", "date");
CREATE INDEX "transactions_userId_categoryId_idx" ON "transactions"("userId", "categoryId");
CREATE INDEX "transactions_userId_amount_idx" ON "transactions"("userId", "amount");
CREATE INDEX "transactions_userId_excluded_idx" ON "transactions"("userId", "excluded");
CREATE INDEX "transactions_projectId_idx" ON "transactions"("projectId");
CREATE INDEX "transactions_choreId_idx" ON "transactions"("choreId");
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
