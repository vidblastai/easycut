import { describe, expect, it } from 'vitest';
import { punchMoments, type PunchScriptOptions } from '@/lib/edl/punch-script';
import type { TranscriptSentence } from '@/lib/transcribe/types';

/** Sentences laid end to end, so a test reads as a script rather than as times. */
function script(lines: string[], gap = 0.25, perWord = 0.33): TranscriptSentence[] {
  let at = 0;
  return lines.map((text, i) => {
    const startSec = at;
    const endSec = at + Math.max(1.4, text.split(/\s+/).length * perWord);
    at = endSec + gap;
    return { text, startSec, endSec, speaker: 0, wordStart: i, wordEnd: i + 1 };
  });
}

const run = (sentences: TranscriptSentence[], over: Partial<PunchScriptOptions> = {}) =>
  punchMoments({
    sentences,
    busy: [],
    hints: [],
    palette: ['push', 'ramp', 'speed-ramp', 'snap'],
    cadenceSec: [6, 10],
    durationSec: sentences[sentences.length - 1].endSec + 2,
    hookSec: 0,
    ...over,
  });

describe('what in a script earns a camera move', () => {
  /*
   * One line at a time.
   *
   * These tests are about what a sentence IS, not about which sentences
   * survive the thinning — and the thinning is right to refuse two punch-ins
   * on back-to-back sentences, which is what reading them out of a running
   * script would be asking it to do.
   */
  const find = (_lines: string[], text: string) =>
    run(script([text]), { cadenceSec: [1.5, 1.5] })[0];

  const lines = [
    'So I started this channel in my bedroom with a borrowed camera.',
    'It took about nine months to get to a hundred thousand subscribers.',
    'But here is the thing nobody tells you about that.',
    'Nobody cares how good your camera is.',
    'So what actually moves the needle?',
    'The thumbnail does almost all of the work for you.',
  ];

  it('finds the figure in the sentence that is built on one', () => {
    expect(find(lines, lines[1])?.signal).toBe('figure');
  });

  it('finds the sentence that turns', () => {
    expect(find(lines, lines[2])?.signal).toBe('pivot');
  });

  it('finds the absolute claim', () => {
    expect(find(lines, lines[3])?.signal).toBe('superlative');
  });

  it('finds the question', () => {
    expect(find(lines, lines[4])?.signal).toBe('question');
  });

  it('leaves an ordinary sentence alone', () => {
    // A zoom on this says LOOK AT THIS about a line that is just scene-setting,
    // which is how a camera move stops meaning anything.
    const plain = script(['I usually shoot these on a Tuesday afternoon in the kitchen.']);
    expect(run(plain, { cadenceSec: [60, 60], durationSec: 400 })).toHaveLength(0);
  });

  it('does not call a mid-clause "but" a pivot', () => {
    // A conjunction, not a reversal. Only the sentence that OPENS with the
    // turn is the sentence that turns.
    const mid = script(['I wanted to make it shorter but the edit ran long on me.']);
    expect(run(mid, { cadenceSec: [60, 60], durationSec: 400 })).toHaveLength(0);
  });

  it('does not call an everyday "every" an absolute claim', () => {
    const every = script(['I post a new one every Tuesday without really thinking about it.']);
    expect(run(every, { cadenceSec: [60, 60], durationSec: 400 })).toHaveLength(0);
  });
});

describe('the move a signal asks for', () => {
  const moveFor = (line: string) => {
    const s = script(['Filler line that earns nothing at all here.', line]);
    return run(s, { cadenceSec: [1.5, 1.5] })?.find(
      (m) => Math.abs(m.startSec - s[1].startSec) < 0.01,
    )?.move;
  };

  it('hits hardest on a figure and softest on a question', () => {
    expect(moveFor('That is ninety per cent of everything I make.')).toBe('snap');
    expect(moveFor('So where does all that time actually go?')).toBe('ramp');
  });

  it('never leaves the style’s palette, however emphatic the line', () => {
    // A documentary that lists two calm moves must not produce a crash zoom.
    const s = script(['It cost four hundred thousand pounds.']);
    const calm = run(s, { palette: ['push', 'ramp'], hookSec: 0 });
    expect(calm[0].move).toBe('ramp');
  });

  it('uses the push for a frame that simply has not changed', () => {
    const long = script(Array.from({ length: 14 }, (_, i) => `An ordinary line number ${'x'.repeat(i)} with nothing in it.`));
    const drift = run(long).filter((m) => m.signal === 'drift');
    expect(drift.length).toBeGreaterThan(0);
    expect(drift[0].move).toBe('push');
  });
});

