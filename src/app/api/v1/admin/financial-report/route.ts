import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { withAdminPermission } from '@/lib/api/with-auth';
import { computeFinancialReport } from '@/lib/services/financial-reporting.service';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { ValidationError } from '@platform/core/errors';

const QuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  // ISO date (YYYY-MM-DD) — convenience for "this day".
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  shopId: z.string().uuid().optional(),
  // Quick ranges — overrides from/to.
  range: z.enum(['today', 'week', 'month', 'ytd']).optional(),
});

/**
 * GET /api/v1/admin/financial-report — the platform-wide (or per-shop)
 * financial report. Returns the 7 distinct financial entities the
 * Phase 6 prompt requires, kept separate so no value is conflated.
 *
 * Authorization: requires the `finance.read` admin permission.
 *
 * Query params:
 *   - from + to: ISO datetimes (UTC). Inclusive lower, exclusive upper.
 *   - date: ISO date (YYYY-MM-DD) — convenience for a single day.
 *   - shopId: scope the report to one shop (optional).
 *   - range: 'today' | 'week' | 'month' | 'ytd' — overrides from/to.
 *
 * All monetary values are integer paise. Never float.
 */
export const GET = withAdminPermission('finance.read', async (req) => {
  try {
    const params = QuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));

    // Resolve the date range.
    let from: Date;
    let to: Date;
    if (params.range) {
      const now = new Date();
      switch (params.range) {
        case 'today':
          from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
          to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
          break;
        case 'week':
          // ISO week starts Monday.
          from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
          from.setUTCDate(from.getUTCDate() - ((from.getUTCDay() + 6) % 7));
          to = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
          to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
          break;
        case 'ytd':
          from = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
          to = new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1));
          break;
      }
    } else if (params.date) {
      from = new Date(params.date + 'T00:00:00Z');
      to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
    } else if (params.from && params.to) {
      from = new Date(params.from);
      to = new Date(params.to);
      if (from >= to) {
        throw new ValidationError('`from` must be before `to`');
      }
    } else {
      // Default to today (UTC).
      const now = new Date();
      from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
    }

    const report = await computeFinancialReport(from, to, params.shopId ?? null);
    return ok(report);
  } catch (cause) {
    return fail(toAppError(cause));
  }
});
