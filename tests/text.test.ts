import { describe, expect, it } from 'vitest';
import { trimToWords } from '@/lib/text';

/**
 * Cutting prose to length.
 *
 * `slice` is the reflex and it is wrong wherever the result is read as words.
 * A scene's supporting line reached the screen as "…but the you picke", and the
 * social caption handed to a creator to paste under their video was cut the
 * same way — both from a plain character count landing mid-word.
 */

describe('text that already fits', () => {
  it('comes back untouched, with no ellipsis', () => {
    expect(trimToWords('a short line', 40)).toBe('a short line');
  });

  it('is trimmed of surrounding space', () => {
    expect(trimToWords('  padded  ', 40)).toBe('padded');
  });

  it('is left alone at exactly the budget', () => {
    expect(trimToWords('12345', 5)).toBe('12345');
  });
});

describe('text that has to be cut', () => {
  const LINE = 'You can move the number later, but the one you picked on day one is the anchor';

  it('never ends mid-word', () => {
    for (let budget = 8; budget <= LINE.length; budget++) {
      const out = trimToWords(LINE, budget);
      if (!out.endsWith('…')) continue;
      const body = out.slice(0, -1);
      // Whatever it kept has to be a whole prefix of the original words.
      expect(LINE.startsWith(body), `budget ${budget} produced "${out}"`).toBe(true);
      const next = LINE[body.length];
      expect([' ', ',', undefined], `budget ${budget} cut inside "${out}"`).toContain(next);
    }
  });

  it('stays within the budget it was given', () => {
    for (let budget = 8; budget <= 60; budget++) {
      expect(trimToWords(LINE, budget).length, `budget ${budget}`).toBeLessThanOrEqual(budget);
    }
  });

  it('marks the cut, so it reads as deliberate', () => {
    expect(trimToWords(LINE, 30).endsWith('…')).toBe(true);
  });

  it('does not leave punctuation hanging before the ellipsis', () => {
    // "later,…" reads as a typo.
    expect(trimToWords('You can move the number later, but the one', 31)).toBe('You can move the number later…');
  });

  it('is the case that used to break: a label at 48 characters', () => {
    const label = 'You can move the number later, but the you picked on day';
    const out = trimToWords(label, 48);
    expect(out).not.toContain('picke…');
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(48);
  });
});

describe('a single word longer than the budget', () => {
  it('has to break mid-word, because there is no earlier boundary', () => {
    const out = trimToWords('Antidisestablishmentarianism', 10);
    expect(out.length).toBeLessThanOrEqual(10);
    expect(out.endsWith('…')).toBe(true);
  });

  it('still does not return an empty string', () => {
    expect(trimToWords('Antidisestablishmentarianism', 2).length).toBeGreaterThan(0);
  });
});
