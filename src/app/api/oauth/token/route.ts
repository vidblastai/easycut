import { NextResponse } from 'next/server';
import { exchangeCode } from '@/lib/mcp/oauth';

export const runtime = 'nodejs';

/** The token endpoint: authorization code + PKCE verifier → EasyCut access token. */
export async function POST(request: Request) {
  const type = request.headers.get('content-type') ?? '';
  const form = type.includes('application/json')
    ? new URLSearchParams(Object.entries((await request.json().catch(() => ({}))) as Record<string, string>))
    : new URLSearchParams(await request.text());
  const outcome = await exchangeCode(form);
  return NextResponse.json(outcome.body, {
    status: outcome.status,
    headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
  });
}
