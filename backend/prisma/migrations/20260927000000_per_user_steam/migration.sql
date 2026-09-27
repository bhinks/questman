-- Steam moves from GLOBAL env (STEAM_USER_ID / STEAM_API_KEY) to per-user
-- settings: each member's own Steam64 ID and an optional personal API key.
ALTER TABLE "user_settings" ADD COLUMN "steamId" TEXT;
ALTER TABLE "user_settings" ADD COLUMN "steamApiKey" TEXT;
