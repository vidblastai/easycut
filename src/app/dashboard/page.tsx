import Link from 'next/link';
import { clsx } from 'clsx';
import { AppShell, ShellMain } from '@/components/shell/AppShell';
import { IconPlus } from '@/components/shell/Icons';
import { db, parseJson } from '@/lib/db';
import { formatUsd, formatUsdCoarse } from '@/lib/pricing/cost';
import { getStyle } from '@/lib/styles/presets';
import { recentsFor } from '@/lib/ui/recents';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const projects = await db.project
    .findMany({
      orderBy: { createdAt: 'desc' },
      take: 60,
      include: { jobs: { orderBy: { queuedAt: 'desc' }, take: 1 } },
    })
    .catch(() => []);

  const ready = projects.filter((p) => p.status === 'ready');
  const totalSpend = projects.reduce((sum, p) => sum + p.costUsd, 0);
  const minutes = ready.reduce((sum, p) => sum + (p.durationSec ?? 0), 0) / 60;

  return (
    <AppShell
      recents={recentsFor(projects)}
      action={
        <Link href="/new" className="btn-primary">
          <IconPlus className="h-4 w-4" />
          New video
        </Link>
      }
    >
      <ShellMain>
        <div className="flex flex-wrap items-end justify-between gap-4 pt-7">
          <div>
            <h1 className="text-[28px] font-extrabold">Your videos</h1>
            <p className="mt-1 text-[13.5px] text-muted">
              {projects.length === 0
                ? 'Nothing here yet.'
                : `${projects.length} project${projects.length === 1 ? '' : 's'}`}
            </p>
          </div>
        </div>

        {projects.length > 0 ? (
          <Kpis
            videos={projects.length}
            finished={ready.length}
            minutes={minutes}
            spend={totalSpend}
          />
        ) : null}

        {projects.length === 0 ? (
          <Empty />
        ) : (
          <ul className="mt-5 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {projects.map((project) => {
              const job = project.jobs[0];
              const style = getStyle(project.styleId);
              const hashtags = parseJson<string[]>(project.hashtags, []);

              return (
                <li key={project.id}>
                  <Link
                    href={`/projects/${project.id}`}
                    className={clsx(
                      'group block overflow-hidden rounded-[14px] border border-line bg-charcoal',
                      'transition-[transform,border-color,box-shadow] duration-200',
                      'hover:-translate-y-0.5 hover:border-violet/40 hover:shadow-card active:translate-y-0',
                    )}
                    style={{ transitionTimingFunction: 'var(--ease)' }}
                  >
                    {/* Every tile is the same 16:9 box whatever the video's
                        shape. Letting a 9:16 thumbnail set its own height is
                        what tore the grid's rows apart — so the real format is
                        drawn inside the tile as a nested frame instead. */}
                    <div className="relative grid aspect-video place-items-center bg-ink">
                      <Frame project={project} label={job?.progressLabel} progress={job?.progress ?? 0} />
                      <span className="absolute left-2.5 top-2.5 rounded-md bg-ink/80 px-1.5 py-0.5 text-[10.5px] font-semibold backdrop-blur">
                        {project.mode === 'short' ? '9:16' : '16:9'}
                      </span>
                      {project.durationSec ? (
                        <span className="absolute bottom-2.5 right-2.5 rounded-md bg-ink/80 px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums backdrop-blur">
                          {formatDuration(project.durationSec)}
                        </span>
                      ) : null}
                    </div>

                    <div className="px-3.5 pb-3.5 pt-2.5">
                      <b className="block truncate text-[13px] font-bold tracking-[-0.01em]">
                        {project.title}
                      </b>
                      <div className="mt-1.5 flex items-center justify-between text-[11.5px] text-muted">
                        <Status status={project.status} label={job?.progressLabel} />
                        <span className="tabular-nums">
                          {project.costUsd > 0 ? formatUsd(project.costUsd) : '—'}
                        </span>
                      </div>
                      <p className="mt-1.5 flex items-center gap-1.5 truncate text-[11px] text-faint">
                        <span
                          className="h-1.5 w-1.5 flex-none rounded-full"
                          style={{ background: style.accent }}
                          aria-hidden
                        />
                        {style.name}
                        {hashtags.length ? ` · ${hashtags.slice(0, 3).join(' ')}` : ''}
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </ShellMain>
    </AppShell>
  );
}

/**
 * One hairline-split surface rather than four bordered cards.
 *
 * Border, radius and fill each say "separate object", and four of them in a
 * row said it four times about numbers that are one summary.
 */
function Kpis({
  videos,
  finished,
  minutes,
  spend,
}: {
  videos: number;
  finished: number;
  minutes: number;
  spend: number;
}) {
  const cells = [
    { label: 'Videos', value: String(videos), note: `${finished} finished` },
    { label: 'Minutes made', value: minutes >= 10 ? minutes.toFixed(0) : minutes.toFixed(1), note: 'Total runtime' },
    { label: 'Spent', value: formatUsdCoarse(spend), note: 'Across every render' },
    {
      label: 'Average',
      value: videos ? formatUsdCoarse(spend / videos) : '—',
      note: 'Per video',
    },
  ];

  return (
    <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-[14px] bg-line-soft sm:grid-cols-4">
      {cells.map((cell) => (
        <div key={cell.label} className="bg-charcoal px-[17px] py-[15px]">
          <dt className="eyebrow">{cell.label}</dt>
          <dd className="mt-1.5 text-[23px] font-extrabold tabular-nums tracking-[-0.035em]">
            {cell.value}
          </dd>
          <p className="mt-0.5 text-[11.5px] text-muted">{cell.note}</p>
        </div>
      ))}
    </dl>
  );
}

/** The video's real shape, drawn inside the uniform tile. */
function Frame({
  project,
  label,
  progress,
}: {
  project: { mode: string; thumbnailUrl: string | null; status: string };
  label?: string;
  progress: number;
}) {
  const wide = project.mode === 'long';

  if (project.thumbnailUrl) {
    return (
      <span
        className={clsx(
          'relative block overflow-hidden rounded-md',
          wide ? 'h-[72%]' : 'h-[76%]',
        )}
        style={{ aspectRatio: wide ? '16 / 9' : '9 / 16' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={project.thumbnailUrl}
          alt=""
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
        />
      </span>
    );
  }

  if (project.status === 'failed') {
    return <span className="px-6 text-center text-[12px] font-semibold text-bad">Something went wrong</span>;
  }

  if (project.status === 'processing') {
    return (
      <span className="block w-full px-6 text-center">
        <span className="block text-[11.5px] font-semibold text-muted">{label || 'Working on it'}</span>
        <span className="mx-auto mt-2.5 block h-1 w-32 overflow-hidden rounded-full bg-charcoal2">
          <span
            className="block h-full rounded-full bg-violet transition-[width] duration-500"
            style={{ width: `${Math.max(4, progress * 100)}%` }}
          />
        </span>
      </span>
    );
  }

  return (
    <span
      className={clsx(
        'block rounded-md border border-dashed border-line',
        wide ? 'h-[72%]' : 'h-[76%]',
      )}
      style={{ aspectRatio: wide ? '16 / 9' : '9 / 16' }}
    />
  );
}

/**
 * Status reads as colour first.
 *
 * The tone comes from a lookup rather than a ternary inside a template string,
 * which is how the third state ended up the same grey as the first.
 */
function Status({ status, label }: { status: string; label?: string }) {
  const tone =
    status === 'ready'
      ? { dot: 'bg-ok', text: 'text-ok', word: 'Ready' }
      : status === 'failed'
        ? { dot: 'bg-bad', text: 'text-bad', word: 'Failed' }
        : status === 'processing'
          ? { dot: 'bg-warn', text: 'text-warn', word: label || 'Editing' }
          : { dot: 'bg-faint', text: 'text-muted', word: 'Queued' };

  return (
    <span className={clsx('flex items-center gap-1.5 font-semibold', tone.text)}>
      <span className={clsx('h-1.5 w-1.5 flex-none rounded-full', tone.dot)} aria-hidden />
      <span className="truncate">{tone.word}</span>
    </span>
  );
}

function Empty() {
  return (
    <div className="card mt-5 px-6 py-14 text-center">
      <h2 className="text-[19px] font-bold">Upload something and see what happens.</h2>
      <p className="mx-auto mt-2 max-w-md text-[13.5px] text-muted">
        Point a camera at yourself, talk for thirty seconds, and drop the file in. You&rsquo;ll have a
        postable video before you&rsquo;ve finished making coffee.
      </p>
      <Link href="/new" className="btn-primary mt-6">
        Upload your footage
      </Link>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  return minutes > 0 ? `${minutes}:${String(total % 60).padStart(2, '0')}` : `0:${String(total).padStart(2, '0')}`;
}
