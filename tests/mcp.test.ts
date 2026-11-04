import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * A tiny in-memory stand-in for the three tables the MCP auth uses, enough to
 * run the token and OAuth code paths for real rather than mocking them away.
 */
const tables = vi.hoisted(() => ({
  apiToken: [] as Array<Record<string, unknown>>,
  oAuthClient: [] as Array<Record<string, unknown>>,
  oAuthCode: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/db', () => {
  const table = (rows: Array<Record<string, unknown>>, key: string) => ({
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: data.id ?? `id-${rows.length + 1}`, createdAt: new Date(), revokedAt: null, lastUsedAt: null, usedAt: null, ...data };
      rows.push(row);
      return row;
    },
    findUnique: async ({ where }: { where: Record<string, unknown> }) =>
      rows.find((row) => Object.entries(where).every(([k, v]) => row[k] === v)) ?? null,
    update: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const row = rows.find((r) => r[key] === where[key]);
      Object.assign(row ?? {}, data);
      return row;
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const hits = rows.filter((row) => Object.entries(where).every(([k, v]) => row[k] === v));
      hits.forEach((row) => Object.assign(row, data));
      return { count: hits.length };
    },
  });
  return {
    db: {
      apiToken: table(tables.apiToken, 'id'),
      oAuthClient: table(tables.oAuthClient, 'id'),
      oAuthCode: table(tables.oAuthCode, 'code'),
    },
    parseJson: (value: string | null, fallback: unknown) => (value ? JSON.parse(value) : fallback),
    stringifyJson: (value: unknown) => JSON.stringify(value),
  };
});

import { bearerOf, hashToken, issueToken, looksLikeToken, revokeToken, userForToken } from '@/lib/mcp/tokens';
import { approve, authorizationServerMetadata, checkAuthorize, exchangeCode, isAllowedRedirect, protectedResourceMetadata, registerClient } from '@/lib/mcp/oauth';
import { directDownloadUrl, isPrivateAddress } from '@/lib/mcp/service';
import { handleMessage, INSTRUCTIONS, jsonSchema, SUPPORTED_VERSIONS } from '@/lib/mcp/server';
import { serverAiAllowed, withServerAi } from '@/lib/llm/server-ai';
import { isChatConfigured } from '@/lib/llm/chat';
import { selectedProvider } from '@/lib/director';
import { z } from 'zod';

afterEach(() => {
  tables.apiToken.length = 0;
  tables.oAuthClient.length = 0;
  tables.oAuthCode.length = 0;
});

describe('access tokens', () => {
  it('stores only a hash, and resolves the secret back to its owner', async () => {
    const token = await issueToken({ userId: 'u1', name: 'Claude Code' });
    expect(looksLikeToken(token.secret)).toBe(true);
    expect(tables.apiToken[0].hash).toBe(hashToken(token.secret));
    expect(JSON.stringify(tables.apiToken)).not.toContain(token.secret);
    expect(await userForToken(token.secret)).toBe('u1');
    expect(await userForToken('ek_not-a-real-token-at-all')).toBeNull();
  });

  it('stops working once revoked or expired', async () => {
    const live = await issueToken({ userId: 'u1', name: 'a' });
    expect(await revokeToken('u1', live.id)).toBe(true);
    expect(await userForToken(live.secret)).toBeNull();
    const old = await issueToken({ userId: 'u1', name: 'b', expiresAt: new Date(Date.now() - 1000) });
    expect(await userForToken(old.secret)).toBeNull();
  });

  it('reads a Bearer header and nothing else', () => {
    expect(bearerOf('Bearer ek_abc')).toBe('ek_abc');
    expect(bearerOf('Basic xyz')).toBeNull();
    expect(bearerOf(null)).toBeNull();
  });
});

