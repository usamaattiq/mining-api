-- CreateEnum
CREATE TYPE "ListingCategory" AS ENUM ('equipment', 'services', 'gold');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EquipmentMode" AS ENUM ('rent', 'sell');

-- CreateEnum
CREATE TYPE "ServiceListingType" AS ENUM ('onsite', 'online');

-- CreateEnum
CREATE TYPE "DeliveryType" AS ENUM ('free', 'perKm');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('photo', 'video', 'document');

-- CreateEnum
CREATE TYPE "NotificationTarget" AS ENUM ('Requests', 'Messages', 'HomeTab');

-- CreateTable
CREATE TABLE "listings" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "category" "ListingCategory" NOT NULL,
    "status" "ListingStatus" NOT NULL DEFAULT 'ACTIVE',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "equipmentMode" "EquipmentMode",
    "equipmentTypeLabel" TEXT,
    "hourlyRental" TEXT,
    "monthlyRental" TEXT,
    "weeklyRental" TEXT,
    "salePrice" TEXT,
    "units" INTEGER,
    "deliveryAvailable" BOOLEAN,
    "deliveryType" "DeliveryType",
    "deliveryPricePerKm" TEXT,
    "serviceType" "ServiceListingType",
    "serviceCategoryLabel" TEXT,
    "yearsOfExperience" TEXT,
    "price" TEXT,
    "serviceDate" TIMESTAMP(3),
    "weight" TEXT,
    "purityLabel" TEXT,
    "auctionEndDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_media" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "uri" TEXT NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "name" TEXT,
    "key" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_read_receipts" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_read_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "in_app_notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "titleKey" TEXT NOT NULL,
    "bodyKey" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "icon" TEXT NOT NULL,
    "target" "NotificationTarget" NOT NULL,
    "listingId" TEXT,
    "conversationId" TEXT,

    CONSTRAINT "in_app_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "listings_ownerId_category_createdAt_idx" ON "listings"("ownerId", "category", "createdAt");

-- CreateIndex
CREATE INDEX "listing_media_listingId_sortOrder_idx" ON "listing_media"("listingId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_listingId_buyerId_key" ON "conversations"("listingId", "buyerId");

-- CreateIndex
CREATE INDEX "conversations_buyerId_updatedAt_idx" ON "conversations"("buyerId", "updatedAt");

-- CreateIndex
CREATE INDEX "conversations_sellerId_updatedAt_idx" ON "conversations"("sellerId", "updatedAt");

-- CreateIndex
CREATE INDEX "messages_conversationId_createdAt_idx" ON "messages"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_read_receipts_conversationId_userId_key" ON "conversation_read_receipts"("conversationId", "userId");

-- CreateIndex
CREATE INDEX "in_app_notifications_userId_sentAt_idx" ON "in_app_notifications"("userId", "sentAt");

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_media" ADD CONSTRAINT "listing_media_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_read_receipts" ADD CONSTRAINT "conversation_read_receipts_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_read_receipts" ADD CONSTRAINT "conversation_read_receipts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "in_app_notifications" ADD CONSTRAINT "in_app_notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
