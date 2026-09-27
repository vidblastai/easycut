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

const svg = (inner: string, viewBox = '0 0 1000 1000') =>
  `<svg viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;

describe('splitting a drawing into its parts', () => {
  it('takes the top-level groups in order', () => {
    const art = parseIllustration(
      svg(`<g id="part-1">${shape(1)}</g><g id="part-2">${shape(2)}</g><g id="part-3">${shape(3)}</g>`),
    );
    expect(art?.parts).toHaveLength(3);
    expect(art?.parts[0]).toContain('cx="101"');
    expect(art?.parts[2]).toContain('cx="103"');
  });

  it('keeps a nested group inside its parent, not as a part of its own', () => {
    // Groups nest, and a regex that matched the first `</g>` would cut part one
    // short and shift every part after it. This is the reason the splitter
    // counts depth.
    const art = parseIllustration(
      svg(`<g id="part-1">${shape(1)}<g id="inner">${shape(9)}</g></g><g id="part-2">${shape(2)}</g>`),
    );
    expect(art?.parts).toHaveLength(2);
    expect(art?.parts[0]).toContain('id="inner"');
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
    expect(art?.parts.join('')).not.toContain('script');
  });

  it('drops an event handler', () => {
    const art = parseIllustration(svg(`<g><circle cx="10" cy="10" r="5" fill="#000" onload="steal()"/>${shape(1)}</g>`));
    expect(art?.parts.join('')).not.toContain('onload');
  });

  it('drops anything that would fetch', () => {
    const art = parseIllustration(svg(`<g>${shape(1)}<image href="https://example.com/x.png"/></g>`));
    const markup = art?.parts.join('') ?? '';
    expect(markup).not.toContain('image');
    expect(markup).not.toContain('example.com');
  });

  it('drops filters, which would re-rasterise the drawing every frame', () => {
    const art = parseIllustration(
      svg(`<defs><filter id="f"><feGaussianBlur stdDeviation="8"/></filter></defs><g filter="url(#f)">${shape(1)}</g>`),
    );
    const markup = art?.parts.join('') ?? '';
    expect(markup).not.toContain('filter');
    expect(markup).not.toContain('feGaussianBlur');
  });

  it('drops text, because the renderer sets the type', () => {
    const art = parseIllustration(svg(`<g>${shape(1)}<text x="10" y="10">Six hours</text></g>`));
    expect(art?.parts.join('')).not.toContain('Six hours');
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
