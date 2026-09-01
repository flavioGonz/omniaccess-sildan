/*
  Warnings:

  - A unique constraint covering the columns `[parkingSlotId]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "apartment" TEXT,
ADD COLUMN     "parkingSlotId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_parkingSlotId_key" ON "User"("parkingSlotId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_parkingSlotId_fkey" FOREIGN KEY ("parkingSlotId") REFERENCES "ParkingSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
