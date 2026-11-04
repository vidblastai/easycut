import { deriveSentences, type Transcript, type TranscriptWord } from './types';

/**
 * Names and words the creator told us how to spell, applied to a transcript.
 *
 * Speech recognition hears "Claude Code" as "Cloud Code" and "EasyCut" as
 * "easy cut", and every caption, title card and B-roll search downstream then
 * carries the mistake. Providers that take a word list are given it as well
 * (see `keyterms` in TranscribeOptions), but this pass is the guarantee: it
 * works the same whichever provider answered.
 *
 * It only ever swaps a run of words for the creator's spelling when the run
 * SOUNDS like it — near in letters, word for word, or as one squashed string —
 * so a list of names cannot rewrite unrelated speech.
 */

/** Letters and digits only, lower case: "Code." and "code" are the same word. */
function bare(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');
}

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = above;
    }
  }
  return prev[b.length];
}

/** Close enough to be a mishearing: allowance grows with length, never for tiny words. */
function soundsLike(heard: string, meant: string): boolean {
  if (!heard || !meant) return false;
  if (heard === meant) return true;
  if (meant.length <= 3) return false;
  const allowed = meant.length <= 5 ? 1 : 2;
  return editDistance(heard, meant) <= allowed;
}

/** Keeps the punctuation the provider put around a word, e.g. "Code." → "Code" + "." */
function respell(word: TranscriptWord, spelling: string): TranscriptWord {
  const lead = word.text.match(/^[^\p{L}\p{N}]*/u)?.[0] ?? '';
  const trail = word.text.match(/[^\p{L}\p{N}]*$/u)?.[0] ?? '';
  return { ...word, text: `${lead}${spelling}${trail}` };
}

export function cleanSpellings(raw: readonly string[] | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw ?? []) {
    const term = entry.trim().replace(/\s+/g, ' ').slice(0, 60);
    if (!term || !bare(term) || seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    out.push(term);
    if (out.length >= 30) break;
  }
  return out;
}

export function applySpellings(transcript: Transcript, raw: readonly string[] | null | undefined): Transcript {
  const terms = cleanSpellings(raw);
  if (!terms.length || !transcript.words.length) return transcript;

  let words = transcript.words.slice();
  let changed = false;

  // Longest terms first, so "Claude Code" is settled before "Claude".
  for (const term of [...terms].sort((a, b) => b.split(' ').length - a.split(' ').length)) {
    const parts = term.split(' ');
    const meantParts = parts.map(bare);
    const meantWhole = meantParts.join('');

    for (let i = 0; i < words.length; i++) {
      // Word for word: "Cloud Code" → "Claude Code".
      const run = words.slice(i, i + parts.length);
      if (run.length === parts.length) {
        const heard = run.map((w) => bare(w.text));
        const already = heard.every((h, k) => h === meantParts[k]) && run.every((w, k) => w.text.includes(parts[k]));
        if (!already && heard.every((h, k) => soundsLike(h, meantParts[k]))) {
          run.forEach((w, k) => (words[i + k] = respell(w, parts[k])));
          changed = true;
          i += parts.length - 1;
          continue;
        }
      }
      // Run together: "easy cut" → "EasyCut", one word over both timings.
      if (parts.length === 1 && i + 1 < words.length) {
        const pair = bare(words[i].text) + bare(words[i + 1].text);
        if (meantWhole.length > 5 && soundsLike(pair, meantWhole)) {
          const merged = respell({ ...words[i], endSec: words[i + 1].endSec, endsSentence: words[i + 1].endsSentence }, parts[0]);
          merged.text = merged.text.replace(/[^\p{L}\p{N}]*$/u, '') + (words[i + 1].text.match(/[^\p{L}\p{N}]*$/u)?.[0] ?? '');
          words = [...words.slice(0, i), merged, ...words.slice(i + 2)];
          changed = true;
          continue;
        }
      }
      // A single word that is only a case or near-miss of a one-word name.
      if (parts.length === 1) {
        const heard = bare(words[i].text);
        if (heard !== meantWhole || !words[i].text.includes(parts[0])) {
          if (soundsLike(heard, meantWhole) && heard.length > 3) {
            words[i] = respell(words[i], parts[0]);
            changed = true;
          }
        }
      }
    }
  }

  if (!changed) return transcript;
  return {
    ...transcript,
    words,
    text: words.map((w) => w.text).join(' '),
    sentences: deriveSentences(words, transcript.language),
  };
}
