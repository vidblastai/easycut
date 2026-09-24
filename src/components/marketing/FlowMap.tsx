import { clsx } from 'clsx';
import { LogoMark } from '@/components/Logo';
import {
  FLOW_BOX,
  flowCardVars,
  flowChipGeometry,
  flowCoreJoins,
  flowJourney,
  flowPairs,
  layOutFlow,
  type FlowNode,
} from '@/lib/ui/flowmap';

/**
 * The hero graphic: footage in on the left, finished videos out on the right.
 *
 * The whole product in one picture, which is what a hero is for. All the
 * geometry lives in `@/lib/ui/flowmap` — one table of coordinates that both
 * the SVG and the cards read, so a card cannot drift off the end of its wire.
 *
 * Static: the movement is CSS, so this stays a server component and ships no
 * JavaScript. Everything animated here respects `prefers-reduced-motion`
 * through the global rule in globals.css.
 */
/** One loop, shared by the wire's light and the clip riding it. */
const LOOP_SEC = 7.2;

export function FlowMap() {
  const nodes = layOutFlow();
  const pairs = flowPairs(nodes);
  const cards = (side: 'in' | 'out') => nodes.filter((n) => n.side === side);
  // Evenly spaced along the loop, so something is always arriving somewhere
  // and the picture never reads as finished.
  const step = LOOP_SEC / Math.max(1, pairs.length);

  return (
    <div>
      {/* The two ends, named — in their own band above the map. Inside it, the
          first card on each side sits straight on top of them. */}
      <div className="mx-auto mb-0.5 mt-3 hidden w-[min(100%,1000px,(100vh-518px)*2.0833)] items-end justify-between gap-5 px-1 lg:flex">
        <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-faint">
          Footage in
          <span className="mt-1 block text-[11px] font-medium normal-case tracking-normal text-faint">
            However you filmed it
          </span>
        </span>
        <span className="text-right text-[11px] font-bold uppercase tracking-[0.14em] text-violet">
          Videos out
          <span className="mt-1 block text-[11px] font-medium normal-case tracking-normal text-faint">
            Cut, captioned, scored
          </span>
        </span>
      </div>

      <div
        className={clsx(
          'relative mx-auto w-full',
          /*
           * Sized from the height that is LEFT, not the width available.
           *
           * This graphic only does its job if you can see it when the page
           * loads, and a fixed width means a short laptop gets the headline
           * and the top of a wire. 518px is everything stacked above it —
           * header, hero, label band, air — measured rather than guessed.
           */
          'lg:w-[min(100%,1000px,(100vh-518px)*2.0833)]',
          // Narrow: the curves are the first thing to go — four wires crossing
          // a phone-width column is a scribble. The story survives as two
          // labelled rows with the mark between them.
          'grid gap-3.5 justify-items-center',
          'lg:block lg:aspect-[1000/480]',
        )}
      >
        <svg
          viewBox={`0 0 ${FLOW_BOX.w} ${FLOW_BOX.h}`}
          fill="none"
          aria-hidden
          className="pointer-events-none absolute inset-0 hidden h-full w-full overflow-visible lg:block"
        >
          {pairs.map(([from, to], i) => {
            const d = flowJourney(from, to);
            const delay = `${(-i * step).toFixed(2)}s`;
            return (
              <g key={i}>
                <path d={d} stroke="rgba(155,123,255,.26)" strokeWidth={1.4} fill="none" />
                {/* The light that runs ahead of the clip, so a wire reads as
                    carrying something even when no clip is on it. */}
                <path
                  d={d}
                  fill="none"
                  stroke="#B39AFF"
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  className="animate-flowRun"
                  style={{
                    strokeDasharray: '26 1600',
                    opacity: 0.8,
                    filter: 'drop-shadow(0 0 4px rgba(155,123,255,.8))',
                    animationDelay: delay,
                  }}
                />
                {flowCoreJoins(from, to).map((j, k) => (
                  <circle key={k} cx={j.x} cy={j.y} r={3.6} fill="#0D0D10" stroke="rgba(155,123,255,.5)" strokeWidth={1.4} />
                ))}
                <TravellingClip path={d} ratio={from.ratio} delay={delay} />
              </g>
            );
          })}
        </svg>

        <span className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-faint lg:hidden">
          Footage in
        </span>
        <FlowRow nodes={cards('in')} />

        {/* The core. `relative` even when it is a plain grid item, because the
            glow is an absolutely positioned pseudo-element and a static parent
            would anchor it to the whole map. */}
        <div
          aria-hidden
          className={clsx(
            'relative z-[3] grid w-[84px] place-items-center rounded-[26%] border border-violet/45',
            'bg-[linear-gradient(160deg,#23233b,#16161f_60%,#101016)]',
            'shadow-[0_0_0_10px_rgba(155,123,255,.05),0_0_0_22px_rgba(155,123,255,.025),0_26px_70px_-20px_rgba(155,123,255,.5),inset_0_1px_0_rgba(255,255,255,.08)]',
            'lg:absolute lg:left-1/2 lg:top-1/2 lg:w-[15.5%] lg:-translate-x-1/2 lg:-translate-y-1/2',
            'aspect-square',
            'before:absolute before:-inset-[34%] before:-z-10 before:rounded-full before:animate-flowBreathe',
            'before:bg-[radial-gradient(circle,rgba(155,123,255,.30),transparent_68%)] before:content-[""]',
          )}
        >
          <LogoMark className="h-[46%] w-auto text-violet-hover" />
        </div>

        <span className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-violet lg:hidden">
          Videos out
        </span>
        <FlowRow nodes={cards('out')} />
      </div>
    </div>
  );
}

