import { NextResponse } from 'next/server';
import { getContainer } from '@/lib/container';

export async function GET(): Promise<NextResponse> {
  const c = getContainer();
  const dbOk = await c.db.ping();
  return NextResponse.json(
    { success: true, data: { ready: dbOk, db: c.db.provider, storage: c.storage.provider, cache: c.cache.provider } },
    { status: dbOk ? 200 : 503 },
  );
}
