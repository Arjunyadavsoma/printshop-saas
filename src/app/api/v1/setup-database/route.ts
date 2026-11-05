import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';

/**
 * POST /api/v1/setup-database?key=<SETUP_KEY>
 *
 * One-time database initialization. Creates all tables if they don't exist.
 * Visit this URL after deploying to set up the database without SQL Editor.
 *
 * Security: requires ?key= matching SETUP_KEY or ADMIN_ACCESS_KEY env var.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const providedKey = url.searchParams.get('key');
  const expectedKey = process.env.SETUP_KEY ?? process.env.ADMIN_ACCESS_KEY ?? '';
  if (!expectedKey || providedKey !== expectedKey) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Missing or invalid ?key= param.' } },
      { status: 401 },
    );
  }

  try {
    const statements = SETUP_SQL.split(';').map(s => s.trim()).filter(s => s && !s.startsWith('--'));
    let created = 0;
    for (const stmt of statements) {
      try {
        await db.$executeRawUnsafe(stmt);
        created++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('already exists') && !msg.includes('duplicate')) {
          console.error('[setup-db] stmt failed:', msg.substring(0, 120));
        }
      }
    }
    // Partial unique index for PrintJob (can't express in Prisma schema)
    try {
      await db.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "PrintJob_active_file_unique" ON "PrintJob"("fileId") WHERE status IN ('queued', 'printing')`);
    } catch { /* may already exist */ }

    return NextResponse.json({
      success: true,
      data: { message: 'Database initialized', statementsExecuted: created, next: 'Register at /shop/register or seed: bun run scripts/seed.ts' },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: { code: 'SETUP_FAILED', message: err instanceof Error ? err.message : String(err) } },
      { status: 500 },
    );
  }
}

