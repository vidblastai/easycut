import { clsx } from 'clsx';

/**
 * A person's face, in one place.
 *
 * Two states, and swapping between them is one field:
 *
 *   <Avatar name="Marcus Reed" />                     → drawn
 *   <Avatar name="Marcus Reed" photo="/people/m.jpg" /> → photographed
 *
 * ── Why the drawn one is drawn and not a stock portrait ──────────────────
 *
 * A stock portrait beside a named quote is a photograph of a real person who
 * never said it. The drawn one is obviously a stand-in, costs nothing, loads
 * instantly, and holds the layout at exactly the size the real photograph
 * will occupy — so dropping the photographs in later changes nothing about
 * the page except the faces.
 *
 * ── Why the same name always gets the same face ──────────────────────────
 *
 * The face is picked from the name, not from the list position. Reorder the
 * reviews and nobody's face follows somebody else's name — which, on a page
 * where the face and the name are meant to be one person, is the difference
 * between a stand-in and a bug.
 */

/** Skin, shirt and backdrop per face. Six people, visibly different. */
export const FACES = [
  { skin: '#E8C9A0', shirt: '#4A4370', room: '#2A2440' },
  { skin: '#8D5C3D', shirt: '#3C5A6E', room: '#1F3242' },
  { skin: '#F0D5B4', shirt: '#5A4A6E', room: '#332A47' },
  { skin: '#6B4530', shirt: '#4C6A55', room: '#23392E' },
  { skin: '#D8A87C', shirt: '#6A4A63', room: '#3D2A3A' },
  { skin: '#C08A5E', shirt: '#4A5A78', room: '#252F45' },
] as const;

/** Stable index from a name, so a face belongs to a person rather than a slot. */
export function faceFor(name: string): (typeof FACES)[number] {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return FACES[h % FACES.length];
}

/** The drawn figure alone, for callers that supply their own frame. */
export function DrawnFace({ name, className }: { name: string; className?: string }) {
  const f = faceFor(name);
  return (
    <svg viewBox="0 0 40 40" aria-hidden className={clsx('block h-full w-full', className)}>
      <rect width="40" height="40" fill={f.room} />
      {/* Shoulders run the full width of the disc. Stopped short they read as
          a hill behind a head rather than a person in a frame. */}
      <path d="M0 40 C1 29.5, 9 24.5, 20 24.5 C31 24.5, 39 29.5, 40 40 Z" fill={f.shirt} />
      <ellipse cx="20" cy="15.5" rx="7.2" ry="8" fill={f.skin} />
    </svg>
  );
}

export function Avatar({
  name,
  photo,
  className,
}: {
  name: string;
  /** A path under /public. Replaces the drawing, same size, same position. */
  photo?: string | null;
  className?: string;
}) {
  return (
    <span className={clsx('block flex-none overflow-hidden rounded-full', className)}>
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt="" className="h-full w-full object-cover" />
      ) : (
        <DrawnFace name={name} />
      )}
    </span>
  );
}
