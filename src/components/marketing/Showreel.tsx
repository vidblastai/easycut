import Link from 'next/link';
import { SHOWCASE } from '@/content/showcase';
import { STYLE_PRESETS, leadsWithCards, type StyleId } from '@/lib/styles/presets';
import { StylePreview } from '@/components/styles/StylePreview';
import { Showcase } from '@/components/marketing/Showcase';

/**
 * The showreel: what comes out the other end.
 *
 * ── Why these are drawn and not filmed ──────────────────────────────────
 *
 * This is the most persuasive thing a video product can put on its homepage
 * and also the easiest to fake. A stock clip captioned "made with EasyCut" is
 * a claim about output quality that nobody can check and that is not true.
 *
 * So every card here is drawn by `StylePreview` — the same component the
 * app's own picker uses, reading the same layout plan the renderer executes.
 * It is a simulation of the edit rather than somebody else's video with our
 * name on it, and it cannot advertise a shape the renderer will not produce.
 *
 * The moment `src/content/showcase.ts` has real exports in it, those take the
 * section over instead: see the swap at the top of the component.
 *
 * Tapping a card carries that style into the upload flow, so the reel is a
 * way in rather than a display case.
 */

interface Cut {
  title: string;
  style: StyleId;
  len: string;
}

const SHORTS: Cut[] = [
  { title: 'Pricing, backwards', style: 'punchy', len: '0:34' },
  { title: 'Reacting to my own ad', style: 'reaction', len: '0:48' },
  { title: 'The comment that started it', style: 'commentary', len: '1:02' },
  { title: 'One day, one launch', style: 'vlog', len: '0:57' },
];

const LONGS: Cut[] = [
  { title: 'Setting the whole thing up', style: 'tutorial', len: '6:12' },
  { title: 'Q4 numbers, explained', style: 'sidebar', len: '11:40' },
];

/** One loop of the progress line, in seconds — matches the prototype's reel. */
const LOOP = 5.6;

export function Showreel() {
  // Real exports beat drawn ones the moment there are any.
  if (SHOWCASE.length) return <Showcase />;

  const shorts = SHORTS.filter((c) => STYLE_PRESETS[c.style]);
  const longs = LONGS.filter((c) => STYLE_PRESETS[c.style]);
  const total = shorts.length + longs.length;

  return (
    <section className="relative z-10 border-t border-line py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-[760px] text-center">
          <span className="eyebrow inline-flex items-center gap-2 text-violet">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-violet" />
            The showreel
          </span>
          <h2 className="mt-3 text-3xl font-extrabold leading-[1.1] tracking-[-0.03em] sm:text-[40px]">
            These cuts came out of EasyCut.
          </h2>
          <p className="mx-auto mt-4 max-w-[58ch] text-muted">
            Vertical for Reels and Shorts, widescreen for YouTube — you upload the footage for
            the one you are making. One upload each, no editor, no timeline. Tap one to start
            from that style with your own footage.
          </p>
        </div>

        <div className="mt-9 grid grid-cols-2 gap-3.5 sm:grid-cols-4">
          {shorts.map((cut, i) => (
            <ReelCard key={cut.style} cut={cut} aspect="9:16" index={i} total={total} />
          ))}
        </div>

        {/* A rule with a label in it, because the second row is the same
            editor on a different shape — not a second product. */}
        <div className="mt-7 flex items-center gap-3.5">
          <span aria-hidden className="h-px flex-1 bg-line-soft" />
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-faint">
            Long form, the same editor
          </span>
          <span aria-hidden className="h-px flex-1 bg-line-soft" />
        </div>

        <div className="mt-3.5 grid gap-3.5 sm:grid-cols-2">
          {longs.map((cut, i) => (
            <ReelCard
              key={cut.style}
              cut={cut}
              aspect="16:9"
              index={shorts.length + i}
              total={total}
            />
          ))}
        </div>

        <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
          <Link href="/new" className="btn-primary px-6 py-3 text-[14.5px]">
            Cut mine like this
          </Link>
          <span className="text-[13px] text-muted">
            Every style re-renders for free, so picking one is never a one-way door.
          </span>
        </div>
      </div>
    </section>
  );
}

function ReelCard({
  cut,
  aspect,
  index,
  total,
}: {
  cut: Cut;
  aspect: '9:16' | '16:9';
  index: number;
  total: number;
}) {
  const style = STYLE_PRESETS[cut.style];
  // A style that does not do this format would be a claim the app refuses, so
  // the card follows the style rather than the wish.
  const mode = aspect === '9:16' ? 'short' : 'long';
  const drawn = style.formats.includes(mode) ? aspect : aspect === '9:16' ? '16:9' : '9:16';

  return (
    <Link
      href={`/new?style=${style.id}`}
      aria-label={`${cut.title} — cut in the ${style.name} style`}
      className="group block overflow-hidden rounded-xl border border-line bg-charcoal transition-[transform,border-color] duration-200 hover:-translate-y-[3px] hover:border-violet focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <span className="relative block">
        <StylePreview
          layout={style.layout}
          aspect={drawn}
          accent={style.accent}
          chapterCards={leadsWithCards(style, mode)}
          className="w-full"
        />

        <span className="pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-md bg-ink/80 px-2 py-1 text-[11px] font-bold text-chalk backdrop-blur">
          <span aria-hidden className="h-[5px] w-[5px] rounded-full" style={{ background: style.accent }} />
          {style.name}
        </span>

        {/* The line that says this is a video and not a screenshot. Each card
            is offset by its share of one loop, so the wall does not pulse in
            unison — six cards hitting the same beat reads as one animation
            rather than six videos. */}
        <span
          aria-hidden
          className="animate-reelProgress absolute bottom-0 left-0 z-[5] h-[2px] bg-violet motion-reduce:hidden"
          style={{ animationDelay: `-${(index * LOOP) / total}s` }}
        />
      </span>

      <span className="block px-3 py-2.5 text-[12.5px] font-semibold leading-snug text-chalk">
        {cut.title} <i className="not-italic font-medium text-faint">· {cut.len}</i>
      </span>
    </Link>
  );
}
