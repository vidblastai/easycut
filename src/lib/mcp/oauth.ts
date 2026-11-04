import { createHash, randomBytes } from 'node:crypto';
import { db } from '@/lib/db';
import { env } from '@/lib/config/env';
import { issueToken } from './tokens';

/**
 * OAuth 2.1 for the MCP server — just enough of it for a claude.ai connector.
 *
 * Claude finds this through the protected-resource metadata the MCP endpoint
 * points at, registers itself (RFC 7591, public client, no secret), sends the
 * person to /oauth/authorize where they sign in to EasyCut and say yes, and
 * swaps the code for a token with PKCE (S256 only — "plain" is not offered).
 * The token it gets is an ordinary EasyCut access token: the account page
 * lists it, and revoking it there disconnects that Claude.
 */

/** Where this deployment is reachable, as the outside world sees it. */
export function publicOrigin(request?: Request): string {
  const configured = env.appUrl;
  if (request) {
    const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
    const host = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ?? request.headers.get('host');
    if (host && !configured.includes(host)) return `${proto || 'https'}://${host}`;
  }
  return configured.replace(/\/$/, '');
}

/** The same, for a server component, which has headers but no Request. */
export async function publicOriginFromHeaders(): Promise<string> {
  const { headers } = await import('next/headers');
  const h = await headers();
  return publicOrigin(new Request('http://internal/', { headers: h }));
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ['header'],
    resource_name: 'EasyCut',
  };
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['easycut'],
  };
}

/** A redirect URI a client may register: https anywhere, http only for localhost. */
export function isAllowedRedirect(uri: string): boolean {
  try {
    const url = new URL(uri);
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

export async function registerClient(body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const input = (body ?? {}) as { client_name?: unknown; redirect_uris?: unknown };
  const uris = Array.isArray(input.redirect_uris) ? input.redirect_uris.filter((u): u is string => typeof u === 'string') : [];
  if (!uris.length || !uris.every(isAllowedRedirect)) {
    return { status: 400, body: { error: 'invalid_redirect_uri', error_description: 'redirect_uris must be https (or http on localhost).' } };
  }
  const name = typeof input.client_name === 'string' && input.client_name.trim() ? input.client_name.trim().slice(0, 80) : 'Claude';
  const id = `ecc_${randomBytes(16).toString('base64url')}`;
  await db.oAuthClient.create({ data: { id, name, redirectUris: JSON.stringify(uris) } });
  return {
    status: 201,
    body: {
      client_id: id,
      client_name: name,
      redirect_uris: uris,
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      client_id_issued_at: Math.floor(Date.now() / 1000),
    },
  };
}

export interface AuthorizeRequest {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  state?: string;
  scope?: string;
  responseType: string;
}

/** Checks an authorize request; returns the client's name, or why it is refused. */
export async function checkAuthorize(req: AuthorizeRequest): Promise<{ ok: true; clientName: string } | { ok: false; error: string }> {
  if (req.responseType !== 'code') return { ok: false, error: 'Only the authorization code flow is supported.' };
  if (!req.codeChallenge || req.codeChallengeMethod !== 'S256') return { ok: false, error: 'PKCE with S256 is required.' };
  const client = await db.oAuthClient.findUnique({ where: { id: req.clientId } });
  if (!client) return { ok: false, error: 'Unknown client. Remove the connector in Claude and add it again.' };
  const uris = JSON.parse(client.redirectUris) as string[];
  if (!uris.includes(req.redirectUri)) return { ok: false, error: 'That redirect address was not registered by this client.' };
  return { ok: true, clientName: client.name };
}

/** Issues a one-time code after the person has said yes, and the URL to send them back to. */
export async function approve(req: AuthorizeRequest, userId: string): Promise<string> {
  const code = randomBytes(24).toString('base64url');
  await db.oAuthCode.create({
    data: {
      code,
      clientId: req.clientId,
      userId,
      redirectUri: req.redirectUri,
      codeChallenge: req.codeChallenge,
      scope: req.scope ?? null,
      expiresAt: new Date(Date.now() + 5 * 60_000),
    },
  });
  const back = new URL(req.redirectUri);
  back.searchParams.set('code', code);
  if (req.state) back.searchParams.set('state', req.state);
  return back.toString();
}

export function denyUrl(req: AuthorizeRequest): string {
  const back = new URL(req.redirectUri);
  back.searchParams.set('error', 'access_denied');
  if (req.state) back.searchParams.set('state', req.state);
  return back.toString();
}

function s256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** The token endpoint: a code and its verifier in, an access token out. */
export async function exchangeCode(form: URLSearchParams): Promise<{ status: number; body: Record<string, unknown> }> {
  const fail = (error: string, description: string) => ({ status: 400, body: { error, error_description: description } });
  if (form.get('grant_type') !== 'authorization_code') return fail('unsupported_grant_type', 'Only authorization_code is supported.');
  const code = form.get('code') ?? '';
  const verifier = form.get('code_verifier') ?? '';
  const row = await db.oAuthCode.findUnique({ where: { code } });
  if (!row || row.usedAt || row.expiresAt <= new Date()) return fail('invalid_grant', 'The code is unknown, used or expired.');
  // Burn it first: a code is good for exactly one attempt, right or wrong.
  await db.oAuthCode.update({ where: { code }, data: { usedAt: new Date() } });
  if (form.get('client_id') && form.get('client_id') !== row.clientId) return fail('invalid_grant', 'The code was issued to another client.');
  if (form.get('redirect_uri') && form.get('redirect_uri') !== row.redirectUri) return fail('invalid_grant', 'redirect_uri does not match.');
  if (!verifier || s256(verifier) !== row.codeChallenge) return fail('invalid_grant', 'PKCE verification failed.');

  const client = await db.oAuthClient.findUnique({ where: { id: row.clientId } });
  const lifetimeSec = 365 * 24 * 3600;
  const token = await issueToken({
    userId: row.userId,
    name: client?.name ?? 'Claude',
    source: 'oauth',
    clientId: row.clientId,
    expiresAt: new Date(Date.now() + lifetimeSec * 1000),
  });
  return { status: 200, body: { access_token: token.secret, token_type: 'Bearer', expires_in: lifetimeSec, scope: row.scope ?? 'easycut' } };
}
