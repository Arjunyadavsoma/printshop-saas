import { z } from 'zod';
import { PRINT_JOB_STATUSES, type PrintJobStatus } from './enums';

/** A registered print agent (the daemon running on the shop's PC). */
export interface PrintAgent {
  id: string;
  shopId: string;
  name: string;
  tokenHash: string;
  /** Hash of the credential that was valid immediately before tokenHash.
   *  Set by POST /api/v1/companion/token/rotate; honoured for a short grace
   *  window (see with-auth.ts) so an in-flight request is not dropped
   *  mid-rotation. Optional: null for devices that never rotated. */
  prevTokenHash?: string | null;
  /** When the credential was last rotated. Drives the grace-window check. */
  tokenRotatedAt?: Date | null;
  lastSeenAt: Date | null;
  printerName: string | null;
  isOnline: boolean;
  /** Whether the shopkeeper has enabled this device. A disabled device's
   *  token is still recognised but every authenticated call is rejected
   *  (DEVICE_DISABLED) — used to revoke access for a lost/stolen PC without
   *  deleting the agent row (which would lose history). */
  isEnabled: boolean;
  version: string | null;
  os: string | null;
  createdAt: Date;
  updatedAt: Date;
  // ── Mobile executor / queue v2 (additive; old fields keep working) ──
  /** 'PC' (the PrintEXE companion on Windows) or 'MOBILE' (the PrintShop
   *  Android/iOS app). Defaults to 'PC' for legacy rows. Drives which
   *  dispatcher path the agent uses (PC = /agents/jobs/pending pull,
   *  MOBILE = /agents/jobs/:id/claim push). */
  kind?: 'PC' | 'MOBILE';
  /** android | ios | windows | linux | … (free-form, for the dashboard). */
  platform?: string | null;
  /** App version reported by the agent (e.g. '1.4.2'). */
  appVersion?: string | null;
  /** JSON array of capability strings: ['queue.v2','ipp.lan','raw.9100']. */
  capabilities?: string;
  /** Human-readable name set by the device owner: "Ana's phone". */
  agentName?: string | null;
}

export const PrintAgentSchema = z.object({
  id: z.string().uuid(),
  shopId: z.string().uuid(),
  name: z.string().min(1).max(120),
  tokenHash: z.string(),
  lastSeenAt: z.date().nullable(),
  printerName: z.string().max(200).nullable(),
  isOnline: z.boolean(),
  isEnabled: z.boolean().default(true),
  version: z.string().max(40).nullable(),
  os: z.string().max(40).nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

/** A unit of work dispatched to an agent.
 *  Product build (Phase 1, docs/DATA-MODEL.md): a file may be split into
 *  MULTIPLE concurrent tasks (COLOR_SET -> color printer, BW_SET -> B&W
 *  printer); the task-level fields below are additive and optional so the
 *  legacy 1:1 flow keeps compiling. */
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
  // ── task-level (PrintTask) fields — optional for legacy flows ──
  printerId?: string | null;
  kind?: 'color_set' | 'bw_set' | 'full' | null;
  sourcePages?: number[] | null;
  taskPdfStorageKey?: string | null;
  sheetCount?: number | null;
  copies?: number | null;
  colorMode?: 'BW' | 'COLOR' | null;
  paperSize?: string | null;
  duplex?: boolean | null;
  pagesPerSheet?: number;
  orientation?: string | null;
  scale?: string | null;
  setLabel?: string | null;
  idempotencyKey?: string;
  dispatchedAt?: Date | null;
  printedAt?: Date | null;
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
