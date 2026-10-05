import React from 'react';
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Annotation, Edl } from '../../src/lib/edl/types';
import { FONT_FAMILY } from '../lib/fonts';
import { easeOutCubic, kf } from '../lib/motion';
import { Pill } from './Pill';

/**
 * Things that stand beside the speaker while he carries on talking.
 *
 * The layer this renderer was missing. Every other device here takes the
 * frame away — a scene replaces it, an insert covers it, an icon card
 * punctuates under the captions — and counted off a reference edit that is
 * the wrong instinct by a wide margin: four full-screen scenes in 165
 * seconds, against a constant stream of small things standing in the empty
 * third at head height, arriving as the sentence that earns them is said.
 *
 * ── It builds, it does not appear ───────────────────────────────────────
 *
 * The lines arrive one at a time on the words that name them, and once a
 * line is up it stays up: by the fourth, all four are on screen together and
 * the viewer can see the whole list. That accumulation is the point. A
 * version that showed one line at a time would be a caption with a tick on
 * it.
 *
 * ── Nothing here moves ──────────────────────────────────────────────────
 *
 * Every line is in its final position from the first frame — the block is
 * laid out for its finished size, exactly as an icon row is, so the third
 * line does not shove the first two upward when it lands. Lines that have
 * not arrived are hidden rather than absent, and the type warms in the way
 * all type in this renderer now does.
 */
export const Annotations: React.FC<{ edl: Edl }> = ({ edl }) => {
  const { fps } = useVideoConfig();

  return (
    <>
      {edl.annotations.map((note) => {
        const from = Math.round(note.outStartSec * fps);
        // A beat past the last line, so the finished list can be read.
        const until = Math.round(note.outEndSec * fps);
        const durationInFrames = Math.max(1, until - from);
        return (
          <Sequence key={note.id} from={from} durationInFrames={durationInFrames} layout="none">
            <Note note={note} durationInFrames={durationInFrames} />
          </Sequence>
        );
      })}
    </>
  );
};

/** How long the whole block takes to leave. Linear, and everything goes together. */
const FADE_SEC = 0.45;

const Note: React.FC<{ note: Annotation; durationInFrames: number }> = ({ note, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const unit = height * 0.001;

  const fadeFrames = Math.max(1, Math.round(fps * FADE_SEC));
  const opacity = kf(frame, [[durationInFrames - fadeFrames, 1], [durationInFrames, 0]]);
  if (opacity <= 0) return null;

  /*
   * The column is as wide as the margin, not as wide as the text.
   *
   * Sized off the frame so a line wraps inside the column rather than
   * growing the block across the speaker's face — and bounded by the
   * distance to the nearer edge, doubled, for the same reason a side-placed
   * graphic is: the block is anchored on its own side, so a fixed width at
   * x=0.78 runs off the frame.
   */
  const toEdge = note.side === 'right' ? 1 - note.x : note.x;
  const column = Math.min(width * 0.3, width * toEdge * 1.7);
  const fontSize = unit * 26;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none', opacity }}>
      <div
        style={{
          position: 'absolute',
          left: note.x * width,
          top: note.y * height,
          // Anchored on the side it stands in, so the block grows AWAY from
          // the subject as its lines arrive rather than toward them.
          transform: note.side === 'right' ? 'none' : 'translateX(-100%)',
          width: column,
          display: 'flex',
          flexDirection: 'column',
          alignItems: note.side === 'right' ? 'flex-start' : 'flex-end',
          gap: unit * 14,
        }}
      >
        {note.title ? (
          <Pill
            text={note.title}
            fontSize={fontSize}
            maxWidth={column}
            tone={{ background: 'rgba(255,255,255,0.93)', color: '#17171C' }}
          />
        ) : null}

        {note.items.map((item, i) => (
          <Line
            key={i}
            text={item.text}
            at={Math.round((item.offsetSec + (note.title ? 0.45 : 0)) * fps)}
            fontSize={fontSize}
            side={note.side}
            kind={note.kind}
          />
        ))}
      </div>
    </AbsoluteFill>
  );
};

/** How dim an unspoken word sits. The captions' own figure, so they match. */
const DIM = 0.42;

const Line: React.FC<{
  text: string;
  at: number;
  fontSize: number;
  side: 'left' | 'right';
  kind: Annotation['kind'];
}> = ({ text, at, fontSize, side, kind }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  /*
   * Hidden until its moment, rather than transparent.
   *
   * A line at zero opacity still costs its shadow a composited layer, and
   * there are up to five of them standing over moving footage for eight
   * seconds. The block's height is fixed by the layout either way.
   */
  if (frame < at) return <div style={{ visibility: 'hidden', fontSize, lineHeight: 1.3 }}>{text}</div>;

  const words = text.trim().split(/\s+/).filter(Boolean);
  const per = Math.max(1, Math.round(fps * 0.08));
  const warm = Math.max(1, Math.round(fps * 0.1));

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        flexDirection: side === 'right' ? 'row' : 'row-reverse',
        gap: fontSize * 0.34,
        fontFamily: FONT_FAMILY,
        fontSize,
        fontWeight: 600,
        lineHeight: 1.3,
        color: '#FFFFFF',
        letterSpacing: '-0.01em',
        // The only thing holding this off the footage. A plate behind each
        // line would make the block a card, and a card beside the speaker is
        // a scene that forgot to take the frame.
        textShadow: `0 ${fontSize * 0.06}px ${fontSize * 0.5}px rgba(0,0,0,0.75)`,
        textAlign: side === 'right' ? 'left' : 'right',
      }}
    >
      {kind === 'checklist' ? <Tick size={fontSize * 0.78} at={at} /> : null}
      <span>
        {words.map((word, i) => (
          <span
            key={i}
            style={{
              opacity:
                DIM + (1 - DIM) * kf(frame, [[at + i * per, 0], [at + i * per + warm, 1]], easeOutCubic),
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

/**
 * The tick, drawn rather than typed.
 *
 * A ✓ character is a different typeface's idea of a tick at a size the font
 * never designed it for, and it sits on the text baseline rather than on the
 * line's optical centre. Two strokes of a path cost nothing and land where
 * they are put.
 *
 * It draws itself on, left stroke first, over four frames — the one thing in
 * the block that is allowed to move, because a tick that is already complete
 * reads as a bullet.
 */
const Tick: React.FC<{ size: number; at: number }> = ({ size, at }) => {
  const frame = useCurrentFrame();
  const drawn = kf(frame, [[at, 0], [at + 4, 1]], easeOutCubic);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={{ flexShrink: 0, alignSelf: 'center', overflow: 'visible' }}
      aria-hidden="true"
    >
      <path
        d="M4 12.5 L9.5 18 L20 6"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={3.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        // One dash as long as the path, offset back by however much is left
        // to draw. The length is over-estimated on purpose: too long simply
        // starts the dash further back, where too short would clip the tail.
        strokeDasharray={34}
        strokeDashoffset={34 * (1 - drawn)}
        style={{ filter: `drop-shadow(0 ${size * 0.06}px ${size * 0.4}px rgba(0,0,0,0.7))` }}
      />
    </svg>
  );
};
