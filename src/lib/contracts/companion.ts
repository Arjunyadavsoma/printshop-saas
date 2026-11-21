import { z } from 'zod';

/**
 * COMPANION API CONTRACT — machine-readable single source of truth (v1.1).
 *
 * The human contract lives in `docs/integration/COMPANION_V1_CONTRACT.md`;
 * THIS file is the authoritative shape registry. `scripts/contracts/gen-schema.ts`
 * turns these schemas into `docs/integration/companion-v1.schema.json`, and
 * `companion.contract.test.ts` fails CI when this file and the artifact drift
 * apart. PrintEXE keeps a byte-identical copy of the artifact and a C# test
 * that deserializes its examples into the client DTOs — change anything here
 * and you must regenerate, copy, and update both repos in the same commit.
 *
 * Schemas describe FULL HTTP bodies (the `{success, data, error}` envelope
 * included) because that is what the wire carries and what the client parses.
 */

export const CONTRACT_VERSION = '1.1';

// ─── Shared primitives ───────────────────────────────────────────────────────

export const isoDateTime = z.iso.datetime();

export const successEnvelope = z.literal(true);
export const errorEnvelopeShape = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});

/** Full success body: `{ success: true, data: T }`. */
export function envelope<T extends z.ZodType>(data: T) {
  return z.object({ success: z.literal(true), data });
}

/** Full error body: `{ success: false, error: { code, message, details? } }`. */
export const errorEnvelope = z.object({ success: z.literal(false), error: errorEnvelopeShape });

// ─── Pairing ─────────────────────────────────────────────────────────────────

export const pairingBeginResponse = envelope(
  z.object({
    ticket: z.string().length(64),
    pairingUrl: z.string(),
    expiresAt: isoDateTime,
    shopId: z.string(),
  }),
);

export const pairRequest = z.object({
  ticket: z.string().length(64),
  deviceName: z.string().min(1).max(255),
  version: z.string().max(40).optional(),
  os: z.string().max(80).optional(),
  printerName: z.string().max(200).optional(),
});

export const pairResponse = envelope(
  z.object({
    agentId: z.string(),
    deviceToken: z.string().length(64),
    shopId: z.string(),
    shopName: z.string(),
    protocolVersion: z.literal(1),
    warning: z.string().optional(),
  }),
);

// ─── Device auth + heartbeat ─────────────────────────────────────────────────

export const heartbeatRequest = z.object({
  printerName: z.string().max(200).optional(),
  version: z.string().max(40).optional(),
  os: z.string().max(80).optional(),
});

export const heartbeatResponse = envelope(
  z.object({ agentId: z.string(), online: z.literal(true), ts: isoDateTime }),
);

// ─── Commands (device side) ──────────────────────────────────────────────────

export const commandItem = z.object({
  commandId: z.string(),
  commandType: z.string(),
  payload: z.record(z.string(), z.unknown()),
  issuedAt: isoDateTime,
  expiresAt: isoDateTime,
});

export const commandsPendingResponse = envelope(
  z.object({ agentId: z.string(), commands: z.array(commandItem) }),
);

export const commandAckRequest = z.object({
  commandId: z.string(),
  status: z.enum(['delivered', 'accepted', 'executing', 'succeeded', 'failed', 'outcome_unknown']),
  result: z.unknown().optional(),
});

export const commandAckResponse = envelope(
  z.object({ commandId: z.string(), status: z.string(), updatedAt: isoDateTime }),
);

// ─── Commands (shopkeeper side) ──────────────────────────────────────────────

export const commandIssueRequest = z.object({
  commandType: z.enum(['refresh_printers', 'pause', 'resume', 'cancel_job', 'retry_job', 'test_print', 'diagnostics']),
  payload: z.record(z.string(), z.unknown()).default({}),
  idempotencyKey: z.string().min(1).max(120).optional(),
});

