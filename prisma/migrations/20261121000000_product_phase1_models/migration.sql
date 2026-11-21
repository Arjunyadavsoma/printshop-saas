-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "addonsPaise" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "collectedAt" TIMESTAMP(3),
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "orderNumber" TEXT,
ADD COLUMN     "paymentModeAtOrder" TEXT,
ADD COLUMN     "pickupCode" TEXT,
ADD COLUMN     "placedAt" TIMESTAMP(3),
ADD COLUMN     "priceSnapshot" JSONB,
ADD COLUMN     "readyAt" TIMESTAMP(3),
ADD COLUMN     "scheduledFor" TIMESTAMP(3),
ADD COLUMN     "subtotalPaise" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "urgent" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PrintFile" ADD COLUMN     "checksum" TEXT,
ADD COLUMN     "colorSuggestion" JSONB,
ADD COLUMN     "failReason" TEXT,
ADD COLUMN     "pageHeightPt" DOUBLE PRECISION,
ADD COLUMN     "pageWidthPt" DOUBLE PRECISION,
ADD COLUMN     "pdfStorageKey" TEXT;

-- AlterTable
ALTER TABLE "PrintJob" ADD COLUMN     "colorMode" TEXT,
ADD COLUMN     "dispatchedAt" TIMESTAMP(3),
ADD COLUMN     "duplex" BOOLEAN,
ADD COLUMN     "idempotencyKey" TEXT;
-- backfill existing device-contract-era rows, then enforce
UPDATE "PrintJob" SET "idempotencyKey" = gen_random_uuid()::text WHERE "idempotencyKey" IS NULL;
ALTER TABLE "PrintJob" ALTER COLUMN "idempotencyKey" SET NOT NULL;
ALTER TABLE "PrintJob"
ADD COLUMN     "kind" TEXT,
ADD COLUMN     "orientation" TEXT,
ADD COLUMN     "pagesPerSheet" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "paperSize" TEXT,
ADD COLUMN     "printedAt" TIMESTAMP(3),
ADD COLUMN     "printerId" TEXT,
ADD COLUMN     "scale" TEXT,
ADD COLUMN     "setLabel" TEXT,
ADD COLUMN     "sheetCount" INTEGER,
ADD COLUMN     "sourcePages" JSONB,
ADD COLUMN     "taskPdfStorageKey" TEXT;

-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "acceptingOrders" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "autoConfirmCounterPayment" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "colorSheetBilling" TEXT NOT NULL DEFAULT 'PER_PAGE_ACTUAL',
ADD COLUMN     "isOpen" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "languages" JSONB NOT NULL DEFAULT '["en"]',
ADD COLUMN     "minutesPerPageBw" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "minutesPerPageColor" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "openingHours" JSONB,
ADD COLUMN     "orderExpiryMinutes" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "paymentMode" TEXT NOT NULL DEFAULT 'UPI_THEN_PRINT',
ADD COLUMN     "retentionHours" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN     "scheduledOrders" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "upiPayeeName" TEXT,
ADD COLUMN     "urgencySurchargePaise" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "name" TEXT;

-- CreateTable
CREATE TABLE "Printer" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "agentId" TEXT,
    "systemName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "supportsColor" BOOLEAN NOT NULL DEFAULT false,
    "supportsDuplex" BOOLEAN NOT NULL DEFAULT false,
    "paperSizes" JSONB NOT NULL DEFAULT '["A4"]',
    "isDefaultColor" BOOLEAN NOT NULL DEFAULT false,
    "isDefaultBw" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'OFFLINE',
    "statusDetail" TEXT,
    "speedPpm" INTEGER NOT NULL DEFAULT 20,
    "pagesPrintedToday" INTEGER NOT NULL DEFAULT 0,
    "counterDate" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Printer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintSpec" (
    "id" TEXT NOT NULL,
    "orderFileId" TEXT NOT NULL,
    "copies" INTEGER NOT NULL DEFAULT 1,
    "paperSize" TEXT NOT NULL DEFAULT 'A4',
    "paperType" TEXT NOT NULL DEFAULT 'PLAIN',
    "orientation" TEXT NOT NULL DEFAULT 'AUTO',
    "sides" TEXT NOT NULL DEFAULT 'SINGLE',
    "duplexEdge" TEXT NOT NULL DEFAULT 'long',
    "pagesPerSheet" INTEGER NOT NULL DEFAULT 1,
    "scale" TEXT NOT NULL DEFAULT 'FIT',
    "collate" BOOLEAN NOT NULL DEFAULT true,
    "pageRangeText" TEXT,
    "pageModes" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrintSpec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceRule" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "paperSize" TEXT NOT NULL,
    "paperType" TEXT NOT NULL DEFAULT 'PLAIN',
    "colorMode" TEXT NOT NULL,
    "sides" TEXT NOT NULL DEFAULT 'SINGLE',
    "slabs" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Addon" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "pricePaise" INTEGER NOT NULL,
    "pricingUnit" TEXT NOT NULL DEFAULT 'PER_ORDER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Addon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "amountPaise" INTEGER NOT NULL,
    "upiIntentUrl" TEXT,
    "utr" TEXT,
    "screenshotStorageKey" TEXT,
    "confirmedBy" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "orderId" TEXT,
    "payload" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Printer_shopId_enabled_idx" ON "Printer"("shopId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "Printer_shopId_systemName_key" ON "Printer"("shopId", "systemName");

-- CreateIndex
CREATE UNIQUE INDEX "PrintSpec_orderFileId_key" ON "PrintSpec"("orderFileId");

-- CreateIndex
CREATE INDEX "PriceRule_shopId_active_idx" ON "PriceRule"("shopId", "active");

-- CreateIndex
CREATE INDEX "Addon_shopId_active_idx" ON "Addon"("shopId", "active");

-- CreateIndex
CREATE INDEX "Payment_orderId_status_idx" ON "Payment"("orderId", "status");

-- CreateIndex
CREATE INDEX "OrderEvent_orderId_createdAt_idx" ON "OrderEvent"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_shopId_readAt_createdAt_idx" ON "Notification"("shopId", "readAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrintJob_idempotencyKey_key" ON "PrintJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PrintJob_printerId_idx" ON "PrintJob"("printerId");

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "Printer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Printer" ADD CONSTRAINT "Printer_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintSpec" ADD CONSTRAINT "PrintSpec_orderFileId_fkey" FOREIGN KEY ("orderFileId") REFERENCES "PrintFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceRule" ADD CONSTRAINT "PriceRule_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Addon" ADD CONSTRAINT "Addon_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

