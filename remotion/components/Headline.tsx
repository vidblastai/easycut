import React from 'react';
import { AbsoluteFill, useVideoConfig } from 'remotion';
import type { Edl } from '../../src/lib/edl/types';
import { FONT_FAMILY } from '../lib/fonts';

/**
 * The bulletin's headline.
 *
 * The one layout where the first thing read is text rather than a face, which
 * is the entire point of it: in a feed, on mute, before anybody has decided to
 * watch, a headline is the only part of a video that can do any work.
 *
 * The words are `deliverable.title` — the line the director already wrote for
 * the post. Deliberately not a new field for the customer to fill in: a
 * headline layout with an empty headline is the worst version of this, and
 * reusing the title means there is always one and it always matches what gets
 * posted alongside the video.
 *
 * Everything is sized against the frame's WIDTH rather than its height. A
 * headline is a line of type across the top; on a 16:9 talk the same fraction
 * of height would be twice the type and would eat the picture.
 */
export const Headline: React.FC<{ edl: Edl }> = ({ edl }) => {
  const { width, height } = useVideoConfig();
  const text = edl.deliverable.title.trim();
  if (!text) return null;

  const pad = width * 0.055;
  // Longer headlines step down rather than wrapping to a third line, which on
  // a 20%-tall band is what pushes the type into the picture below it.
  const size = width * (text.length > 64 ? 0.058 : text.length > 38 ? 0.068 : 0.082);

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          left: pad,
          right: pad,
          top: 0,
          // The band the layout reserves — see `HEADLINE_BAND` in
          // src/lib/styles/layouts.ts, which is where the frame below it
          // starts. Centring inside the band rather than pinning to the top
          // keeps a one-line and a three-line headline optically even.
          height: height * 0.2,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: width * 0.022,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: width * 0.018 }}>
          <span
            style={{
              display: 'block',
              width: width * 0.012,
              height: width * 0.012,
              borderRadius: '50%',
              background: '#FF4D4D',
            }}
          />
          <span
            style={{
              fontFamily: FONT_FAMILY,
              fontSize: width * 0.026,
              fontWeight: 800,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: '#A5A5B3',
            }}
          >
            {edl.deliverable.hashtags[0]?.replace(/^#/, '') || 'The story'}
          </span>
        </div>

        <h1
          style={{
            margin: 0,
            fontFamily: FONT_FAMILY,
            fontSize: size,
            fontWeight: 800,
            letterSpacing: '-0.035em',
            lineHeight: 1.06,
            color: '#F5F5F7',
            // `balance` rather than a hard break: a headline broken by the
            // browser's greedy algorithm leaves one word on the last line,
            // which is the difference between a bulletin and a school project.
            textWrap: 'balance',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {text}
        </h1>
      </div>
    </AbsoluteFill>
  );
};