const SETUP_SQL = `
CREATE TABLE IF NOT EXISTS "Shop" (
    "id" TEXT NOT NULL, "name" TEXT NOT NULL, "slug" TEXT NOT NULL, "ownerUserId" TEXT NOT NULL,
    "upiId" TEXT NOT NULL, "paymentProvider" TEXT NOT NULL, "paymentCredentials" TEXT NOT NULL,
    "pricingConfig" TEXT NOT NULL, "address" TEXT NOT NULL, "phone" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata', "isActive" BOOLEAN NOT NULL DEFAULT true,
    "subscriptionTier" TEXT NOT NULL DEFAULT 'free', "subscriptionExpiresAt" TIMESTAMP(3),
    "description" TEXT, "businessHours" TEXT, "logoUrl" TEXT, "upiQrStorageKey" TEXT,
    "servicesJson" TEXT, "paymentPhone" TEXT, "paymentInstructions" TEXT,
    "cashOnPickup" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Shop_slug_key" ON "Shop"("slug");
CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL, "email" TEXT NOT NULL, "phone" TEXT NOT NULL, "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'owner', "shopId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");
CREATE TABLE IF NOT EXISTS "Order" (
    "id" TEXT NOT NULL, "shopId" TEXT NOT NULL, "customerToken" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'awaiting_payment', "totalAmountPaise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR', "paymentProvider" TEXT, "paymentTxnId" TEXT,
    "paymentUtr" TEXT, "paidAt" TIMESTAMP(3), "customerPhone" TEXT, "notes" TEXT, "tokenNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Order_paymentTxnId_key" ON "Order"("paymentTxnId");
CREATE UNIQUE INDEX IF NOT EXISTS "Order_shopId_tokenNumber_key" ON "Order"("shopId", "tokenNumber");
CREATE INDEX IF NOT EXISTS "Order_shopId_status_idx" ON "Order"("shopId", "status");
CREATE INDEX IF NOT EXISTS "Order_customerToken_idx" ON "Order"("customerToken");
CREATE TABLE IF NOT EXISTS "PrintFile" (
    "id" TEXT NOT NULL, "orderId" TEXT NOT NULL, "originalFilename" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL, "mimeType" TEXT NOT NULL, "sizeBytes" INTEGER NOT NULL,
    "pageCount" INTEGER, "copies" INTEGER NOT NULL DEFAULT 1, "colorMode" TEXT NOT NULL DEFAULT 'bw',
    "pageRange" TEXT, "paperSize" TEXT NOT NULL DEFAULT 'a4', "duplex" BOOLEAN NOT NULL DEFAULT false,
    "pricePaise" INTEGER NOT NULL DEFAULT 0, "status" TEXT NOT NULL DEFAULT 'pending',
    "printedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "PrintFile_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PrintFile_orderId_idx" ON "PrintFile"("orderId");
CREATE TABLE IF NOT EXISTS "PrintJob" (
    "id" TEXT NOT NULL, "shopId" TEXT NOT NULL, "fileId" TEXT NOT NULL, "agentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued', "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT, "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PrintJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PrintJob_shopId_fileId_idx" ON "PrintJob"("shopId", "fileId");
CREATE TABLE IF NOT EXISTS "PrintAgent" (
    "id" TEXT NOT NULL, "shopId" TEXT NOT NULL, "name" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false, "lastSeenAt" TIMESTAMP(3),
    "printerName" TEXT, "version" TEXT, "os" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PrintAgent_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "Subscription" (
    "id" TEXT NOT NULL, "shopId" TEXT NOT NULL, "tier" TEXT NOT NULL, "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id" TEXT NOT NULL, "shopId" TEXT, "userId" TEXT, "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL, "entityId" TEXT NOT NULL, "metadata" TEXT NOT NULL,
    "ip" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AuditLog_shopId_createdAt_idx" ON "AuditLog"("shopId", "createdAt");
CREATE TABLE IF NOT EXISTS "PaymentAttempt" (
    "id" TEXT NOT NULL, "shopId" TEXT NOT NULL, "orderId" TEXT NOT NULL, "provider" TEXT NOT NULL,
    "merchantOrderId" TEXT NOT NULL, "providerTransactionId" TEXT, "amountPaise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR', "status" TEXT NOT NULL DEFAULT 'created',
    "idempotencyKey" TEXT, "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentAttempt_merchantOrderId_key" ON "PaymentAttempt"("merchantOrderId");
CREATE INDEX IF NOT EXISTS "PaymentAttempt_shopId_status_idx" ON "PaymentAttempt"("shopId", "status");
CREATE INDEX IF NOT EXISTS "PaymentAttempt_orderId_idx" ON "PaymentAttempt"("orderId");
CREATE INDEX IF NOT EXISTS "PaymentAttempt_providerTransactionId_idx" ON "PaymentAttempt"("providerTransactionId");
CREATE TABLE IF NOT EXISTS "PaymentEvent" (
    "id" TEXT NOT NULL, "attemptId" TEXT NOT NULL, "provider" TEXT NOT NULL, "eventId" TEXT,
    "merchantOrderId" TEXT, "providerTransactionId" TEXT, "eventType" TEXT NOT NULL,
    "signatureValid" BOOLEAN NOT NULL DEFAULT false, "processingStatus" TEXT NOT NULL DEFAULT 'received',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "processedAt" TIMESTAMP(3),
    "errorMessage" TEXT, CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentEvent_provider_eventId_key" ON "PaymentEvent"("provider", "eventId");
CREATE INDEX IF NOT EXISTS "PaymentEvent_attemptId_idx" ON "PaymentEvent"("attemptId");
CREATE INDEX IF NOT EXISTS "PaymentEvent_merchantOrderId_idx" ON "PaymentEvent"("merchantOrderId");
ALTER TABLE "User" ADD CONSTRAINT IF NOT EXISTS "User_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT IF NOT EXISTS "Order_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrintFile" ADD CONSTRAINT IF NOT EXISTS "PrintFile_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrintJob" ADD CONSTRAINT IF NOT EXISTS "PrintJob_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrintJob" ADD CONSTRAINT IF NOT EXISTS "PrintJob_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "PrintFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrintAgent" ADD CONSTRAINT IF NOT EXISTS "PrintAgent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT IF NOT EXISTS "Subscription_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT IF NOT EXISTS "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT IF NOT EXISTS "AuditLog_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT IF NOT EXISTS "PaymentAttempt_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT IF NOT EXISTS "PaymentAttempt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentEvent" ADD CONSTRAINT IF NOT EXISTS "PaymentEvent_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "PaymentAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE
`;
