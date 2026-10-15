import { type NextRequest } from 'next/server';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { seedDemoData } from '@/lib/services/seed.service';

/** POST /api/v1/dev/seed — create the demo shop + owner (idempotent). DEV-ONLY. */
export const POST = withRateLimit('seed', 5, 60, async (_req, _ctx) => {
  try {
    const result = await seedDemoData();
    return ok(result, { devOnly: true, warning: 'This endpoint exists for local demos only' });
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

/** GET convenience so the demo UI can trigger seeding from a link. */
export const GET = withRateLimit('seed', 5, 60, async (_req, _ctx) => {
  try {
    const result = await seedDemoData();
    return ok(result, { devOnly: true, warning: 'This endpoint exists for local demos only' });
  } catch (cause) {
    return fail(toAppError(cause));
  }
});
