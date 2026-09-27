import { describe, expect, it } from 'vitest';
import { auditIllustration, isDrawn, parseIllustration } from '@/lib/assets/illustration';

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
    // Higher than it was, because a part is now a piece of one BEAT rather
    // than of the whole scene — three beats of four pieces is normal.
    const many = Array.from({ length: 30 }, (_, i) => `<g>${shape(i)}</g>`).join('');
    expect(parseIllustration(svg(many))?.parts.length).toBeLessThanOrEqual(14);
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

describe('beats', () => {
  const beat = (stage: number, i: number) => `<g data-stage="${stage}">${shape(i)}</g>`;

  it('counts the beats and keeps the parts in beat order', () => {
    const art = parseIllustration(svg(beat(2, 1) + beat(0, 2) + beat(1, 3)));
    expect(art?.stages).toBe(3);
    expect(art?.parts.map((p) => p.stage)).toEqual([0, 1, 2]);
  });

  it('is one beat when nothing says otherwise', () => {
    expect(parseIllustration(svg(`<g>${shape(1)}</g>`))?.stages).toBe(1);
  });

  it('drops a beat past the ceiling rather than pacing it into nothing', () => {
    const art = parseIllustration(svg(beat(0, 1) + beat(9, 2)));
    expect(art?.stages).toBe(1);
    expect(art?.parts).toHaveLength(1);
  });
});

describe('auditing a drawing before it is used', () => {
  // Enough shapes to clear the clipart floor, spanning its own square.
  const beatAt = (stage: number, extra = '') =>
    `<g data-stage="${stage}" ${extra}><rect x="60" y="${stage * 1000 + 100}" width="880" height="700" fill="#ddd"/>` +
    Array.from(
      { length: 16 },
      (_, i) => `<circle cx="${80 + i * 55}" cy="${stage * 1000 + 450}" r="60" fill="#333"/>`,
    ).join('') +
    `<path d="M100 ${stage * 1000 + 800} L900 ${stage * 1000 + 800}" stroke="#333" fill="none"/></g>`;

  const sound = () =>
    parseIllustration(
      `<svg viewBox="0 0 1000 3000">${beatAt(0)}${beatAt(1)}${beatAt(2)}` +
        `<g data-stage="0" data-enter="draw"><path d="M500 900 L500 1100" stroke="#333" fill="none"/></g></svg>`,
    )!;

  it('passes a drawing that is put together properly', () => {
    expect(auditIllustration(sound(), 3)).toEqual([]);
  });

  it('complains when a beat is drawn outside its own band', () => {
    const art = parseIllustration(`<svg viewBox="0 0 1000 3000">${beatAt(0)}${beatAt(0).replace('data-stage="0"', 'data-stage="2"')}</svg>`)!;
    expect(auditIllustration(art, 3).join(' ')).toContain('outside its own band');
  });

  it('complains when a beat does not fill its square', () => {
    // Plenty of shapes, all of them crowded into the middle of the square.
    const small =
      `<g data-stage="0"><rect x="460" y="460" width="80" height="80" fill="#111"/>` +
      Array.from({ length: 16 }, (_, i) => `<circle cx="${470 + i}" cy="${480 + i}" r="8" fill="#333"/>`).join('') +
      `</g>`;
    const art = parseIllustration(`<svg viewBox="0 0 1000 2000">${small}${beatAt(1)}</svg>`)!;
    expect(auditIllustration(art, 2).join(' ')).toContain('fill the square');
  });

  it('complains when something rotates with no pivot', () => {
    const art = parseIllustration(
      `<svg viewBox="0 0 1000 2000">${beatAt(0, 'data-idle="tick"')}${beatAt(1)}</svg>`,
    )!;
    expect(auditIllustration(art, 2).join(' ')).toContain('data-pivot');
  });

  it('accepts a rotating part that states its pivot', () => {
    const art = parseIllustration(
      `<svg viewBox="0 0 1000 2000">${beatAt(0, 'data-idle="tick" data-pivot="500 450"')}${beatAt(1)}` +
        `<g data-stage="0" data-enter="draw"><path d="M500 900 L500 1100" stroke="#333" fill="none"/></g></svg>`,
    )!;
    expect(auditIllustration(art, 2).join(' ')).not.toContain('data-pivot');
  });

  it('complains when there is no connector between beats', () => {
    const art = parseIllustration(`<svg viewBox="0 0 1000 2000">${beatAt(0)}${beatAt(1)}</svg>`)!;
    expect(auditIllustration(art, 2).join(' ')).toContain('no connector');
  });

  it('complains when a single beat came back and more were asked for', () => {
    const art = parseIllustration(`<svg viewBox="0 0 1000 1000">${beatAt(0)}</svg>`)!;
    expect(auditIllustration(art, 3).join(' ')).toContain('only one beat');
  });
});

describe('an empty beat', () => {
  it('is caught, because the camera pans down to it and finds nothing', () => {
    // Every other check passes: the backdrop spans the full width and the
    // coordinates sit in the right band. Only a count of the beat's own
    // shapes finds it, which is how one shipped.
    const full = (stage: number) =>
      `<g data-stage="${stage}" data-depth="0.6">` +
      Array.from({ length: 16 }, (_, i) => `<circle cx="${80 + i * 55}" cy="${stage * 1000 + 450}" r="60" fill="#333"/>`).join('') +
      `</g><g data-stage="${stage}" data-depth="0.5"><rect x="60" y="${stage * 1000 + 100}" width="880" height="200" fill="#ccc"/><circle cx="500" cy="${stage * 1000 + 200}" r="50" fill="#444"/><path d="M100 ${stage * 1000 + 300} L900 ${stage * 1000 + 300}" stroke="#333" fill="none"/></g>` +
      `<g data-stage="${stage}" data-depth="0.7"><rect x="200" y="${stage * 1000 + 600}" width="600" height="120" fill="#bbb"/><circle cx="500" cy="${stage * 1000 + 660}" r="40" fill="#555"/><path d="M250 ${stage * 1000 + 700} L750 ${stage * 1000 + 700}" stroke="#222" fill="none"/></g>`;
    const bare = `<g data-stage="1" data-depth="0.05"><rect x="0" y="1000" width="1000" height="1000" fill="#eee"/></g>`;
    const art = parseIllustration(`<svg viewBox="0 0 1000 2000">${full(0)}${bare}` +
      `<g data-stage="0" data-enter="draw"><path d="M500 900 L500 1100" stroke="#333" fill="none"/></g></svg>`)!;
    expect(auditIllustration(art, 2).join(' ')).toContain('nearly empty');
  });
});
