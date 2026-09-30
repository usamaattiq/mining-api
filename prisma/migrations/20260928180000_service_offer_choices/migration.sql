CREATE TYPE "ServiceDeliveryMode" AS ENUM ('onsite', 'online');

CREATE TABLE "service_offer_choices" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "responderId" TEXT NOT NULL,
    "mode" "ServiceDeliveryMode" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_offer_choices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "service_offer_choices_listingId_responderId_key" ON "service_offer_choices"("listingId", "responderId");

ALTER TABLE "service_offer_choices" ADD CONSTRAINT "service_offer_choices_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
