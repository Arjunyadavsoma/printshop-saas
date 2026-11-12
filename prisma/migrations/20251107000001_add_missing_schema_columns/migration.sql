-- Phase 6.11: Add columns that were introduced via prisma db push but never
-- committed as a migration. These columns exist in schema.prisma but were
-- missing from the init migration, causing prisma migrate deploy to produce
-- a schema that doesn't match the Prisma client's expectations.

-- AlterTable: Shop — add missing columns
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "businessHours" TEXT;
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "cashOnPickup" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "logoUrl" TEXT;
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "pamphletEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "pamphletName" TEXT;
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "pamphletPricePaise" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "paymentInstructions" TEXT;
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "paymentMethods" TEXT NOT NULL DEFAULT 'both';
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "paymentPhone" TEXT;
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "servicesJson" TEXT;
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "upiQrStorageKey" TEXT;

-- AlterTable: Order — add missing column
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "tokenNumber" TEXT;

-- CreateIndex: Order unique constraint on (shopId, tokenNumber)
CREATE UNIQUE INDEX IF NOT EXISTS "Order_shopId_tokenNumber_key" ON "Order"("shopId", "tokenNumber");
