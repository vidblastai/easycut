'use client';

import { useState } from 'react';
import { BrollArt, Shot } from './Shot';

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
  const [split, setSplit] = useState(38);

  return (
    <div className="ba">
      {/* BEFORE — the take as it came off the camera. */}
      <div className="ba-layer ba-before">
        <Shot />
        <span className="ba-badge ba-badge-before">Straight off the camera</span>
        <div className="ba-deadair" aria-hidden>
          <span /><span /><span /><span /><span /><span /><span /><span />
        </div>
      </div>

      {/* AFTER — clipped to the split, so it is revealed rather than faded. */}
      <div className="ba-layer ba-after" style={{ clipPath: `inset(0 0 0 ${split}%)` }}>
        <Shot graded />

        <div className="ba-broll" aria-hidden>
          <BrollArt />
        </div>

        <div className="ba-stat" aria-hidden>
          <b>41%</b>
          <span>watched to the end</span>
        </div>

        <p className="ba-caption" aria-hidden>
          <span>so</span> <span>nobody</span> <em>finished</em> <span>it</span>
        </p>

        <span className="ba-badge ba-badge-after">Cut, captioned, scored</span>

        <div className="ba-music" aria-hidden>
          <i style={{ animationDelay: '0ms' }} />
          <i style={{ animationDelay: '120ms' }} />
          <i style={{ animationDelay: '240ms' }} />
          <i style={{ animationDelay: '80ms' }} />
          <i style={{ animationDelay: '300ms' }} />
        </div>
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
