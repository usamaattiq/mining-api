ALTER TABLE "equipment_holds" ADD COLUMN "acceptedAt" TIMESTAMP(3);

UPDATE "equipment_holds"
SET "acceptedAt" = "updatedAt"
WHERE status IN ('selected', 'active');
