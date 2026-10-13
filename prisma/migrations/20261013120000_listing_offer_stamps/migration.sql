CREATE TABLE "listing_offer_stamps" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "responderId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_offer_stamps_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "listing_offer_stamps_listingId_responderId_key" ON "listing_offer_stamps"("listingId", "responderId");

ALTER TABLE "listing_offer_stamps" ADD CONSTRAINT "listing_offer_stamps_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
