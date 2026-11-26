import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withCustomerAuth } from '@/lib/api/with-auth';

/**
 * GET /api/v1/customer/me — the signed-in customer's profile.
 * PATCH /api/v1/customer/me — update the display name / phone the
 * checkout form prefills. Email is the Google identity and is never
 * editable here (it follows the Clerk account).
 *
 * Both guarded by `withCustomerAuth`: only a JWT minted by the customer
 * exchange route (`role: 'customer'`) is accepted. A shopkeeper JWT is
 * rejected — a shopkeeper's profile lives on the shopkeeper side.
 */

const PatchSchema = z.object({
  name: z.string().trim().max(120).optional().nullable(),
  phone: z
    .string()
    .regex(/^\d{10}$/, 'Enter a 10-digit Indian mobile number')
    .optional()
    .nullable(),
});

function toPublic(customer: { id: string; email: string; name: string | null; phone: string | null; createdAt: Date }) {
  return {
    id: customer.id,
    email: customer.email,
    name: customer.name,
    phone: customer.phone,
    createdAt: customer.createdAt.toISOString(),
  };
}

export const GET = withCustomerAuth(async (_req, _ctx, principal) => {
  try {
    return ok(toPublic(principal.customer));
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

export const PATCH = withCustomerAuth(async (req: NextRequest, _ctx, principal) => {
  try {
    const body = PatchSchema.parse(await req.json());
    const patch: { name?: string | null; phone?: string | null } = {};
    if (body.name !== undefined) patch.name = body.name === '' ? null : body.name;
    if (body.phone !== undefined) patch.phone = body.phone;
    const updated = await repos.customerAccounts.update(principal.customerId, patch);
    return ok(toPublic(updated));
  } catch (cause) {
    return fail(toAppError(cause));
  }
});
