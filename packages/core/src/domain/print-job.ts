import { z } from 'zod';
import { PRINT_JOB_STATUSES, type PrintJobStatus } from './enums';

/** A registered print agent (the daemon running on the shop's PC). */
export interface PrintAgent {
  id: string;
  shopId: string;
  name: string;
  tokenHash: string;
  lastSeenAt: Date | null;
  printerName: string | null;
  isOnline: boolean;
  version: string | null;
  os: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const PrintAgentSchema = z.object({
  id: z.string().uuid(),
  shopId: z.string().uuid(),
  name: z.string().min(1).max(120),
  tokenHash: z.string(),
  lastSeenAt: z.date().nullable(),
  printerName: z.string().max(200).nullable(),
  isOnline: z.boolean(),
  version: z.string().max(40).nullable(),
  os: z.string().max(40).nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

/** A unit of work dispatched to an agent (one per file per print attempt). */
export interface PrintJob {
  id: string;
  shopId: string;
  fileId: string;
  agentId: string | null;
  status: PrintJobStatus;
  attempts: number;
  lastError: string | null;
  queuedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export const PrintJobSchema = z.object({
  id: z.string().uuid(),
  shopId: z.string().uuid(),
  fileId: z.string().uuid(),
  agentId: z.string().uuid().nullable(),
  status: z.enum(PRINT_JOB_STATUSES as [PrintJobStatus, ...PrintJobStatus[]]),
  attempts: z.number().int().nonnegative(),
  lastError: z.string().max(500).nullable(),
  queuedAt: z.date(),
  startedAt: z.date().nullable(),
  completedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

/** Internal SaaS subscription record (we charge the shop, not the customer). */
export interface Subscription {
  id: string;
  shopId: string;
  tier: 'free' | 'starter' | 'pro' | 'enterprise';
  status: 'active' | 'past_due' | 'cancelled';
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  provider: 'internal' | 'razorpay' | 'manual';
  providerSubscriptionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Append-only audit trail for every state transition. */
export interface AuditLog {
  id: string;
  shopId: string | null;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
  ip: string | null;
  createdAt: Date;
}
