'use client';

import { useState } from 'react';

/**
 * The same thirty seconds, before and after — dragged, not described.
 *
 * A range input does the work rather than pointer maths on a div. It is
 * draggable with a mouse, draggable with a thumb, and arrow-keyable from the
 * keyboard, all for free, and it is the correct element: this is one value
 * between two bounds. It is made invisible and stretched over the whole frame,
 * with the handle drawn separately, because the accessible control and the
 * good-looking control should not be two different things.
 *
 * Both sides are the same shot, so the seam cutting through the middle of a
 * caption reads as a comparison rather than as a rendering fault. What the
 * right-hand side adds is the work: a grade, a B-roll insert, a stat card,
 * captions with a word picked out, a music bed. What the left-hand side has
 * that the right does not is the dead air, marked in red along the bottom.
 */

export function BeforeAfter() {
  const [split, setSplit] = useState(50);

  return (
    <div className="ba">
      {/* BEFORE — the take as it came off the camera. */}
      <div className="ba-layer ba-before">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/marketing/before-after-before.jpg" alt="The raw take, straight off a phone" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
        <span className="ba-badge ba-badge-before">Straight off the camera</span>
      </div>

      {/* AFTER — clipped to the split, so it is revealed rather than faded. */}
      <div className="ba-layer ba-after" style={{ clipPath: `inset(0 0 0 ${split}%)` }}>
        {/* The same moment out of EasyCut: the punchy style's cut of that take. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/marketing/before-after-after.jpg" alt="The same moment, edited: captions, a badge and a punch-in" className="absolute inset-0 h-full w-full object-cover" draggable={false} />

        <span className="ba-badge ba-badge-after">Cut, captioned, scored</span>

      </div>

      {/* The seam and its handle, positioned from the same one number. */}
      <div className="ba-seam" style={{ left: `${split}%` }} aria-hidden>
        <span className="ba-handle">
          <svg viewBox="0 0 20 12" fill="none">
            <path d="M8 2L4 6l4 4M12 2l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>

      <input
        className="ba-range"
        type="range"
        min={4}
        max={96}
        step={0.5}
        value={split}
        onChange={(event) => setSplit(Number(event.target.value))}
        aria-label="Drag to compare the footage you upload with the video you get back"
      />
    </div>
  );
}
