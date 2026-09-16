import Link from 'next/link';
import { clsx } from 'clsx';
import { AppShell, ShellMain } from '@/components/shell/AppShell';
import { IconPlus } from '@/components/shell/Icons';
import { NewProjectBanner } from '@/components/NewProjectBanner';
import { db } from '@/lib/db';
import { formatUsd } from '@/lib/pricing/cost';
import { getStyle } from '@/lib/styles/presets';
import { recentsFor } from '@/lib/ui/recents';
import { relativeTime } from '@/lib/ui/relative-time';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const projects = await db.project
    .findMany({
      orderBy: { createdAt: 'desc' },
      take: 60,
      include: { jobs: { orderBy: { queuedAt: 'desc' }, take: 1 } },
    })
    .catch(() => []);

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
        {/* Make one, then the ones you already made. Nothing in between: a
            heading repeating the nav item that is already highlighted, over a
            row of totals nobody opened this page for, is a screen's worth of
            scrolling between the person and their own work. */}
        <div className="pt-6">
          <NewProjectBanner />
        </div>

        {projects.length === 0 ? (
          <Empty />
        ) : (
          <ul className="mt-6 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {projects.map((project) => {
              const job = project.jobs[0];
              const style = getStyle(project.styleId);

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
                      <Frame project={project} />
                      {/* No aspect badge. The thumbnail inside the tile is
                          drawn at the video's real shape, so a chip reading
                          "9:16" over a visibly vertical frame is the interface
                          telling you what you can already see. */}
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
                      <Meta
                        status={project.status}
                        styleName={style.name}
                        createdAt={project.createdAt}
                        costUsd={project.costUsd}
                        label={job?.progressLabel}
                        progress={job?.progress ?? 0}
                      />
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

/** The video's real shape, drawn inside the uniform tile. */
function Frame({ project }: { project: { mode: string; thumbnailUrl: string | null; status: string } }) {
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

  // No stage label and no progress bar up here: the line under the title
  // already carries both, and a card that reports the same thing twice reads
  // as a layout that could not decide. What this owes the grid is the video's
  // shape, so the rows keep their rhythm while there is nothing to show yet.
  return (
    <span
      className={clsx(
        'block rounded-md border border-dashed',
        project.status === 'failed' ? 'border-bad/30' : 'border-line',
        wide ? 'h-[72%]' : 'h-[76%]',
      )}
      style={{ aspectRatio: wide ? '16 / 9' : '9 / 16' }}
    />
  );
}

/**
 * The line under the title.
 *
 * A finished video says nothing about being finished. Four cards in a row each
 * carrying a green dot and the word "Ready" is an interface reporting its own
 * success back at you — it costs a line on every card to tell you the thing
 * that is true of almost all of them. So "ready" is the silent state, and the
 * line carries what you would actually want: what look it was cut in, and how
 * long ago.
 *
 * Colour is spent only where there is something to act on. Still working gets
 * the stage it is on and a bar; failed gets the one red thing on the screen.
 */
function Meta({
  status,
  styleName,
  createdAt,
  costUsd,
  label,
  progress,
}: {
  status: string;
  styleName: string;
  createdAt: Date;
  costUsd: number;
  label?: string;
  progress: number;
}) {
  if (status === 'failed') {
    return (
      <p className="mt-1.5 truncate text-[11.5px] font-semibold text-bad">
        Didn&rsquo;t finish &mdash; open it to see why
      </p>
    );
  }

  if (status === 'processing' || status === 'draft') {
    return (
      <div className="mt-1.5">
        <div className="flex items-center justify-between gap-2 text-[11.5px]">
          <span className="truncate text-chalk">{label || 'Getting started'}</span>
          <span className="flex-none tabular-nums text-faint">{Math.round(progress * 100)}%</span>
        </div>
        <span className="mt-1.5 block h-[3px] overflow-hidden rounded-full bg-ink">
          <span
            className="block h-full rounded-full bg-violet transition-[width] duration-500"
            style={{ width: `${Math.max(4, progress * 100)}%` }}
          />
        </span>
      </div>
    );
  }

  return (
    <div className="mt-1.5 flex items-baseline justify-between gap-2 text-[11.5px] text-muted">
      <span className="truncate">
        {styleName} &middot; {relativeTime(createdAt)}
      </span>
      {/* `formatUsd` keeps four decimals under a cent because the cost ledger
          exists to make fractions of a cent visible. On a card that is machine
          output: "$0.0006" is not a number anyone reads, it is a number
          something printed. Under a cent, say nothing. */}
      {costUsd >= 0.01 ? (
        <span className="flex-none tabular-nums text-faint">{formatUsd(costUsd)}</span>
      ) : null}
    </div>
  );
}

function Empty() {
  return (
    <div className="mt-6 rounded-[14px] border border-dashed border-line px-6 py-12 text-center">
      <p className="text-[14px] font-bold">Nothing here yet.</p>
      <p className="mx-auto mt-1.5 max-w-md text-[13px] text-muted">
        Point a camera at yourself, talk for thirty seconds, and drop the file above. You&rsquo;ll have
        a postable video before you&rsquo;ve finished making coffee.
      </p>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  return minutes > 0 ? `${minutes}:${String(total % 60).padStart(2, '0')}` : `0:${String(total).padStart(2, '0')}`;
}