/**
 * A clip making the journey, plain on the way in and finished on the way out.
 *
 * It rides the same path the wire is drawn from, via `offset-path` — which on
 * an SVG element takes its coordinates in USER units and therefore scales with
 * the viewBox. The px-based CSS equivalent drifts the moment the box resizes,
 * and SMIL would have ignored the global reduced-motion rule; this is a plain
 * CSS animation, so it does not.
 */
function TravellingClip({ path, ratio, delay }: { path: string; ratio: string; delay: string }) {
  const g = flowChipGeometry(ratio);
  const figure = (
    <>
      <circle cx={0} cy={g.headY} r={g.headR} fill="#D9B68B" />
      <rect
        x={-g.bodyW / 2}
        y={g.headY + g.headR + 0.8}
        width={g.bodyW}
        height={g.bodyH}
        rx={g.bodyW / 2.6}
        fill="#3B3555"
      />
    </>
  );

  return (
    <g
      className="animate-flowTravel"
      style={{
        offsetPath: `path('${path}')`,
        offsetRotate: '0deg',
        offsetDistance: '0%',
        animationDelay: delay,
      }}
    >
      <g className="animate-flowWas" style={{ animationDelay: delay }}>
        <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={4} fill="#14141B" stroke="#2C2C36" strokeWidth={1.2} />
        {figure}
        <rect x={g.x + 3} y={g.y + g.h - 7} width={g.w - 6} height={2.4} rx={1.2} fill="#FF7B7B" opacity={0.75} />
      </g>
      <g
        className="animate-flowIs"
        style={{ animationDelay: delay, opacity: 0, filter: 'drop-shadow(0 0 5px rgba(155,123,255,.55))' }}
      >
        <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={4} fill="#16121F" stroke="#9B7BFF" strokeWidth={1.4} />
        {figure}
        <rect x={-g.w * 0.32} y={g.y + g.h - 10} width={g.w * 0.64} height={2.4} rx={1.2} fill="#F5F5F7" />
        <rect x={-g.w * 0.2} y={g.y + g.h - 6} width={g.w * 0.4} height={2.4} rx={1.2} fill="#9B7BFF" />
      </g>
    </g>
  );
}

/**
 * One side's cards.
 *
 * A real box that overlays the map on a wide screen, rather than
 * `display: contents` — a contents element generates no box, and the cards
 * inside one resolve their percentages against the wrong containing block,
 * which puts every card beside its wire instead of on it.
 */
function FlowRow({ nodes }: { nodes: FlowNode[] }) {
  return (
    <div
      className={clsx(
        'grid w-full grid-cols-3 items-start gap-2.5',
        'lg:pointer-events-none lg:absolute lg:inset-0 lg:block',
      )}
    >
      {nodes.map((node, i) => (
        <FlowCard key={`${node.side}-${i}`} node={node} index={i} />
      ))}
    </div>
  );
}

