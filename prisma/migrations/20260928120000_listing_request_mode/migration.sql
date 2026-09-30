-- CreateEnum
CREATE TYPE "ListingRequestMode" AS ENUM ('rfq', 'auction');

-- AlterTable
ALTER TABLE "listings" ADD COLUMN "requestMode" "ListingRequestMode" NOT NULL DEFAULT 'rfq';
