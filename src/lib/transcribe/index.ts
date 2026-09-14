import { env } from '@/lib/config/env';
import { AssemblyAiProvider } from './assemblyai';
import { DeepgramProvider } from './deepgram';
import { GroqWhisperProvider } from './groq';
import { StubTranscriptionProvider } from './stub';
import type { Transcript, TranscribeOptions, TranscriptionProvider } from './types';

export * from './types';

const REGISTRY: Record<string, () => TranscriptionProvider> = {
  deepgram: () => new DeepgramProvider(),
  groq: () => new GroqWhisperProvider(),
  assemblyai: () => new AssemblyAiProvider(),
  stub: () => new StubTranscriptionProvider(),
};

/**
 * Providers in the order we'd like to use them. Deepgram first for filler-word
 * tokens, Groq second for price, AssemblyAI third for accuracy-under-noise.
 */
const AUTO_ORDER = ['deepgram', 'groq', 'assemblyai'] as const;

export function resolveTranscriptionProviders(): TranscriptionProvider[] {
  const preferred = env.transcription.preferred;

  if (preferred !== 'auto') {
    const chosen = REGISTRY[preferred]?.();
    if (chosen?.isConfigured()) {
      // Still keep the others as fallbacks — an outage shouldn't fail the job.
      const rest = AUTO_ORDER.map((k) => REGISTRY[k]()).filter(
        (p) => p.name !== chosen.name && p.isConfigured(),
      );
      return [chosen, ...rest, new StubTranscriptionProvider()];
    }
  }

  const configured = AUTO_ORDER.map((k) => REGISTRY[k]()).filter((p) => p.isConfigured());
  return [...configured, new StubTranscriptionProvider()];
}

export interface TranscribeResult {
  transcript: Transcript;
  costUsd: number;
  /** Providers that threw before one succeeded — surfaced in the job log. */
  attempts: Array<{ provider: string; error?: string }>;
}

/** Transcribes with automatic failover down the provider chain. */
export async function transcribeAudio(
  audioPath: string,
  durationSec: number,
  options: TranscribeOptions = {},
): Promise<TranscribeResult> {
  const providers = resolveTranscriptionProviders();
  const attempts: TranscribeResult['attempts'] = [];

  for (const provider of providers) {
    try {
      const transcript = await provider.transcribe(audioPath, options);
      // A real provider returning zero words on audio with sound is a failure,
      // not a silent video — fall through to the next one.
      if (provider.name !== 'stub' && transcript.words.length === 0 && durationSec > 2) {
        throw new Error('provider returned an empty transcript');
      }
      attempts.push({ provider: provider.name });
      return {
        transcript: { ...transcript, durationSec: transcript.durationSec || durationSec },
        costUsd: provider.estimateCostUsd(durationSec),
        attempts,
      };
    } catch (error) {
      attempts.push({ provider: provider.name, error: (error as Error).message });
    }
  }

  // Unreachable in practice — the stub never throws.
  throw new Error(`All transcription providers failed: ${JSON.stringify(attempts)}`);
}
