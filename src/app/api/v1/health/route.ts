import { NextResponse } from 'next/server';
import { getContainer } from '@/lib/container';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ success: true, data: { status: 'ok', provider: 'printshop-api', ts: new Date().toISOString() } });
}

export async function HEAD(): Promise<NextResponse> {
  return new NextResponse(null, { status: 200 });
}
