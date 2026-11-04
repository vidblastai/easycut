import { describe, expect, it } from 'vitest';
import { SCENE_LOOKS, TEXT_SCENE_LOOKS, sceneHasText } from '@/lib/edl/types';
import { STYLE_GUIDES, isTextLook } from '@/lib/scenes/style-guides';
import { auditComposition, systemPrompt } from '@/lib/director/hyperframe';

describe('text-led scene looks', () => {
  it('are exactly the looks whose guide sets typography', () => {
    const fromGuides = SCENE_LOOKS.filter((look) => Boolean(STYLE_GUIDES[look].typography));
    expect([...TEXT_SCENE_LOOKS].sort()).toEqual([...fromGuides].sort());
    expect(isTextLook('signal')).toBe(true);
    expect(isTextLook('science')).toBe(false);
  });

  it('take the captions away while their clip plays, and only theirs', () => {
    const scene = { id: 's', outStartSec: 0, outEndSec: 4, headline: '', items: [], clipUrl: '/x.mp4' } as never;
    expect(sceneHasText({ ...(scene as object), look: 'signal' } as never)).toBe(true);
    expect(sceneHasText({ ...(scene as object), look: 'science' } as never)).toBe(false);
  });

  it('may put words on screen; the other looks still may not', () => {
    const parts = { concept: 'x', style: '', markup: '<div id="scene"><div>$35 million</div></div>', script: 'tl.to("#scene",{opacity:1,duration:1},0);' };
    expect(auditComposition(parts as never).some((f) => f.includes('words on screen'))).toBe(true);
    expect(auditComposition(parts as never, { allowText: true }).some((f) => f.includes('words on screen'))).toBe(false);
  });

  it('get a prompt about type instead of the no-text rule', () => {
    const text = systemPrompt(1920, 1080, 8, 'slate');
    expect(text).toContain('Show what is being said');
    expect(text).not.toContain('No text of any kind');
    expect(systemPrompt(1080, 1920, 5, 'science')).toContain('No text of any kind');
  });
});
