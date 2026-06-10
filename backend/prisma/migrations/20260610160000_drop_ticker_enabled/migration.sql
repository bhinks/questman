-- AlterTable: retire the HANDLER FEED knob. The topbar ticker is long gone
-- and the Today-page handler card is now governed by the AI Calibration
-- toggles (aiEnabled + handlerEnabled), so the display-side gate is dead.
ALTER TABLE "user_settings" DROP COLUMN "tickerEnabled";
