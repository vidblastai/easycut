import { readFile } from 'node:fs/promises';
import { env } from '@/lib/config/env';
import { deriveSentences, FILLER_LEXICON, normalizeWord } from './types';
import type { Transcript, TranscribeOptions, TranscriptionProvider, TranscriptWord } from './types';

/**
 * AssemblyAI is the third option, kept because it has the best accuracy on
 * accented English and noisy rooms. It is also the slowest of the three (it
 * polls a job rather than answering inline), so it's never the auto-pick.
 *
 * Pricing: $0.12 / hour (Universal, async).
 */
const BASE = 'https://api.assemblyai.com/v2';
const USD_PER_HOUR = 0.12;
const POLL_INTERVAL_MS = 1500;
const MAX_POLLS = 400;

export class AssemblyAiProvider implements TranscriptionProvider {
  readonly name = 'assemblyai';

  isConfigured(): boolean {
    return Boolean(env.transcription.assemblyaiKey);
  }

  estimateCostUsd(durationSec: number): number {
    return (durationSec / 3600) * USD_PER_HOUR;
  }

  async transcribe(audioPath: string, options: TranscribeOptions = {}): Promise<Transcript> {
    const key = env.transcription.assemblyaiKey;
    if (!key) throw new Error('ASSEMBLYAI_API_KEY is not set');
    const headers = { authorization: key };

    const uploaded = await fetch(`${BASE}/upload`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/octet-stream' },
      body: new Uint8Array(await readFile(audioPath)),
    });
    if (!uploaded.ok) throw new Error(`AssemblyAI upload ${uploaded.status}`);
    const { upload_url } = (await uploaded.json()) as { upload_url: string };

    const created = await fetch(`${BASE}/transcript`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        audio_url: upload_url,
        speech_model: 'universal',
        punctuate: true,
        format_text: true,
        disfluencies: true,
        speaker_labels: options.diarize ?? false,
        language_code: options.languageHint,
      }),
    });
    if (!created.ok) throw new Error(`AssemblyAI create ${created.status}`);
    const { id } = (await created.json()) as { id: string };

    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const polled = await fetch(`${BASE}/transcript/${id}`, { headers });
      const job = (await polled.json()) as any;

      if (job.status === 'error') throw new Error(`AssemblyAI: ${job.error}`);
      if (job.status !== 'completed') continue;

      const words: TranscriptWord[] = (job.words ?? []).map((w: any) => ({
        text: w.text,
        startSec: w.start / 1000,
        endSec: w.end / 1000,
        confidence: w.confidence ?? 1,
        speaker: typeof w.speaker === 'string' ? w.speaker.charCodeAt(0) - 65 : 0,
        isFiller: FILLER_LEXICON.has(normalizeWord(w.text)),
        endsSentence: /[.!?]$/.test(w.text),
      }));

      return {
        provider: this.name,
        language: job.language_code ?? 'en',
        durationSec: (job.audio_duration ?? 0) || (words.at(-1)?.endSec ?? 0),
        text: job.text ?? '',
        words,
        sentences: deriveSentences(words),
      };
    }
    throw new Error('AssemblyAI transcription timed out');
  }
}
