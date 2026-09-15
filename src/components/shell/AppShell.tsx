import React from 'react';
import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { Sidebar, type RecentProject } from './Sidebar';
import { MeasureTopBar } from './MeasureTopBar';

/**
 * The frame every signed-in screen sits in: a sticky topbar, a sidebar that
 * survives navigation, and one centred column beside it.
 *
 * The centring is the point. Before it, each page laid itself out from the
 * left edge of the space next to the sidebar, so on a wide monitor the content
 * hugged the nav and trailed off into emptiness — the page read as falling off
 * its own left edge. `.measure` gives every screen the same column and the
 * same centre line.
 */

export function AppShell({
  children,
  recents = [],
  action,
  full = false,
}: {
  children: React.ReactNode;
  recents?: RecentProject[];
  /** The one primary action for this screen, rendered at the right of the topbar. */
  action?: React.ReactNode;
  /**
   * The studio claims the viewport so its timeline can dock to the bottom.
   * Every other screen scrolls normally, and forcing them all into a fixed
   * height is how a dashboard ends up with two scrollbars.
   */
  full?: boolean;
}) {
  return (
    <div className="min-h-screen">
      <MeasureTopBar />
      <header
        data-topbar
        className="sticky top-0 z-40 border-b border-line-soft bg-ink/[0.86] backdrop-blur-[14px]"
      >
        <div className="flex items-center gap-3.5 px-5 py-3 sm:px-8">
          <Link href="/" className="flex items-center rounded-md" aria-label="EasyCut home">
            <Logo size={22} />
          </Link>
          <div className="ml-auto flex items-center gap-2">{action}</div>
        </div>
      </header>

      <div className="flex items-stretch" style={{ minHeight: 'calc(100vh - var(--topbar))' }}>
        <Sidebar recents={recents} />
        <div
          className="flex min-w-0 flex-1 flex-col"
          style={full ? { height: 'calc(100vh - var(--topbar))' } : undefined}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/** The scrolling body of an ordinary screen, in the shared column. */
export function ShellMain({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-w-0 flex-1 px-4 pb-20 sm:px-8">
      <div className="measure">{children}</div>
    </main>
  );
}
