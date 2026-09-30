-- AlterEnum
ALTER TYPE "EquipmentMode" ADD VALUE IF NOT EXISTS 'both';

-- AlterTable
ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "yearlyRental" TEXT;
