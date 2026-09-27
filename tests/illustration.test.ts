import { describe, expect, it } from 'vitest';
import { isDrawn, parseIllustration } from '@/lib/assets/illustration';

/**
 * The drawing parser's job is to be suspicious.
 *
 * What it is handed is a few kilobytes of markup a language model wrote,
 * inlined straight into a full-frame layer of a video. Everything below is
 * either something a model actually returns, or something that would be very
 * bad to inline — and the failure the tests care about most is the quiet one:
 * a drawing that parses into nonsense and renders as an empty frame where the
 * icon fallback would have worked fine.
 */

const shape = (i: number) => `<circle cx="${100 + i}" cy="200" r="40" fill="#0D0D10"/><rect x="10" y="10" width="80" height="80" fill="#fff"/>`;

/** Every part's markup, for the tests that only care that something is gone. */
const markupOf = (art: { parts: Array<{ markup: string }> } | null) =>
  (art?.parts ?? []).map((part) => part.markup).join('');

const svg = (inner: string, viewBox = '0 0 1000 1000') =>
  `<svg viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;

describe('splitting a drawing into its parts', () => {
  it('takes the top-level groups in order', () => {
    const art = parseIllustration(
      svg(`<g id="part-1">${shape(1)}</g><g id="part-2">${shape(2)}</g><g id="part-3">${shape(3)}</g>`),
    );
    expect(art?.parts).toHaveLength(3);
    expect(art?.parts[0].markup).toContain('cx="101"');
    expect(art?.parts[2].markup).toContain('cx="103"');
  });

  it('keeps a nested group inside its parent, not as a part of its own', () => {
    // Groups nest, and a regex that matched the first `</g>` would cut part one
    // short and shift every part after it. This is the reason the splitter
    // counts depth.
    const art = parseIllustration(
      svg(`<g id="part-1">${shape(1)}<g id="inner">${shape(9)}</g></g><g id="part-2">${shape(2)}</g>`),
    );
    expect(art?.parts).toHaveLength(2);
    expect(art?.parts[0].markup).toContain('id="inner"');
  });

  it('is not confused by a self-closing group', () => {
    const art = parseIllustration(svg(`<g id="part-1">${shape(1)}</g><g id="ghost"/><g id="part-2">${shape(2)}</g>`));
    expect(art?.parts).toHaveLength(2);
  });

  it('reads the viewBox, and falls back to the canvas when there is none', () => {
    expect(parseIllustration(svg(`<g>${shape(1)}</g>`, '0 0 800 600'))?.viewBox).toBe('0 0 800 600');
    expect(
      parseIllustration(`<svg xmlns="http://www.w3.org/2000/svg"><g>${shape(1)}</g></svg>`)?.viewBox,
    ).toBe('0 0 1000 1000');
  });

  it('accepts a drawing with no groups as one part', () => {
    // Worse animation, fine picture. Refusing these would throw away most of
    // what comes back on a first attempt.
    const art = parseIllustration(svg(shape(1) + shape(2)));
    expect(art?.parts).toHaveLength(1);
  });

  it('caps the number of parts', () => {
    const many = Array.from({ length: 14 }, (_, i) => `<g>${shape(i)}</g>`).join('');
    expect(parseIllustration(svg(many))?.parts.length).toBeLessThanOrEqual(8);
  });
});

describe('what never reaches the document', () => {
  it('drops a script', () => {
    const art = parseIllustration(svg(`<g>${shape(1)}<script>alert(1)</script></g>`));
    expect(markupOf(art)).not.toContain('script');
  });

  it('drops an event handler', () => {
    const art = parseIllustration(svg(`<g><circle cx="10" cy="10" r="5" fill="#000" onload="steal()"/>${shape(1)}</g>`));
    expect(markupOf(art)).not.toContain('onload');
  });

  it('drops anything that would fetch', () => {
    const art = parseIllustration(svg(`<g>${shape(1)}<image href="https://example.com/x.png"/></g>`));
    const markup = markupOf(art);
    expect(markup).not.toContain('image');
    expect(markup).not.toContain('example.com');
  });

  it('drops filters, which would re-rasterise the drawing every frame', () => {
    const art = parseIllustration(
      svg(`<defs><filter id="f"><feGaussianBlur stdDeviation="8"/></filter></defs><g filter="url(#f)">${shape(1)}</g>`),
    );
    const markup = markupOf(art);
    expect(markup).not.toContain('filter');
    expect(markup).not.toContain('feGaussianBlur');
  });

  it('drops text, because the renderer sets the type', () => {
    const art = parseIllustration(svg(`<g>${shape(1)}<text x="10" y="10">Six hours</text></g>`));
    expect(markupOf(art)).not.toContain('Six hours');
  });
});

describe('refusing a failed drawing', () => {
  it('returns null when there is no svg at all', () => {
    expect(parseIllustration('I am sorry, I cannot draw that.')).toBeNull();
    expect(parseIllustration('')).toBeNull();
  });

  it('returns null when the svg has no shapes in it', () => {
    expect(parseIllustration('<svg viewBox="0 0 10 10"><title>nothing</title></svg>')).toBeNull();
  });

  it('calls a one-shape drawing not drawn, so the icons take over', () => {
    expect(isDrawn(parseIllustration(svg('<circle cx="5" cy="5" r="2" fill="#000"/>')))).toBe(false);
    expect(isDrawn(null)).toBe(false);
  });

  it('calls a real drawing drawn', () => {
    expect(isDrawn(parseIllustration(svg(`<g>${shape(1)}</g><g>${shape(2)}</g>`)))).toBe(true);
  });
});

describe('the hints that make it move', () => {
  it('reads depth, enter, idle and pivot off the group', () => {
    const art = parseIllustration(
      svg(`<g data-depth="0.9" data-enter="slide-left" data-idle="spin" data-pivot="640 320">${shape(1)}</g>`),
    );
    expect(art?.parts[0]).toMatchObject({
      depth: 0.9,
      enter: 'slide-left',
      idle: 'spin',
      pivot: { x: 640, y: 320 },
    });
  });

  it('measures a pivot off the shapes when the hint is missing', () => {
    // shape(1) is a circle at (101, 200) and a rect from (10,10) to (90,90),
    // so the extent is x 10..101, y 10..200 and the middle is (55.5, 105).
    const art = parseIllustration(svg(`<g>${shape(1)}</g>`, '0 0 800 600'));
    expect(art?.parts[0].pivot.x).toBeCloseTo(55.5, 1);
    expect(art?.parts[0].pivot.y).toBeCloseTo(105, 1);
  });

  it('falls back to the canvas centre when there is nothing to measure', () => {
    const art = parseIllustration(svg(`<g><circle r="4" fill="#000"/><circle r="9" fill="#111"/></g>`, '0 0 800 600'));
    expect(art?.parts[0].pivot).toEqual({ x: 400, y: 300 });
  });

  it('ignores a hint it does not recognise rather than rendering nothing', () => {
    const art = parseIllustration(svg(`<g data-depth="banana" data-enter="explode" data-idle="wobble">${shape(1)}</g>`));
    expect(art?.parts[0]).toMatchObject({ depth: 0.5, enter: 'pop', idle: 'bob' });
  });

  it('does not read a nested group’s hints as the part’s own', () => {
    const art = parseIllustration(svg(`<g data-depth="0.2">${shape(1)}<g data-depth="0.9">${shape(2)}</g></g>`));
    expect(art?.parts[0].depth).toBe(0.2);
  });

  it('guesses draw for a stroke-only part, which is always a connector', () => {
    const art = parseIllustration(
      svg(`<g><path d="M0 0 L9 9" fill="none" stroke="#333" stroke-width="8"/><path d="M1 1 L8 8" fill="none" stroke="#333"/><line x1="0" y1="0" x2="4" y2="4" stroke="#333" fill="none"/></g>`),
    );
    expect(art?.parts[0].enter).toBe('draw');
    // …and normalises its lengths, so the dash offset can walk it on without a
    // laid-out document to measure against.
    expect(art?.parts[0].markup).toContain('pathLength="1"');
  });

  it('does not guess draw for something that is filled', () => {
    const art = parseIllustration(svg(`<g>${shape(1)}</g>`));
    expect(art?.parts[0].enter).toBe('pop');
  });
});

describe('gradients', () => {
  it('keeps the defs, which the parts refer to', () => {
    const art = parseIllustration(
      svg(`<defs><linearGradient id="wall"><stop offset="0" stop-color="#fff"/></linearGradient></defs><g><rect x="0" y="0" width="9" height="9" fill="url(#wall)"/>${shape(1)}</g>`),
    );
    expect(art?.defs).toContain('linearGradient');
    // …and out of the parts, so it is not painted as a piece of the drawing.
    expect(markupOf(art)).not.toContain('linearGradient');
  });

  it('namespaces ids so two scenes cannot steal each other’s gradients', () => {
    const markup = `<defs><linearGradient id="wall"/></defs><g><rect x="0" y="0" width="9" height="9" fill="url(#wall)"/>${shape(1)}</g>`;
    const first = parseIllustration(svg(markup), 'scene-0');
    const second = parseIllustration(svg(markup), 'scene-1');
    expect(first?.defs).toContain('id="scene-0-wall"');
    expect(markupOf(first)).toContain('url(#scene-0-wall)');
    expect(second?.defs).toContain('id="scene-1-wall"');
    expect(markupOf(first)).not.toContain('url(#scene-1-wall)');
  });
});
