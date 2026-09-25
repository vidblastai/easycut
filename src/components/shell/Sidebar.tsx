'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';
import { IconGrid, IconPlus, IconCaptions, IconSettings, IconHelp, IconSparkle } from './Icons';
import { UsageMeter } from './UsageMeter';
import { SidebarUpload } from './UploadEntry';

export interface RecentProject {
  id: string;
  title: string;
  mode: 'short' | 'long';
  status: string;
  thumbnailUrl: string | null;
}

const NAV = [
  { href: '/dashboard', label: 'Your videos', Icon: IconGrid },
  { href: '/new', label: 'New video', Icon: IconPlus },
  { href: '/captions', label: 'Caption styles', Icon: IconCaptions },
];

const NAV_FOOT = [
  { href: '/pricing', label: 'Plans', Icon: IconSparkle },
  { href: '/settings', label: 'Settings', Icon: IconSettings },
  { href: '/help', label: 'How it works', Icon: IconHelp },
];

/**
 * Persistent navigation, plus the recent projects strip.
 *
 * Recents are here rather than only on the dashboard because the thing people
 * do second-most often is go back to the video they just made, and making them
 * pass through a grid to do it adds a screen to every round trip.
 */
export function Sidebar({ recents }: { recents: RecentProject[] }) {
  const pathname = usePathname();
  const isCurrent = (href: string) =>
    href === '/dashboard' ? pathname === href : pathname.startsWith(href);

  return (
    <nav
      className={clsx(
        'flex flex-none flex-col bg-[#0B0B0E] py-3.5',
        // Wide: a real column that stays put while the page scrolls.
        'md:sticky md:w-[232px] md:border-r md:border-line-soft',
        // Narrow: a scrolling row of links under the bar, no column at all.
        'w-auto border-b border-line-soft md:border-b-0',
      )}
      style={{ top: 'var(--topbar)' }}
      data-app-nav
      aria-label="Main"
    >
      <ul className="flex gap-px overflow-x-auto px-2.5 pb-1.5 md:flex-col md:overflow-visible md:pb-0">
        {NAV.map(({ href, label, Icon }) => (
          <NavLink key={href} href={href} label={label} Icon={Icon} current={isCurrent(href)} />
        ))}

        {/* The one action this product exists for, reachable from every screen
            without first going to a page about it. Opens the file picker where
            you stand and carries the file into the wizard — see UploadEntry. */}
        <SidebarUpload />
      </ul>

      {recents.length > 0 ? (
        <div className="hidden min-h-0 flex-1 overflow-y-auto px-2.5 md:block">
          <h2 className="eyebrow mx-3 mb-1.5 mt-3">Recent</h2>
          <ul>
            {recents.map((project) => (
              <li key={project.id}>
                <Link
                  href={`/projects/${project.id}`}
                  className="flex items-center gap-2.5 rounded-[9px] px-3 py-1.5 transition-colors hover:bg-charcoal"
                >
                  <Thumb project={project} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] text-chalk">{project.title}</span>
                    <span className="text-[10.5px] text-faint">
                      {project.mode === 'short' ? 'Short · 9:16' : 'Long · 16:9'}
                    </span>
                  </span>
                  <StatusDot status={project.status} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="hidden flex-1 md:block" />
      )}

      <UsageMeter />

      <ul className="mt-1.5 hidden gap-px border-t border-line-soft px-2.5 pt-2 md:flex md:flex-col">
        {NAV_FOOT.map(({ href, label, Icon }) => (
          <NavLink key={href} href={href} label={label} Icon={Icon} current={isCurrent(href)} />
        ))}
      </ul>
    </nav>
  );
}

function NavLink({
  href,
  label,
  Icon,
  current,
}: {
  href: string;
  label: string;
  Icon: React.FC<{ className?: string }>;
  current: boolean;
}) {
  return (
    <li>
      <Link
        href={href}
        aria-current={current ? 'page' : undefined}
        className={clsx(
          'group flex items-center gap-[11px] whitespace-nowrap rounded-[9px] px-[11px] py-2.5 text-[13.5px] transition-colors md:py-[9px]',
          current
            ? 'bg-violet-dim font-semibold text-chalk'
            : 'font-medium text-muted hover:bg-charcoal hover:text-chalk',
        )}
      >
        <Icon
          className={clsx(
            'h-[17px] w-[17px] flex-none transition-colors',
            current ? 'text-violet' : 'text-faint group-hover:text-muted',
          )}
        />
        {label}
      </Link>
    </li>
  );
}

function Thumb({ project }: { project: RecentProject }) {
  const wide = project.mode === 'long';
  return (
    <span
      className={clsx(
        'relative flex-none overflow-hidden rounded-[5px] bg-gradient-to-br from-[#26263a] to-[#14141c]',
        wide ? 'h-[27px] w-12' : 'h-11 w-[34px]',
      )}
    >
      {project.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={project.thumbnailUrl} alt="" className="h-full w-full object-cover" />
      ) : null}
    </span>
  );
}

function StatusDot({ status }: { status: string }) {
  const tone =
    status === 'ready' ? 'bg-ok' : status === 'failed' ? 'bg-bad' : status === 'processing' ? 'bg-warn' : 'bg-faint';
  return <span className={clsx('h-1.5 w-1.5 flex-none rounded-full', tone)} aria-hidden />;
}
