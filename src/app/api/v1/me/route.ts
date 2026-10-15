import { NextResponse, type NextRequest } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok } from '@/lib/api/envelope';

export const GET = withAuth(async (_req, _ctx, principal) => {
  const user = principal.user;
  return ok({
    id: user.id,
    email: user.email,
    phone: user.phone,
    role: user.role,
    shopId: user.shopId,
  });
});