function FlowCard({ node, index }: { node: FlowNode; index: number }) {
  const out = node.side === 'out';
  return (
    <figure
      /* `m-0` is load-bearing: a <figure> carries `margin: 1em 40px` from the
         browser's own stylesheet, and that 40px puts every card exactly forty
         pixels clear of the wire it belongs to. */
      className={clsx(
        'm-0 overflow-hidden rounded-xl border bg-charcoal transition-colors',
        // The position only exists at this breakpoint; below it the card is an
        // ordinary grid item and the variables go unread.
        'lg:pointer-events-auto lg:absolute lg:animate-flowFloat',
        'lg:left-[var(--fm-x)] lg:top-[var(--fm-y)] lg:w-[var(--fm-w)]',
        out
          ? 'border-violet/50 shadow-[0_20px_50px_-18px_rgba(155,123,255,.35)] hover:border-violet'
          : 'border-line shadow-[0_18px_44px_-18px_rgba(0,0,0,.95)] hover:border-violet',
      )}
      style={{ animationDelay: `${(index * 0.7).toFixed(2)}s`, ...flowCardVars(node) } as React.CSSProperties}
    >
      <span
        className="relative block w-full"
        style={{ aspectRatio: node.ratio.replace(':', ' / ') }}
      >
        {node.src ? (
          <video
            src={node.src}
            muted
            loop
            autoPlay
            playsInline
            preload="metadata"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <FlowPlaceholder node={node} />
        )}
      </span>
      {/* 8.5px, not 9.5: "REACTION 0:47" is one pixel too wide for a 104-unit
          card at the larger size and ellipsises to "REAC…". */}
      <figcaption className="m-0 flex items-center justify-between gap-1 px-1.5 pb-1.5 pt-1 text-[8.5px] font-bold tracking-normal">
        <b className={clsx('min-w-0 truncate uppercase', out ? 'text-violet-hover' : 'text-muted')}>
          {node.kind}
        </b>
        <i className="flex-none not-italic tabular-nums text-faint">{node.len}</i>
      </figcaption>
    </figure>
  );
}

/**
 * What a card shows until there is a file to put in it.
 *
 * Drawn rather than a grey box with a filename on it: the point of this
 * graphic is "plain in, finished out", and two identical rectangles would
 * illustrate nothing. So the raw side is flat and full of the gaps we are
 * about to remove, and the finished side is graded, captioned and marked with
 * the style it was cut in.
 */
function FlowPlaceholder({ node }: { node: FlowNode }) {
  const figure = (
    <svg viewBox="0 0 150 150" preserveAspectRatio="xMidYMax meet" className="absolute bottom-0 left-1/2 h-[78%] -translate-x-1/2">
      <path d="M14 150 L17 100 C20 74, 38 63, 58 62 L92 62 C112 63, 130 74, 133 100 L136 150 Z" fill="#3B3555" />
      <ellipse cx="75" cy="34" rx="20" ry="25" fill="#D9B68B" />
    </svg>
  );
  const room = (
    <span className="absolute inset-0 bg-[radial-gradient(120%_90%_at_60%_24%,#262631_0%,#17171f_52%,#0d0d12_100%)]" />
  );

  if (node.side === 'in') {
    // The red cells are the dead air — the thing the product is for, shown
    // rather than claimed.
    const live = [1, 1, 0, 1, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1, 0, 1];
    return (
      <span className="absolute inset-0 overflow-hidden bg-[#0A0A0E] [filter:saturate(.55)_brightness(.86)]">
        {room}
        {figure}
        <span className="absolute bottom-[8%] left-[7%] right-[7%] flex h-[7px] gap-[2px] rounded p-[2px] [background:rgba(0,0,0,.45)]">
          {live.map((on, i) => (
            <i
              key={i}
              className={clsx('flex-1 rounded-sm', on ? 'bg-white/[.34]' : 'bg-[rgba(255,123,123,.8)]')}
            />
          ))}
        </span>
      </span>
    );
  }

  return (
    <span className="absolute inset-0 overflow-hidden bg-[#0A0A0E]">
      {room}
      {figure}
      <span className="absolute left-[8%] top-[9%] rounded-[5px] bg-violet/90 px-1.5 py-0.5 text-[8.5px] font-extrabold uppercase tracking-[0.02em] text-ink">
        {node.kind}
      </span>
      <span className="absolute bottom-[14%] left-[8%] right-[8%] flex flex-col items-center gap-[3px]">
        <i className="block h-1 w-[66%] rounded-full bg-chalk" />
        <i className="block h-1 w-[40%] rounded-full bg-violet" />
      </span>
      <span
        className="absolute bottom-0 left-0 h-0.5 bg-violet"
        style={{ width: `${38 + ((Math.round(node.top) * 7) % 46)}%` }}
      />
    </span>
  );
}
