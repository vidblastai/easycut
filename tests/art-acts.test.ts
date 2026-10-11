import { describe, expect, it } from 'vitest';
import { parseIllustration } from '@/lib/assets/illustration';

/**
 * A drawing has to DO the thing it says it does.
 *
 * Every drawing already shipped with a line naming what physically changes in
 * it — the model writes it, because only the model knows which group is a bar
 * and which is a tick. That line was read by exactly one file: the prompt that
 * hands a rendered plate to a video model. In the vector path nothing read it,
 * so the change never happened: pieces flew in and then bobbed, for the whole
 * of every exhibit. `data-act` is the machine-readable half of that sentence.
 */

const wrap = (groups: string) =>
  `<svg viewBox="0 0 1000 756" xmlns="http://www.w3.org/2000/svg">` +
  `<desc data-stage="0">The bar fills and the tick lands.</desc>${groups}</svg>`;

const bar = (attrs: string) =>
  `<g data-stage="0" ${attrs}>` +
  `<rect x="100" y="300" width="600" height="40" rx="20" fill="#2E9E5B"/>` +
  `<rect x="100" y="380" width="600" height="40" rx="20" fill="#E4E4E9"/></g>`;

describe('reading an act off a drawing', () => {
  it('takes the act and its timing', () => {
    const art = parseIllustration(wrap(bar('data-act="fill" data-act-at="0.5"')))!;
    expect(art.parts[0].act).toBe('fill');
    expect(art.parts[0].actAt).toBeCloseTo(0.5, 3);
  });

  it('measures the piece’s own box, so a fill can anchor to its left edge', () => {
    // Without this the bar scales about the drawing's centre and grows out of
    // the middle of itself.
    const { box } = parseIllustration(wrap(bar('data-act="fill"')))!.parts[0];
    expect(box.x).toBeCloseTo(100, 0);
    expect(box.w).toBeGreaterThan(500);
  });

  it('defaults to acting part-way through, not on arrival', () => {
    // An entrance is the assembly; an act is the event, and an event that
    // happens during the assembly is just more assembly.
    expect(parseIllustration(wrap(bar('data-act="fill"')))!.parts[0].actAt).toBeGreaterThan(0.25);
  });

  it('does nothing when the drawing asks for nothing', () => {
    expect(parseIllustration(wrap(bar('data-idle="bob"')))!.parts[0].act).toBe('none');
  });

  it('falls back rather than failing on an act it does not have', () => {
    expect(parseIllustration(wrap(bar('data-act="explode"')))!.parts[0].act).toBe('none');
    expect(parseIllustration(wrap(bar('data-act="fill" data-act-at="9")')))!.parts[0].actAt)
      .toBeGreaterThan(0.25);
  });

  it('gives a late-drawing stroke the dash length it needs', () => {
    // `draw-on` walks a dash along the stroke exactly as `enter: draw` does,
    // so it needs the same `pathLength` normalisation — without it the dash is
    // in user units and a long path never finishes drawing.
    const art = parseIllustration(
      wrap('<g data-stage="0" data-enter="pop" data-act="draw-on">' +
        '<path d="M100 400 L300 500 L700 200" fill="none" stroke="#2E9E5B" stroke-width="8"/>' +
        '<circle cx="400" cy="350" r="120" fill="none" stroke="#15151A" stroke-width="6"/></g>'),
    )!;
    expect(art.parts[0].act).toBe('draw-on');
    expect(art.parts[0].markup).toContain('pathLength="1"');
  });

  it('reads an act off the group’s own tag, not a child’s', () => {
    const art = parseIllustration(
      wrap('<g data-stage="0" data-act="travel">' +
        '<g data-act="fill"><rect x="10" y="10" width="200" height="30" fill="#15151A"/></g>' +
        '<rect x="10" y="60" width="400" height="30" fill="#8C8C98"/></g>'),
    )!;
    expect(art.parts[0].act).toBe('travel');
  });
});
