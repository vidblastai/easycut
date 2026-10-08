import { ENGLISH } from './en';
import { GERMAN } from './de';
import { FRENCH } from './fr';
import { SPANISH } from './es';
import { deaccent, type LanguageCode, type LanguagePack } from './types';

export * from './types';
export { repairUnitNumbers, repairUnitNumbersInText } from './repair';

export const LANGUAGE_PACKS: Record<LanguageCode, LanguagePack> = {
  en: ENGLISH,
  de: GERMAN,
  fr: FRENCH,
  es: SPANISH,
};

export const SUPPORTED_LANGUAGES = Object.values(LANGUAGE_PACKS).map((p) => ({
  code: p.code,
  name: p.name,
  endonym: p.endonym,
}));

/**
 * The pack for a language tag, however it was spelled.
 *
 * ASR providers return "de", "de-DE", "DE" and occasionally "german"; the
 * browser sends "fr-CA". All of those mean the same table. Anything we have
 * no pack for falls back to English rather than failing, because an edit
 * made with the wrong function words is a worse edit, and an edit that
 * throws is no edit at all.
 */
export function packFor(language: string | undefined | null): LanguagePack {
  if (!language) return ENGLISH;
  const base = language.trim().toLowerCase().split(/[-_]/)[0];
  const byCode = LANGUAGE_PACKS[base as LanguageCode];
  if (byCode) return byCode;
  const byName = Object.values(LANGUAGE_PACKS).find(
    (p) => p.name.toLowerCase() === base || deaccent(p.endonym.toLowerCase()) === base,
  );
  return byName ?? ENGLISH;
}

export function isSupportedLanguage(language: string | undefined | null): boolean {
  if (!language) return false;
  const base = language.trim().toLowerCase().split(/[-_]/)[0];
  return base in LANGUAGE_PACKS;
}

/**
 * Which of the four a transcript is in, from the text alone.
 *
 * Not a replacement for the ASR's own answer — Deepgram's `detect_language`
 * is better informed, because it heard the audio. This exists for the cases
 * where nobody told us: a provider that returns no language, an imported
 * transcript, a fixture. And as a cross-check: a transcript whose words
 * disagree with the language stamped on it means the wrong ASR model ran,
 * which is worth saying out loud rather than quietly editing badly.
 *
 * Counts function-word hits, which is the oldest trick there is and the
 * right one here: the marker lists are short, the four languages share
 * almost none of them, and it costs nothing and needs no network.
 */
export function detectLanguage(text: string): { code: LanguageCode; confidence: number } {
  const words = text
    .toLowerCase()
    .split(/[^\p{L}']+/u)
    .filter((w) => w.length > 0)
    .slice(0, 600);

  if (words.length < 8) return { code: 'en', confidence: 0 };

  const counts = new Map<LanguageCode, number>();
  for (const pack of Object.values(LANGUAGE_PACKS)) {
    const markers = new Set(pack.markers.map((m) => deaccent(m)));
    let hits = 0;
    for (const word of words) if (markers.has(deaccent(word))) hits++;
    counts.set(pack.code, hits / words.length);
  }

  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  const [best, second] = ranked;
  // The margin, not the raw rate: "la" and "que" are French and Spanish
  // both, so what settles it is how far ahead the winner is.
  const margin = best[1] - (second?.[1] ?? 0);
  return { code: best[0], confidence: Math.min(1, margin * 8) };
}
