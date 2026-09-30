ALTER TABLE "listings" ADD COLUMN "onsitePrice" TEXT;
ALTER TABLE "listings" ADD COLUMN "onlinePrice" TEXT;

UPDATE "listings"
SET "onsitePrice" = "price"
WHERE category = 'services'
  AND "serviceType" IN ('onsite', 'both')
  AND "price" IS NOT NULL
  AND "price" <> '';

UPDATE "listings"
SET "onlinePrice" = "price"
WHERE category = 'services'
  AND "serviceType" IN ('online', 'both')
  AND "price" IS NOT NULL
  AND "price" <> '';
