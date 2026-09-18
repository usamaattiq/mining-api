ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "rfqId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "listings_rfqId_key" ON "listings"("rfqId");
