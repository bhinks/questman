-- AlterTable: source-account dimension on transactions (import-only, no sync)
ALTER TABLE "transactions" ADD COLUMN "account" TEXT;

-- AlterTable: independently-equippable cosmetic slots (fonts / FX)
ALTER TABLE "player_profiles" ADD COLUMN "equippedFont" TEXT;
ALTER TABLE "player_profiles" ADD COLUMN "equippedFx" TEXT;

-- CreateTable: weekly workout plan template
CREATE TABLE "workout_plans" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'strength',
    "targetMin" INTEGER,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "workout_plans_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "workout_plans_userId_dayOfWeek_idx" ON "workout_plans"("userId", "dayOfWeek");
