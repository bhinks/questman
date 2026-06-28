-- Per-user integrations: location, calendar, and phone-health-pull config
-- move from GLOBAL env values (one hub user) to PER-USER columns on
-- user_settings. No global fallback — a blank user gets nothing.
-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN "weatherLat" REAL;
ALTER TABLE "user_settings" ADD COLUMN "weatherLon" REAL;
ALTER TABLE "user_settings" ADD COLUMN "calendarIcsUrls" TEXT;
ALTER TABLE "user_settings" ADD COLUMN "healthPullUrl" TEXT;
ALTER TABLE "user_settings" ADD COLUMN "healthPullToken" TEXT;
ALTER TABLE "user_settings" ADD COLUMN "healthPullMinutes" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "user_settings" ADD COLUMN "healthBackfillDays" INTEGER NOT NULL DEFAULT 365;
ALTER TABLE "user_settings" ADD COLUMN "ingestToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "user_settings_ingestToken_key" ON "user_settings"("ingestToken");
