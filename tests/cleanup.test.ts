import { describe, expect, it } from 'vitest';
import { CLEANUP_PRESETS, applicableFindings, findCleanupTargets } from '@/lib/timeline/cleanup';
import { deriveSentences, type Transcript, type TranscriptWord } from '@/lib/transcribe/types';

function words(spec: Array<[text: string, start: number, end: number]>): TranscriptWord[] {
  return spec.map(([text, startSec, endSec]) => ({
    text,
    startSec,
    endSec,
    confidence: 1,
    speaker: 0,
    isFiller: false,
    endsSentence: /[.!?]$/.test(text),
  }));
}

function transcriptOf(list: TranscriptWord[]): Transcript {
  return {
    provider: 'test',
    language: 'en',
    durationSec: list.at(-1)?.endSec ?? 0,
    text: list.map((w) => w.text).join(' '),
    words: list,
    sentences: deriveSentences(list),
  };
}

describe('filler removal', () => {
  it('cuts an "um" that sits alone in its own pocket of silence', () => {
    const transcript = transcriptOf(
      words([
        ['So', 0, 0.3],
        ['um', 0.9, 1.2], // 0.6s of air on the left
        ['anyway', 2.0, 2.5], // 0.8s on the right
      ]),
    );
    const findings = findCleanupTargets(transcript, CLEANUP_PRESETS.raw);
    const filler = findings.find((f) => f.kind === 'filler');
    expect(filler).toBeDefined();
    expect(filler!.confidence).toBeGreaterThan(0.9);
  });

  it('only flags an "um" wedged inside a sentence, never auto-cuts it', () => {
    // Removing this one would leave an audible click mid-phrase.
    const transcript = transcriptOf(
      words([
        ['it', 0, 0.2],
        ['um', 0.21, 0.35],
        ['works', 0.36, 0.7],
      ]),
    );
    const findings = findCleanupTargets(transcript, CLEANUP_PRESETS.raw);
    const applied = applicableFindings(findings, CLEANUP_PRESETS.raw);

    expect(findings.some((f) => f.kind === 'filler')).toBe(true);
    expect(applied).toHaveLength(0);
  });
});

describe('stammer removal', () => {
  it('keeps the last of a tight repetition', () => {
    const transcript = transcriptOf(
      words([
        ['the', 0, 0.15],
        ['the', 0.16, 0.3],
        ['the', 0.31, 0.45],
        ['point', 0.46, 0.9],
      ]),
    );
    const stammer = findCleanupTargets(transcript, CLEANUP_PRESETS.raw).find((f) => f.kind === 'stammer');
    expect(stammer).toBeDefined();
    // The final "the" survives — the removal ends before it starts.
    expect(stammer!.endSec).toBeCloseTo(0.3, 5);
  });

  it('leaves deliberate emphasis alone', () => {
    // "very, very good" — spaced out, so it is rhetoric, not a stumble.
    const transcript = transcriptOf(
      words([
        ['very', 0, 0.4],
        ['very', 0.8, 1.2],
        ['good', 1.3, 1.7],
      ]),
    );
    expect(findCleanupTargets(transcript, CLEANUP_PRESETS.raw).some((f) => f.kind === 'stammer')).toBe(false);
  });
});

