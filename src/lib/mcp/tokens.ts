import { createHash, randomBytes } from 'node:crypto';
import { db } from '@/lib/db';

/**
 * Access tokens for the MCP server.
 *
 * `ek_` plus 32 random bytes, base64url. Only a SHA-256 of the whole string is
 * kept: a database dump hands nobody a working credential, and a lookup is one
 * indexed equality. The first twelve characters are stored in the clear as a
 * label, so the account page can tell two tokens apart without being able to
 * reconstruct either.
 */

const PREFIX = 'ek_';

export function hashToken(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function looksLikeToken(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.startsWith(PREFIX) && value.length > 20;
}

export interface IssuedToken {
  id: string;
  secret: string;
  prefix: string;
}

export async function issueToken(options: {
  userId: string;
  name: string;
  source?: 'manual' | 'oauth';
  clientId?: string;
  expiresAt?: Date | null;
}): Promise<IssuedToken> {
  const secret = PREFIX + randomBytes(32).toString('base64url');
  const row = await db.apiToken.create({
    data: {
      userId: options.userId,
      name: options.name.slice(0, 80) || 'Claude',
      prefix: secret.slice(0, 12),
      hash: hashToken(secret),
      source: options.source ?? 'manual',
      clientId: options.clientId ?? null,
      expiresAt: options.expiresAt ?? null,
    },
  });
  return { id: row.id, secret, prefix: row.prefix };
}

/** The user a token belongs to, or null for an unknown, revoked or expired one. */
export async function userForToken(secret: string, now = new Date()): Promise<string | null> {
  if (!looksLikeToken(secret)) return null;
  const row = await db.apiToken.findUnique({ where: { hash: hashToken(secret) } });
  if (!row || row.revokedAt || (row.expiresAt && row.expiresAt <= now)) return null;
  // Best-effort: a failed timestamp write must not fail the request it describes.
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > 60_000) {
    await db.apiToken.update({ where: { id: row.id }, data: { lastUsedAt: now } }).catch(() => undefined);
  }
  return row.userId;
}

/** The Bearer value of an Authorization header, if it carries one. */
export function bearerOf(header: string | null): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(header?.trim() ?? '');
  return match ? match[1].trim() : null;
}

export async function listTokens(userId: string) {
  return db.apiToken.findMany({
    where: { userId, revokedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, prefix: true, source: true, createdAt: true, lastUsedAt: true, expiresAt: true },
  });
}

export async function revokeToken(userId: string, id: string): Promise<boolean> {
  const result = await db.apiToken.updateMany({ where: { id, userId, revokedAt: null }, data: { revokedAt: new Date() } });
  return result.count > 0;
}
