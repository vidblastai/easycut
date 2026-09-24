import { clsx } from 'clsx';
import { LogoMark } from '@/components/Logo';
import {
  FLOW_BOX,
  FLOW_LANES,
  FLOW_RAIL,
  FLOW_SIZE,
  flowClips,
  flowRing,
  flowWire,
  type FlowLane,
} from '@/lib/ui/flowmap';

/**
 * The hero graphic: footage arrives at one edge of the window, rides a wire
 * through the mark, and leaves the other edge edited.
 *
 * Nothing rests on either side — the mark is the only fixed thing on screen.
 * All the geometry lives in `@/lib/ui/flowmap`: one table of lanes that both
 * the SVG and the cards read, so a clip cannot drift off the wire it rides.
 *
 * A server component. Every movement here is a CSS animation declared in the
 * Tailwind config, so the hero ships no JavaScript and the global
 * reduced-motion rule in globals.css already switches it off.
 */
export function FlowMap() {
  const clips = flowClips();

  return (
    <div
      className={clsx(
        // Full bleed: wires that stop at a content column look like a pipeline
        // that starts and ends on the page.
        'relative w-screen ml-[calc(50%-50vw)]',
        // Narrow: wires across a phone-width column are a scribble, and a clip
        // crossing one is gone before you have read it. The same sentence,
        // stacked, instead.
        'grid justify-items-center gap-4',
        'lg:block lg:aspect-[2000/520]',
      )}
      aria-label="Raw footage goes in, finished videos come out"
    >
      <svg
        viewBox={`0 0 ${FLOW_BOX.w} ${FLOW_BOX.h}`}
        fill="none"
        aria-hidden
        className="pointer-events-none absolute inset-0 hidden h-full w-full overflow-visible lg:block"
      >
        {FLOW_LANES.map((lane, i) => {
          const d = flowWire(lane);
          const ring = flowRing(lane, i);
          return (
            <g key={i}>
              <path d={d} stroke="rgba(155,123,255,.42)" strokeWidth={1.8} fill="none" />
              {ring ? (
                <circle cx={ring.x} cy={ring.y} r={9} fill="#0D0D10" stroke="rgba(155,123,255,.6)" strokeWidth={1.8} />
              ) : null}
              {/* A lane with no clip still has to show which way it runs. */}
              {lane.ratio ? null : (
                <path
                  d={d}
                  fill="none"
                  stroke="#B39AFF"
                  strokeWidth={2.2}
                  strokeLinecap="round"
                  className="animate-flowDrift"
                  style={{
                    strokeDasharray: '30 2400',
                    opacity: 0.55,
                    filter: 'drop-shadow(0 0 5px rgba(155,123,255,.75))',
                    animationDelay: `${(-i * 1.9).toFixed(2)}s`,
                  }}
                />
              )}
            </g>
          );
        })}

        {clips.map(({ lane, delay }, i) => (
          <TravellingClip key={`clip-${i}`} lane={lane} delay={delay} />
        ))}
      </svg>

      {/* The mark. `relative` even as a plain grid item, because the halo is
          two absolutely positioned pseudo-elements inset past its edges and a
          static parent would anchor them to the whole map. */}
      <div
        aria-hidden
        className={clsx(
          'relative z-[3] order-2 grid w-[76px] place-items-center rounded-[28%] border border-violet/50',
          'aspect-square bg-[linear-gradient(155deg,#2b2b45,#1a1a26_58%,#121218)]',
          'shadow-[0_24px_64px_-18px_rgba(155,123,255,.55),inset_0_1px_0_rgba(255,255,255,.09)]',
          'lg:absolute lg:left-1/2 lg:top-1/2 lg:w-[10.1%] lg:-translate-x-1/2 lg:-translate-y-1/2',
          // The soft square halo, 1.55× the tile — two stops of the same
          // violet rather than one blur, which is how the reference reads.
          'before:absolute before:-inset-[27.5%] before:-z-10 before:rounded-[30%] before:animate-flowBreathe before:content-[""]',
          'before:bg-[radial-gradient(closest-side,rgba(155,123,255,.34),rgba(155,123,255,.16)_58%,transparent_76%)]',
          'after:absolute after:-inset-[12%] after:-z-10 after:rounded-[30%] after:content-[""]',
          'after:bg-[radial-gradient(closest-side,rgba(155,123,255,.30),transparent_82%)]',
        )}
      >
        <LogoMark className="h-[44%] w-auto text-violet-hover" />
      </div>

      {/* The phone's version: before above, after below.

          Two columns, fixed. `auto-fit` looked like the tidy answer and was
          not: it fits as many tracks as the phone allows, so four pairs came
          out three and one, with the last pair alone on a row of its own. */}
      <div className="order-3 grid w-full grid-cols-2 gap-x-3 gap-y-[18px] px-4 lg:hidden">
        {clips.map(({ lane }, i) => (
          <span key={`stack-${i}`} className="grid justify-items-center gap-1.5">
            <Slot>
              <ClipCard lane={lane} state="raw" />
            </Slot>
            <span aria-hidden className="text-[13px] leading-none text-violet">↓</span>
            <Slot>
              <ClipCard lane={lane} state="done" />
            </Slot>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * One cell of the phone's grid.
 *
 * Every card sits in a slot of the same height, so the arrows across a row
 * line up however differently the two shapes fill it: a vertical clip is sized
 * by that height, and a widescreen one runs out of column width first, where
 * the card's own `max-w-full` takes over.
 */
function Slot({ children }: { children: React.ReactNode }) {
  return <span className="grid h-[148px] w-full place-items-center">{children}</span>;
}

/**
 * A clip riding a wire: the same frame drawn twice, plain and finished,
 * cross-faded exactly where the tile hides it.
 *
 * `offset-path` on an SVG element takes its coordinates in USER units, so it
 * scales with the viewBox; the px-based CSS equivalent drifts the moment the
 * box resizes. A `<foreignObject>` carries the ordinary HTML card inside it,
 * so the slot can still hold a real `<video>`.
 */
function TravellingClip({ lane, delay }: { lane: FlowLane; delay: string }) {
  const size = FLOW_SIZE[lane.ratio!];
  return (
    <g
      className="animate-flowTravel"
      style={{
        offsetPath: `path('${flowWire(lane)}')`,
        offsetRotate: '0deg',
        offsetDistance: '0%',
        animationDelay: delay,
      }}
    >
      <foreignObject x={-size.w / 2} y={-size.h / 2} width={size.w} height={size.h}>
        <span
          {...{ xmlns: 'http://www.w3.org/1999/xhtml' }}
          className="relative block h-full w-full overflow-hidden rounded-[11px] bg-charcoal shadow-[0_16px_40px_-14px_rgba(0,0,0,.95)]"
        >
          <ClipCard lane={lane} state="raw" delay={delay} inline />
          <ClipCard lane={lane} state="done" delay={delay} inline />
        </span>
      </foreignObject>
    </g>
  );
}

/**
 * One state of a clip.
 *
 * `inline` means it is one of the two stacked layers inside a travelling card
 * and animates; without it the card stands alone, which is what the phone's
 * before-and-after pairs use.
 *
 * The delay is stamped here as well as on the travelling group, and it has to
 * be: `animation-delay: inherit` resolves against the parent's COMPUTED value,
 * and the parent is a card inside a `<foreignObject>` that never had one — so
 * every clip travelled on its own clock and changed from raw to finished on a
 * shared one.
 */
function ClipCard({
  lane,
  state,
  delay,
  inline,
}: {
  lane: FlowLane;
  state: 'raw' | 'done';
  delay?: string;
  inline?: boolean;
}) {
  const done = state === 'done';
  const src = done ? (lane.srcDone ?? lane.src) : lane.src;

  const shell = clsx(
    'overflow-hidden rounded-[11px]',
    inline ? 'absolute inset-0' : 'relative block h-auto',
    done
      ? 'shadow-[inset_0_0_0_1.5px_rgba(155,123,255,.75),0_0_22px_rgba(155,123,255,.25)]'
      : 'shadow-[inset_0_0_0_1px_#2C2C36] [filter:saturate(.55)]',
    inline && (done ? 'opacity-0 animate-flowIs' : 'animate-flowWas'),
  );
  const style = {
    ...(inline ? { animationDelay: delay } : null),
    // Width, not height: with a definite height an `aspect-ratio` box that hits
    // its `max-width` keeps the height and loses the ratio, so a widescreen
    // card stretched square on a narrow phone. Sized by width, the height
    // follows from the ratio however hard the column squeezes it.
    ...(inline
      ? null
      : {
          aspectRatio: lane.ratio!.replace(':', ' / '),
          width: `min(${FLOW_RAIL[lane.ratio!]}px, 100%)`,
        }),
  };

  if (src) {
    return (
      <video
        src={src}
        muted
        loop
        autoPlay
        playsInline
        preload="metadata"
        className={clsx(shell, 'h-full w-full object-cover')}
        style={style}
      />
    );
  }

  return (
    <span className={clsx(shell, 'bg-[#0A0A0E]')} style={style}>
      <span
        className={clsx(
          'absolute inset-0',
          done
            ? 'bg-[radial-gradient(120%_90%_at_60%_22%,#3b3352_0%,#251f38_52%,#16111f_100%)]'
            : 'bg-[radial-gradient(120%_90%_at_60%_22%,#35354a_0%,#22222f_52%,#15151c_100%)]',
        )}
      />
      {/* `max-w` matters: the drawing is square, so on a vertical clip its
          natural width is wider than the card. Clipped it looked fine, and
          still stretched the page sideways on a phone. */}
      <svg
        viewBox="0 0 150 150"
        preserveAspectRatio="xMidYMax meet"
        className="absolute bottom-0 left-1/2 h-[74%] w-auto max-w-[92%] -translate-x-1/2"
      >
        <path d="M14 150 L17 100 C20 74, 38 63, 58 62 L92 62 C112 63, 130 74, 133 100 L136 150 Z" fill="#453E68" />
        <ellipse cx="75" cy="34" rx="20" ry="25" fill="#D9B68B" />
      </svg>

      {done ? (
        <>
          <span className="absolute left-[7%] top-[7%] whitespace-nowrap rounded-[5px] bg-violet px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.01em] text-ink">
            {lane.done}
          </span>
          <span className="absolute bottom-[15%] left-[8%] right-[8%] flex flex-col items-center gap-[3px]">
            <i className="block h-[3.5px] w-[64%] rounded-full bg-chalk" />
            <i className="block h-[3.5px] w-[38%] rounded-full bg-violet" />
          </span>
          <span className="absolute bottom-0 left-0 h-[2.5px] w-[62%] bg-violet" />
        </>
      ) : (
        /* The gaps a raw take is full of. The red cells are the dead air —
           the thing the product is for, shown rather than claimed. */
        <span className="absolute bottom-[9%] left-[8%] right-[8%] flex h-[6px] gap-[1.5px] rounded-[3px] bg-black/50 p-[1.5px]">
          {[1, 1, 0, 1, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1, 0, 1].map((live, i) => (
            <i
              key={i}
              className={clsx('flex-1 rounded-[1.5px]', live ? 'bg-white/[.34]' : 'bg-[rgba(255,123,123,.85)]')}
            />
          ))}
        </span>
      )}
    </span>
  );
}
