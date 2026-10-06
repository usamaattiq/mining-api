-- AlterTable
ALTER TABLE "user_sessions" ADD COLUMN     "refreshExpiresAt" TIMESTAMP(3),
ADD COLUMN     "refreshTokenHash" TEXT;
