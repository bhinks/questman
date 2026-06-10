-- AlterTable: AI Calibration grant for the calendar uplink. Defaults OFF —
-- calendar data never flowed to the AI before this grant existed, so off
-- preserves prior behavior (the other domain grants defaulted on for the
-- same reason in reverse).
ALTER TABLE "user_settings" ADD COLUMN "aiAccessCalendar" BOOLEAN NOT NULL DEFAULT false;
