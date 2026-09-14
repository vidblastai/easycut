import { readFile } from 'node:fs/promises';
import { env } from '@/lib/config/env';
import { deriveSentences, FILLER_LEXICON, normalizeWord } from './types';
import type { Transcript, TranscribeOptions, TranscriptionProvider, TranscriptWord } from './types';

/**
 * Deepgram Nova-3 is the default because of one feature nothing else has at this
 * price: `filler_words=true` returns "um"/"uh" as real tokens with timestamps
 * instead of silently discarding them. Removing fillers is half of what makes
 * raw footage watchable, and guessing where they were is hopeless.
 *
 * Pricing: $0.0043 / minute of audio (pay-as-you-go, pre-recorded).
 */
const ENDPOINT = 'https://api.deepgram.com/v1/listen';
const USD_PER_MINUTE = 0.0043;

interface DeepgramWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
  punctuated_word?: string;
  speaker?: number;
}

export class DeepgramProvider implements TranscriptionProvider {
  readonly name = 'deepgram';

  isConfigured(): boolean {
    return Boolean(env.transcription.deepgramKey);
  }

  estimateCostUsd(durationSec: number): number {
    return (durationSec / 60) * USD_PER_MINUTE;
  }

  async transcribe(audioPath: string, options: TranscribeOptions = {}): Promise<Transcript> {
    const key = env.transcription.deepgramKey;
    if (!key) throw new Error('DEEPGRAM_API_KEY is not set');

    const params = new URLSearchParams({
      model: 'nova-3',
      smart_format: 'true',
      punctuate: 'true',
      paragraphs: 'true',
      filler_words: 'true',
      utterances: 'true',
      diarize: String(options.diarize ?? false),
    });
    if (options.languageHint) params.set('language', options.languageHint);

    const audio = await readFile(audioPath);

    const response = await fetch(`${ENDPOINT}?${params}`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${key}`,
        'Content-Type': 'audio/wav',
      },
      body: new Uint8Array(audio),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Deepgram ${response.status}: ${body.slice(0, 400)}`);
    }

    const json = (await response.json()) as any;
    const alternative = json?.results?.channels?.[0]?.alternatives?.[0];
    if (!alternative) throw new Error('Deepgram returned no alternatives');

    const rawWords: DeepgramWord[] = alternative.words ?? [];
    const words: TranscriptWord[] = rawWords.map((w) => {
      const display = w.punctuated_word ?? w.word;
      return {
        text: display,
        startSec: w.start,
        endSec: w.end,
        confidence: w.confidence ?? 1,
        speaker: w.speaker ?? 0,
        isFiller: FILLER_LEXICON.has(normalizeWord(w.word)),
        endsSentence: /[.!?]$/.test(display),
      };
    });

    return {
      provider: this.name,
      language: json?.results?.channels?.[0]?.detected_language ?? options.languageHint ?? 'en',
      durationSec: json?.metadata?.duration ?? (words.at(-1)?.endSec ?? 0),
      text: alternative.transcript ?? words.map((w) => w.text).join(' '),
      words,
      sentences: deriveSentences(words),
    };
  }
}
