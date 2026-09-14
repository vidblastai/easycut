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
