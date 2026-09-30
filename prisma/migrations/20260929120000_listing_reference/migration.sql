ALTER TABLE "listings" ADD COLUMN "reference" TEXT;

WITH numbered AS (
  SELECT
    id,
    CASE
      WHEN category = 'equipment' AND "postedAs" = 'supplier' THEN 'SEQ'
      WHEN category = 'gold' OR "requestMode" = 'auction' THEN 'AUC'
      ELSE 'RFQ'
    END AS prefix,
    to_char("createdAt" AT TIME ZONE 'UTC', 'YY') AS yy,
    ROW_NUMBER() OVER (
      PARTITION BY
        CASE
          WHEN category = 'equipment' AND "postedAs" = 'supplier' THEN 'SEQ'
          WHEN category = 'gold' OR "requestMode" = 'auction' THEN 'AUC'
          ELSE 'RFQ'
        END,
        to_char("createdAt" AT TIME ZONE 'UTC', 'YY')
      ORDER BY "createdAt", id
    ) AS n
  FROM "listings"
)
UPDATE "listings" AS listing
SET "reference" = numbered.prefix || '-' || numbered.yy || '-' || lpad(numbered.n::text, 4, '0')
FROM numbered
WHERE listing.id = numbered.id;

ALTER TABLE "listings" ALTER COLUMN "reference" SET NOT NULL;
CREATE UNIQUE INDEX "listings_reference_key" ON "listings"("reference");

CREATE TABLE "listing_reference_counters" (
  "prefix" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "next" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "listing_reference_counters_pkey" PRIMARY KEY ("prefix", "year")
);

INSERT INTO "listing_reference_counters" ("prefix", "year", "next")
SELECT
  split_part("reference", '-', 1),
  (2000 + split_part("reference", '-', 2)::int),
  MAX(split_part("reference", '-', 3)::int) + 1
FROM "listings"
GROUP BY 1, 2;
