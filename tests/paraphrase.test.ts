import { describe, expect, it } from 'vitest';
import { coreOf, restatementEvidence } from '@/lib/timeline/paraphrase';
import {
  applicableFindings,
  applyRestatementReview,
  CLEANUP_PRESETS,
  findCleanupTargets,
  pendingRestatements,
  retakeKey,
  type RestatementRuling,
} from '@/lib/timeline/cleanup';
import { deriveSentences, type Transcript, type TranscriptWord } from '@/lib/transcribe/types';

/**
 * Lines of speech, laid out on a clock. Each line's words are spread evenly
 * across its span and a long enough gap is left between lines that
 * `deriveSentences` sees them as separate sentences.
 */
function speech(lines: Array<[text: string, startSec: number, endSec: number]>): Transcript {
  const words: TranscriptWord[] = [];
  for (const [text, startSec, endSec] of lines) {
    const parts = text.split(/\s+/).filter(Boolean);
    const each = (endSec - startSec) / parts.length;
    parts.forEach((part, i) => {
      words.push({
        text: part,
        startSec: startSec + i * each,
        endSec: startSec + (i + 1) * each,
        confidence: 1,
        speaker: 0,
        isFiller: false,
        endsSentence: /[.!?]$/.test(part),
      });
    });
  }
  return {
    provider: 'test',
    language: 'en',
    durationSec: words.at(-1)?.endSec ?? 0,
    text: words.map((w) => w.text).join(' '),
    words,
    sentences: deriveSentences(words),
  };
}

function retakesIn(transcript: Transcript) {
  return findCleanupTargets(transcript, CLEANUP_PRESETS.raw).filter((f) => f.kind === 'retake');
}

describe('taking the packaging off a sentence', () => {
  it('strips the announcement that a rewording is coming', () => {
    expect(coreOf("What I'm saying is you just need to begin.").tokens).toEqual([
      'you', 'just', 'must', 'start',
    ]);
    expect(coreOf("What I'm saying is it works.").announced).toBe(true);
    expect(coreOf('It works.').announced).toBe(false);
  });

  it('does not treat a word that merely starts with a frame as a frame', () => {
    // "so" must not eat the front of "software".
    expect(coreOf('Software is the moat.').tokens).toContain('softwar');
  });

  it('folds the ways people say the same instruction', () => {
    const a = coreOf('You have to start now.').tokens;
    const b = coreOf('You need to begin now.').tokens;
    const c = coreOf('You gotta kick off now.').tokens;
    expect(new Set(a)).toEqual(new Set(b));
    expect(new Set(a)).toEqual(new Set(c));
  });

  it('reads a number the same whether it was spoken or written', () => {
    expect(coreOf('We grew forty percent.').figures).toEqual(new Set(['40']));
    expect(coreOf('We grew 40%.').figures).toEqual(new Set(['40']));
  });
});

describe('the reworded retake', () => {
  it('catches a line said again in almost entirely different words', () => {
    // The case the old bag-of-words detector could never see: these two share
    // "you" and "to", and are the same sentence twice.
    const evidence = restatementEvidence(
      'So the point is you have to start.',
      "What I'm saying is you just need to begin.",
      0.8,
    );
    expect(evidence.verdict).toBe('restated');
    expect(evidence.reasons.join(' ')).toContain('rewording');
  });

  it('cuts the first take of a reworded line end to end', () => {
    const transcript = speech([
      ['So the point is you have to start.', 0, 2.2],
      ["What I'm saying is you just need to begin.", 3.2, 5.6],
    ]);
    const retake = retakesIn(transcript)[0];
    expect(retake).toBeDefined();
    expect(retake.startSec).toBe(0);
    expect(retake.endSec).toBeCloseTo(2.2, 5);
    expect(retake.confidence).toBeGreaterThan(CLEANUP_PRESETS.raw.confidenceFloor);
  });

  it('matches a swap of modal and verb that shares no content word with the first', () => {
    const evidence = restatementEvidence(
      'You should always shoot in log.',
      'You always want to film in log.',
      1,
    );
    expect(evidence.verdict).toBe('restated');
  });
});

