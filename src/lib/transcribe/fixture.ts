import { readFile } from 'node:fs/promises';
import { env } from '@/lib/config/env';
import { deriveSentences } from './types';
import type { Transcript, TranscriptionProvider, TranscriptWord } from './types';

/**
 * A transcript read from a file instead of from a microphone.
 *
 * This exists so the whole pipeline can be run without a network or a key:
 * the demo seed uses it, an end-to-end test can assert on exact cue timings,
 * and anyone who clones the repo can see a finished video before signing up
 * for anything.
 *
 * It is opt-in and loud about it. `ASR_PROVIDER=fixture` plus an explicit
 * `ASR_FIXTURE` path are both required — there is no discovery, no default
 * location, and no fallback to a bundled sample. A transcription provider that
 * could silently substitute prepared words for someone's actual speech is a
 * product that puts words in their mouth, so the only way to reach this one is
 * to name it and name the file.
 */
export class FixtureTranscriptionProvider implements TranscriptionProvider {
  readonly name = 'fixture';

  isConfigured(): boolean {
    return env.transcription.preferred === 'fixture' && Boolean(env.transcription.fixturePath);
  }

  estimateCostUsd(): number {
    return 0;
  }

  async transcribe(): Promise<Transcript> {
    const path = env.transcription.fixturePath;
    if (!path) throw new Error('ASR_FIXTURE is not set.');

    const raw = JSON.parse(await readFile(path, 'utf8')) as {
      language?: string;
      words: Array<{
        text: string;
        startSec: number;
        endSec: number;
        confidence?: number;
        isFiller?: boolean;
        speaker?: number;
      }>;
    };

    const words: TranscriptWord[] = raw.words.map((w) => ({
      text: w.text,
      startSec: w.startSec,
      endSec: w.endSec,
      confidence: w.confidence ?? 0.98,
      speaker: w.speaker ?? 0,
      isFiller: w.isFiller ?? false,
      // Punctuation is the only sentence signal a hand-written fixture has, and
      // it is the same one the real providers' punctuation models give us.
      endsSentence: /[.!?]$/.test(w.text),
    }));

    return {
      provider: this.name,
      language: raw.language ?? 'en',
      durationSec: words.length ? words[words.length - 1].endSec : 0,
      text: words.map((w) => w.text).join(' '),
      words,
      sentences: deriveSentences(words),
      degraded: false,
    };
  }
}
