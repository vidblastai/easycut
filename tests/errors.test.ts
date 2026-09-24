import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fingerprint, normaliseMessage } from '@/lib/errors/fingerprint';
import { redact, redactContext } from '@/lib/errors/redact';
import { parseDsn } from '@/lib/errors/sentry';
import { stackFrames } from '@/lib/errors/frames';

/**
 * Error reporting is the one part of this product whose failures nobody is
 * watching for — by definition, since it IS the watching. So the things that
 * would quietly break it are tested directly: the grouping that stops a flood,
 * the redaction that stops a leak, and the guarantee that a broken reporter
 * cannot break the thing it reports on.
 */

describe('redaction', () => {
  it('strips API keys by shape, whatever they are called', () => {
    const shapes = [
      'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA',
      'sk_live_51HxxxxxxxxxxxxxxxxxxYZ',
      'whsec_abcdefghijklmnopqrstuvwxyz',
      're_123456789abcdefghijk',
      'AIzaSyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      'AKIAIOSFODNN7EXAMPLE',
    ];
    for (const secret of shapes) {
      const out = redact(`request failed with ${secret} in it`);
      expect(out, secret).not.toContain(secret);
      expect(out).toContain('[redacted]');
    }
  });

  it('strips a signed URL without losing which URL it was', () => {
    const out = redact(
      'GET https://bucket.r2.cloudflarestorage.com/sources/abc.mp4?X-Amz-Signature=deadbeef99&X-Amz-Expires=900 failed',
    );
    expect(out).not.toContain('deadbeef99');
    // The path survives, because without it the alert says nothing.
    expect(out).toContain('/sources/abc.mp4');
    // A non-secret parameter is left alone.
    expect(out).toContain('X-Amz-Expires=900');
  });

  it('strips a bearer token and a named secret', () => {
    expect(redact('Authorization: Bearer abcdef1234567890')).not.toContain('abcdef1234567890');
    expect(redact('DEEPGRAM_API_KEY=9f8e7d6c5b4a3210')).toContain('[redacted]');
  });

  it('strips email addresses, which are people rather than diagnostics', () => {
    expect(redact('could not send to sam@example.com')).toBe('could not send to [redacted]');
  });

  it('empties a secret-looking context key outright', () => {
    const out = redactContext({
      projectId: 'abc',
      apiKey: 'anything at all',
      nested: { sessionToken: 'xyz', keep: 'this' },
    }) as Record<string, Record<string, string>>;
    expect(out.projectId).toBe('abc');
    expect(out.apiKey).toBe('[redacted]');
    expect(out.nested.sessionToken).toBe('[redacted]');
    expect(out.nested.keep).toBe('this');
  });

  it('refuses to walk a deep object into an alert', () => {
    const deep = { a: { b: { c: { d: { e: 'buried' } } } } };
    expect(JSON.stringify(redactContext(deep))).not.toContain('buried');
  });

  it('leaves an ordinary message alone', () => {
    const plain = 'ffmpeg exited with code 1';
    expect(redact(plain)).toBe(plain);
  });
});

describe('fingerprinting', () => {
  it('groups the same failure across different projects', () => {
    const a = fingerprint({ name: 'Error', message: 'project cm3x9abcdefghijklmnop not found', where: 'worker.pipeline' });
    const b = fingerprint({ name: 'Error', message: 'project cm4y2zyxwvutsrqponml not found', where: 'worker.pipeline' });
    expect(a).toBe(b);
  });

  it('groups across varying paths, numbers and urls', () => {
    const a = fingerprint({ name: 'Error', message: 'ENOSPC writing /app/.storage/tmp/9f2c.mp4', where: 'render' });
    const b = fingerprint({ name: 'Error', message: 'ENOSPC writing /app/.storage/tmp/44ab.mp4', where: 'render' });
    expect(a).toBe(b);
    expect(normaliseMessage('timed out after 30012ms')).toBe(normaliseMessage('timed out after 45ms'));
  });

  it('keeps genuinely different failures apart', () => {
    const base = { name: 'Error', message: 'storage unreachable', where: 'worker.pipeline' };
    expect(fingerprint(base)).not.toBe(fingerprint({ ...base, message: 'transcript empty' }));
    // Same message, different place, is a different bug to fix.
    expect(fingerprint(base)).not.toBe(fingerprint({ ...base, where: 'api.upload' }));
    expect(fingerprint(base)).not.toBe(fingerprint({ ...base, name: 'TypeError' }));
  });

  it('is stable across calls, which is what makes a cooldown possible', () => {
    const args = { name: 'Error', message: 'x', where: 'y' };
    expect(fingerprint(args)).toBe(fingerprint(args));
  });
});

