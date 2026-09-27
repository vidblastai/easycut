import { describe, expect, it } from 'vitest';
import { sanitiseSvg } from '../src/lib/assets/icons';

/**
 * This markup is fetched from a third party and inlined into a page as HTML —
 * both the render browser's and the editor's. Everything that could execute
 * has to be gone before it gets there.
 */
describe('stripping a fetched icon down to its drawing', () => {
  const svg = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${inner}</svg>`;

  it('keeps an ordinary icon intact', () => {
    const out = sanitiseSvg(svg('<path d="M4 4h16v16H4z" fill="#9B7BFF"/>'));
    expect(out).toContain('<path');
    expect(out).toContain('#9B7BFF');
  });

  it('removes a script tag', () => {
    const out = sanitiseSvg(svg('<path d="M0 0"/><script>fetch("//evil")</script>'));
    expect(out).not.toMatch(/script/i);
    expect(out).toContain('<path');
  });

  it('removes event handlers however they are quoted', () => {
    const out = sanitiseSvg(svg(`<path d="M0 0" onload="steal()" onclick='go()' onerror=x />`));
    expect(out).not.toMatch(/onload|onclick|onerror/i);
  });

  it('removes links and external references', () => {
    const out = sanitiseSvg(svg('<a href="javascript:alert(1)"><path d="M0 0"/></a>'));
    expect(out).not.toMatch(/href/i);
  });

  it('removes foreignObject, which can carry arbitrary HTML', () => {
    const out = sanitiseSvg(svg('<path d="M0 0"/><foreignObject><iframe src="//evil"></iframe></foreignObject>'));
    expect(out).not.toMatch(/foreignObject|iframe/i);
  });

  it('returns null for anything that is not an svg', () => {
    expect(sanitiseSvg('<html><body>nope</body></html>')).toBeNull();
    expect(sanitiseSvg('')).toBeNull();
  });

  it('returns null for an svg with nothing drawn in it', () => {
    expect(sanitiseSvg(svg('<script>x()</script>'))).toBeNull();
  });
});
