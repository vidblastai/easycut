/**
 * "2h ago", the way a person would say it.
 *
 * Deliberately coarse. A dashboard card wants to answer "recent or old", and
 * anything more precise than that is a number nobody reads — "1 hour and 14
 * minutes ago" is the tell of an interface written by something that had the
 * data and could not think of a reason not to print it.
 */
export function relativeTime(date: Date, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));

  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w ago`;

  // Past a month the gap stops being the useful fact and the date starts being.
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
