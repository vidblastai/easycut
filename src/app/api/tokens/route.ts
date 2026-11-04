import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ensureUser, isAuthEnabled } from '@/lib/auth';
import { issueToken, listTokens, revokeToken } from '@/lib/mcp/tokens';

export const runtime = 'nodejs';

/**
 * The account's Claude connections: list, create, revoke.
 *
 * A created token's secret is in the POST response and nowhere else, ever —
 * the list shows only its first characters.
 */

async function owner(): Promise<string | NextResponse> {
  if (!isAuthEnabled()) {
    return NextResponse.json({ error: 'Sign-in is off on this server, so the MCP server needs no token.' }, { status: 400 });
  }
  const userId = await ensureUser();
  return userId ?? NextResponse.json({ error: 'Sign in to continue' }, { status: 401 });
}

export async function GET() {
  const userId = await owner();
  if (typeof userId !== 'string') return userId;
  return NextResponse.json({ tokens: await listTokens(userId) });
}

const CreateSchema = z.object({ name: z.string().trim().min(1).max(80).default('Claude') });

export async function POST(request: Request) {
  const userId = await owner();
  if (typeof userId !== 'string') return userId;
  const body = CreateSchema.safeParse(await request.json().catch(() => ({})));
  const token = await issueToken({ userId, name: body.success ? body.data.name : 'Claude' });
  return NextResponse.json({ token: { id: token.id, prefix: token.prefix, secret: token.secret } }, { status: 201 });
}

export async function DELETE(request: Request) {
  const userId = await owner();
  if (typeof userId !== 'string') return userId;
  const id = new URL(request.url).searchParams.get('id') ?? '';
  return (await revokeToken(userId, id))
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: 'Token not found' }, { status: 404 });
}