describe('stack frames', () => {
  it('takes the frames and not the message, however long the message is', () => {
    // Zod's message is a pretty-printed JSON document, so counting lines past
    // "the message" quotes the message back instead of saying where it broke.
    const stack = ['[', '  {', '    "code": "invalid_enum_value"', '  }', ']', '    at parse (/app/x.ts:1:2)', '    at POST (/app/y.ts:3:4)'].join('\n');
    expect(stackFrames(stack, 2)).toEqual(['at parse (/app/x.ts:1:2)', 'at POST (/app/y.ts:3:4)']);
  });

  it('copes with no stack at all', () => {
    expect(stackFrames(undefined, 3)).toEqual([]);
    expect(stackFrames('just a message', 3)).toEqual([]);
  });
});

describe('the sentry DSN', () => {
  it('builds the envelope endpoint from a real DSN', () => {
    const dsn = parseDsn('https://abc123@o4507.ingest.sentry.io/1234567');
    expect(dsn?.publicKey).toBe('abc123');
    expect(dsn?.envelopeUrl).toBe('https://o4507.ingest.sentry.io/api/1234567/envelope/');
  });

  it('returns null rather than throwing on a typo', () => {
    // A bad environment variable must not take down the thing that reports
    // bad environment variables.
    expect(parseDsn('not a url')).toBeNull();
    expect(parseDsn('https://o4507.ingest.sentry.io/1234567')).toBeNull(); // no key
    expect(parseDsn('https://abc123@o4507.ingest.sentry.io')).toBeNull(); // no project
    expect(parseDsn(undefined)).toBeNull();
  });
});