describe('the sentences that only look like retakes', () => {
  it('leaves two steps of a list alone', () => {
    const evidence = restatementEvidence('Then you add the music.', 'Then you add the captions.', 2);
    expect(evidence.verdict).toBe('different');
    expect(evidence.reasons.join(' ')).toContain('moves on');
  });

  it('keeps both items in an enumeration', () => {
    const transcript = speech([
      ['First you need a tripod.', 0, 1.8],
      ['Second you need a light.', 2.9, 4.6],
    ]);
    expect(retakesIn(transcript)).toHaveLength(0);
  });

  it('keeps two different figures when the speaker had moved on', () => {
    const evidence = restatementEvidence(
      'Set the shutter to fifty.',
      'Set the shutter to one hundred.',
      4,
    );
    expect(evidence.verdict).toBe('different');
  });

  it('refuses to judge two sentences that share only function words', () => {
    const evidence = restatementEvidence('Do you know what I mean?', 'You know what I think?', 1);
    expect(evidence.verdict).toBe('different');
  });

  it('leaves a sentence that merely follows a rewording announcement', () => {
    // "In other words" is strong evidence, but not enough on its own — an
    // announced elaboration is still something the viewer needs to hear.
    const evidence = restatementEvidence(
      'This is the best camera under a thousand dollars.',
      'In other words, nothing else at this price comes close.',
      0.6,
    );
    expect(evidence.verdict).toBe('different');
  });
});

describe('the pairs nobody can settle from the words', () => {
  it('calls two figures said back to back a maybe, not a cut', () => {
    const evidence = restatementEvidence('We grew forty percent.', 'We grew fifty percent.', 0.4);
    expect(evidence.verdict).toBe('maybe');
  });

  it('keeps a maybe out of the edit until somebody reads it', () => {
    const transcript = speech([
      ['We grew forty percent.', 0, 1.6],
      ['We grew fifty percent.', 2.0, 3.6],
    ]);
    const findings = findCleanupTargets(transcript, CLEANUP_PRESETS.raw);
    const retake = findings.find((f) => f.kind === 'retake');
    expect(retake?.review?.needsReader).toBe(true);
    // Flagged in the panel…
    expect(pendingRestatements(findings)).toHaveLength(1);
    // …and not cut by anybody.
    expect(retake!.confidence).toBeLessThan(CLEANUP_PRESETS.raw.confidenceFloor);
    expect(applicableFindings(findings, CLEANUP_PRESETS.raw)).toHaveLength(0);
  });

  it('asks about the pair with both takes and the silence between them', () => {
    const transcript = speech([
      ['We grew forty percent.', 0, 1.6],
      ['We grew fifty percent.', 2.0, 3.6],
    ]);
    const [question] = pendingRestatements(findCleanupTargets(transcript, CLEANUP_PRESETS.raw));
    expect(question.earlier).toContain('forty');
    expect(question.later).toContain('fifty');
    expect(question.gapSec).toBeCloseTo(0.4, 5);
    expect(question.id).toBe('0.00>2.00');
  });
});

