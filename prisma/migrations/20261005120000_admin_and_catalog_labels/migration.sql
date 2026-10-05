ALTER TYPE "AccountType" ADD VALUE IF NOT EXISTS 'ADMIN';

CREATE TABLE IF NOT EXISTS "catalog_labels" (
    "id" TEXT NOT NULL,
    "category" "ListingCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_labels_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "catalog_labels_category_name_key" ON "catalog_labels"("category", "name");
CREATE INDEX IF NOT EXISTS "catalog_labels_parentId_idx" ON "catalog_labels"("parentId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'catalog_labels_parentId_fkey'
  ) THEN
    ALTER TABLE "catalog_labels"
      ADD CONSTRAINT "catalog_labels_parentId_fkey"
      FOREIGN KEY ("parentId") REFERENCES "catalog_labels"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
