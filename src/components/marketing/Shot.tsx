import { clsx } from 'clsx';

/**
 * A frame of footage, drawn.
 *
 * Head and shoulders in flat tone, in a lit room. No features, no hair, no skin
 * detail — a stock photograph here would be a stranger appearing to endorse the
 * product, and a rendered face would be worse. A head and a shoulder line read
 * as "someone talking to camera" from across the room and claim nothing about
 * who.
 *
 * The figure is a path rather than two rounded divs, and the path says what a
 * torso is: near-vertical sides, an almost flat top, curves spent only on the
 * two shoulder corners. Four earlier attempts — rounded rectangle, wide ellipse,
 * single sweeping curve — all came out as an archway with a head balanced on
 * it, because any curve running from the bottom corner up to the neck has to
 * climb the whole height of the torso on the way.
 *
 * `graded` is the after side: warmer key, more colour in the shadows. Small and
 * deliberate, because the claim on this page is an edit, not a filter.
 */
export function Shot({
  graded,
  bare,
  wide,
  className,
}: {
  graded?: boolean;
  /** Room only. For the reframing demo, which supplies its own moving subject. */
  bare?: boolean;
  /** The same person from further back and off to one side — a second angle. */
  wide?: boolean;
  className?: string;
}) {
  return (
    <div className={clsx('shot', graded && 'shot-warm', wide && 'shot-wide', className)} aria-hidden>
      {bare ? null : <Figure className="shot-figure" />}
      <div className="shot-floor" />
      <div className="shot-sheen" />
    </div>
  );
}

/**
 * The silhouette on its own.
 *
 * Proportioned from a real medium shot rather than by eye: the head is about a
 * quarter of the frame's height with a little headroom above it, and under a
 * third of the shoulder width. Get that one ratio wrong and it stops being a
 * person and becomes a chess piece.
 */
export function Figure({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 150 150" preserveAspectRatio="xMidYMax meet" aria-hidden>
      {/* Neck first, so the shoulders and the head both close over it. */}
      <rect className="shot-skin" x="64" y="48" width="22" height="20" rx="9" />
      <path
        className="shot-body"
        d="M14 150 L17 100 C20 74, 38 63, 58 62 L92 62 C112 63, 130 74, 133 100 L136 150 Z"
      />
      <ellipse className="shot-skin" cx="75" cy="30" rx="20.8" ry="26" />
    </svg>
  );
}

/** What the B-roll layer cuts in: a city after dark, as lights rather than buildings. */
export function BrollArt({ className }: { className?: string }) {
  return <div className={clsx('shot-broll', className)} aria-hidden />;
}
