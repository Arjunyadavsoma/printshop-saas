/**
 * Wire EXAMPLES for the companion contract — every entry must parse against
 * the schema with the same name in `companion.ts`. The contract tests in BOTH
 * repos (vitest here, xUnit in PrintEXE) assert this: the saas test parses
 * each example with Zod; the PrintEXE test deserializes them into its DTOs.
 * When the contract changes, change schemas + examples together.
 */
export const EXAMPLES: Record<string, unknown[]> = {
  errorEnvelope: [
    {
      success: false,
      error: { code: 'PAIRING_TICKET_CONSUMED', message: 'Pairing ticket was just consumed by another request.' },
    },
    {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: { issues: [] } },
    },
  ],
  pairingBeginResponse: [
    {
      success: true,
      data: {
        ticket: 'a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8',
        pairingUrl: 'printshop://pair?ticket=a1b2c3d4e5f6&shop=8476e148-37f9-4787-9845-dd0f0ec815a0',
        expiresAt: '2026-11-20T13:05:00.000Z',
        shopId: '8476e148-37f9-4787-9845-dd0f0ec815a0',
      },
    },
  ],
  pairRequest: [
    {
      ticket: 'a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8',
      deviceName: 'Shop-Front-PC',
      version: '1.0.0',
      os: 'Windows 11',
      printerName: 'HP LaserJet Pro',
    },
  ],
  pairResponse: [
    {
      success: true,
      data: {
        agentId: '0f0e6d0a-1111-4222-8333-444455556666',
        deviceToken: 'e7f8a9b0c1d2e7f8a9b0c1d2e7f8a9b0c1d2e7f8a9b0c1d2e7f8a9b0c1d2e7f8',
        shopId: '8476e148-37f9-4787-9845-dd0f0ec815a0',
        shopName: 'QuickPrint Demo Shop',
        protocolVersion: 1,
      },
    },
  ],
  heartbeatRequest: [{ printerName: 'HP LaserJet Pro', version: '1.0.0', os: 'Windows 11' }, {}],
  heartbeatResponse: [
    { success: true, data: { agentId: '0f0e6d0a-1111-4222-8333-444455556666', online: true, ts: '2026-11-20T13:00:00.000Z' } },
  ],
  commandItem: [
    {
      commandId: 'c1d2e3f4-1111-4222-8333-444455556666',
      commandType: 'refresh_printers',
      payload: {},
      issuedAt: '2026-11-20T12:30:00.000Z',
      expiresAt: '2026-11-20T12:35:00.000Z',
    },
  ],
  commandsPendingResponse: [
    {
      success: true,
      data: {
        agentId: '0f0e6d0a-1111-4222-8333-444455556666',
        commands: [
          {
            commandId: 'c1d2e3f4-1111-4222-8333-444455556666',
            commandType: 'refresh_printers',
            payload: {},
            issuedAt: '2026-11-20T12:30:00.000Z',
            expiresAt: '2026-11-20T12:35:00.000Z',
          },
        ],
      },
    },
  ],
  commandAckRequest: [
    { commandId: 'c1d2e3f4-1111-4222-8333-444455556666', status: 'succeeded', result: { printers: ['HP LaserJet'] } },
    { commandId: 'c1d2e3f4-1111-4222-8333-444455556666', status: 'outcome_unknown' },
  ],
  commandAckResponse: [
    { success: true, data: { commandId: 'c1d2e3f4-1111-4222-8333-444455556666', status: 'succeeded', updatedAt: '2026-11-20T12:31:00.000Z' } },
  ],
  commandIssueRequest: [{ commandType: 'refresh_printers', payload: {} }, { commandType: 'cancel_job', payload: { jobId: '0a0b0c0d-1111-4222-8333-444455556666' }, idempotencyKey: 'dash-2026-11-20-0007' }],
  commandIssuedResponse: [
    { success: true, data: { commandId: 'c1d2e3f4-1111-4222-8333-444455556666', status: 'requested', expiresAt: '2026-11-20T12:35:00.000Z' } },
  ],
  printJob: [
    {
      jobId: '0a0b0c0d-1111-4222-8333-444455556666',
      fileId: '1b2c3d4e-1111-4222-8333-444455556666',
      orderId: '2c3d4e5f-1111-4222-8333-444455556666',
      filename: 'document.pdf',
      downloadUrl: 'https://storage.example.com/signed/object?sig=…',
      copies: 1,
      colorMode: 'bw',
      duplex: false,
      paperSize: 'a4',
      pageRange: null,
    },
  ],
  pendingJobsResponse: [
    {
      success: true,
      data: {
        jobs: [
          {
            jobId: '0a0b0c0d-1111-4222-8333-444455556666',
            fileId: '1b2c3d4e-1111-4222-8333-444455556666',
            orderId: '2c3d4e5f-1111-4222-8333-444455556666',
            filename: 'document.pdf',
            downloadUrl: 'https://storage.example.com/signed/object?sig=…',
            copies: 1,
            colorMode: 'bw',
            duplex: false,
            paperSize: 'a4',
            pageRange: null,
          },
        ],
        failedJobs: [],
        agentId: '0f0e6d0a-1111-4222-8333-444455556666',
      },
    },
  ],
  jobStatusRequest: [
    { status: 'printing', printerName: 'HP LaserJet Pro' },
    { status: 'failed', lastError: 'Printer offline' },
    { status: 'needs_review' },
  ],
  jobStatusResponse: [
    { success: true, data: { jobId: '0a0b0c0d-1111-4222-8333-444455556666', status: 'printing', applied: true } },
    { success: true, data: { jobId: '0a0b0c0d-1111-4222-8333-444455556666', skipped: true, reason: "job is 'printing' — not in 'queued' state" } },
  ],
  jobReceivedRequest: [{ checksum: 'sha256-abc123def456' }],
  jobReceivedResponse: [
    { success: true, data: { jobId: '0a0b0c0d-1111-4222-8333-444455556666', received: true, cleanupScheduled: true, message: 'Receipt recorded.' } },
    { success: true, data: { jobId: '0a0b0c0d-1111-4222-8333-444455556666', received: true, cleanupScheduled: false } },
  ],
  agentTokenResponse: [
    { success: true, data: { accessToken: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZ2VudDo…', expiresIn: 900, shopId: '8476e148-37f9-4787-9845-dd0f0ec815a0' } },
  ],
  tokenRotateResponse: [
    {
      success: true,
      data: {
        agentId: '0f0e6d0a-1111-4222-8333-444455556666',
        deviceToken: '9a8b7c6d5e4f9a8b7c6d5e4f9a8b7c6d5e4f9a8b7c6d5e4f9a8b7c6d5e4f9a8b',
        rotatedAt: '2026-11-20T13:00:00.000Z',
        overlapExpiresAt: '2026-11-20T13:10:00.000Z',
        warning: 'Store this token now (DPAPI on Windows). The previous token is accepted for 10 more minutes only, and only for heartbeat, read-only polling, and rotation recovery.',
      },
    },
  ],
  shopSnapshotResponse: [
    {
      success: true,
      data: {
        shop: { id: '8476e148-37f9-4787-9845-dd0f0ec815a0', name: 'QuickPrint Demo Shop', slug: 'quickprint-demo', timezone: 'Asia/Kolkata' },
        orders: [],
        analytics: null,
      },
    },
  ],
};
