-- AlterTable: AI Calibration (SYS//CAL) — user-owned AI controls.
-- Master breaker, per-feature toggles, per-domain data-access grants,
-- provider selection (Anthropic cloud vs local Ollama), model overrides,
-- and a daily token cap with its rolling per-day counter.
ALTER TABLE "user_settings" ADD COLUMN "aiEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "user_settings" ADD COLUMN "aiQuestsEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "user_settings" ADD COLUMN "aiAccessFinance" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "user_settings" ADD COLUMN "aiAccessHealth" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "user_settings" ADD COLUMN "aiAccessSocial" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "user_settings" ADD COLUMN "aiProvider" TEXT NOT NULL DEFAULT 'anthropic';
ALTER TABLE "user_settings" ADD COLUMN "aiModelQuests" TEXT;
ALTER TABLE "user_settings" ADD COLUMN "aiModelHandler" TEXT;
ALTER TABLE "user_settings" ADD COLUMN "ollamaUrl" TEXT NOT NULL DEFAULT 'http://localhost:11434';
ALTER TABLE "user_settings" ADD COLUMN "ollamaModel" TEXT NOT NULL DEFAULT 'llama3.1';
ALTER TABLE "user_settings" ADD COLUMN "aiDailyTokenCap" INTEGER NOT NULL DEFAULT 100000;
ALTER TABLE "user_settings" ADD COLUMN "aiTokensUsed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "user_settings" ADD COLUMN "aiTokensUsedOn" DATETIME;