describe('false starts and retakes', () => {
  it('drops a run-up that the next sentence restarts', () => {
    const transcript = transcriptOf(
      words([
        ['The', 0, 0.2], ['thing', 0.2, 0.5], ['about', 0.5, 0.8],
        // The beat of hesitation before restarting is what makes this a
        // separate utterance rather than one continuous sentence.
        ['The', 1.9, 2.1], ['thing', 2.1, 2.4], ['about', 2.4, 2.7], ['pricing', 2.7, 3.2], ['is', 3.2, 3.4], ['simple.', 3.4, 3.9],
      ]),
    );
    const finding = findCleanupTargets(transcript, CLEANUP_PRESETS.raw).find((f) => f.kind === 'false-start');
    expect(finding).toBeDefined();
    expect(finding!.startSec).toBe(0);
  });

  it('keeps the last take when a line is delivered twice', () => {
    const transcript = transcriptOf(
      words([
        ['We', 0, 0.2], ['grew', 0.2, 0.6], ['forty', 0.6, 1.0], ['percent', 1.0, 1.5], ['last', 1.5, 1.8], ['year.', 1.8, 2.2],
        ['We', 3.0, 3.2], ['grew', 3.2, 3.6], ['forty', 3.6, 4.0], ['percent', 4.0, 4.5], ['last', 4.5, 4.8], ['year.', 4.8, 5.2],
      ]),
    );
    const retake = findCleanupTargets(transcript, CLEANUP_PRESETS.raw).find((f) => f.kind === 'retake');
    expect(retake).toBeDefined();
    // The EARLIER attempt is the one removed — people retry until they get it right.
    expect(retake!.startSec).toBe(0);
    expect(retake!.endSec).toBeCloseTo(2.2, 5);
  });

  it('does not re-cut footage the user already edited', () => {
    const transcript = transcriptOf(
      words([
        ['The', 0, 0.2], ['thing', 0.2, 0.5], ['about', 0.5, 0.8],
        ['The', 1.9, 2.1], ['thing', 2.1, 2.4], ['about', 2.4, 2.7], ['pricing.', 2.7, 3.2],
      ]),
    );
    const findings = findCleanupTargets(transcript, CLEANUP_PRESETS.roughcut);
    expect(findings.some((f) => f.kind === 'false-start')).toBe(false);
    expect(findings.some((f) => f.kind === 'retake')).toBe(false);
  });
});

describe('which take survives', () => {
  it('keeps a shorter restatement when the speaker finished it', () => {
    // Four words against nine, and the second is the better take: tighter,
    // and it ends. Length alone would have thrown it away and kept the
    // rambling first attempt.
    const transcript = transcriptOf(
      words([
        ['We', 0, 0.2], ['grew', 0.2, 0.5], ['about', 0.5, 0.8], ['forty', 0.8, 1.1],
        ['percent', 1.1, 1.5], ['last', 1.5, 1.8], ['year', 1.8, 2.1], ['I', 2.1, 2.3], ['think.', 2.3, 2.7],
        ['We', 3.4, 3.6], ['grew', 3.6, 4.0], ['forty', 4.0, 4.4], ['percent.', 4.4, 4.9],
      ]),
    );
    const retake = findCleanupTargets(transcript, CLEANUP_PRESETS.raw).find((f) => f.kind === 'retake');
    expect(retake).toBeDefined();
    expect(retake!.startSec).toBe(0);
  });

  it('still keeps the first take when the retry was abandoned', () => {
    // No terminator on the second: the speaker trailed off, and the fragment
    // is not the take anybody wants.
    const transcript = transcriptOf(
      words([
        ['We', 0, 0.2], ['grew', 0.2, 0.5], ['about', 0.5, 0.8], ['forty', 0.8, 1.1],
        ['percent', 1.1, 1.5], ['last', 1.5, 1.8], ['year.', 1.8, 2.2],
        ['We', 3.4, 3.6], ['grew', 3.6, 4.0], ['forty', 4.0, 4.4],
      ]),
    );
    const retake = findCleanupTargets(transcript, CLEANUP_PRESETS.raw).find((f) => f.kind === 'retake');
    if (retake) expect(retake.startSec).toBeCloseTo(3.4, 1);
  });
});

/**
 * The three repeats a real 40-second upload kept, and why each survived.
 *
 * Every fixture here is the exact words and timings from
 * `out/user/IMG_4836.MOV`, transcribed by Deepgram. They are grouped
 * together because they were reported together — "there are multiple repeats
 * where I also mess up and then repeat again, and that was left in" — and
 * because two of the three had the same root cause.
 */
