import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { FONT_FAMILY } from '../lib/fonts';
import { easeOutCubic, easeOutExpo, kf } from '../lib/motion';

/**
 * A label that opens out of a rule.
 *
 * ── Measured, not invented ──────────────────────────────────────────────
 *
 * Pulled frame by frame at 15fps out of a reference edit, where it is the
 * house signature and every label in the video uses it: a 2px horizontal line
 * draws at the width the label will be, grows into a pill over about three
 * frames, and the text then fills into it word by word. Line to readable is
 * roughly 0.7 seconds.
 *
 * ── Why it is the height that animates and nothing else ─────────────────
 *
 * Because a rule IS a pill two pixels tall. Animating the height means the
 * element is its final width from frame one, so no text reflows, no layout
 * pass runs, and the whole entrance is one interpolation on a box that was
 * already composited — which is the same reason the progress bar scales
 * instead of growing its width.
 *
 * The alternative everybody reaches for first is a width wipe, and it is what
 * this renderer's chapter card did: `clipPath: inset(0 N% 0 0)`. That reveals
 * the label left to right like a lower third from 2009. The height open reads
 * as the thing UNFOLDING, and it costs exactly as little.
 *
 * ── Why the type warms rather than appearing ────────────────────────────
 *
 * Same mechanic as the captions, from the same reference, and it has to match
 * them or the video has two opinions about how type arrives: the words are in
 * their final positions from the start and each one ramps up from dim as it
 * is reached. Nothing in a pill ever moves sideways.
 */

/** The rule sits visible for a beat before it opens. Measured at ~0.07s. */
const RULE_SEC = 0.07;
/** And opens over this. Three frames at 15, six at 30. */
const OPEN_SEC = 0.2;
/** Then a word every so often, matching the caption fill's cadence. */
const WORD_SEC = 0.09;
/** How dim an unreached word sits. The captions' own figure. */
const DIM = 0.42;

export interface PillTone {
  /** The plate. */
  background: string;
  /** The type on it. */
  color: string;
  /** An optional hairline, for a plate with no contrast against the frame. */
  border?: string;
}

export const Pill: React.FC<{
  text: string;
  /** Frames into this element's own timeline before the rule appears. */
  at?: number;
  tone: PillTone;
  /** Type size in pixels; everything else is derived from it. */
  fontSize: number;
  /** Nudges the plate's padding, for a chip that wants to be tighter. */
  padding?: number;
  maxWidth?: number;
}> = ({ text, at = 0, tone, fontSize, padding, maxWidth }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const ruleFrames = Math.max(1, Math.round(fps * RULE_SEC));
  const openFrames = Math.max(2, Math.round(fps * OPEN_SEC));
  const pad = padding ?? fontSize * 0.52;
  const full = fontSize * 1.42 + pad;

  /*
   * The rule's own thickness, not a fraction of the pill.
   *
   * Two pixels at 1080 and four at 4K is the same line; two pixels at both is
   * a line that halves when somebody exports larger. Scaled off the type,
   * which is already scaled off the frame.
   */
  const rule = Math.max(2, fontSize * 0.055);

  const opened = kf(frame, [[at + ruleFrames, 0], [at + ruleFrames + openFrames, 1]], easeOutCubic);
  const height = rule + (full - rule) * opened;

  // The plate arrives at full opacity — it is a line, not a ghost. Only the
  // first frame is eased, so a cut onto it does not strobe.
  const plate = kf(frame, [[at, 0], [at + 1, 1]], easeOutExpo);

  const words = text.trim().split(/\s+/).filter(Boolean);
  const textFrom = at + ruleFrames + openFrames;

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        height,
        // The pill's radius is its own height, which is what makes it a pill
        // at full size and a rounded rule on the way there.
        borderRadius: height / 2,
        padding: `0 ${pad}px`,
        background: tone.background,
        boxShadow: tone.border ? `inset 0 0 0 1px ${tone.border}` : undefined,
        opacity: plate,
        maxWidth,
        overflow: 'hidden',
        // Nothing reflows: the element is its final width from frame one, so
        // the type below is laid out once and only its tone changes.
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          fontFamily: FONT_FAMILY,
          fontSize,
          fontWeight: 650,
          letterSpacing: '-0.01em',
          lineHeight: 1,
          color: tone.color,
          // Hidden while the plate is still a rule, rather than squashed by
          // it — a line of type clipped to two pixels is a grey smear.
          opacity: opened > 0.6 ? 1 : 0,
        }}
      >
        {words.map((word, i) => (
          <span
            key={i}
            style={{
              opacity:
                DIM +
                (1 - DIM) *
                  kf(
                    frame,
                    [
                      [textFrom + i * Math.max(1, Math.round(fps * WORD_SEC)), 0],
                      [textFrom + i * Math.max(1, Math.round(fps * WORD_SEC)) + Math.max(1, Math.round(fps * 0.1)), 1],
                    ],
                    easeOutCubic,
                  ),
            }}
          >
            {word}
            {i < words.length - 1 ? ' ' : ''}
          </span>
        ))}
      </span>
    </div>
  );
};
