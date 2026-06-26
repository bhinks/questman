-- Add descriptionNormalized column: cleaned + clustered vendor name for grouping.
ALTER TABLE "transactions" ADD COLUMN "descriptionNormalized" TEXT;

-- Index for grouping/sorting queries by normalized description.
CREATE INDEX "transactions_userId_descriptionNormalized_idx" ON "transactions"("userId", "descriptionNormalized");
