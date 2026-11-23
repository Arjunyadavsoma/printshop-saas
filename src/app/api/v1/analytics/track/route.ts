import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getContainer } from '@/lib/container';
import { ok, fail, toAppError, AppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { detectPiiInBatch } from '@/lib/security/pii-scan';

/**
 * POST /api/v1/analytics/track — batch ingestion for client-side analytics.
 *
 * Unauthenticated (the customer is never logged in). Rate-limited per IP
 * to 60 batches / minute (each batch carries up to 100 events).
 *
 * Privacy contract — the client is responsible for NEVER sending personal
 * data. P9-Security §5 hardening: the server ALSO scans every event for
 * PII patterns (phone numbers, UTRs, emails, file names, leaked order
 * tokens) and rejects the batch atomically if ANY event trips a pattern.
 * A buggy or malicious client cannot leak PII past this gate even if the
 * client-side `track()` helper is bypassed.
 *
 * Events that arrive here:
 *   shop_landed, upload_started, upload_failed, file_ready,
 *   preset_chosen, more_options_opened, page_picker_opened,
 *   colour_pages_changed, quote_viewed, checkout_started,
 *   payment_app_tapped, paid_clicked, utr_submitted,
 *   payment_confirmed, payment_rejected, order_ready_seen, reorder_clicked
 */

const EventSchema = z.object({
  event: z.string().min(1).max(64),
  properties: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .default({}),
  client_ts: z.number().int().nonnegative(),
});

const BodySchema = z.object({
  events: z.array(EventSchema).min(1).max(100),
});

export const POST = withRateLimit(
  'analytics-track',
  60,
  60,
  async (req: NextRequest) => {
    try {
      const body = BodySchema.parse(await req.json());
      // P9-Security §5: scan every event for PII BEFORE persisting. If any
      // event trips a pattern, reject the WHOLE batch atomically — partial
      // ingestion would lose the clean events but accept the leaky one.
      // Atomicity > completeness here.
      const leaks = detectPiiInBatch(body.events);
      if (leaks.length > 0) {
        const first = leaks[0];
        const kinds = first.findings.map((f) => f.kind).join(',');
        return fail(
          new AppError(
            `Analytics event at index ${first.index} contains PII (${kinds}). Privacy contract: do not send phone numbers, UTRs, emails, file names, or order tokens.`,
            'PII_DETECTED',
            400,
            { leakIndexes: leaks.map((l) => l.index) },
          ),
        );
      }
      const logger = getContainer().logger;
      for (const evt of body.events) {
        logger.info('analytics', {
          kind: 'analytics',
          event: evt.event,
          properties: evt.properties,
          clientTs: evt.client_ts,
        });
      }
      return ok({ accepted: body.events.length });
    } catch (cause) {
      return fail(toAppError(cause));
    }
  },
);
