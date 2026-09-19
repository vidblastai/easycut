import { AppShell, ShellMain } from '@/components/shell/AppShell';
import { capabilities } from '@/lib/config/env';
import { env } from '@/lib/config/env';
import { selectedProvider } from '@/lib/director';
import { isAuthEnabled } from '@/lib/auth';
import { db } from '@/lib/db';
import { recentsFor } from '@/lib/ui/recents';
import { clsx } from 'clsx';
import { BillingPanel } from '@/components/billing/BillingPanel';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Settings — EasyCut' };

/**
 * What is switched on, and what each thing being off actually costs you.
 *
 * Deliberately not a form. Every one of these is an environment variable on
 * the server, so a text field here would be a lie — what a person needs is to
 * see which ones are missing and what the video loses without them. The
 * fallback text is the same string /api/health and the setup banner read, so
 * there is one answer to "why doesn't my video have captions".
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Stripe sends people back here after checkout. Saying so is the difference
  // between "did that work?" and knowing it did.
  const justPaid = (await searchParams).checkout === 'done';
  const caps = capabilities();
  const projects = await db.project.findMany({ orderBy: { createdAt: 'desc' }, take: 8 }).catch(() => []);

  const runtime = [
    { label: 'AI director', value: selectedProvider() },
    { label: 'Storage', value: env.storage.driver },
    { label: 'Queue', value: env.queue.driver },
    { label: 'Renderer', value: env.render.driver },
    { label: 'Sign-in', value: isAuthEnabled() ? 'Clerk' : 'Off — anyone with a link can open any video' },
  ];

  return (
    <AppShell recents={recentsFor(projects)}>
      <ShellMain>
        <div className="pt-7">
          <h1 className="text-[28px] font-extrabold">Settings</h1>
          <p className="mt-1.5 max-w-[62ch] text-[13.5px] text-muted">
            Everything below is set on the server. This page tells you what is on, and what a video
            loses when something is off.
          </p>
        </div>

        <BillingPanel justPaid={justPaid} />

        <h2 className="mt-8 text-[15px] font-bold">Features</h2>
        <ul className="mt-3 grid gap-px overflow-hidden rounded-[14px] bg-line-soft">
          {caps.map((cap) => (
            <li key={cap.key} className="bg-charcoal px-4 py-3.5">
              <div className="flex flex-wrap items-center gap-2.5">
                <span
                  className={clsx('h-1.5 w-1.5 flex-none rounded-full', cap.configured ? 'bg-ok' : 'bg-warn')}
                  aria-hidden
                />
                <b className="text-[13.5px] font-bold">{cap.label}</b>
                <span className={clsx('text-[12px] font-semibold', cap.configured ? 'text-ok' : 'text-warn')}>
                  {cap.configured ? 'On' : 'Off'}
                </span>
                {!cap.configured && cap.signupUrl ? (
                  <a
                    href={cap.signupUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto text-[12px] font-semibold text-violet hover:text-violet-hover"
                  >
                    Get a key
                  </a>
                ) : null}
              </div>
              {!cap.configured ? (
                <p className="mt-1.5 text-[12.5px] text-muted">{cap.fallback}</p>
              ) : null}
              {cap.envVars.length ? (
                <p className="mt-1.5 font-mono text-[11px] text-faint">{cap.envVars.join(' · ')}</p>
              ) : null}
            </li>
          ))}
        </ul>

        <h2 className="mt-8 text-[15px] font-bold">This deployment</h2>
        <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-[14px] bg-line-soft sm:grid-cols-5">
          {runtime.map((row) => (
            <div key={row.label} className="bg-charcoal px-4 py-3.5">
              <dt className="eyebrow">{row.label}</dt>
              <dd className="mt-1 truncate text-[13px] font-semibold">{row.value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[12.5px] text-faint">
          <a href="/api/health" className="text-violet hover:text-violet-hover">
            /api/health
          </a>{' '}
          returns the same thing as JSON, including warnings about settings that quietly lose data
          once there is more than one container.
        </p>
      </ShellMain>
    </AppShell>
  );
}
