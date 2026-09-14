import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { env } from '@/lib/config/env';
import { deriveSentences, FILLER_LEXICON, normalizeWord } from './types';
import type { Transcript, TranscribeOptions, TranscriptionProvider, TranscriptWord } from './types';

/**
 * Groq's hosted Whisper large-v3-turbo is the cheapest credible ASR available:
 * $0.04 per hour of audio, roughly 6× cheaper than Deepgram, and absurdly fast
 * (~200× realtime).
 *
 * The trade-off is real though — Whisper drops disfluencies by design, so filler
 * removal degrades to "cut the silence where the um was". That's why this is the
 * fallback rather than the default.
 */
const ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const USD_PER_HOUR = 0.04;

export class GroqWhisperProvider implements TranscriptionProvider {
  readonly name = 'groq-whisper';

  isConfigured(): boolean {
    return Boolean(env.transcription.groqKey);
  }

  estimateCostUsd(durationSec: number): number {
    return (durationSec / 3600) * USD_PER_HOUR;
  }

  async transcribe(audioPath: string, options: TranscribeOptions = {}): Promise<Transcript> {
    const key = env.transcription.groqKey;
    if (!key) throw new Error('GROQ_API_KEY is not set');

    const fileStat = await stat(audioPath);
    const form = new FormData();
    // Node 22 can stream a file into FormData via Blob-from-stream; for the
    // modest sizes we send (16 kHz mono WAV) a buffer is simpler and faster.
    const chunks: Buffer[] = [];
    for await (const chunk of createReadStream(audioPath)) chunks.push(chunk as Buffer);
    const blob = new Blob([new Uint8Array(Buffer.concat(chunks))], { type: 'audio/wav' });

    form.set('file', blob, basename(audioPath));
    form.set('model', 'whisper-large-v3-turbo');
    form.set('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    form.append('timestamp_granularities[]', 'segment');
    if (options.languageHint) form.set('language', options.languageHint);

    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Groq ${response.status}: ${body.slice(0, 400)} (file ${fileStat.size} bytes)`);
    }

    const json = (await response.json()) as any;
    const words: TranscriptWord[] = (json.words ?? []).map((w: any) => ({
      text: w.word,
      startSec: w.start,
      endSec: w.end,
      confidence: 1,
      speaker: 0,
      isFiller: FILLER_LEXICON.has(normalizeWord(w.word)),
      endsSentence: /[.!?]$/.test(w.word),
    }));

    return {
      provider: this.name,
      language: json.language ?? options.languageHint ?? 'en',
      durationSec: json.duration ?? (words.at(-1)?.endSec ?? 0),
      text: json.text ?? '',
      words,
      sentences: deriveSentences(words),
    };
  }
}