describe('the repeats that were left in a real cut', () => {
  const preset = CLEANUP_PRESETS.raw;
  const applied = (t: Transcript) =>
    findCleanupTargets(t, preset).filter((f) => f.confidence >= preset.confidenceFloor);

  it('cuts the clause the speaker abandoned and keeps the hook', () => {
    // "Cloud Code just replaced video editors, but not..." is the opening
    // line of the video. Everything before "but" is the hook; "but not..." is
    // a thought that goes nowhere. Cutting the sentence would have cost the
    // opening line, so only the clause goes.
    const transcript = transcriptOf(
      words([
        ['Cloud', 0.8, 1.12], ['Code', 1.12, 1.44], ['just', 1.44, 1.68],
        ['replaced', 1.68, 2.16], ['video', 2.16, 2.56], ['editors,', 2.56, 3.2],
        ['but', 3.2, 3.36], ['not...', 3.36, 3.92],
      ]),
    );
    const [cut] = applied(transcript);
    expect(cut.kind).toBe('false-start');
    expect(cut.startSec).toBeCloseTo(3.2, 2);
    expect(cut.endSec).toBeCloseTo(3.92, 2);
  });

  it('cuts a fragment that is nothing but the run-up', () => {
    // "It's really really..." — three words, no landing. The ellipsis is why
    // this survived: `/[.!?]$/` matches "...", so every detector that asked
    // whether the speaker finished the sentence was told yes.
    const transcript = transcriptOf(
      words([
        ['It’s', 22.61, 23.0], ['really', 23.0, 23.4], ['really...', 23.4, 23.8],
        ['So', 24.29, 24.45], ['I', 24.45, 24.61], ['really', 24.61, 25.0],
        ['recommend', 25.0, 25.5], ['it.', 25.5, 25.9],
      ]),
    );
    const cut = applied(transcript).find((f) => f.startSec < 24);
    expect(cut).toBeDefined();
    expect(cut!.startSec).toBeCloseTo(22.61, 2);
    expect(cut!.endSec).toBeGreaterThanOrEqual(23.8);
  });

  it('cuts a finished sentence the speaker restarted at greater length', () => {
    // He got the domain wrong, stopped, and said the whole line again with
    // more on the end. The guard that was blocking this exists to protect
    // "We grew forty percent." / "We grew fifty percent." — two facts with a
    // shared opening — and the test below keeps that protection.
    const transcript = transcriptOf(
      words([
        ['You', 27.96, 28.2], ['only', 28.2, 28.5], ['have', 28.5, 28.7],
        ['to', 28.7, 28.8], ['go', 28.8, 29.0], ['to', 29.0, 29.1],
        ['easycut.com.', 29.1, 30.28],
        ['You', 30.36, 30.6], ['only', 30.6, 30.8], ['have', 30.8, 30.95],
        ['to', 30.95, 31.03], ['go', 31.03, 31.11], ['to', 31.11, 31.27],
        ['easycut.i,', 31.27, 32.0], ['put', 32.0, 32.3], ['in', 32.3, 32.5],
        ['your', 32.5, 32.7], ['footage,', 32.7, 33.2], ['and', 33.2, 33.4],
        ['it', 33.4, 33.6], ['does', 33.6, 33.9], ['everything.', 33.9, 34.4],
      ]),
    );
    const cut = applied(transcript).find((f) => f.kind === 'false-start');
    expect(cut).toBeDefined();
    expect(cut!.startSec).toBeCloseTo(27.96, 2);
    expect(cut!.endSec).toBeLessThanOrEqual(30.4);
  });

  it('cuts a repeated phrase, not just a repeated word', () => {
    // "and it and it literally does everything else". No word here is
    // immediately followed by itself, so the stammer pass found nothing.
    const transcript = transcriptOf(
      words([
        ['footage,', 32.95, 33.43], ['and', 33.43, 33.51], ['it', 33.51, 33.75],
        ['and', 33.75, 34.39], ['it', 34.47, 34.63], ['literally', 34.63, 35.03],
        ['does', 35.03, 35.35], ['everything', 35.35, 35.75], ['else.', 35.75, 36.23],
      ]),
    );
    const cut = applied(transcript).find((f) => f.kind === 'stammer');
    expect(cut).toBeDefined();
    // The LAST copy is the keeper, so the cut is the first "and it".
    expect(cut!.startSec).toBeCloseTo(33.43, 2);
    expect(cut!.endSec).toBeCloseTo(33.75, 2);
  });

  it('reports one finding per thing cut', () => {
    // Two passes reach "It's really really..." from different directions.
    // The removals merge either way; the COUNT the customer is shown should
    // not say two.
    const transcript = transcriptOf(
      words([
        ['It’s', 0, 0.4], ['really', 0.4, 0.8], ['really...', 0.8, 1.2],
        ['So', 1.6, 1.8], ['anyway', 1.8, 2.3], ['that', 2.3, 2.5],
        ['is', 2.5, 2.7], ['that.', 2.7, 3.1],
      ]),
    );
    const starts = applied(transcript).filter(
      (f) => f.kind === 'false-start' && f.startSec < 1.5,
    );
    expect(starts).toHaveLength(1);
  });
});

