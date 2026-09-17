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
  const plan = layoutPlan(layout);
  const captionTop = plan.captionY ?? 0.76;

  return (
    <div
      className={clsx('relative overflow-hidden rounded-[10px] bg-ink', className)}
      style={{ aspectRatio: aspect === '9:16' ? '9 / 16' : '16 / 9' }}
      aria-hidden
    >
      {/* the speaker */}
      <div
        className="absolute overflow-hidden"
        style={{
          ...regionStyle(plan.speaker),
          background: 'radial-gradient(120% 90% at 62% 22%, #2A2A36 0%, #1A1A22 52%, #101016 100%)',
        }}
      >
        <Figure />
      </div>

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
