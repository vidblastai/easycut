import { describe, expect, it } from 'vitest';
import { detectLanguage, packFor, repairUnitNumbers, SUPPORTED_LANGUAGES } from '@/lib/lang';
import { coreOf, restatementEvidence } from '@/lib/timeline/paraphrase';
import { CLEANUP_PRESETS, findCleanupTargets } from '@/lib/timeline/cleanup';
import { punchMoments } from '@/lib/edl/punch-script';
import { deriveSentences, type Transcript, type TranscriptWord } from '@/lib/transcribe/types';

/**
 * The German, French and Spanish strings in this file are what Deepgram
 * actually returned for three recorded clips, transcription warts and all
 * ("Dann dann fügst Du", a capitalised "Du"). Inventing the transcripts
 * would have tested the detector against my idea of the language rather
 * than against what arrives in production.
 */

function speech(lines: Array<[text: string, startSec: number, endSec: number]>, language: string) {
  const words: TranscriptWord[] = [];
  for (const [text, startSec, endSec] of lines) {
    const parts = text.split(/\s+/).filter(Boolean);
    const each = (endSec - startSec) / parts.length;
    parts.forEach((part, i) => {
      words.push({
        text: part,
        startSec: startSec + i * each,
        endSec: startSec + (i + 1) * each,
        confidence: 1,
        speaker: 0,
        isFiller: false,
        endsSentence: /[.!?]$/.test(part),
      });
    });
  }
  const transcript: Transcript = {
    provider: 'test',
    language,
    durationSec: words.at(-1)?.endSec ?? 0,
    text: words.map((w) => w.text).join(' '),
    words,
    sentences: deriveSentences(words, language),
  };
  return transcript;
}

const retakesIn = (t: Transcript) =>
  findCleanupTargets(t, CLEANUP_PRESETS.raw).filter((f) => f.kind === 'retake');

describe('picking the right table', () => {
  it('resolves a language tag however it was spelled', () => {
    for (const tag of ['de', 'de-DE', 'DE', 'de_AT', ' German ', 'deutsch']) {
      expect(packFor(tag).code).toBe('de');
    }
  });

  it('falls back to English rather than failing on one it does not know', () => {
    // A worse edit beats no edit: every detector still runs, reading the
    // English tables, and the video comes out cut rather than crashed.
    expect(packFor('hu').code).toBe('en');
    expect(packFor(undefined).code).toBe('en');
    expect(packFor('').code).toBe('en');
  });

  it('offers the four it actually supports', () => {
    expect(SUPPORTED_LANGUAGES.map((l) => l.code)).toEqual(['en', 'de', 'fr', 'es']);
    expect(SUPPORTED_LANGUAGES.find((l) => l.code === 'de')?.endonym).toBe('Deutsch');
  });

  it('reads the language off the words when nobody says', () => {
    const samples: Array<[string, string]> = [
      ['de', 'Also der Punkt ist, dass Du einfach anfangen musst. Was ich eigentlich sagen will, ist, Du musst einfach mal beginnen.'],
      ['fr', "Alors le truc c'est qu'il faut commencer. Ce que je veux dire c'est qu'il faut juste se lancer."],
      ['es', 'Bueno, la cuestión es que tienes que empezar. Lo que quiero decir es que simplemente tienes que comenzar.'],
      ['en', 'So the point is you have to start. What I am saying is you just need to begin.'],
    ];
    for (const [code, text] of samples) {
      const read = detectLanguage(text);
      expect(read.code, text.slice(0, 30)).toBe(code);
      expect(read.confidence).toBeGreaterThan(0.3);
    }
  });

  it('does not guess from a handful of words', () => {
    expect(detectLanguage('ok').confidence).toBe(0);
  });
});

