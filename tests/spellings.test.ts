import { describe, expect, it } from 'vitest';
import { applySpellings, cleanSpellings } from '@/lib/transcribe/spellings';
import type { Transcript } from '@/lib/transcribe/types';

function transcriptOf(text: string): Transcript {
  const words = text.split(' ').map((word, i) => ({
    text: word,
    startSec: i * 0.4,
    endSec: i * 0.4 + 0.35,
    confidence: 0.9,
    speaker: 0,
    isFiller: false,
    endsSentence: /[.!?]$/.test(word),
  }));
  return { provider: 'test', language: 'en', durationSec: words.length * 0.4, text, words, sentences: [] };
}

const said = (t: Transcript) => t.words.map((w) => w.text).join(' ');

describe('spelling names the way the creator wrote them', () => {
  it('fixes a misheard two-word name and keeps the punctuation', () => {
    const out = applySpellings(transcriptOf('Cloud Code just replaced video editors, inside of Cloud Code.'), ['Claude Code']);
    expect(said(out)).toBe('Claude Code just replaced video editors, inside of Claude Code.');
    expect(out.sentences.length).toBeGreaterThan(0);
  });

  it('joins a name heard as two words into one, over both timings', () => {
    const out = applySpellings(transcriptOf('go to easy cut. today'), ['EasyCut']);
    expect(said(out)).toBe('go to EasyCut. today');
    const name = out.words.find((w) => w.text.startsWith('EasyCut'))!;
    expect(name.startSec).toBeCloseTo(0.8);
    expect(name.endSec).toBeCloseTo(1.55);
  });

  it('fixes the case of a single-word name', () => {
    expect(said(applySpellings(transcriptOf('I use notion every day'), ['Notion']))).toBe('I use Notion every day');
  });

  it('leaves unrelated speech alone', () => {
    const text = 'the cloud is a computer somewhere else and code runs on it';
    expect(said(applySpellings(transcriptOf(text), ['Claude Code']))).toBe(text);
    expect(said(applySpellings(transcriptOf('a cat sat'), ['Cal']))).toBe('a cat sat');
  });

  it('cleans the list: trims, drops duplicates and empties, caps it', () => {
    expect(cleanSpellings([' Claude  Code ', 'claude code', '', '!!', 'EasyCut'])).toEqual(['Claude Code', 'EasyCut']);
    expect(cleanSpellings(Array.from({ length: 40 }, (_, i) => `Name${i}`))).toHaveLength(30);
  });
});