describe('folding in the second opinion', () => {
  const transcript = speech([
    ['We grew forty percent.', 0, 1.6],
    ['We grew fifty percent.', 2.0, 3.6],
  ]);
  const findings = () => findCleanupTargets(transcript, CLEANUP_PRESETS.raw);
  const ruling = (r: RestatementRuling) => new Map([[pendingRestatements(findings())[0].id, r]]);

  it('deletes the finding when the reader says they are two different claims', () => {
    const reviewed = applyRestatementReview(findings(), ruling({ verdict: 'different', keep: 'later' }));
    expect(reviewed.some((f) => f.kind === 'retake')).toBe(false);
  });

  it('cuts the earlier take when the reader says it was reworded', () => {
    const reviewed = applyRestatementReview(findings(), ruling({ verdict: 'restated', keep: 'later' }));
    const retake = reviewed.find((f) => f.kind === 'retake')!;
    expect(retake.startSec).toBe(0);
    expect(retake.confidence).toBeGreaterThan(CLEANUP_PRESETS.raw.confidenceFloor);
    expect(applicableFindings(reviewed, CLEANUP_PRESETS.raw)).toHaveLength(1);
  });

  it('moves the cut to the later take when the reader prefers the first one', () => {
    const reviewed = applyRestatementReview(
      findings(),
      ruling({ verdict: 'restated', keep: 'earlier' }),
    );
    const retake = reviewed.find((f) => f.kind === 'retake')!;
    expect(retake.startSec).toBeCloseTo(2.0, 5);
    expect(retake.endSec).toBeCloseTo(3.6, 5);
    expect(retake.text).toContain('fifty');
  });

  it('changes nothing when the reader is unsure, or never answered', () => {
    for (const rulings of [ruling({ verdict: 'unsure', keep: 'later' }), new Map()]) {
      const reviewed = applyRestatementReview(findings(), rulings);
      expect(reviewed.some((f) => f.kind === 'retake')).toBe(true);
      expect(applicableFindings(reviewed, CLEANUP_PRESETS.raw)).toHaveLength(0);
    }
  });

  it('never asks about footage the user already edited', () => {
    // A roughcut has had these decisions made by hand. Second-guessing them
    // is the fastest way to make the product feel like it is fighting you —
    // so there is nothing to read and nothing to cut.
    const already = findCleanupTargets(transcript, CLEANUP_PRESETS.roughcut);
    expect(already.some((f) => f.kind === 'retake')).toBe(false);
    expect(pendingRestatements(already)).toHaveLength(0);
  });

  it('names a pair the same way on every run', () => {
    const first = pendingRestatements(findings())[0].id;
    const second = pendingRestatements(findings())[0].id;
    expect(first).toBe(second);
    const retake = findings().find((f) => f.kind === 'retake')!;
    expect(retakeKey(retake.review!)).toBe(first);
  });
});

describe('the take that carries a condition', () => {
  it('cuts the plain take and keeps the qualified one', () => {
    // A viewer who hears only the second sentence has everything the first
    // one said, plus the caveat. Nothing is lost.
    const transcript = speech([
      ['It takes about ten minutes.', 0, 1.6],
      ['It takes ten minutes if your footage is already organised.', 2.6, 5.6],
    ]);
    const retake = retakesIn(transcript)[0];
    expect(retake).toBeDefined();
    expect(retake.startSec).toBe(0);
    expect(retake.review?.needsReader).toBe(false);
    expect(retake.confidence).toBeGreaterThan(CLEANUP_PRESETS.raw.confidenceFloor);
  });

  it('refuses to cut the condition on its own', () => {
    // The same pair the other way round. Cutting the earlier take now loses
    // the "if", and the video promises something it did not before.
    const transcript = speech([
      ['It takes ten minutes if your footage is already organised.', 0, 3.0],
      ['It takes about ten minutes.', 4.0, 5.6],
    ]);
    const findings = findCleanupTargets(transcript, CLEANUP_PRESETS.raw);
    const retake = findings.find((f) => f.kind === 'retake')!;
    expect(retake.review?.needsReader).toBe(true);
    expect(applicableFindings(findings, CLEANUP_PRESETS.raw)).toHaveLength(0);
    expect(retake.review?.reasons.join(' ')).toContain('condition');
  });
});

describe('still right about the easy cases', () => {
  it('cuts the first of two identical takes', () => {
    const transcript = speech([
      ['We grew forty percent last year.', 0, 2.2],
      ['We grew forty percent last year.', 3.0, 5.2],
    ]);
    const retake = retakesIn(transcript)[0];
    expect(retake.startSec).toBe(0);
    expect(retake.confidence).toBeGreaterThan(0.9);
  });

  it('keeps a tightened second take over a rambling first one', () => {
    const transcript = speech([
      ['We grew about forty percent last year I think.', 0, 2.7],
      ['We grew forty percent.', 3.4, 4.9],
    ]);
    expect(retakesIn(transcript)[0].startSec).toBe(0);
  });

  it('keeps the complete take when the retry was abandoned', () => {
    const transcript = speech([
      ['We grew about forty percent last year.', 0, 2.2],
      ['We grew forty', 3.4, 4.4],
    ]);
    const retake = retakesIn(transcript)[0];
    expect(retake.startSec).toBeCloseTo(3.4, 1);
  });

  it('scores a pair identically however many times it is asked', () => {
    const once = restatementEvidence('We grew forty percent.', 'We grew fifty percent.', 0.4);
    const twice = restatementEvidence('We grew forty percent.', 'We grew fifty percent.', 0.4);
    expect(twice).toEqual(once);
  });
});
