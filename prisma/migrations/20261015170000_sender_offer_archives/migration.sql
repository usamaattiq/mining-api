CREATE TABLE "sender_offer_archives" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "responderId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "price" TEXT NOT NULL DEFAULT '',
    "quantity" INTEGER,
    "kind" TEXT,
    "handover" TEXT,
    "delivery" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sender_offer_archives_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sender_offer_archives_listingId_offerId_key" ON "sender_offer_archives"("listingId", "offerId");
CREATE INDEX "sender_offer_archives_listingId_responderId_idx" ON "sender_offer_archives"("listingId", "responderId");

ALTER TABLE "sender_offer_archives" ADD CONSTRAINT "sender_offer_archives_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
