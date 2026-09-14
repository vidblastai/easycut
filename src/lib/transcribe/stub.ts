import { deriveSentences } from './types';
import type { Transcript, TranscriptionProvider, TranscriptWord } from './types';

/**
 * The keyless fallback. It does not invent words — inventing a transcript would
 * produce captions that say something the person never said, which is the single
 * worst failure this product could ship.
 *
 * Instead it produces an EMPTY word list with the real duration. The pipeline
 * then degrades honestly: silence-based edit only, no captions, and the UI tells
 * the user that captions need a transcription key.
 */
export class StubTranscriptionProvider implements TranscriptionProvider {
  readonly name = 'stub';

  isConfigured(): boolean {
    return true;
  }

  estimateCostUsd(): number {
    return 0;
  }

  async transcribe(_audioPath: string): Promise<Transcript> {
    const words: TranscriptWord[] = [];
    return {
      provider: this.name,
      language: 'en',
      durationSec: 0,
      text: '',
      words,
      sentences: deriveSentences(words),
      degraded: true,
    };
  }
}
