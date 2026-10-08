import { readFile } from 'node:fs/promises';
import { env } from '@/lib/config/env';
import { packFor, repairUnitNumbers, repairUnitNumbersInText } from '@/lib/lang';
import { deriveSentences, normalizeWord } from './types';
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
      /*
       * English only, and Deepgram says so plainly: outside English the
       * fillers are stripped whatever this is set to. It costs nothing to
       * ask, and the loss is covered elsewhere — German says "also" and
       * "halt" where English says "um", and those are real words every ASR
       * transcribes, which `lib/lang` then recognises as fillers.
       */
      filler_words: 'true',
      utterances: 'true',
      diarize: String(options.diarize ?? false),
    });

    /*
     * Name the language when we know it, and let Deepgram listen when we do
     * not. Measured on German, French and Spanish: `detect_language=true`
     * returns the same transcript as naming the language outright, and
     * naming the WRONG one is a disaster — the German model on a German
     * voice got 49 words where the multilingual model got 49 and the English
     * model would have got nonsense.
     */
    if (options.languageHint) params.set('language', packFor(options.languageHint).asrCode);
    else params.set('detect_language', 'true');

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

    const language =
      json?.results?.channels?.[0]?.detected_language ?? options.languageHint ?? 'en';
    const pack = packFor(language);
    const fillers = pack.fillers;

    const rawWords: DeepgramWord[] = alternative.words ?? [];
    const words: TranscriptWord[] = rawWords.map((w) => {
      const display = w.punctuated_word ?? w.word;
      return {
        text: display,
        startSec: w.start,
        endSec: w.end,
        confidence: w.confidence ?? 1,
        speaker: w.speaker ?? 0,
        isFiller: fillers.has(normalizeWord(w.word)),
        endsSentence: /[.!?]$/.test(display),
      };
    });

    // `smart_format` writes "40 pour 100" where the speaker said "pour
    // cent". One token, measured, French and Spanish only.
    const repaired = repairUnitNumbers(words, pack);

    return {
      provider: this.name,
      language,
      durationSec: json?.metadata?.duration ?? (words.at(-1)?.endSec ?? 0),
      text: repairUnitNumbersInText(
        alternative.transcript ?? repaired.map((w) => w.text).join(' '),
        pack,
      ),
      words: repaired,
      sentences: deriveSentences(repaired, language),
    };
  }
}
