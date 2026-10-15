import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getContainer } from '@/lib/container';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { UnauthorizedError } from '@platform/core/errors';

const RefreshSchema = z.object({ refreshToken: z.string().min(1) });

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { refreshToken } = RefreshSchema.parse(await req.json());
    const pair = await getContainer().auth.rotateRefreshToken(refreshToken);
    if (!pair) throw new UnauthorizedError('Refresh token is invalid, expired, or already used');
    return ok({ accessToken: pair.access, refreshToken: pair.refresh });
  } catch (cause) {
    return fail(toAppError(cause));
  }
}
