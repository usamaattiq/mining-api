-- CreateEnum
CREATE TYPE "MarketplaceRole" AS ENUM ('buyer', 'supplier');

-- AlterTable
ALTER TABLE "listings" ADD COLUMN "postedAs" "MarketplaceRole" NOT NULL DEFAULT 'supplier';

-- CreateIndex
CREATE INDEX "listings_postedAs_category_createdAt_idx" ON "listings"("postedAs", "category", "createdAt");
