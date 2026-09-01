-- CreateEnum
CREATE TYPE "DeviceType" AS ENUM ('LPR_CAMERA', 'FACE_TERMINAL');

-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "deviceType" "DeviceType" NOT NULL DEFAULT 'LPR_CAMERA';
