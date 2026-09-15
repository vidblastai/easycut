import type { RecentProject } from '@/components/shell/Sidebar';

/**
 * The sidebar's recent list, from whatever the page already loaded.
 *
 * Shared so a page never fires a second query for rows it is holding, and so
 * the sidebar's shape is defined once instead of being re-derived (slightly
 * differently) on each screen.
 */
export function recentsFor(
  projects: Array<{
    id: string;
    title: string;
    mode: string;
    status: string;
    thumbnailUrl: string | null;
  }>,
  limit = 8,
): RecentProject[] {
  return projects.slice(0, limit).map((p) => ({
    id: p.id,
    title: p.title,
    mode: p.mode === 'long' ? 'long' : 'short',
    status: p.status,
    thumbnailUrl: p.thumbnailUrl,
  }));
}
