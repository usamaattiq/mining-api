ALTER TABLE "listings" ADD COLUMN "unitLabel" TEXT;
ALTER TABLE "listings" ADD COLUMN "unitPrice" TEXT;

CREATE TABLE "unit_labels" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unit_labels_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "unit_labels_name_key" ON "unit_labels"("name");
