import { describe, expect, it } from 'vitest';
import { brollPrompt } from '@/lib/assets/broll-prompt';
import {
  findInspo,
  inspoForInsert,
  MAX_INSPO,
  parseInspo,
  sanitiseInspo,
  sceneLookForInspo,
  VISUAL_INSPO,
} from '@/lib/assets/visual-inspo';
import { SCENE_LOOKS } from '@/lib/edl/types';

describe('the inspo catalogue', () => {
  it('has unique ids, and every look maps to a real scene world', () => {
    const ids = VISUAL_INSPO.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const inspo of VISUAL_INSPO) expect(SCENE_LOOKS, inspo.id).toContain(inspo.sceneLook);
  });

  it('never asks a model for people or lettering in its own words', () => {
    for (const inspo of VISUAL_INSPO) expect(inspo.look, inspo.id).not.toMatch(/\b(person|people|face|text|sign|logo)\b/i);
  });
});

describe('reading the picks', () => {
  it('keeps known ids, in order, once each, at most three', () => {
    expect(sanitiseInspo(['anime', 'nope', 'anime', 'clay-3d', 'neon-night', 'cinematic'])).toEqual([
      'anime',
      'clay-3d',
      'neon-night',
    ]);
    expect(sanitiseInspo('anime')).toEqual([]);
    expect(MAX_INSPO).toBe(3);
  });

  it('survives a bad stored value', () => {
    expect(parseInspo('not json')).toEqual([]);
    expect(parseInspo(null)).toEqual([]);
    expect(parseInspo('["cinematic"]')).toEqual(['cinematic']);
  });

  it('cycles the picks across made inserts, in the order picked', () => {
    const picks = ['anime', 'cinematic'];
    expect([0, 1, 2, 3].map((i) => inspoForInsert(picks, i)?.id)).toEqual(['anime', 'cinematic', 'anime', 'cinematic']);
    expect(inspoForInsert([], 0)).toBeNull();
  });

  it('takes the scene world from the first pick', () => {
    expect(sceneLookForInspo(['neon-night', 'clay-3d'])).toBe('neon');
    expect(sceneLookForInspo([])).toBeNull();
  });
});

describe('what a made insert is asked for', () => {
  it('swaps the realism for the picked look', () => {
    const prompt = brollPrompt('an espresso machine on a counter', 'still', findInspo('clay-3d'));
    expect(prompt).toContain('clay render');
    expect(prompt).not.toMatch(/not stylised/);
  });

  it('keeps the two rules whatever the look', () => {
    for (const inspo of VISUAL_INSPO) {
      for (const medium of ['still', 'clip'] as const) {
        const prompt = brollPrompt('a barista making coffee', medium, inspo);
        expect(prompt, inspo.id).toMatch(/NO PEOPLE/);
        expect(prompt, inspo.id).toMatch(/No text of any kind/);
        expect(prompt, inspo.id).toMatch(/OBJECTS and the SPACE only/);
      }
    }
  });

  it('is unchanged with no pick, or with the realistic one', () => {
    const plain = brollPrompt('a harbour', 'clip');
    expect(brollPrompt('a harbour', 'clip', null)).toBe(plain);
    expect(brollPrompt('a harbour', 'clip', findInspo('documentary'))).toBe(plain);
  });
});
