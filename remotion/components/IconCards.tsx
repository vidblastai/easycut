import React from 'react';
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import { iconRowPlacement, type CaptionStyle, type Edl, type IconCue } from '../../src/lib/edl/types';
import { riseProgress } from '../lib/motion';
import { FONT_FAMILY } from '../lib/fonts';

/**
 * The icon that rises on the word.
 *
 * One illustrated object on a plain tile. It slides up out of nothing at the
 * moment its noun is spoken, holds dead still for a beat or two, and fades.
 * No type, no decoration, no second move.
 *
 * ── The numbers here are measured, not invented ─────────────────────────
 *
 * Every constant below came off a reference clip frame by frame — the card's
 * size against the frame, how far it travels, the shape of the ease, how long
 * it holds, how it leaves. That is worth saying because each one of them is
 * the kind of value that gets "tidied" to a rounder number later, and the
 * roundness is what kills it. In the reference, at 1080×1920:
 *
 *   card            325 × 298 px, centred        → 0.30 of the short edge
 *   travel          602 px, from below a floor   → 2× the card's own height
 *   rise            19 frames at 30fps, easeOut  → 0.63s, quadratic, NO overshoot
 *   settle          absolute stillness           → not a drift, not a breath
 *   exit            15 frames, LINEAR opacity    → 0.5s, and it does not move
 *
 * Two of those are the ones that matter most and are easiest to get wrong.
 *
 * **It does not scale.** The card's width is constant to the pixel through the
 * entire entrance. A pop — the reflex for anything arriving — would make this
 * a sticker; what makes it read as an object is that it is already its full
 * size before you see it, and it is moving.
 *
 * **It does not bounce.** The ease is quadratic-out, which decelerates hard
 * and then creeps the last few pixels. An overshoot-and-settle spring is the
 * other reflex and it is wrong for the same reason: a bounce is a thing
 * landing, and this is a thing rising into view.
 *
 * ── The floor ───────────────────────────────────────────────────────────
 *
 * In the reference the card rises from below the bottom edge of the FRAME,
 * which cuts it off cleanly while it travels. Our cards rest higher up, above
 * the captions, so there is no frame edge to hide behind — the clip box below
 * gives each card its own invisible floor one card-height beneath where it
 * lands, and it emerges from that exactly as the reference emerges from the
 * bottom of the screen. Without it you get the tell-tale mistake: a card that
 * simply fades and slides, which reads as a web animation rather than an edit.
 */

/** The corner. Generous — an app-icon squircle, not a UI card. */
const RADIUS_OF_CARD = 0.17;

/** The icon's box inside the tile, measured off the reference. */
const ICON_OF_CARD = 0.72;

/** Room around the card for its shadow, so the clip box does not slice it. */
const PAD_OF_CARD = 0.16;

const RISE_SEC = 0.63;
const FADE_SEC = 0.5;

/**
 * Frames of head start, so the movement is already underway on the syllable.
 *
 * A card that begins to move on the exact frame of the word reads a touch
 * late, because what the eye registers is not the first pixel of travel but
 * the moment the shape becomes legible. Three frames earlier and the two land
 * together.
 */
const LEAD_FRAMES = 3;

export const IconCards: React.FC<{ edl: Edl }> = ({ edl }) => {
  const { fps } = useVideoConfig();

  return (
    <>
      {edl.icons.map((cue) => {
        const from = Math.max(0, Math.round(cue.outStartSec * fps) - LEAD_FRAMES);
        const until = Math.round(cue.outEndSec * fps) + Math.round(fps * FADE_SEC);
        const durationInFrames = Math.max(1, until - from);

        return (
          <Sequence key={cue.id} from={from} durationInFrames={durationInFrames} name={`icons · ${cue.cards.map((c) => c.word).join(' + ')}`}>
            <Row cue={cue} startFrame={from} captions={edl.captionStyle} />
          </Sequence>
        );
      })}
    </>
  );
};