describe('the reworded retake, in four languages', () => {
  it('catches it in German', () => {
    // "Was ich eigentlich sagen will ist" announces the rewording, and
    // "anfangen" / "beginnen" are one verb once the pack folds them.
    const transcript = speech(
      [
        ['Also der Punkt ist, dass Du einfach anfangen musst.', 0.2, 4.6],
        ['Was ich eigentlich sagen will, ist, Du musst einfach mal beginnen.', 5.6, 9.2],
      ],
      'de',
    );
    const retake = retakesIn(transcript)[0];
    expect(retake).toBeDefined();
    expect(retake.startSec).toBeCloseTo(0.2, 1);
    expect(retake.confidence).toBeGreaterThan(CLEANUP_PRESETS.raw.confidenceFloor);
  });

  it('catches it in French', () => {
    const transcript = speech(
      [
        ["Alors le truc c'est qu'il faut commencer.", 0.1, 2.6],
        ["Ce que je veux dire c'est qu'il faut juste se lancer.", 3.6, 6.0],
      ],
      'fr',
    );
    expect(retakesIn(transcript)[0]?.startSec).toBeCloseTo(0.1, 1);
  });

  it('catches it in Spanish', () => {
    const transcript = speech(
      [
        ['Bueno, la cuestión es que tienes que empezar.', 0.3, 4.0],
        ['Lo que quiero decir es que simplemente tienes que comenzar.', 5.0, 8.0],
      ],
      'es',
    );
    expect(retakesIn(transcript)[0]?.startSec).toBeCloseTo(0.3, 1);
  });

  it('would have missed all three on the English tables', () => {
    // The point of the packs, stated as a test: the same German pair read
    // with English function words, English frames and an English stemmer is
    // not a retake at all.
    const pair: [string, string] = [
      'Also der Punkt ist, dass Du einfach anfangen musst.',
      'Was ich eigentlich sagen will, ist, Du musst einfach mal beginnen.',
    ];
    expect(restatementEvidence(...pair, 1, 'de').verdict).toBe('restated');
    expect(restatementEvidence(...pair, 1, 'en').verdict).toBe('different');
  });
});

describe('the sentences that only look like retakes, in four languages', () => {
  it('leaves two steps of a German list alone', () => {
    const evidence = restatementEvidence(
      'Dann fügst Du die Musik hinzu.',
      'Danach fügst Du die Untertitel hinzu.',
      1.2,
      'de',
    );
    expect(evidence.verdict).toBe('different');
    expect(evidence.reasons.join(' ')).toContain('moves on');
  });

  it('leaves two steps of a French list alone', () => {
    const evidence = restatementEvidence(
      'Ensuite tu ajoutes la musique.',
      'Ensuite tu ajoutes les sous-titres.',
      1.2,
      'fr',
    );
    expect(evidence.verdict).toBe('different');
  });

  it('leaves two steps of a Spanish list alone', () => {
    const evidence = restatementEvidence(
      'Luego añades la música.',
      'Luego añades los subtítulos.',
      1.2,
      'es',
    );
    expect(evidence.verdict).toBe('different');
  });

  it('refuses a pair where one side is negated', () => {
    const evidence = restatementEvidence(
      'You are not competing on features.',
      'You are competing on features.',
      0.8,
    );
    expect(evidence.verdict).toBe('different');
    expect(evidence.reasons.join(' ')).toContain('negated');
  });

  it('refuses a negated German pair too', () => {
    const evidence = restatementEvidence(
      'Das funktioniert nicht ohne ein Stativ.',
      'Das funktioniert mit einem Stativ.',
      0.8,
      'de',
    );
    expect(evidence.verdict).toBe('different');
  });
});

describe('what each pack knows', () => {
  it('folds the inflections a retake swaps', () => {
    // gewachsen / wachsen: the participle wears a prefix in German, which no
    // suffix rule reaches.
    expect(coreOf('Wir sind gewachsen.', 'de').tokens).toContain(
      coreOf('Wir wachsen.', 'de').tokens.at(-1),
    );
    // French elision: "qu'il" has to become two words or it matches nothing.
    // ("il faut" is not the example to use — the pack folds that whole
    // phrase to the modal, which is the point of it.)
    expect(coreOf("qu'il arrive en retard", 'fr').tokens).toContain('il');
    // Spanish stem change: tienes → tener, via the modal fold.
    expect(coreOf('tienes que empezar', 'es').tokens).toEqual(
      coreOf('hay que empezar', 'es').tokens,
    );
  });

  it('reads a spoken number in each language', () => {
    expect(coreOf('vierzig Prozent', 'de').figures).toEqual(new Set(['40']));
    expect(coreOf('quarante pour cent', 'fr').figures).toEqual(new Set(['40']));
    expect(coreOf('cuarenta por ciento', 'es').figures).toEqual(new Set(['40']));
  });

  it('does not let the percent unit stand in for a figure', () => {
    // "pour cent" folds to a unit, not to the number 100 — otherwise two
    // different percentages share a figure and the conflict check never
    // fires.
    const evidence = restatementEvidence(
      'On a grandi de quarante pour cent.',
      'On a grandi de cinquante pour cent.',
      4,
      'fr',
    );
    expect(evidence.verdict).toBe('different');
    expect(evidence.reasons.join(' ')).toContain('numbers');
  });

  it('knows what a filler is in each language', () => {
    expect(packFor('de').fillers.has('ähm')).toBe(true);
    expect(packFor('fr').fillers.has('euh')).toBe(true);
    expect(packFor('es').fillers.has('bueno')).toBe(true);
    // And the English set does not: a German video edited on it keeps them.
    expect(packFor('en').fillers.has('ähm')).toBe(false);
  });

  it('cuts the discourse marker a speaker opens with', () => {
    const transcript = speech([['Bueno, la cuestión es que tienes que empezar.', 0.3, 4.0]], 'es');
    const filler = findCleanupTargets(transcript, CLEANUP_PRESETS.raw).find(
      (f) => f.kind === 'filler',
    );
    expect(filler?.text).toContain('Bueno');
  });

  it('finds the sentence worth a camera move in German', () => {
    const transcript = speech(
      [
        ['Wir haben einfach weitergemacht und nichts verändert.', 3.0, 7.0],
        ['Aber dann ist die Wahrheit rausgekommen.', 9.0, 12.5],
        ['Das war der einzige Weg nach vorne.', 15.0, 18.5],
        ['Und so sind wir dahin gekommen wo wir heute stehen.', 21.0, 25.0],
      ],
      'de',
    );
    const moments = punchMoments({
      sentences: transcript.sentences,
      language: 'de',
      busy: [],
      hints: [],
      palette: ['push', 'ramp', 'snap', 'bounce'],
      cadenceSec: [6, 10],
      durationSec: 28,
      hookSec: 2.5,
    });
    const signals = moments.map((m) => m.signal);
    expect(signals).toContain('pivot'); // "Aber dann…"
    expect(signals).toContain('superlative'); // "der einzige Weg"
  });
});