describe('OAuth for claude.ai connectors', () => {
  const origin = 'https://easycut.example';

  it('publishes metadata pointing at its own endpoints', () => {
    expect(protectedResourceMetadata(origin)).toMatchObject({ resource: `${origin}/api/mcp`, authorization_servers: [origin] });
    expect(authorizationServerMetadata(origin)).toMatchObject({
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/api/oauth/token`,
      registration_endpoint: `${origin}/api/oauth/register`,
      code_challenge_methods_supported: ['S256'],
    });
  });

  it('only registers https redirects, or http on localhost', async () => {
    expect(isAllowedRedirect('https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(isAllowedRedirect('http://localhost:6274/callback')).toBe(true);
    expect(isAllowedRedirect('http://evil.example/cb')).toBe(false);
    expect((await registerClient({ redirect_uris: ['http://evil.example/cb'] })).status).toBe(400);
  });

  it('runs the whole flow: register, approve, exchange with PKCE, and the token works once', async () => {
    const registered = await registerClient({ client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] });
    expect(registered.status).toBe(201);
    const clientId = String(registered.body.client_id);
    const verifier = 'v'.repeat(64);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const request = {
      clientId,
      redirectUri: 'https://claude.ai/api/mcp/auth_callback',
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      state: 'st',
      responseType: 'code',
    };
    expect(await checkAuthorize(request)).toEqual({ ok: true, clientName: 'Claude' });
    expect(await checkAuthorize({ ...request, codeChallengeMethod: 'plain' })).toMatchObject({ ok: false });
    expect(await checkAuthorize({ ...request, redirectUri: 'https://elsewhere.example/cb' })).toMatchObject({ ok: false });

    const back = new URL(await approve(request, 'user-7'));
    expect(back.searchParams.get('state')).toBe('st');
    const code = back.searchParams.get('code')!;

    const wrong = await exchangeCode(new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: 'nope', client_id: clientId }));
    expect(wrong.status).toBe(400);
    // A code is burnt by its first attempt, right or wrong.
    const again = await exchangeCode(new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId }));
    expect(again.status).toBe(400);

    const back2 = new URL(await approve(request, 'user-7'));
    const good = await exchangeCode(
      new URLSearchParams({ grant_type: 'authorization_code', code: back2.searchParams.get('code')!, code_verifier: verifier, client_id: clientId, redirect_uri: request.redirectUri }),
    );
    expect(good.status).toBe(200);
    expect(good.body.token_type).toBe('Bearer');
    expect(await userForToken(String(good.body.access_token))).toBe('user-7');
  });
});

describe('the MCP protocol', () => {
  const caller = { userId: null, origin: 'https://easycut.example' };

  it('negotiates a version, and offers tools, prompts and resources', async () => {
    const response = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }, caller, null);
    expect(response).toMatchObject({ id: 1, result: { protocolVersion: '2025-03-26', serverInfo: { name: 'easycut' } } });
    expect((response!.result as { instructions: string }).instructions).toBe(INSTRUCTIONS);
    const unknown = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } }, caller, null);
    expect((unknown!.result as { protocolVersion: string }).protocolVersion).toBe(SUPPORTED_VERSIONS[0]);
  });

  it('lists every tool with an object schema', async () => {
    const response = await handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, caller, null);
    const tools = (response!.result as { tools: Array<{ name: string; inputSchema: { type: string } }> }).tools;
    expect(tools.map((tool) => tool.name)).toEqual([
      'list_styles', 'list_projects', 'create_project', 'start_edit', 'get_project', 'get_transcript',
      'set_scenes', 'get_scene_brief', 'preview_scene', 'submit_scene', 'update_edit', 'render_video',
    ]);
    for (const tool of tools) expect(tool.inputSchema.type).toBe('object');
  });

  it('answers list_styles with every look, and rejects bad arguments as a tool error', async () => {
    const styles = await handleMessage({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_styles', arguments: {} } }, caller, null);
    const looks = (styles!.result as { structuredContent: { sceneLooks: Array<{ id: string }> } }).structuredContent.sceneLooks;
    expect(looks.map((look) => look.id)).toEqual(expect.arrayContaining(['science', 'clay', 'sticker', 'retro']));
    const bad = await handleMessage({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'get_project', arguments: {} } }, caller, null);
    expect(bad!.result).toMatchObject({ isError: true });
  });

  it('serves the training as prompts and resources', async () => {
    const prompt = await handleMessage({ jsonrpc: '2.0', id: 6, method: 'prompts/get', params: { name: 'write_scene', arguments: { line: 'Save a little every week.', look: 'pixel' } } }, caller, null);
    const textOf = JSON.stringify(prompt!.result);
    expect(textOf).toContain('Traps that break a scene');
    expect(textOf).toContain('Save a little every week.');
    const resource = await handleMessage({ jsonrpc: '2.0', id: 7, method: 'resources/read', params: { uri: 'easycut://looks/clay' } }, caller, null);
    expect(JSON.stringify(resource!.result)).toContain('Reference scene');
  });

  it('stays silent on notifications and says so on unknown methods', async () => {
    expect(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, caller, null)).toBeNull();
    const response = await handleMessage({ jsonrpc: '2.0', id: 8, method: 'sampling/nonsense' }, caller, null);
    expect(response).toMatchObject({ error: { code: -32601 } });
  });

  it('turns zod into JSON Schema with required fields and enums', () => {
    const schema = jsonSchema(z.object({ a: z.string(), b: z.enum(['x', 'y']).optional(), c: z.array(z.number()) }));
    expect(schema).toMatchObject({ type: 'object', required: ['a', 'c'], properties: { b: { enum: ['x', 'y'] }, c: { type: 'array' } } });
  });
});

describe('fetching footage from a link', () => {
  it('turns share links into downloads', () => {
    expect(directDownloadUrl('https://drive.google.com/file/d/ABC123/view?usp=sharing')).toBe('https://drive.google.com/uc?export=download&id=ABC123');
    expect(directDownloadUrl('https://www.dropbox.com/s/xyz/clip.mp4?dl=0')).toContain('dl=1');
  });

  it('never reaches a private or metadata address', () => {
    for (const ip of ['127.0.0.1', '10.0.0.4', '172.20.1.1', '192.168.1.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1']) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    for (const ip of ['8.8.8.8', '151.101.1.140', '2606:4700::1111']) expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe('client-AI projects make no paid model calls', () => {
  it('switches every provider off inside the scope, and only there', () => {
    expect(serverAiAllowed()).toBe(true);
    withServerAi(false, () => {
      expect(serverAiAllowed()).toBe(false);
      expect(isChatConfigured()).toBe(false);
      expect(selectedProvider()).toBe('heuristic');
    });
    expect(serverAiAllowed()).toBe(true);
  });

  it('holds across awaits', async () => {
    await withServerAi(false, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(serverAiAllowed()).toBe(false);
    });
  });
});

describe('the preview shows what the platform covers', () => {
  it('describes the safe area and caption band as fractions of the frame', async () => {
    const { frameGuides, SCENE_CAPTION_BAND } = await import('@/lib/director/hyperframe');
    const guides = frameGuides(1080, 1920);
    expect(guides.left).toBeCloseTo(60 / 1080);
    expect(guides.bottom).toBeCloseTo(1520 / 1920);
    expect(guides.notchRight).toBeCloseTo(900 / 1080);
    expect([guides.captionTop, guides.captionBottom]).toEqual([SCENE_CAPTION_BAND.top, SCENE_CAPTION_BAND.bottom]);
  });

  it('draws them over the frames as one sheet', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { existsSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { ffmpeg } = await import('@/lib/media/ffmpeg');
    const { guideSheet } = await import('@/lib/render/hyperframes');
    const { frameGuides } = await import('@/lib/director/hyperframe');
    const dir = await mkdtemp(join(tmpdir(), 'guides-'));
    try {
      const frame = join(dir, 'f.png');
      await ffmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=0xE9E7E3:s=540x960', '-frames:v', '1', frame]);
      const out = await guideSheet([frame, frame], frameGuides(1080, 1920), join(dir, 'sheet.jpg'));
      expect(out && existsSync(out)).toBe(true);
      expect(await guideSheet([], frameGuides(1080, 1920), join(dir, 'none.jpg'))).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
