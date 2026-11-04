import { NextResponse } from 'next/server';
import { registerClient } from '@/lib/mcp/oauth';

export const runtime = 'nodejs';

/** RFC 7591 dynamic client registration, for claude.ai and other MCP clients. */
export async function POST(request: Request) {
  const outcome = await registerClient(await request.json().catch(() => null));
  return NextResponse.json(outcome.body, { status: outcome.status, headers: { 'Access-Control-Allow-Origin': '*' } });
}