export const commandIssuedResponse = envelope(
  z.object({ commandId: z.string(), status: z.literal('requested'), expiresAt: isoDateTime }),
);

// ─── Print jobs ──────────────────────────────────────────────────────────────

export const printJob = z.object({
  jobId: z.string(),
  fileId: z.string(),
  orderId: z.string(),
  filename: z.string(),
  downloadUrl: z.string(),
  copies: z.number().int().min(1),
  colorMode: z.enum(['bw', 'color']),
  duplex: z.boolean(),
  paperSize: z.string(),
  pageRange: z.string().nullable(),
});

export const pendingJobsResponse = envelope(
  z.object({
    jobs: z.array(printJob),
    failedJobs: z.array(printJob),
    agentId: z.string(),
  }),
);

export const jobStatusRequest = z.object({
  status: z.enum(['printing', 'completed', 'failed', 'needs_review']),
  lastError: z.string().nullable().optional(),
  printerName: z.string().max(200).optional(),
});

export const jobStatusApplied = envelope(
  z.object({ jobId: z.string(), status: z.string(), applied: z.literal(true) }),
);

export const jobStatusSkipped = envelope(
  z.object({ jobId: z.string(), skipped: z.literal(true), reason: z.string() }),
);

/** The status route returns applied OR skipped — the client must handle both. */
export const jobStatusResponse = z.union([jobStatusApplied, jobStatusSkipped]);

export const jobReceivedRequest = z.object({
  checksum: z.string().min(1),
});

export const jobReceivedResponse = envelope(
  z.object({
    jobId: z.string(),
    received: z.literal(true),
    cleanupScheduled: z.boolean(),
    message: z.string().optional(),
  }),
);

// ─── Socket.IO JWT + token rotation ──────────────────────────────────────────

export const agentTokenResponse = envelope(
  z.object({ accessToken: z.string(), expiresIn: z.number().int(), shopId: z.string() }),
);

export const tokenRotateResponse = envelope(
  z.object({
    agentId: z.string(),
    deviceToken: z.string().length(64),
    rotatedAt: isoDateTime,
    overlapExpiresAt: isoDateTime,
    warning: z.string(),
  }),
);

// ─── Shop snapshot (v0.6.1) ──────────────────────────────────────────────────

export const shopSnapshotResponse = envelope(
  z.object({
    shop: z
      .object({ id: z.string(), name: z.string(), slug: z.string(), timezone: z.string() })
      .nullable(),
    orders: z.array(z.record(z.string(), z.unknown())),
    analytics: z.record(z.string(), z.unknown()).nullable(),
  }),
);

// ─── Registry ────────────────────────────────────────────────────────────────

export interface RouteSpec {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Path with the /api/v1 prefix; path params as :param. */
  path: string;
  /** Which credential authenticates this route. */
  auth: 'device-token' | 'jwt owner/staff' | 'none (ticket is the credential)';
  /** Source route file under src/app, for the existence drift check. */
  sourceFile: string;
  /** Name of the schema in SCHEMAS describing the 200 body (null = none documented). */
  responseSchema?: keyof typeof SCHEMAS;
  /** Name of the schema describing the request body. */
  requestSchema?: keyof typeof SCHEMAS;
}