describe('how long each one runs', () => {
  it('gives the slow push room and the emphasis none', () => {
    const lines = Array.from({ length: 12 }, () => 'An ordinary line with nothing in it at all.');
    lines[11] = 'That is ninety per cent.';
    const moments = run(script(lines));
    const drift = moments.find((m) => m.signal === 'drift')!;
    const figure = moments.find((m) => m.signal === 'figure');
    expect(drift.endSec - drift.startSec).toBeGreaterThan(4);
    if (figure) expect(figure.endSec - figure.startSec).toBeLessThanOrEqual(3.6);
  });

  it('holds a question through the sentence that answers it', () => {
    const s = script(['So what actually moves the needle?', 'The thumbnail does, almost entirely.']);
    const q = run(s).find((m) => m.signal === 'question')!;
    expect(q.endSec).toBeGreaterThan(s[1].startSec);
  });

  it('stops a push at a paragraph break rather than running through it', () => {
    // A pause longer than a breath is a new thought, and a creep across it
    // lands its tightest frame on something it is not about.
    const s = script(['One ordinary line here.', 'Another ordinary line here.']);
    s[1].startSec = s[0].endSec + 2.5;
    s[1].endSec = s[1].startSec + 2;
    const moments = punchMoments({
      sentences: s, busy: [], hints: [], palette: ['push'],
      cadenceSec: [1, 1], durationSec: s[1].endSec + 2, hookSec: 0,
    });
    const first = moments.find((m) => m.startSec === s[0].startSec);
    if (first) expect(first.endSec).toBeLessThan(s[1].startSec);
  });
});

describe('the rules that keep it from becoming a tic', () => {
  const emphatic = Array.from({ length: 20 }, (_, i) => `That one cost ${i + 2} hundred thousand pounds exactly.`);

  it('never repeats the same move twice running', () => {
    const moments = run(script(emphatic), { cadenceSec: [2, 3] });
    expect(moments.length).toBeGreaterThan(3);
    for (let i = 1; i < moments.length; i++) {
      expect(moments[i].move, `${i} repeats ${moments[i - 1].move}`).not.toBe(moments[i - 1].move);
    }
  });

  it('spends the style’s budget and no more', () => {
    const sentences = script(emphatic);
    const durationSec = sentences[sentences.length - 1].endSec + 2;
    const moments = run(sentences, { cadenceSec: [2, 3], durationSec });
    expect(moments.length).toBeLessThanOrEqual(Math.floor(durationSec / 2.5));
  });

  it('keeps them apart, so two never read as a wobble', () => {
    const moments = run(script(emphatic), { cadenceSec: [6, 10] });
    for (let i = 1; i < moments.length; i++) {
      expect(moments[i].startSec - moments[i - 1].startSec).toBeGreaterThanOrEqual(6 * 0.7);
      expect(moments[i].startSec).toBeGreaterThanOrEqual(moments[i - 1].endSec);
    }
  });

  it('places nothing at all where the style wants a locked-off frame', () => {
    // A cadence of zero means NEVER. Read as a step it was once an infinite
    // loop; read as a budget it would be every sentence in the video.
    expect(run(script(emphatic), { cadenceSec: [0, 0] })).toHaveLength(0);
  });

  it('spreads across the whole video rather than filling the front of it', () => {
    const sentences = script(emphatic);
    const durationSec = sentences[sentences.length - 1].endSec + 2;
    const moments = run(sentences, { cadenceSec: [6, 10], durationSec });
    expect(moments.at(-1)!.startSec).toBeGreaterThan(durationSec * 0.6);
  });
});

