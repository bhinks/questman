-- AlterTable: Night Market consumables (streak shield / overdrive / time dilation)
ALTER TABLE "player_profiles" ADD COLUMN "streakShields" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "player_profiles" ADD COLUMN "boosterUntil" DATETIME;
ALTER TABLE "player_profiles" ADD COLUMN "budgetBoostOn" DATETIME;