describe('what must stay in', () => {
  const preset = CLEANUP_PRESETS.raw;
  const applied = (t: Transcript) =>
    findCleanupTargets(t, preset).filter((f) => f.confidence >= preset.confidenceFloor);

  it('keeps two finished facts that happen to share an opening', () => {
    const transcript = transcriptOf(
      words([
        ['We', 0, 0.3], ['grew', 0.3, 0.6], ['forty', 0.6, 1.0], ['percent.', 1.0, 1.5],
        ['We', 1.7, 2.0], ['grew', 2.0, 2.3], ['fifty', 2.3, 2.7], ['percent.', 2.7, 3.2],
      ]),
    );
    expect(applied(transcript).filter((f) => f.kind === 'false-start')).toEqual([]);
  });

  it('keeps a deliberate repeat, which comes punctuated and slower', () => {
    const transcript = transcriptOf(
      words([
        ['It', 0, 0.3], ['goes', 0.3, 0.7], ['up,', 0.7, 1.3],
        ['and', 1.3, 1.6], ['up,', 1.6, 2.2], ['and', 2.2, 2.5], ['up.', 2.5, 3.1],
      ]),
    );
    expect(applied(transcript).filter((f) => f.kind === 'stammer')).toEqual([]);
  });

  it('keeps a trail-off with no clause boundary to cut at', () => {
    // "the whole thing was kind of..." — walking back four words finds no
    // word that can open a clause, so any cut would land mid-phrase.
    const transcript = transcriptOf(
      words([
        ['The', 0, 0.3], ['whole', 0.3, 0.6], ['thing', 0.6, 0.9],
        ['was', 0.9, 1.2], ['kind', 1.2, 1.5], ['of...', 1.5, 2.0],
        ['Anyway.', 3.5, 4.2],
      ]),
    );
    expect(applied(transcript).filter((f) => f.kind === 'false-start')).toEqual([]);
  });

  it('never cuts a clause out of a sentence we split ourselves', () => {
    // A piece of a broken-up long sentence ends without a terminator by
    // construction; it is not a trail-off.
    const transcript = transcriptOf(
      words(
        ('In Berlin last summer we rebuilt the whole pipeline from scratch, '
          + 'and it took the team about four months of solid work to get it finished.')
          .split(' ')
          .map((w, i) => [w, i * 0.35, i * 0.35 + 0.3] as [string, number, number]),
      ),
    );
    expect(transcript.sentences.some((s) => s.split)).toBe(true);
    expect(applied(transcript).filter((f) => f.kind === 'false-start')).toEqual([]);
  });
});

