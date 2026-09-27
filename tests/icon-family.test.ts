import { describe, expect, it } from 'vitest';
import { bestInSet, cardTerms, chooseFamily } from '../src/lib/assets/icon-cards';

/**
 * Picking the icons, before any of them is fetched.
 *
 * Two failures this guards against, both of which look like a design decision
 * rather than a bug once they are on screen: a video whose icons come from
 * four different illustrators, and an icon that is confidently the wrong
 * object.
 */

describe('the best match inside one set', () => {
  it('does not take whatever the search returned first', () => {
    // The real case that forced the ranking: searching "money" returns a
    // money-mouth face ahead of the money bag, because the index ranks by its
    // own relevance and not by what a card should show.
    const icons = ['noto:money-mouth-face', 'noto:money-with-wings', 'noto:money-bag'];
    expect(bestInSet(icons, 'noto', 'money')).toBe('noto:money-bag');
  });

  it('prefers the exact name over any compound', () => {
    expect(bestInSet(['noto:banana-bread', 'noto:banana'], 'noto', 'banana')).toBe('noto:banana');
  });

  it('prefers a compound that starts with the word over one that merely contains it', () => {
    expect(bestInSet(['noto:bandage-scissors', 'noto:scissors-blade'], 'noto', 'scissors'))
      .toBe('noto:scissors-blade');
  });

  it('breaks a tie on the shorter name, which is the more general object', () => {
    expect(bestInSet(['noto:house-with-garden', 'noto:house-fire'], 'noto', 'house')).toBe('noto:house-fire');
  });

  it('ignores every other set', () => {
    expect(bestInSet(['openmoji:banana'], 'noto', 'banana')).toBeNull();
  });

  it('cannot save a genuinely ambiguous word — which is what the object map is for', () => {
    /*
     * "video" has no exact icon and two equally-ranked compounds: a video
     * camera and a video game. Nothing about the name tells you which one a
     * sentence about editing meant, and the shorter-name tie-break picks the
     * games console. That is not a ranking bug to fix, it is the limit of
     * ranking — `cardTerms` never asks for "video" in the first place.
     */
    const icons = ['noto:video-game', 'noto:video-camera'];
    expect(bestInSet(icons, 'noto', 'video')).toBe('noto:video-game');
    // "video" is still in the ladder, but below "clapper board", and the
    // ladder stops at the first term that matches anything.
    const terms = cardTerms('video editing');
    expect(terms.indexOf('clapper board')).toBeLessThan(terms.indexOf('video'));
  });
});

describe('the family rule', () => {
  it('gives the video to whichever set answers the most of its words', () => {
    const candidates = [
      new Map([['openmoji', 'openmoji:banana'], ['noto', 'noto:banana']]),
      new Map([['openmoji', 'openmoji:apple']]),
      new Map([['openmoji', 'openmoji:grapes']]),
    ];
    expect(chooseFamily(candidates)).toBe('openmoji');
  });

  it('falls back to the preference order when two sets cover the same number', () => {
    const candidates = [new Map([['openmoji', 'openmoji:banana'], ['noto', 'noto:banana']])];
    expect(chooseFamily(candidates)).toBe('noto');
  });

  it('answers nothing when nothing matched, rather than a set with no icons in it', () => {
    expect(chooseFamily([new Map(), new Map()])).toBeNull();
  });
});

describe('what gets searched for', () => {
  it('asks for the phrase first, so a query that names an object gets it', () => {
    expect(cardTerms('banana')[0]).toBe('banana');
  });

  it('puts the mapped object SECOND, where the ladder will actually reach it', () => {
    /*
     * The ladder stops at the first term that matches anything, and a single
     * word out of the query almost always matches something. With the mapping
     * at the bottom, "video editing" reached "video" and stopped on a games
     * console while "clapper board" waited below it.
     */
    expect(cardTerms('video editing').slice(0, 2)).toEqual(['video editing', 'clapper board']);
    expect(cardTerms('my audience')[1]).toBe('busts in silhouette');
  });

  it('maps abstractions onto things somebody has actually drawn', () => {
    // An emoji set has no "revenue" and no "growth". It has a money bag.
    expect(cardTerms('our revenue')).toContain('money bag');
    expect(cardTerms('the deadline')).toContain('hourglass');
    expect(cardTerms('total burnout')).toContain('sleeping face');
  });

  it('leaves a concrete noun alone', () => {
    expect(cardTerms('banana')).not.toContain('money bag');
  });
});
