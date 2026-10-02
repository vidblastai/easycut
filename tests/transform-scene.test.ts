import { describe, expect, it } from 'vitest';
import { shapeOf, transformPair } from '@/lib/edl/scene-fallback';

/**
 * One thing becoming another.
 *
 * Drawn as two photographs with an arrow between them, so the detector has two
 * jobs and the second one is the harder: find the sentences that really are a
 * transformation, and refuse the ones where both sides are ideas. A scene that
 * tries to photograph "confidence" illustrates a mood, and a mood is exactly
 * what a stock library will cheerfully hand back.
 */

describe('sentences that are a transformation', () => {
  it('reads the plain form', () => {
    expect(transformPair('a seedling becomes a banana tree')).toEqual(['seedling', 'banana tree']);
  });

  it('reads the other verbs that mean the same thing', () => {
    for (const verb of ['turns into', 'grows into', 'develops into', 'ends up as']) {
      expect(transformPair(`a green banana ${verb} a ripe banana`), verb).toEqual(['green banana', 'ripe banana']);
    }
  });

  it('reads it said the other way round', () => {
    expect(transformPair('from a seedling to a full grown tree')).toEqual(['seedling', 'full grown tree']);
  });

  it('survives the clause people actually add on the end', () => {
    /*
     * "A seedling becomes a banana tree IN ABOUT NINE MONTHS" is the same
     * transformation as the version that stops at "tree". Anchoring the match
     * to the end of the sentence missed every one that said how long it took —
     * and the trailing clause then went to the figure matcher, so the sentence
     * came out as a scene about the number nine.
     */
    expect(transformPair('a tiny seedling becomes a banana tree in about nine months'))
      .toEqual(['tiny seedling', 'banana tree']);
    expect(shapeOf('a tiny seedling becomes a banana tree in about nine months')?.kind).toBe('transform');
  });

  it('drops the article, because the search does not want it', () => {
    expect(transformPair('the raw footage turns into the finished video'))
      .toEqual(['raw footage', 'finished video']);
  });
});

describe('sentences that are not', () => {
  it('refuses two abstractions', () => {
    // Nothing to point a camera at, and the stock library will answer anyway.
    expect(transformPair('doubt becomes confidence over time')).toBeNull();
    expect(transformPair('a problem becomes an opportunity')).toBeNull();
  });

  it('refuses a pronoun, which names something only the viewer is holding', () => {
    expect(transformPair('it becomes a tree eventually')).toBeNull();
    expect(transformPair('that turns into a habit')).toBeNull();
  });

  it('refuses a side too long to be a thing', () => {
    expect(transformPair('the way you have always done your invoicing becomes a problem')).toBeNull();
  });

  it('refuses a thing becoming itself', () => {
    expect(transformPair('a tree becomes a tree')).toBeNull();
  });

  it('leaves an ordinary sentence alone', () => {
    expect(transformPair('we signed up three thousand users last month')).toBeNull();
    expect(transformPair('you can record once and post everywhere')).toBeNull();
  });
});

describe('how it beats the other shapes', () => {
  it('wins over the list detector, which sees two nouns and calls it a pair', () => {
    /*
     * An orbit of two chips says the things belong together. The sentence
     * claims one BECAME the other, which is the only thing it actually says,
     * and the direction is the whole point of the picture.
     */
    const shape = shapeOf('a banana seedling becomes a banana tree');
    expect(shape?.kind).toBe('transform');
    expect(shape?.items).toEqual(['banana seedling', 'banana tree']);
  });

  it('leaves the two sides in the order they were said', () => {
    // Reversed, the arrow points from the tree to the seed.
    expect(shapeOf('a seed becomes a tree')?.items).toEqual(['seed', 'tree']);
  });

  it('carries no headline of its own', () => {
    // The pictures say it. A line of type over them is the scene explaining
    // the thing it is already showing.
    expect(shapeOf('a seed becomes a tree')?.headline).toBe('');
  });
});