describe('what the smart formatter got wrong', () => {
  const words = (texts: string[]) =>
    texts.map((text, i) => ({ text, startSec: i, endSec: i + 0.5 }));

  it('writes back the unit the formatter turned into a number', () => {
    const fixed = repairUnitNumbers(words(['grandi', 'de', '40', 'pour', '100.']), packFor('fr'));
    expect(fixed.map((w) => w.text)).toEqual(['grandi', 'de', '40', 'pour', 'cent.']);
  });

  it('leaves a real hundred alone', () => {
    // "cent euros" is an amount. Only a figure in front of "pour" makes it
    // unambiguously a percentage.
    const kept = words(['ça', 'coûte', 'pour', '100', 'euros']);
    expect(repairUnitNumbers(kept, packFor('fr'))).toBe(kept);
  });

  it('does the same in Spanish and nothing in English', () => {
    expect(
      repairUnitNumbers(words(['crecimos', 'un', '40', 'por', '100']), packFor('es')).at(-1)!.text,
    ).toBe('ciento');
    const english = words(['grew', '40', 'per', '100']);
    expect(repairUnitNumbers(english, packFor('en'))).toBe(english);
  });
});

describe('a sentence that runs on', () => {
  /** The Spanish clip, with the gaps Deepgram measured. */
  const runOn = speech(
    [['crecimos alrededor de un 40 por ciento el año pasado, creo, crecimos un 40 por ciento.', 12.4, 17.8]],
    'es',
  );

  it('breaks at the clause the speaker marked', () => {
    // One 16-word "sentence" holding a claim and a retake of it. Deepgram
    // punctuates Spanish and French with commas where it ends the English
    // with a full stop, and nothing compares a sentence to itself.
    expect(runOn.sentences.length).toBeGreaterThan(1);
    expect(runOn.sentences.every((s) => s.split)).toBe(true);
    expect(runOn.sentences.at(-1)!.text).toContain('crecimos un 40 por ciento');
  });

  it('finds the retake the run-on was hiding', () => {
    expect(retakesIn(runOn)).toHaveLength(1);
  });

  it('keeps a list in one piece', () => {
    const list = speech(
      [['It reads your inbox, checks the calendar, plans your day, and gives you the time back.', 0, 6]],
      'en',
    );
    expect(list.sentences).toHaveLength(1);
  });

  it('keeps a list with no conjunction in one piece too', () => {
    const list = speech(
      [['The captions, the b-roll, the effects, everything you see was done by AI.', 0, 6]],
      'en',
    );
    expect(list.sentences).toHaveLength(1);
  });

  it('does not invent a false start out of a clause it split itself', () => {
    const transcript = speech(
      [['In Berlin, I learned the one thing that actually changed how I run the company.', 0, 6]],
      'en',
    );
    const findings = findCleanupTargets(transcript, CLEANUP_PRESETS.raw);
    expect(findings.some((f) => f.kind === 'false-start')).toBe(false);
  });
});
