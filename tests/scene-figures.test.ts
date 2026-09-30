import { describe, expect, it } from 'vitest';
import { shapeOf } from '@/lib/edl/scene-fallback';

/**
 * Which spoken figures earn a full-frame scene, and what number they are.
 *
 * A big-number scene puts ONE figure on screen at a size you can read across a
 * room, so both halves have to be right: the wrong value is a lie, and a figure
 * that carries no meaning is a whole scene spent on nothing. Speech-to-text
 * writes what was said, so all of this arrives as words.
 */

const figure = (line: string) => {
  const shape = shapeOf(line);
  return shape?.kind === 'big-number' ? shape.headline : null;
};

describe('numbers said as words', () => {
  it('reads a plain one', () => {
    expect(figure('it took eleven minutes to finish')).toBe('11 minutes');
  });

  it('multiplies by the scale word after it', () => {
    /*
     * The matcher used to find the first number word and stop, so the word
     * doing all the work was never looked at — "one hundred dollars" came out
     * as the figure 1, and "three thousand users" as 3.
     */
    expect(figure('it cost one hundred dollars to run')).toBe('100 dollars');
    expect(figure('we signed up three thousand users last month')).toBe('3,000');
  });

  it('reads a scale word standing on its own', () => {
    expect(figure('that is a million times better than before')).toBe('1,000,000 times');
  });

  it('reads digits as written', () => {
    expect(figure('revenue grew 40% this quarter')).toBe('40%');
  });

  it('sets a suffix unit against the figure and a word apart from it', () => {
    // "2.5 x" and "40 %" read as typos at the size a big-number scene draws.
    expect(figure('we saw 2.5x more signups in the first week')).toBe('2.5x');
    expect(figure('it took eleven minutes to finish')).toBe('11 minutes');
  });
});

describe('figures not worth a scene', () => {
  /*
   * English uses "one" as a pronoun far more than as a quantity, and every one
   * of these used to produce a full-frame scene shouting "1" — with the word
   * torn out of the middle of the line printed underneath it.
   */
  it('refuses a bare one used as a pronoun', () => {
    expect(figure('but the one you picked on day one is the anchor')).toBeNull();
    expect(figure('no one showed up to the launch that day')).toBeNull();
  });

  it('keeps one where it is a measurement', () => {
    // "one minute" is a quantity and reads as one.
    expect(figure('it only took one minute to set up')).toBe('1 minute');
  });

  it('keeps a written 1, because a digit is somebody being deliberate', () => {
    expect(figure('conversion moved 1% after the change')).toBe('1%');
  });
});

describe('the line under the figure', () => {
  it('never ends mid-word', () => {
    const said = 'we signed up three thousand users last month and it changed everything for the team';
    const shape = shapeOf(said);
    expect(shape?.kind).toBe('big-number');

    const label = shape!.items[0];
    expect(label.endsWith('…')).toBe(true);
    // Whatever it kept has to end on a word that was finished — so the next
    // character in the line it came from is a boundary, not more letters.
    const kept = label.slice(0, -1);
    const rest = said.replace('three thousand ', '').slice(kept.length);
    expect(rest === '' || rest.startsWith(' '), `cut inside a word: "${label}"`).toBe(true);
  });

  it('is what was said with the figure taken out, not with a hole in it', () => {
    const shape = shapeOf('it cost one hundred dollars to run');
    expect(shape!.items[0]).not.toContain('hundred');
    expect(shape!.items[0]).toContain('cost');
  });
});
