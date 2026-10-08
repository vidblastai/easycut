import type { LanguagePack } from './types';

/**
 * Undo the one thing an ASR's smart formatter gets wrong outside English.
 *
 * Deepgram's `smart_format` is worth having: it writes "40%" instead of
 * "forty percent", formats dates and currency, and makes captions read like
 * text rather than a transcript. In French and Spanish it also reads the
 * unit as a numeral, and the captions come out as
 *
 *     "on a grandi d'environ 40 pour 100"      (said: pour cent)
 *     "crecimos un 40 por 100"                 (said: por ciento)
 *
 * which is wrong on screen in a way a native speaker notices immediately.
 * Measured against the live API, not assumed — both languages, both the
 * named-language and the auto-detect call.
 *
 * The repair is narrow on purpose. It fires only on "<figure> pour 100",
 * where the preceding number makes it unambiguously a percentage: "cent
 * euros" is a real amount and must survive. One token changes, the timings
 * are untouched, and English never enters this function.
 */

const UNIT_FIXES: Partial<Record<string, { connector: string; wrong: string; right: string }>> = {
  fr: { connector: 'pour', wrong: '100', right: 'cent' },
  es: { connector: 'por', wrong: '100', right: 'ciento' },
};

export function repairUnitNumbers<T extends { text: string }>(words: T[], pack: LanguagePack): T[] {
  const fix = UNIT_FIXES[pack.code];
  if (!fix) return words;

  let repaired = false;
  const out = words.map((word, i) => {
    const bare = word.text.replace(/[^\p{L}\p{N}]/gu, '');
    if (bare !== fix.wrong) return word;
    if (words[i - 1]?.text.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase() !== fix.connector) return word;
    if (!/\d/.test(words[i - 2]?.text ?? '')) return word;
    repaired = true;
    // Keep whatever punctuation rode along with the number.
    return { ...word, text: word.text.replace(fix.wrong, fix.right) };
  });

  return repaired ? out : words;
}

/** The same repair over a joined transcript string, for `Transcript.text`. */
export function repairUnitNumbersInText(text: string, pack: LanguagePack): string {
  const fix = UNIT_FIXES[pack.code];
  if (!fix) return text;
  return text.replace(
    new RegExp(`(\\d[\\d.,]*\\s+${fix.connector}\\s+)${fix.wrong}\\b`, 'gi'),
    `$1${fix.right}`,
  );
}
