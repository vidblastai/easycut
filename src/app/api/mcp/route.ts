import { NextResponse } from 'next/server';
import { isAuthEnabled } from '@/lib/auth';
import { bearerOf, userForToken } from '@/lib/mcp/tokens';
import { publicOrigin } from '@/lib/mcp/oauth';
import { handleMessage } from '@/lib/mcp/server';

export const runtime = 'nodejs';
// A scene preview loads the page in a browser and captures four frames.
export const maxDuration = 300;

/**
 * The MCP endpoint (Streamable HTTP, stateless, JSON responses).
 *
 * With sign-in on, every call needs an EasyCut access token: one made on the
 * Settings page, or one a claude.ai connector got through the OAuth flow. A
 * call without one gets the 401 the MCP auth spec asks for, pointing at the
 * protected-resource metadata, which is how Claude knows to send the person
 * to sign in.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, WWW-Authenticate',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
};

export async function POST(request: Request) {
  const origin = publicOrigin(request);
  const bearer = bearerOf(request.headers.get('authorization'));
  let userId: string | null = null;
  if (isAuthEnabled()) {
    userId = bearer ? await userForToken(bearer) : null;
    if (!userId) {
      return NextResponse.json(
        { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Sign in to EasyCut to use this server.' } },
        {
          status: 401,
          headers: {
            ...CORS,
            'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
          },
        },
      );
    }
  }

  const body = await request.json().catch(() => undefined);
  if (body === undefined) {
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400, headers: CORS });
  }

  const caller = { userId, origin };
  const messages = Array.isArray(body) ? body : [body];
  const responses = (await Promise.all(messages.map((message) => handleMessage(message, caller, bearer)))).filter(Boolean);
  if (!responses.length) return new Response(null, { status: 202, headers: CORS });
  return NextResponse.json(Array.isArray(body) ? responses : responses[0], { headers: CORS });
}

/** No server-initiated stream: this server never needs to push. */
export function GET() {
  return new Response(null, { status: 405, headers: { ...CORS, Allow: 'POST' } });
}

/** Stateless, so there is no session to end. */
export function DELETE() {
  return new Response(null, { status: 405, headers: { ...CORS, Allow: 'POST' } });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