describe('a trail-off that is a hook, not a mistake', () => {
  const preset = CLEANUP_PRESETS.raw;

  it('keeps a short trail-off held for effect', () => {
    // "And the best part is..." then a beat, then the reveal. The pause is
    // the device; cutting the line would cut the setup.
    const transcript = transcriptOf(
      words([
        ['And', 0, 0.3], ['the', 0.3, 0.5], ['best', 0.5, 0.9],
        ['part', 0.9, 1.3], ['is...', 1.3, 1.8],
        ['It', 3.4, 3.6], ['is', 3.6, 3.8], ['free.', 3.8, 4.3],
      ]),
    );
    const findings = findCleanupTargets(transcript, preset);
    const fragment = findings.find((f) => f.startSec < 2);
    // Flagged for a reader, not cut.
    expect(fragment?.confidence).toBeLessThan(preset.confidenceFloor);
  });

  it('cuts the same shape when the speaker came straight back', () => {
    const transcript = transcriptOf(
      words([
        ['And', 0, 0.3], ['the', 0.3, 0.5], ['best', 0.5, 0.9],
        ['part', 0.9, 1.3], ['is...', 1.3, 1.8],
        ['The', 2.1, 2.3], ['best', 2.3, 2.7], ['part', 2.7, 3.1],
        ['is', 3.1, 3.3], ['it', 3.3, 3.5], ['is', 3.5, 3.7], ['free.', 3.7, 4.2],
      ]),
    );
    const findings = findCleanupTargets(transcript, preset);
    const fragment = findings.find((f) => f.startSec < 2);
    expect(fragment?.confidence).toBeGreaterThanOrEqual(preset.confidenceFloor);
  });

  it('never auto-cuts a trail-off that ends the video', () => {
    const transcript = transcriptOf(
      words([
        ['So', 0, 0.3], ['yeah.', 0.3, 0.8],
        ['It', 1.2, 1.4], ['is', 1.4, 1.6], ['just...', 1.6, 2.2],
      ]),
    );
    const findings = findCleanupTargets(transcript, preset);
    const last = findings.find((f) => f.startSec >= 1.2);
    expect(last?.confidence ?? 0).toBeLessThan(preset.confidenceFloor);
  });
});

/**
 * The failure that was worse than the one being fixed.
 *
 * Teaching the false-start pass to see a restart made two passes reach the
 * same pair of takes. The false-start pass cut the earlier attempt to keep
 * the later one; the restatement reader, asked about the same pair, said keep
 * the EARLIER — the first take had the right domain in it — and so cut the
 * later. Both removals applied and the line vanished from the video. On the
 * reported upload that line was the whole call to action.
 */
describe('two passes that disagree about which take to keep', () => {
  const preset = CLEANUP_PRESETS.raw;

  const pair = () => [
    {
      kind: 'false-start' as const,
      startSec: 28,
      endSec: 30.4,
      text: 'You only have to go to easycut.com.',
      confidence: 0.9,
      keeps: { startSec: 30.4, endSec: 36.2 },
    },
    {
      kind: 'retake' as const,
      startSec: 30.4,
      endSec: 36.2,
      text: 'You only have to go to easycut.i, put in your footage.',
      confidence: 0.88,
      keeps: { startSec: 28, endSec: 30.4 },
    },
  ];

  it('leaves exactly one take in the video', () => {
    const cuts = applicableFindings(pair(), preset);
    expect(cuts).toHaveLength(1);
    // The more confident pass decides; the other stands down.
    expect(cuts[0]).toEqual({ startSec: 28, endSec: 30.4 });
  });

  it('decides the other way when the reader is the more confident one', () => {
    const [falseStart, retake] = pair();
    const cuts = applicableFindings(
      [{ ...falseStart, confidence: 0.7 }, { ...retake, confidence: 0.94 }],
      preset,
    );
    expect(cuts).toEqual([{ startSec: 30.4, endSec: 36.2 }]);
  });

  it('still applies both when they are not about the same pair', () => {
    const [falseStart, retake] = pair();
    const cuts = applicableFindings(
      [falseStart, { ...retake, startSec: 50, endSec: 54, keeps: { startSec: 54, endSec: 58 } }],
      preset,
    );
    expect(cuts).toHaveLength(2);
  });

  it('counts two small removals together against one keeper', () => {
    const cuts = applicableFindings(
      [
        { kind: 'filler', startSec: 10, endSec: 11, text: 'a', confidence: 0.95 },
        { kind: 'filler', startSec: 11, endSec: 12, text: 'b', confidence: 0.94 },
        {
          kind: 'retake',
          startSec: 20,
          endSec: 22,
          text: 'c',
          confidence: 0.8,
          keeps: { startSec: 10, endSec: 12 },
        },
      ],
      preset,
    );
    // Neither filler covers half the keeper; between them they cover all of
    // it, so the retake that was trading for it stands down.
    expect(cuts).toHaveLength(2);
    expect(cuts.some((c) => c.startSec === 20)).toBe(false);
  });
});
