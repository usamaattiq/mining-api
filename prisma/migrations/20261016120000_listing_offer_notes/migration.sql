CREATE TABLE "listing_offer_notes" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listing_offer_notes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "listing_offer_notes_listingId_offerId_key" ON "listing_offer_notes"("listingId", "offerId");

ALTER TABLE "listing_offer_notes" ADD CONSTRAINT "listing_offer_notes_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
