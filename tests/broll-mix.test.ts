import { describe, expect, it } from 'vitest';
import { makingShare, sourceForQuery, wantsMaking } from '@/lib/assets/broll-mix';
import type { BrollSource } from '@/lib/assets/ai-broll';

const all = (_s: BrollSource): boolean => true;
const stockOnly = (s: BrollSource): boolean => s === 'stock';

const mixed = (query: string, available: (s: BrollSource) => boolean = all) =>
  sourceForQuery(query, { chosen: 'mixed', available });

describe('what a camera could have been pointed at', () => {
  it('sends the library the shots it is full of', () => {
    for (const q of [
      'a developer at a desk',
      'hands typing on a laptop',
      'a city street at night',
      'coffee being poured',
      'a team meeting in an office',
    ]) {
      expect(wantsMaking(q), q).toBe(false);
      expect(mixed(q), q).toBe('stock');
    }
  });

  it('makes the ones no library has', () => {
    for (const q of [
      'the algorithm deciding what you see',
      'a notification dashboard',
      'burnout',
      'a glowing holographic interface',
    ]) {
      expect(wantsMaking(q), q).toBe(true);
      expect(mixed(q), q).toBe('ai-image');
    }
  });

  it('treats a described scene as one nobody filmed, even with a camera word in it', () => {
    // "desk" is in the stock list and this is still not a thing that exists
    // in a library — a long query is a picture somebody imagined.
    expect(wantsMaking('a glowing dashboard floating above a desk at midnight')).toBe(true);
  });

  it('leans to the library when it cannot tell', () => {
    // Stock is free and instant, so an uncertain call should cost nothing
    // rather than three cents and ten seconds.
    expect(mixed('a bridge')).toBe('stock');
  });
});

describe('what the wizard asked for still wins', () => {
  it('returns a forced source unchanged, whatever the words say', () => {
    expect(sourceForQuery('burnout', { chosen: 'stock', available: all })).toBe('stock');
    expect(sourceForQuery('hands typing on a laptop', { chosen: 'ai-image', available: all })).toBe('ai-image');
    expect(sourceForQuery('a city street', { chosen: 'ai-video', available: all })).toBe('ai-video');
  });

  it('falls back to the library rather than leaving a hole', () => {
    // The same direction the asset stage already falls: a missing key costs
    // the treatment, never the insert.
    expect(sourceForQuery('burnout', { chosen: 'ai-image', available: stockOnly })).toBe('stock');
    expect(mixed('burnout', stockOnly)).toBe('stock');
  });
});

describe('quoting a mixed edit', () => {
  it('reports the share that will be made, not all or nothing', () => {
    const queries = [
      'hands typing on a laptop',
      'a city street at night',
      'the algorithm deciding what you see',
      'a team meeting in an office',
    ];
    expect(makingShare(queries)).toBeCloseTo(0.25, 5);
    expect(makingShare([])).toBe(0);
  });
});
