-- CreateTable
CREATE TABLE "equipment_offer_choices" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "responderId" TEXT NOT NULL,
    "kind" "EquipmentDealKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipment_offer_choices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "equipment_offer_choices_listingId_responderId_key" ON "equipment_offer_choices"("listingId", "responderId");

ALTER TABLE "equipment_offer_choices" ADD CONSTRAINT "equipment_offer_choices_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
