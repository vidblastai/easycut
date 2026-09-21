import { clsx } from 'clsx';
import type { Layout } from '@/lib/edl/types';
import { layoutPlan, regionStyle } from '@/lib/styles/layouts';

/**
 * What a style will look like, drawn.
 *
 * Read from the same `layoutPlan` the Remotion composition renders from, so a
 * card cannot advertise a shape the video will not have. Names and taglines are
 * how a style picker usually works and they are close to useless: "Punchy" and
 * "Split screen" are the same amount of information until you have seen one.
 */

/** The frame the card is standing in for, so an inset comes out square. */
const FRAMES = {
  '9:16': { width: 1080, height: 1920 },
  '16:9': { width: 1920, height: 1080 },
} as const;

export function StylePreview({
  layout,
  aspect,
  accent,
  className,
  chapterCards = false,
}: {
  layout: Layout;
  aspect: '9:16' | '16:9';
  accent: string;
  className?: string;
  /**
   * Draw a title card on the preview.
   *
   * Some styles differ by cadence rather than by shape — a chaptered edit is a
   * full-frame video with a card every few seconds — and a card that only
   * draws the shape makes those styles look like duplicates of each other.
   */
  chapterCards?: boolean;
}) {
  const plan = layoutPlan(layout, FRAMES[aspect]);
  const captionTop = plan.captionY ?? 0.76;

  /*
   * A card is drawn at the moment that distinguishes the layout.
   *
   * For anything with a permanent arrangement that is any moment at all. For a
   * reaction cut it has to be mid-insert, because full frame with a face in it
   * is what every other style also looks like half the time — so the speaker
   * is drawn in the corner box rather than where they start.
   */
  const inset = plan.speakerWithBroll;
  const speakerRegion = inset ?? plan.speaker;
  const over = plan.stack === 'over';

  const speaker = (
    <div
      className="absolute overflow-hidden"
      style={{
        ...regionStyle(speakerRegion),
        background: 'radial-gradient(120% 90% at 62% 22%, #2A2A36 0%, #1A1A22 52%, #101016 100%)',
        borderRadius:
          plan.speakerShape === 'circle' ? '50%' : plan.frameRadius ? `${plan.frameRadius}%` : inset ? '5px' : undefined,
        ...(over
          ? { outline: '1.5px solid rgba(255,255,255,0.22)', boxShadow: '0 6px 16px rgba(0,0,0,.6)' }
          : null),
      }}
    >
      <Figure />
    </div>
  );

  const pictures = (
    <div
      className="absolute overflow-hidden"
      style={{
        ...(plan.broll ? regionStyle(plan.broll) : { inset: 0 }),
        borderRadius: plan.frameRadius ? `${plan.frameRadius}%` : undefined,
        background: `linear-gradient(140deg, ${accent}55, #17203A 60%, #0E1526 100%)`,
      }}
    >
      <Pictures accent={accent} />
    </div>
  );

  return (
    <div
      className={clsx('relative overflow-hidden rounded-[10px] bg-ink', className)}
      style={{ aspectRatio: aspect === '9:16' ? '9 / 16' : '16 / 9' }}
      aria-hidden
    >
      {/* A headline layout is text first — that is the whole format, so the
          card has to lead with it too or it just looks like a small video. */}
      {plan.headline ? <HeadlineBand accent={accent} /> : null}
      {chapterCards ? <ChapterCard accent={accent} /> : null}

      {/* Stacked layouts draw the picture first and the speaker on top of it;
          side-by-side layouts put them next to each other and the order does
          not matter. A `full` layout has neither, so the insert is drawn as a
          card lifted off the picture — which is what an insert that covers
          the frame looks like when you have to show both states at once. */}
      {over ? pictures : speaker}
      {over ? speaker : plan.broll ? pictures : <FloatingInsert accent={accent} />}

      <div
        className="absolute left-0 right-0 flex flex-col items-center gap-[3px] px-[8%]"
        style={{ top: `${captionTop * 100}%` }}
      >
        <span className="h-[5px] w-[68%] rounded-full bg-chalk shadow-[0_1px_3px_rgba(0,0,0,.8)]" />
        <span className="h-[5px] w-[42%] rounded-full" style={{ background: accent }} />
      </div>
    </div>
  );
}

/**
 * A title card, for the styles whose signature is the cadence of them.
 *
 * Drawn over the top of everything, which is where the renderer puts them —
 * and at the size they actually appear, so the card is not flattering.
 */
function ChapterCard({ accent }: { accent: string }) {
  return (
    <div
      className="absolute left-1/2 top-[16%] z-10 flex -translate-x-1/2 flex-col items-center gap-[4px] rounded-[6px] px-[9%] py-[5%]"
      style={{ background: 'rgba(13,13,16,.88)', outline: `1.5px solid ${accent}` }}
    >
      <span className="h-[3px] w-[16px] rounded-full" style={{ background: accent }} />
      <span className="h-[6px] w-[34px] rounded-[2px] bg-chalk" />
    </div>
  );
}

/** The band a bulletin reserves at the top, as two ruled lines of "type". */
function HeadlineBand({ accent }: { accent: string }) {
  return (
    <div className="absolute left-[5%] right-[5%] top-0 flex h-[20%] flex-col justify-center gap-[5px]">
      <span className="h-[3px] w-[28%] rounded-full" style={{ background: accent }} />
      <span className="h-[7px] w-full rounded-[2px] bg-chalk" />
      <span className="h-[7px] w-[64%] rounded-[2px] bg-chalk" />
    </div>
  );
}

/** B-roll on a full-frame layout: an insert that arrives and goes again. */
function FloatingInsert({ accent }: { accent: string }) {
  return (
    <div
      className="absolute overflow-hidden rounded-[6px] shadow-card"
      style={{
        left: '8%',
        top: '11%',
        width: '40%',
        aspectRatio: '16 / 10',
        background: `linear-gradient(140deg, ${accent}55, #17203A 60%, #0E1526 100%)`,
        outline: '1px solid rgba(255,255,255,0.14)',
      }}
    >
      <Pictures accent={accent} />
    </div>
  );
}

/** Head and shoulders, at the proportions that read as a person and not a lamp. */
function Figure() {
  return (
    <svg
      viewBox="0 0 150 150"
      preserveAspectRatio="xMidYMax meet"
      className="absolute bottom-0 left-1/2 h-[82%] -translate-x-1/2"
    >
      <path
        d="M14 150 L17 100 C20 74, 38 63, 58 62 L92 62 C112 63, 130 74, 133 100 L136 150 Z"
        fill="#3B3555"
      />
      <ellipse cx="75" cy="34" rx="20" ry="25" fill="#D9B68B" />
    </svg>
  );
}

/** Lights in the dark: the shorthand for "footage of something else". */
function Pictures({ accent }: { accent: string }) {
  return (
    <div
      className="absolute inset-0"
      style={{
        background: [
          `radial-gradient(22% 30% at 20% 72%, ${accent}cc, transparent 70%)`,
          'radial-gradient(16% 24% at 44% 84%, rgba(120,200,255,.55), transparent 70%)',
          'radial-gradient(24% 34% at 74% 68%, rgba(180,130,255,.5), transparent 70%)',
          'radial-gradient(14% 20% at 90% 82%, rgba(255,140,120,.45), transparent 70%)',
        ].join(','),
      }}
    />
  );
}