describe('what it has to stay out of the way of', () => {
  it('never moves the camera while something else owns the frame', () => {
    const sentences = script(Array.from({ length: 10 }, () => 'That is ninety per cent of it.'));
    const busy = [{ outStartSec: sentences[2].startSec - 0.2, outEndSec: sentences[5].endSec + 0.2 }];
    for (const m of run(sentences, { busy, cadenceSec: [2, 3] })) {
      expect(m.startSec < busy[0].outEndSec && m.endSec > busy[0].outStartSec).toBe(false);
    }
  });

  it('leaves the hook alone', () => {
    const sentences = script(Array.from({ length: 10 }, () => 'That is ninety per cent of it.'));
    for (const m of run(sentences, { hookSec: 8, cadenceSec: [2, 3] })) {
      expect(m.startSec).toBeGreaterThanOrEqual(8);
    }
  });

  it('counts an insert as the frame changing, so it does not then call it drift', () => {
    const sentences = script(Array.from({ length: 12 }, () => 'An ordinary line with nothing in it.'));
    const busy = [{ outStartSec: sentences[5].startSec, outEndSec: sentences[6].endSec }];
    const after = run(sentences, { busy }).filter((m) => m.startSec > busy[0].outEndSec && m.startSec < busy[0].outEndSec + 12);
    expect(after.every((m) => m.signal !== 'drift')).toBe(true);
  });
});

describe('the director as a hint', () => {
  const lines = [
    'An ordinary line with nothing in it at all.',
    'Another ordinary line with nothing in it.',
    'But here is the thing nobody tells you.',
    'A third ordinary line with nothing in it.',
    'Nobody cares what camera you shoot on.',
  ];

  it('prefers the moment the director pointed at, between two of equal weight', () => {
    const sentences = script(lines);
    const only = (hints: number[]) =>
      punchMoments({
        sentences, busy: [], hints, palette: ['push', 'ramp', 'speed-ramp', 'snap'],
        cadenceSec: [40, 40], durationSec: sentences.at(-1)!.endSec + 2, hookSec: 0,
      });
    // One slot in the budget, and two sentences that both earn one.
    expect(only([sentences[4].startSec])[0].startSec).toBe(sentences[4].startSec);
    expect(only([sentences[2].startSec])[0].startSec).toBe(sentences[2].startSec);
  });

  it('does not place one where the script says nothing, however sure it is', () => {
    const plain = script(['I usually shoot these on a Tuesday afternoon in the kitchen.']);
    expect(run(plain, { hints: [plain[0].startSec], cadenceSec: [60, 60], durationSec: 400 })).toHaveLength(0);
  });
});

describe('the reason it carries', () => {
  it('names the signal and quotes the line', () => {
    const s = script(['It took nine months to get to a hundred thousand subscribers.']);
    const [moment] = run(s);
    expect(moment.reason).toContain('a figure');
    expect(moment.reason).toContain('It took nine months');
  });
});

describe('the register a swap has to stay inside', () => {
  it('leaves two slow pushes alone, because nobody sees either of them', () => {
    // A repeat only matters for a move you notice. The first version of the
    // variety rule promoted the second push to a speed-ramp, which put an
    // emphasis on a sentence whose only qualification was that nothing had
    // happened for a while.
    const long = script(Array.from({ length: 24 }, () => 'An ordinary line with nothing in it at all.'));
    const drifts = run(long, { cadenceSec: [4, 6] }).filter((m) => m.signal === 'drift');
    expect(drifts.length).toBeGreaterThan(2);
    expect(drifts.every((m) => m.move === 'push')).toBe(true);
  });

  it('keeps a creep inside the style’s attention span', () => {
    // A style that cuts away every four seconds must not hold an eleven
    // second push: that is not punctuation any more, it is the video slowly
    // zooming in.
    const long = script(Array.from({ length: 24 }, () => 'An ordinary line with nothing in it at all.'));
    const quick = run(long, { cadenceSec: [3, 5] }).filter((m) => m.signal === 'drift');
    const slow = run(long, { cadenceSec: [20, 30] }).filter((m) => m.signal === 'drift');
    expect(Math.max(...quick.map((m) => m.endSec - m.startSec))).toBeLessThan(7);
    expect(Math.max(...slow.map((m) => m.endSec - m.startSec))).toBeGreaterThan(7);
  });
});
