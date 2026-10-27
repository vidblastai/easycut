import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  auditComposition,
  buildCompositionHtml,
  isFatal,
  parseComposition,
  systemPrompt,
} from '@/lib/director/hyperframe';
import { REFERENCE_LINES, referenceFor, referencePath } from '@/lib/director/reference-scene';
import { SCENE_LOOKS, type SceneLook } from '@/lib/edl/types';

const LOOKS = Object.keys(REFERENCE_LINES) as SceneLook[];
const WORDS: Record<string, Array<{ text: string; atSec: number }>> = JSON.parse(
  readFileSync('src/lib/director/references/words.json', 'utf8'),
);

describe('the per-look references', () => {
  it('cover every look added after the first six, and science', () => {
    for (const look of ['science', 'paper', 'ink', 'blueprint', 'riso', 'pixel', 'chalk', 'scope', 'graph', 'glass', 'clay', 'poster', 'diorama', 'pencil'] as const) {
      expect(LOOKS).toContain(look);
    }
    for (const look of LOOKS) expect(SCENE_LOOKS).toContain(look);
  });

  it.each(LOOKS)('%s parses, has its concept, and passes the audit it is held up as the bar for', (look) => {
    const parts = parseComposition(readFileSync(referencePath(look), 'utf8'));
    expect(parts).not.toBeNull();
    expect(parts!.concept.length).toBeGreaterThan(20);
    expect(auditComposition(parts!).filter(isFatal)).toEqual([]);
  });

  it.each(LOOKS.filter((look) => look !== 'science'))('%s keeps the word timings it was checked against', (look) => {
    expect(WORDS[look]?.length).toBeGreaterThan(8);
  });

  it('shows the composer the reference in its own look, and science to the rest', () => {
    expect(referenceFor('clay').look).toBe('clay');
    expect(referenceFor('studio').look).toBe('science');
    const clay = systemPrompt(1080, 1920, 5, 'clay');
    expect(clay).toContain(REFERENCE_LINES.clay);
    expect(clay).toContain('same world you are drawing in');
    const studio = systemPrompt(1080, 1920, 5, 'studio');
    expect(studio).toContain(REFERENCE_LINES.science);
    expect(studio).toContain('in another world');
  });

  it('passes on the traps the references were debugged through', () => {
    const prompt = systemPrompt(1080, 1920, 5, 'pixel');
    expect(prompt).toContain('immediateRender: false');
    expect(prompt).toContain('round line cap');
    expect(prompt).toContain('easeEach');
  });
});

describe('the page every scene runs in', () => {
  const parts = parseComposition(readFileSync(referencePath('scope'), 'utf8'))!;
  const html = buildCompositionHtml(parts, { width: 1080, height: 1920, durationSec: 5, ground: '#020804', words: [] });

  it('tweens strokeDashoffset without rounding it to whole pixels', () => {
    expect(html).toContain('gsap.registerPlugin({\n  name: "strokeDashoffset"');
  });

  it('matches a whole word before a word that merely contains it', () => {
    expect(html).toContain('WORDS.find((w) => clean(w.text) === needle)');
    // The regex survives the template literal it is written in.
    expect(html).toContain("replace(/[^\\p{L}\\p{N}']/gu");
  });
});
