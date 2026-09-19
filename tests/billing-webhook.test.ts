import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * The webhook, as an unauthenticated POST from the internet.
 *
 * Everything else in the billing code can be wrong and cost a support email.
 * This one can be wrong and cost the whole product: without signature
 * verification, "put me on Studio" is a curl command anyone can write, and the
 * endpoint has to be reachable without a session for Stripe to use it at all.
 *
 * So these tests forge things. A body with no signature, a signature over
 * different bytes, a signature made with the wrong secret, and a timestamp
 * from last year all have to be refused — and the genuine one, signed exactly
 * the way Stripe signs it, has to be honoured.
 */
const dir = mkdtempSync(join(tmpdir(), 'easycut-webhook-'));
const url = `file:${join(dir, 'webhook-test.db')}`;
const SECRET = 'whsec_test_secret';

process.env.DATABASE_URL = url;
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET = SECRET;
process.env.STRIPE_PRICE_STARTER = 'price_starter';
process.env.STRIPE_PRICE_CREATOR = 'price_creator';
process.env.STRIPE_PRICE_STUDIO = 'price_studio';

execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
  env: { ...process.env, DATABASE_URL: url },
  stdio: 'ignore',
});

const db = new PrismaClient({ datasources: { db: { url } } });
const { POST } = await import('../src/app/api/billing/webhook/route');

afterAll(async () => {
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

/** Exactly how Stripe signs: HMAC-SHA256 over `${timestamp}.${body}`. */
function sign(body: string, secret = SECRET, at = Math.floor(Date.now() / 1000)) {
  const v1 = createHmac('sha256', secret).update(`${at}.${body}`).digest('hex');
  return `t=${at},v1=${v1}`;
}

function event(over: Record<string, unknown> = {}, subOver: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: 'evt_1',
    type: 'customer.subscription.updated',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: 'sub_1',
        status: 'active',
        customer: 'cus_1',
        cancel_at_period_end: false,
        metadata: { userId: 'user_1' },
        items: { data: [{ price: { id: 'price_creator' }, current_period_end: 1800000000 }] },
        ...subOver,
      },
    },
    ...over,
  });
}

const post = (body: string, signature?: string) =>
  POST(
    new Request('https://easycut.test/api/billing/webhook', {
      method: 'POST',
      headers: signature ? { 'stripe-signature': signature } : {},
      body,
    }),
  );

const planNow = async () => (await db.user.findUnique({ where: { id: 'user_1' } }))!.plan;

beforeEach(async () => {
  await db.user.deleteMany();
  await db.user.create({ data: { id: 'user_1', email: 'a@example.com', plan: 'free' } });
});

describe('refusing anything it cannot verify', () => {
  it('rejects a body with no signature at all', async () => {
    const response = await post(event());
    expect(response.status).toBe(400);
    expect(await planNow()).toBe('free');
  });

  it('rejects a signature made with the wrong secret', async () => {
    const body = event();
    const response = await post(body, sign(body, 'whsec_not_ours'));
    expect(response.status).toBe(400);
    expect(await planNow()).toBe('free');
  });

  it('rejects a real signature over DIFFERENT bytes', async () => {
    // The forgery that matters: replay a signature you saw, with a body that
    // says Studio instead of Starter.
    const signature = sign(event());
    const tampered = event({}, { items: { data: [{ price: { id: 'price_studio' } }] } });
    const response = await post(tampered, signature);
    expect(response.status).toBe(400);
    expect(await planNow()).toBe('free');
  });

  it('rejects a signature from outside the tolerance window', async () => {
    const body = event();
    const lastYear = Math.floor(Date.now() / 1000) - 400 * 86_400;
    const response = await post(body, sign(body, SECRET, lastYear));
    expect(response.status).toBe(400);
    expect(await planNow()).toBe('free');
  });

  it('answers 400 rather than 500, so Stripe stops retrying a forgery', async () => {
    const response = await post(event(), 't=1,v1=deadbeef');
    expect(response.status).toBe(400);
  });
});

describe('acting on a genuine one', () => {
  it('upgrades the account', async () => {
    const body = event();
    const response = await post(body, sign(body));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, plan: 'creator' });
    expect(await planNow()).toBe('creator');
  });

  it('downgrades on a cancellation', async () => {
    const start = event();
    await post(start, sign(start));

    const ended = event(
      { type: 'customer.subscription.deleted', created: Math.floor(Date.now() / 1000) + 60 },
      { status: 'canceled' },
    );
    await post(ended, sign(ended));
    expect(await planNow()).toBe('free');
  });

  it('answers 200 to an event type it does not handle', async () => {
    // Stripe retries any non-2xx for three days with backoff. An event we do
    // not care about must not look like a failure, or the retry queue delays
    // the events we do care about.
    const body = event({ type: 'invoice.payment_succeeded' });
    const response = await post(body, sign(body));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ignored: 'invoice.payment_succeeded' });
  });

  it('answers 200, not 500, when the account is simply not ours', async () => {
    const body = event({}, { metadata: {}, customer: 'cus_stranger' });
    const response = await post(body, sign(body));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ reason: 'unmatched' });
  });
});
