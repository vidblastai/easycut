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
}: {
  layout: Layout;
  aspect: '9:16' | '16:9';
  accent: string;
  className?: string;
}) {
  const plan = layoutPlan(layout, FRAMES[aspect]);
  const captionTop = plan.captionY ?? 0.76;

  /*
   * A reaction cut is drawn mid-insert, which is the only frame that tells you
   * anything: full frame with a face in it is what every other style also looks
   * like half the time. So the picture takes the whole card and the speaker is
   * in their corner box — the state the name is promising.
   */
  const inset = plan.speakerWithBroll;

  const speaker = (
    <div
      className={clsx('absolute overflow-hidden', inset && 'rounded-[5px]')}
      style={{
        ...regionStyle(inset ?? plan.speaker),
        background: 'radial-gradient(120% 90% at 62% 22%, #2A2A36 0%, #1A1A22 52%, #101016 100%)',
        ...(inset
          ? {
              outline: '1.5px solid rgba(255,255,255,0.22)',
              boxShadow: '0 6px 16px rgba(0,0,0,.6)',
            }
          : null),
      }}
    >
      <Figure />
    </div>
  );

  return (
    <div
      className={clsx('relative overflow-hidden rounded-[10px] bg-ink', className)}
      style={{ aspectRatio: aspect === '9:16' ? '9 / 16' : '16 / 9' }}
      aria-hidden
    >
      {/* Under the speaker everywhere except a reaction cut, where the picture
          is the background and the speaker sits on top of it. */}
      {inset ? null : speaker}

      {/* whatever shares the frame with them */}
      {plan.broll ? (
        <div
          className="absolute overflow-hidden"
          style={{
            ...regionStyle(plan.broll),
            background: `linear-gradient(140deg, ${accent}44, #17203A 55%, #0E1526 100%)`,
          }}
        >
          <Pictures accent={accent} />
        </div>
      ) : inset ? (
        /* The insert has the frame. */
        <div
          className="absolute inset-0"
          style={{ background: `linear-gradient(140deg, ${accent}55, #17203A 60%, #0E1526 100%)` }}
        >
          <Pictures accent={accent} />
        </div>
      ) : (
        /* On a full frame, B-roll is an insert that COVERS — so it is drawn as a
           card lifted off the picture rather than a region beside it. */
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
      )}

      {inset ? speaker : null}

      {/* the words */}
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
