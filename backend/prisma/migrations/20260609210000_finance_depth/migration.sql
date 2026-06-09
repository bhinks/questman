-- AlterTable: finance-depth fields on Transaction
ALTER TABLE "transactions" ADD COLUMN "excluded" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "transactions" ADD COLUMN "projectId" TEXT;
ALTER TABLE "transactions" ADD COLUMN "choreId" TEXT;

-- CreateTable
CREATE TABLE "recurring_expenses" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "cadence" TEXT NOT NULL DEFAULT 'monthly',
    "dueDay" INTEGER,
    "categoryId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isSubscription" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "lastPaidOn" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "recurring_expenses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "recurring_expenses_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "transactions_userId_excluded_idx" ON "transactions"("userId", "excluded");

-- CreateIndex
CREATE INDEX "transactions_projectId_idx" ON "transactions"("projectId");

-- CreateIndex
CREATE INDEX "transactions_choreId_idx" ON "transactions"("choreId");

-- CreateIndex
CREATE INDEX "recurring_expenses_userId_active_idx" ON "recurring_expenses"("userId", "active");