export const ROUTES: RouteSpec[] = [
  { method: 'POST', path: '/api/v1/companion/pairing/begin', auth: 'jwt owner/staff', sourceFile: 'src/app/api/v1/companion/pairing/begin/route.ts', responseSchema: 'pairingBeginResponse' },
  { method: 'POST', path: '/api/v1/companion/pair', auth: 'none (ticket is the credential)', sourceFile: 'src/app/api/v1/companion/pair/route.ts', requestSchema: 'pairRequest', responseSchema: 'pairResponse' },
  { method: 'POST', path: '/api/v1/agents/heartbeat', auth: 'device-token', sourceFile: 'src/app/api/v1/agents/heartbeat/route.ts', requestSchema: 'heartbeatRequest', responseSchema: 'heartbeatResponse' },
  { method: 'GET', path: '/api/v1/companion/commands', auth: 'device-token', sourceFile: 'src/app/api/v1/companion/commands/route.ts', responseSchema: 'commandsPendingResponse' },
  { method: 'POST', path: '/api/v1/companion/commands', auth: 'device-token', sourceFile: 'src/app/api/v1/companion/commands/route.ts', requestSchema: 'commandAckRequest', responseSchema: 'commandAckResponse' },
  { method: 'POST', path: '/api/v1/shops/me/devices/:deviceId/commands', auth: 'jwt owner/staff', sourceFile: 'src/app/api/v1/shops/me/devices/[deviceId]/commands/route.ts', requestSchema: 'commandIssueRequest', responseSchema: 'commandIssuedResponse' },
  { method: 'GET', path: '/api/v1/agents/jobs/pending', auth: 'device-token', sourceFile: 'src/app/api/v1/agents/jobs/pending/route.ts', responseSchema: 'pendingJobsResponse' },
  { method: 'POST', path: '/api/v1/agents/jobs/:jobId/status', auth: 'device-token', sourceFile: 'src/app/api/v1/agents/jobs/[id]/status/route.ts', requestSchema: 'jobStatusRequest', responseSchema: 'jobStatusResponse' },
  { method: 'POST', path: '/api/v1/agents/jobs/:jobId/received', auth: 'device-token', sourceFile: 'src/app/api/v1/agents/jobs/[id]/received/route.ts', requestSchema: 'jobReceivedRequest', responseSchema: 'jobReceivedResponse' },
  { method: 'POST', path: '/api/v1/agents/token', auth: 'device-token', sourceFile: 'src/app/api/v1/agents/token/route.ts', responseSchema: 'agentTokenResponse' },
  { method: 'POST', path: '/api/v1/companion/token/rotate', auth: 'device-token', sourceFile: 'src/app/api/v1/companion/token/rotate/route.ts', responseSchema: 'tokenRotateResponse' },
  { method: 'GET', path: '/api/v1/companion/shop-snapshot', auth: 'device-token', sourceFile: 'src/app/api/v1/companion/shop-snapshot/route.ts', responseSchema: 'shopSnapshotResponse' },
  { method: 'POST', path: '/api/v1/sync/push', auth: 'device-token', sourceFile: 'src/app/api/v1/sync/push/route.ts' },
  { method: 'GET', path: '/api/v1/sync/pull', auth: 'device-token', sourceFile: 'src/app/api/v1/sync/pull/route.ts' },
  { method: 'GET', path: '/api/v1/sync/status', auth: 'device-token', sourceFile: 'src/app/api/v1/sync/status/route.ts' },
];

export const SOCKET_SERVER_EVENTS = [
  'job.dispatch',
  'job.printing',
  'job.completed',
  'job.failed',
  'job.needs_review',
  'order.paid',
  'order.ready',
  'agent.heartbeat',
  'agent.revoked',
  'delivery.received',
  'device.command.issued',
  'device.revoked',
  'device.token_rotated',
  'sync.pushed',
] as const;

export const SOCKET_CLIENT_EVENTS = ['auth'] as const;

// ─── Schemas registry (name → full-body schema) ─────────────────────────────

export const SCHEMAS = {
  errorEnvelope,
  pairingBeginResponse,
  pairRequest,
  pairResponse,
  heartbeatRequest,
  heartbeatResponse,
  commandItem,
  commandsPendingResponse,
  commandAckRequest,
  commandAckResponse,
  commandIssueRequest,
  commandIssuedResponse,
  printJob,
  pendingJobsResponse,
  jobStatusRequest,
  jobStatusResponse,
  jobReceivedRequest,
  jobReceivedResponse,
  agentTokenResponse,
  tokenRotateResponse,
  shopSnapshotResponse,
};
