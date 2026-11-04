import { NextResponse } from 'next/server';
import { authorizationServerMetadata, publicOrigin } from '@/lib/mcp/oauth';

export const runtime = 'nodejs';

/** RFC 8414: the endpoints of EasyCut's authorisation server. */
export function GET(request: Request) {
  return NextResponse.json(authorizationServerMetadata(publicOrigin(request)), {
    headers: { 'Access-Control-Allow-Origin': '*' },
  });
}
