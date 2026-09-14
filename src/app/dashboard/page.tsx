import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { db, parseJson } from '@/lib/db';
import { formatUsd } from '@/lib/pricing/cost';
import { getStyle } from '@/lib/styles/presets';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const projects = await db.project
    .findMany({
      orderBy: { createdAt: 'desc' },
      take: 60,
      include: { jobs: { orderBy: { queuedAt: 'desc' }, take: 1 } },
    })
    .catch(() => []);

  const totalSpend = projects.reduce((sum, p) => sum + p.costUsd, 0);

  return (
    <main className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Link href="/">
          <Logo />
        </Link>
        <Link href="/new" className="btn-primary">
          New video
        </Link>
      </header>

      <div className="mx-auto max-w-6xl px-6 pb-24">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-[-0.03em]">Your videos</h1>
            <p className="mt-2 text-muted">
              {projects.length === 0
                ? 'Nothing here yet.'
                : `${projects.length} project${projects.length === 1 ? '' : 's'} · ${formatUsd(totalSpend)} spent in total`}
            </p>
          </div>
        </div>

        {projects.length === 0 ? (
          <div className="card mt-8 p-12 text-center">
            <h2 className="text-lg font-bold">Upload something and see what happens.</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted">
              Point a camera at yourself, talk for thirty seconds, and drop the file in. You&rsquo;ll
              have a postable video before you&rsquo;ve finished making coffee.
            </p>
            <Link href="/new" className="btn-primary mt-6">
              Upload your footage
            </Link>
          </div>
        ) : (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => {
              const job = project.jobs[0];
              const style = getStyle(project.styleId);
              const hashtags = parseJson<string[]>(project.hashtags, []);

              return (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="card group overflow-hidden transition-colors hover:border-violet/50"
                >
                  <div
                    className="relative flex items-center justify-center bg-ink"
                    style={{ aspectRatio: project.mode === 'short' ? '9 / 12' : '16 / 9' }}
                  >
                    {project.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={project.thumbnailUrl}
                        alt=""
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                      />
                    ) : (
                      <StatusBadge status={project.status} label={job?.progressLabel} progress={job?.progress ?? 0} />
                    )}

                    <span className="absolute left-3 top-3 rounded-md bg-ink/80 px-2 py-1 text-[11px] font-semibold backdrop-blur">
                      {project.mode === 'short' ? '9:16' : '16:9'}
                    </span>
                    {project.durationSec ? (
                      <span className="absolute bottom-3 right-3 rounded-md bg-ink/80 px-2 py-1 text-[11px] font-semibold backdrop-blur">
                        {formatDuration(project.durationSec)}
                      </span>
                    ) : null}
                  </div>

                  <div className="p-4">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: style.accent }} />
                      <h3 className="truncate text-sm font-bold tracking-[-0.01em]">{project.title}</h3>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-muted">
                      <span className="capitalize">{style.name}</span>
                      <span>{project.costUsd > 0 ? formatUsd(project.costUsd) : '—'}</span>
                    </div>
                    {hashtags.length ? (
                      <p className="mt-2 truncate text-xs text-muted/70">{hashtags.slice(0, 4).join(' ')}</p>
                    ) : null}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

function StatusBadge({ status, label, progress }: { status: string; label?: string; progress: number }) {
  if (status === 'failed') {
    return <span className="px-6 text-center text-sm font-semibold text-bad">Something went wrong</span>;
  }
  if (status === 'processing') {
    return (
      <div className="w-full px-6 text-center">
        <p className="text-xs font-semibold text-muted">{label || 'Working on it'}</p>
        <div className="mx-auto mt-3 h-1.5 w-40 overflow-hidden rounded-full bg-charcoal2">
          <div className="h-full rounded-full bg-violet transition-[width]" style={{ width: `${Math.max(4, progress * 100)}%` }} />
        </div>
      </div>
    );
  }
  return <span className="text-sm text-muted">Waiting to start</span>;
}

function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  return minutes > 0 ? `${minutes}:${String(total % 60).padStart(2, '0')}` : `0:${String(total).padStart(2, '0')}`;
}
