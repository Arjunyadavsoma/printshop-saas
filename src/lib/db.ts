import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// In dev: log every SQL query (useful for debugging).
// In production: log only warnings + errors (avoids noisy stdout, reduces
// log volume, and avoids logging query structure — Prisma parameterizes
// queries so no actual values leak, but the structure is unnecessarily
// verbose in production logs).
export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['warn', 'error'] : ['query'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db