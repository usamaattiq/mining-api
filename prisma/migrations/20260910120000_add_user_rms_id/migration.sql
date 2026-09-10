-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "rmsId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "users_rmsId_key" ON "users"("rmsId");
