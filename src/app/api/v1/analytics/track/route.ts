import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getContainer } from '@/lib/container';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';

/**
 * POST /api/v1/analytics/track — batch ingestion for client-side analytics.
 *
 * Unauthenticated (the customer is never logged in). Rate-limited per IP
 * to 60 batches / minute (each batch carries up to 100 events).
 *
 * Privacy contract — the client is responsible for NEVER sending personal
 * data. The server does NOT persist the events to a database yet (the
 * structured JSON logger captures them for downstream aggregation). When
 * we add a real warehouse (ClickHouse / Postgres `analytics_event` table),
 * the schema MUST reject any property key that looks like a phone number,
 * file name, or UTR.
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