const Row: React.FC<{ cue: IconCue; startFrame: number; captions: CaptionStyle }> = ({ cue, startFrame, captions }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const drawable = cue.cards.filter((card) => card.markup);
  if (!drawable.length) return null;

  // The same helper the builder placed the row with, so the card is exactly
  // the size the space it was measured for. `cue.x`/`cue.y` still win, because
  // those are the ones a user can move.
  const { card, gap } = iconRowPlacement(drawable.length, width, height, cue.side);
  const column = cue.side !== 'below';

  /*
   * Laid out for the row's FINAL extent from the first frame.
   *
   * The alternative — centring whatever is on screen right now — makes the
   * banana slide left when the apple arrives, and a card that moves after it
   * has landed breaks the one thing this effect is selling, which is that it
   * lands and stops.
   */
  const span = drawable.length * card + (drawable.length - 1) * gap;
  // A column runs down from its centre; a row runs across from its own.
  const left = column ? cue.x * width - card / 2 : (width - span) / 2;
  const top = column ? cue.y * height - span / 2 : cue.y * height - card / 2;

  const riseFrames = Math.max(1, Math.round(fps * RISE_SEC));
  const fadeFrames = Math.max(1, Math.round(fps * FADE_SEC));
  const endFrame = Math.round(cue.outEndSec * fps) - startFrame;

  // Linear, and shared by the whole row: they arrived one at a time and they
  // leave together, which is what the sentence they belong to does.
  const opacity = frame <= endFrame ? 1 : Math.max(0, 1 - (frame - endFrame) / fadeFrames);
  if (opacity <= 0) return null;

  const pad = card * PAD_OF_CARD;

  return (
    <AbsoluteFill style={{ opacity }}>
      {drawable.map((item, index) => {
        const landsAt = Math.round((cue.outStartSec + item.offsetSec) * fps) - startFrame;
        const travelled = riseProgress(frame - (landsAt - LEAD_FRAMES), riseFrames);
        // Two card-heights, exactly as measured. `translate3d` rather than
        // `top`, so the whole entrance is one composited transform.
        const offset = card * 2 * (1 - travelled);

        return (
          <div
            key={index}
            style={{
              position: 'absolute',
              left: (column ? left : left + index * (card + gap)) - pad,
              top: (column ? top + index * (card + gap) : top) - pad,
              width: card + pad * 2,
              // Down to the floor the card climbs out of: its own height below
              // where it comes to rest.
              height: card * 2 + pad,
              overflow: 'hidden',
              // A rounding artefact at the clip's edge would be a 1px line
              // hanging in the frame for the whole scene.
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: pad,
                top: pad,
                width: card,
                height: card,
                borderRadius: card * RADIUS_OF_CARD,
                transform: `translate3d(0, ${offset}px, 0)`,
                display: 'flex',
                alignItems: 'center',
                // A labelled card lifts its picture to make room; an unlabelled
                // one stays dead centre, which is the measured reference.
                justifyContent: 'center',
                paddingBottom: item.label ? card * 0.2 : 0,
                boxSizing: 'border-box',
                ...tile(cue.tone, card),
              }}
            >
              <div
                style={{
                  width: card * (item.label ? ICON_OF_CARD * 0.74 : ICON_OF_CARD),
                  height: card * (item.label ? ICON_OF_CARD * 0.74 : ICON_OF_CARD),
                }}
                // Sanitised upstream in `src/lib/assets/icons.ts`, and its ids
                // are namespaced per card so two icons in one row cannot end up
                // sharing a gradient.
                dangerouslySetInnerHTML={{ __html: iconMarkup(item.markup!) }}
              />
              {/* Inside the tile, under the picture, and the picture gives up
                  the room for it — a label hung below the tile would make the
                  row two different heights depending on which cards have one,
                  and the row is laid out for its final size from frame one. */}
              {item.label ? (
                <div
                  style={{
                    position: 'absolute',
                    left: card * 0.08,
                    right: card * 0.08,
                    bottom: card * 0.09,
                    fontFamily: FONT_FAMILY,
                    fontSize: card * 0.115,
                    fontWeight: 700,
                    lineHeight: 1.15,
                    letterSpacing: '-0.01em',
                    textAlign: 'center',
                    textWrap: 'balance',
                    color: cue.tone === 'dark' ? 'rgba(255,255,255,0.92)' : '#17171C',
                  }}
                >
                  {item.label}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

/** White tile or near-black one, with the shadow that belongs to each. */
function tile(tone: 'light' | 'dark', card: number): React.CSSProperties {
  return tone === 'dark'
    ? {
        background: '#17171C',
        // A hairline, because a dark tile on dark footage has no edge of its
        // own and reads as a hole rather than an object.
        boxShadow: `inset 0 0 0 ${Math.max(1, card * 0.006)}px rgba(255,255,255,0.12), 0 ${card * 0.05}px ${card * 0.13}px rgba(0,0,0,0.55)`,
      }
    : {
        background: '#FFFFFF',
        boxShadow: `0 ${card * 0.035}px ${card * 0.1}px rgba(13,13,16,0.22)`,
      };
}

/**
 * The icon, sized to its box.
 *
 * The sets ship a fixed `width`/`height` on the root element, which wins over
 * the container and leaves a 200px drawing floating in a 230px tile. Stripping
 * them and adding a `preserveAspectRatio` is what makes one component work for
 * a square emoji and a wide one alike.
 */
export function iconMarkup(markup: string): string {
  return markup
    .replace(/<svg([^>]*)>/i, (_all, attrs: string) => {
      const kept = attrs
        .replace(/\s(width|height)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        .replace(/\spreserveAspectRatio\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
      return `<svg${kept} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style="display:block">`;
    });
}

// Lives in `lib/motion` with the other entrances; re-exported because this
// is where it was measured and where readers look for it.
export { riseProgress };
