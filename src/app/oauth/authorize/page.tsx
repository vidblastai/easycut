import { redirect } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { ensureUser, isAuthEnabled } from '@/lib/auth';
import { db } from '@/lib/db';
import { approve, checkAuthorize, denyUrl, type AuthorizeRequest } from '@/lib/mcp/oauth';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Connect Claude — EasyCut' };

/**
 * The consent screen a claude.ai connector sends people to.
 *
 * The middleware has already made them sign in (this page is not public), so
 * by the time it renders there is an EasyCut account to connect. One question,
 * two buttons; saying yes issues a one-time code and sends them back to Claude.
 */

type Params = Record<string, string | string[] | undefined>;

function read(params: Params): AuthorizeRequest {
  const one = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value) ?? '';
  };
  return {
    clientId: one('client_id'),
    redirectUri: one('redirect_uri'),
    codeChallenge: one('code_challenge'),
    codeChallengeMethod: one('code_challenge_method') || 'S256',
    state: one('state') || undefined,
    scope: one('scope') || undefined,
    responseType: one('response_type') || 'code',
  };
}

export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const req = read(params);
  const check = await checkAuthorize(req);

  async function decide(formData: FormData) {
    'use server';
    const request = read(Object.fromEntries(formData.entries()) as Params);
    const verdict = await checkAuthorize(request);
    if (!verdict.ok) throw new Error(verdict.error);
    if (formData.get('decision') !== 'allow') redirect(denyUrl(request));
    // With sign-in off there are no accounts: the token belongs to nobody and
    // the MCP server lets anyone in anyway, which is what that mode means.
    const userId = isAuthEnabled()
      ? await ensureUser()
      : (await db.user.upsert({ where: { id: 'open' }, update: {}, create: { id: 'open', email: 'open@easycut.local' } })).id;
    if (!userId) redirect('/sign-in');
    redirect(await approve(request, userId));
  }

  return (
    <main className="grid min-h-screen place-items-center bg-ink px-4">
      <div className="w-full max-w-[420px] rounded-[18px] border border-line bg-charcoal p-7">
        <Logo />
        {check.ok ? (
          <>
            <h1 className="mt-6 text-[20px] font-extrabold">Connect {check.clientName} to EasyCut?</h1>
            <p className="mt-2 text-[13.5px] text-muted">
              {check.clientName} will be able to create and edit videos on your EasyCut account: upload
              footage, run edits, write animated scenes and render — against your plan&rsquo;s minutes.
              You can disconnect it any time in Settings.
            </p>
            <form action={decide} className="mt-6 flex gap-2.5">
              {Object.entries(params).map(([key, value]) =>
                typeof value === 'string' ? <input key={key} type="hidden" name={key} value={value} /> : null,
              )}
              <button
                name="decision"
                value="allow"
                className="flex-1 rounded-lg bg-violet px-4 py-2.5 text-[14px] font-bold text-white hover:bg-violet-hover"
              >
                Allow
              </button>
              <button
                name="decision"
                value="deny"
                className="rounded-lg border border-line px-4 py-2.5 text-[14px] font-semibold hover:bg-ink"
              >
                Cancel
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className="mt-6 text-[20px] font-extrabold">This connection request can&rsquo;t be used</h1>
            <p className="mt-2 text-[13.5px] text-muted">{check.error}</p>
          </>
        )}
      </div>
    </main>
  );
}
