-- AlterTable: Night City display-calibration knobs on UserSettings
ALTER TABLE "user_settings" ADD COLUMN "displayCut" INTEGER NOT NULL DEFAULT 24;
ALTER TABLE "user_settings" ADD COLUMN "displayChroma" REAL NOT NULL DEFAULT 2;
ALTER TABLE "user_settings" ADD COLUMN "displayCrt" INTEGER NOT NULL DEFAULT 75;
ALTER TABLE "user_settings" ADD COLUMN "tickerEnabled" BOOLEAN NOT NULL DEFAULT true;