describe('reporting', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.ERROR_WEBHOOK_URL;
    delete process.env.SENTRY_DSN;
    process.env.ERROR_COOLDOWN_MINUTES = '15';
    process.env.ERROR_MAX_PER_HOUR = '20';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('alerts once and then folds the repeats', async () => {
    const { reportError, resetErrorThrottle } = await import('@/lib/errors/report');
    resetErrorThrottle();

    const first = await reportError(new Error('storage unreachable'), { where: 'worker.pipeline' });
    expect(first.alerted).toBe(true);
    expect(first.occurrences).toBe(1);

    for (let i = 0; i < 50; i++) {
      const repeat = await reportError(new Error('storage unreachable'), { where: 'worker.pipeline' });
      expect(repeat.alerted).toBe(false);
    }
  });

  it('still logs every repeat, because a loop is the thing worth seeing', async () => {
    const { reportError, resetErrorThrottle } = await import('@/lib/errors/report');
    resetErrorThrottle();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await reportError(new Error('boom'), { where: 'w' });
    const afterFirst = spy.mock.calls.length;
    await reportError(new Error('boom'), { where: 'w' });
    expect(spy.mock.calls.length).toBeGreaterThan(afterFirst);
  });

  it('reports a second, different failure even while the first is cooling down', async () => {
    const { reportError, resetErrorThrottle } = await import('@/lib/errors/report');
    resetErrorThrottle();

    await reportError(new Error('storage unreachable'), { where: 'worker.pipeline' });
    const other = await reportError(new Error('transcript empty'), { where: 'worker.pipeline' });
    // The failure mode that would hide a real incident behind a noisy one.
    expect(other.alerted).toBe(true);
  });

  it('holds a ceiling across distinct failures too', async () => {
    process.env.ERROR_MAX_PER_HOUR = '3';
    const { reportError, resetErrorThrottle, suppressedThisHour } = await import('@/lib/errors/report');
    resetErrorThrottle();

    const results = [];
    for (let i = 0; i < 10; i++) {
      results.push(await reportError(new Error(`distinct failure ${'x'.repeat(i)}`), { where: 'worker.pipeline' }));
    }
    expect(results.filter((r) => r.alerted)).toHaveLength(3);
    expect(suppressedThisHour()).toBe(7);
  });

  it('flattens a message that arrives as a JSON document', async () => {
    // A Zod validation failure in an API route is among the likeliest things
    // this will ever report, and its `message` is pretty-printed JSON. Left
    // alone the alert's headline is `[` and its second line is `{`.
    process.env.ERROR_WEBHOOK_URL = 'https://hooks.example.com/abc';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const { reportError, resetErrorThrottle } = await import('@/lib/errors/report');
    resetErrorThrottle();

    const zodish = new Error('[\n  {\n    "code": "invalid_enum_value",\n    "path": ["quality"]\n  }\n]');
    zodish.name = 'ZodError';
    await reportError(zodish, { where: 'web.app', route: '/api/projects/[id]/render' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.event.message).not.toContain('\n');
    expect(body.event.message).toContain('invalid_enum_value');
    // The headline is still the first line of the alert, and still readable.
    expect(body.text.split('\n')[1]).toContain('invalid_enum_value');
  });

  it('caps a runaway message rather than posting a novel', async () => {
    process.env.ERROR_WEBHOOK_URL = 'https://hooks.example.com/abc';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const { reportError, resetErrorThrottle } = await import('@/lib/errors/report');
    resetErrorThrottle();

    await reportError(new Error('x'.repeat(5000)), { where: 'worker.pipeline' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.event.message.length).toBeLessThan(450);
  });

  it('never throws, whatever it is handed', async () => {
    const { reportError, resetErrorThrottle } = await import('@/lib/errors/report');
    resetErrorThrottle();

    // A thrown string, a rejected object, and nothing at all — each of which
    // has reached a catch block in a real Node process.
    await expect(reportError('just a string', { where: 'w' })).resolves.toBeDefined();
    await expect(reportError({ odd: true }, { where: 'w' })).resolves.toBeDefined();
    await expect(reportError(undefined, { where: 'w' })).resolves.toBeDefined();
  });

  it('survives a sink that is itself broken', async () => {
    process.env.ERROR_WEBHOOK_URL = 'https://hooks.example.com/abc';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('DNS is down too')));

    const { reportError, resetErrorThrottle } = await import('@/lib/errors/report');
    resetErrorThrottle();

    const result = await reportError(new Error('the real problem'), { where: 'worker.pipeline' });
    // The alert did not get through, and the caller is told nothing went out
    // rather than being handed an exception on top of its own failure.
    expect(result.alerted).toBe(true);
    expect(result.sinks).toEqual([]);
  });

  it('posts a redacted alert to a webhook', async () => {
    process.env.ERROR_WEBHOOK_URL = 'https://hooks.example.com/abc';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const { reportError, resetErrorThrottle } = await import('@/lib/errors/report');
    resetErrorThrottle();

    await reportError(new Error('upload to https://b.r2.dev/x?X-Amz-Signature=deadbeef99 failed'), {
      where: 'worker.pipeline',
      projectId: 'cm3x9',
      apiKey: 'sk-should-never-appear',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const whole = JSON.stringify(body);
    expect(whole).not.toContain('deadbeef99');
    expect(whole).not.toContain('sk-should-never-appear');
    // Slack reads `text`, Discord reads `content` — one body has to satisfy both.
    expect(body.text).toContain('worker.pipeline');
    expect(body.content).toContain('worker.pipeline');
    expect(body.event.context.projectId).toBe('cm3x9');
  });

  it('sends a sentry envelope with our own fingerprint', async () => {
    process.env.SENTRY_DSN = 'https://pub@o1.ingest.sentry.io/42';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const { reportError, resetErrorThrottle } = await import('@/lib/errors/report');
    resetErrorThrottle();

    const result = await reportError(new Error('render failed'), { where: 'worker.rerender' });
    expect(result.sinks).toContain('sentry');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://o1.ingest.sentry.io/api/42/envelope/');
    expect(init.headers['X-Sentry-Auth']).toContain('sentry_key=pub');

    const [, itemHeader, payload] = (init.body as string).trim().split('\n').map((l: string) => JSON.parse(l));
    expect(itemHeader).toEqual({ type: 'event' });
    expect(payload.exception.values[0].value).toBe('render failed');
    // Ours, so the cooldown here and the issue list there agree on what one
    // incident is.
    expect(payload.fingerprint).toEqual([result.fingerprint]);
  });

  it('sends nothing at all when nothing is configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { reportError, resetErrorThrottle } = await import('@/lib/errors/report');
    resetErrorThrottle();

    const result = await reportError(new Error('boom'), { where: 'worker.pipeline' });
    expect(fetchMock).not.toHaveBeenCalled();
    // Still logged and still fingerprinted, which is the unconfigured value.
    expect(result.fingerprint).toMatch(/^[0-9a-z]+$/);
    expect(result.sinks).toEqual([]);
  });
});
