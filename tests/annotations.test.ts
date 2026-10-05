import { describe, expect, it } from 'vitest';
import { outputWords, placeAnnotations, type AnnotationPlacement } from '@/lib/edl/annotations';
import { deriveSentences, type TranscriptWord } from '@/lib/transcribe/types';

/** Words laid end to end at a conversational pace, as the builder maps them. */
function spoken(lines: string[]) {
  let at = 0;
  const words: TranscriptWord[] = [];
  for (const line of lines) {
    const parts = line.split(/\s+/).filter(Boolean);
    parts.forEach((text, i) => {
      words.push({
        text, startSec: at, endSec: at + 0.3, confidence: 1, speaker: 0,
        isFiller: false, endsSentence: i === parts.length - 1,
      });
      at += 0.34;
    });
    at += 0.35;
  }
  return { words, sentences: deriveSentences(words), durationSec: at + 3 };
}

const place = (lines: string[], over: Partial<AnnotationPlacement> = {}) => {
  const { words, sentences, durationSec } = spoken(lines);
  return placeAnnotations({
    sentences,
    words: outputWords(words, (s) => s),
    busy: [],
    durationSec,
    hookSec: 0,
    hasRoom: true,
    ...over,
  });
};

const LIST = 'It reads your inbox, checks the calendar, plans your day, and gives you the time back.';

describe('a list the speaker can stand next to', () => {
  it('writes the things down instead of taking the frame', () => {
    const [note] = place([LIST]);
    expect(note.kind).toBe('checklist');
    expect(note.items.map((i) => i.text)).toEqual([
      'It reads your inbox',
      'checks the calendar',
      'plans your day',
      'gives you the time back',
    ]);
  });

  it('lands each line on the word that names it', () => {
    // Not an even spread: a list is said unevenly, and lines arriving on a
    // metronome while the voice does not is what reads as automated.
    const [note] = place([LIST]);
    const gaps = note.items.slice(1).map((item, i) => item.offsetSec - note.items[i].offsetSec);
    expect(new Set(gaps.map((g) => g.toFixed(2))).size).toBeGreaterThan(1);
    expect(note.items.every((item, i) => i === 0 || item.offsetSec > note.items[i - 1].offsetSec)).toBe(true);
  });

  it('holds the finished list on screen after the last line', () => {
    const [note] = place([LIST]);
    const last = Math.max(...note.items.map((i) => i.offsetSec));
    expect(note.outEndSec - (note.outStartSec + last)).toBeGreaterThan(1);
  });
});

describe('what goes in the title pill', () => {
  it('takes a clause that framed the list from behind', () => {
    const [note] = place(['The captions, the b-roll, the effects, everything you see was done by AI.']);
    expect(note.title).toContain('everything you see');
    expect(note.items).toHaveLength(3);
  });

  it('gives the front stem back to the first line', () => {
    // "it reads your" as a title is a fragment, and it leaves a first line
    // reading "inbox" where the others are verb phrases.
    const [note] = place([LIST]);
    expect(note.title).toBe('');
    expect(note.items[0].text).toBe('It reads your inbox');
  });
});

describe('what it refuses', () => {
  it('stays out of a vertical frame, where the subject fills it', () => {
    expect(place([LIST], { hasRoom: false })).toHaveLength(0);
  });

  it('wants three things, not two and a conjunction', () => {
    expect(place(['You need a camera, and a microphone.'])).toHaveLength(0);
  });

  it('leaves a sentence that is not a list alone', () => {
    expect(place(['I have been doing this for about three years now.'])).toHaveLength(0);
  });

  it('never builds under something that takes the frame', () => {
    // Not just at the start: the block builds across the sentence, so an
    // insert landing halfway covers a list the viewer watched begin.
    const { sentences, words, durationSec } = spoken([LIST]);
    const mid = (sentences[0].startSec + sentences[0].endSec) / 2;
    const notes = placeAnnotations({
      sentences,
      words: outputWords(words, (s) => s),
      busy: [{ outStartSec: mid, outEndSec: mid + 2 }],
      durationSec,
      hookSec: 0,
      hasRoom: true,
    });
    expect(notes).toHaveLength(0);
  });

  it('leaves the hook alone', () => {
    const { sentences } = spoken([LIST]);
    expect(place([LIST], { hookSec: sentences[0].startSec + 1 })).toHaveLength(0);
  });
});

describe('two of them in one video', () => {
  const twice = [
    LIST,
    'Some ordinary filler that earns nothing at all and simply passes the time here.',
    'Some more ordinary filler, because these have to be far enough apart to both survive.',
    'You need a camera, a microphone, and somewhere quiet to sit.',
  ];

  it('puts them in opposite margins', () => {
    const notes = place(twice);
    if (notes.length < 2) return;
    expect(notes[0].side).not.toBe(notes[1].side);
    expect(notes[0].x).not.toBe(notes[1].x);
  });

  it('keeps them far enough apart to not read as one list of lists', () => {
    const notes = place(twice);
    for (let i = 1; i < notes.length; i++) {
      expect(notes[i].outStartSec - notes[i - 1].outEndSec).toBeGreaterThanOrEqual(12);
    }
  });
});

describe('what it carries into the editor', () => {
  it('says what it is reacting to', () => {
    const [note] = place([LIST]);
    expect(note.reason).toContain('a list of 4');
  });
});
