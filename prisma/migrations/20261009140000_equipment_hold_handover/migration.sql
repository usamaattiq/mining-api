-- CreateEnum
CREATE TYPE "EquipmentHandover" AS ENUM ('pickup', 'delivery');

-- AlterTable
ALTER TABLE "equipment_holds" ADD COLUMN "handover" "EquipmentHandover" NOT NULL DEFAULT 'pickup';
