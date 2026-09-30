-- CreateEnum
CREATE TYPE "EquipmentDealKind" AS ENUM ('rent', 'sale');

-- CreateEnum
CREATE TYPE "EquipmentHoldStatus" AS ENUM ('pending', 'selected', 'active', 'rejected', 'declined', 'withdrawn', 'returned');

-- CreateTable
CREATE TABLE "equipment_holds" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "kind" "EquipmentDealKind" NOT NULL,
    "units" INTEGER NOT NULL,
    "price" TEXT NOT NULL DEFAULT '',
    "status" "EquipmentHoldStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipment_holds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "equipment_holds_offerId_key" ON "equipment_holds"("offerId");

-- CreateIndex
CREATE INDEX "equipment_holds_listingId_status_idx" ON "equipment_holds"("listingId", "status");

-- AddForeignKey
ALTER TABLE "equipment_holds" ADD CONSTRAINT "equipment_holds_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_holds" ADD CONSTRAINT "equipment_holds_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
