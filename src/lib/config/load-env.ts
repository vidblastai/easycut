import { loadEnvConfig } from '@next/env';

/**
 * Loads `.env` / `.env.local` for code that runs OUTSIDE Next.js — the worker
 * and the scripts.
 *
 * Next loads these itself for the app, so without this the worker and the web
 * app would silently disagree about configuration: the UI would report that
 * Deepgram is set up while the worker rendered captionless videos. Using Next's
 * own loader (rather than dotenv) guarantees identical file precedence.
 *
 * Import this FIRST, before anything that reads `process.env`.
 */
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production', {
  info: () => {},
  error: (...args: unknown[]) => console.error(...args),
});
