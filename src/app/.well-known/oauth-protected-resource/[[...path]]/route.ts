import { NextResponse } from 'next/server';
import { protectedResourceMetadata, publicOrigin } from '@/lib/mcp/oauth';

export const runtime = 'nodejs';

/** RFC 9728: where a client learns how to get a token for /api/mcp. Also served with the resource path appended. */
export function GET(request: Request) {
  return NextResponse.json(protectedResourceMetadata(publicOrigin(request)), {
    headers: { 'Access-Control-Allow-Origin': '*' },
  });
}
