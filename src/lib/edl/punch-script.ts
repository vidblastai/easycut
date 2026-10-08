import { packFor, type LanguagePack } from '@/lib/lang';
import type { TranscriptSentence } from '@/lib/transcribe/types';
import { PUNCH_MOVES, type PunchMove } from './types';

/**
 * Where the camera moves in, and why.
 *
 * ── The problem this exists to fix ──────────────────────────────────────
 *
 * A punch-in placed on a CADENCE — every eight seconds, say — is a metronome
 * with a lens on it. It lands mid-clause as often as not, it emphasises
 * whatever happened to be said at that moment, and after four of them the
 * viewer has learned the rhythm and stopped reading it as emphasis at all.
 * It is the single clearest tell of an automated edit, and it was what this
 * product shipped.
 *
 * A zoom means something. It says LOOK AT THIS, and the only thing that can
 * tell you which "this" is worth it is the script. So the moments come out of
 * the transcript and the cadence becomes a budget rather than a schedule.
 *
 * ── Why this is bookkeeping and not a prompt ────────────────────────────
 *
 * The same reasoning as grouping icon cards into rows: it has an exact
 * answer, it is cheap to compute, and asking a model to redo it per video
 * buys variance and latency and nothing else. The director's own punch-in
 * cues are still read — it saw the whole transcript and sometimes knows which
 * line is the one — but as a BONUS on a candidate rather than as the
 * placement itself.
 *
 * ── Five things in a script worth a camera move ─────────────────────────
 *
 * Four of them are in the words and one is in the edit:
 *
 *   figure       a number carries the sentence. The hardest emphasis there is
 *   superlative  never, always, nobody, the only, the best. An absolute claim
 *   pivot        but, actually, here's the thing. The sentence that turns
 *   question     tension that the next sentence resolves, so hold through it
 *   drift        nothing has changed on screen for a long time
 *
 * `drift` is the only one that is not about the script, and it is the one
 * that justifies the slow push: the frame has been identical for twenty
 * seconds, and a creep nobody notices is what buys the next twenty.
 */

export const PUNCH_SIGNALS = ['figure', 'superlative', 'pivot', 'question', 'drift'] as const;
export type PunchSignal = (typeof PUNCH_SIGNALS)[number];

/**
 * How much each signal is worth, and the energy of the move it wants.
 *
 * Energy is a position on one ladder rather than a named move, because the
 * STYLE owns which moves exist in this video — a documentary that lists only
 * `push` and `ramp` must never produce a crash zoom, however emphatic the
 * line is. So a signal asks for a level of attack and gets the closest thing
 * the style actually has.
 */
const SIGNALS: Record<PunchSignal, { weight: number; energy: number }> = {
  figure: { weight: 1, energy: 5 },
  superlative: { weight: 0.85, energy: 3 },
  pivot: { weight: 0.8, energy: 3 },
  /*
   * Not an attack: a question is tension, and tension tightens rather than
   * hits. But it tightens over a KNOWN length — the question plus the
   * sentence that answers it — so it is in-hold-out rather than the
   * open-ended creep a drift wants. Put at the creep's energy it also
   * collided with drift, and the two commonest signals producing the same
   * move is how the variety rule ends up doing all the work.
   */
  question: { weight: 0.7, energy: 2 },
  drift: { weight: 0.4, energy: 0 },
};

/** The moves ordered by how hard they hit, which is how a signal finds one. */
const ENERGY: Record<PunchMove, number> = {
  push: 0,
  handheld: 1,
  ramp: 2,
  pull: 2,
  'speed-ramp': 3,
  bounce: 4,
  snap: 5,
};

/*
 * The sentence that turns.
 *
 * Anchored to the opening of the sentence for the short connectives, because
 * "but" in the middle of a clause is a conjunction and at the front it is a
 * reversal — and only the reversal is worth a camera move. The longer phrases
 * are allowed anywhere: nobody says "here's the thing" in passing.
 */

/*
 * An absolute claim.
 *
 * `every` on its own is left out on purpose — "every day", "every time" are
 * ordinary speech, where "everyone" and "everybody" are the whole-world
 * claims this is looking for. `everything` went the same way after a run of
 * the sample script put a bounce on "I shoot everything in the same corner",
 * which is a sentence about a room.
 */


/** A window on the timeline that already has something in it. */
export interface Busy {
  outStartSec: number;
  outEndSec: number;
}

export interface PunchMoment {
  startSec: number;
  endSec: number;
  signal: PunchSignal;
  move: PunchMove;
  /** 0–1 of the style's scale range. */
  strength: number;
  /** Shown in the editor, so somebody can see why the camera moved. */
  reason: string;
}

export interface PunchScriptOptions {
  /** Sentences already mapped into OUTPUT seconds. */
  sentences: TranscriptSentence[];
  /**
   * What the speaker is speaking. Three of the four signals are idioms
   * rather than grammar, so a German video read with the English patterns
   * finds only its digits and its question marks — the camera stops moving
   * for the right reasons and starts drifting for want of anything else.
   */
  language?: string;
  /** B-roll, scenes, graphics — anything that takes the frame off the speaker. */
  busy: Busy[];
  /** Output seconds the director asked for a punch, as hints. */
  hints: number[];
  /** The style's palette. A signal gets the closest move in it, never one outside. */
  palette: PunchMove[];
  /** `[min, max]` seconds between punch-ins. A zero cadence means NEVER. */
  cadenceSec: [number, number];
  durationSec: number;
  /** The opening seconds the speaker is still earning attention in. */
  hookSec: number;
}

/**
 * The moments, in time order, already thinned to the style's budget.
 *
 * Everything about WHICH moments is decided here; the builder turns them into
 * `PunchIn`s with a focal point and a scale, because that is the layer that
 * knows where the face is.
 */
export function punchMoments(options: PunchScriptOptions): PunchMoment[] {
  const { sentences, busy, hints, palette, cadenceSec, durationSec, hookSec } = options;
  const pack = packFor(options.language);
  const moves = palette.filter((m) => PUNCH_MOVES.includes(m));
  const cadence = (cadenceSec[0] + cadenceSec[1]) / 2;

  /*
   * A cadence of zero means NEVER, not "every instant".
   *
   * The same literal that hung the rule-based director: four styles ask for a
   * locked-off frame, which is the point of them. Guard it at the top rather
   * than inside the loop, so there is one place to read.
   */
  if (!moves.length || cadence <= 0) return [];

  const budget = Math.max(1, Math.floor(durationSec / cadence));
  const minGap = Math.max(1.5, cadenceSec[0] * 0.7);

  /* --------------------------------- score -------------------------------- */

  const scored: Array<PunchMoment & { score: number }> = [];
  let lastEventEnd = 0;

  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    if (s.startSec < hookSec) continue;
    if (s.endSec > durationSec - 0.4) continue;

    const covered = busy.some((b) => s.startSec < b.outEndSec + 0.3 && s.endSec > b.outStartSec - 0.3);
    if (covered) {
      // A covered sentence still resets the drift clock: the frame DID change,
      // which is the whole thing drift is measuring.
      lastEventEnd = Math.max(lastEventEnd, s.endSec);
      continue;
    }
    if (s.endSec - s.startSec < 1.2) continue;

    const signal = signalFor(s.text, s.startSec - lastEventEnd, cadence, pack);
    if (!signal) continue;

    const { weight, energy } = SIGNALS[signal];
    // The director saw the whole transcript and sometimes knows which line is
    // the one. A bonus on a candidate, never the placement itself.
    const hinted = hints.some((h) => Math.abs(h - s.startSec) < 1.5);

    scored.push({
      startSec: s.startSec,
      endSec: spanFor(sentences, i, signal, durationSec, cadence),
      signal,
      // `moves` is non-empty — guarded at the top — so this always answers.
      move: nearestMove(moves, energy)!,
      strength: Math.min(1, weight + (hinted ? 0.15 : 0)),
      reason: reasonFor(signal, s.text),
      score: weight + (hinted ? 0.5 : 0),
    });
  }

  /* -------------------------------- choose -------------------------------- */

  /*
   * The best line in each slot, not the best lines in the video.
   *
   * Strongest-first sounds right and is wrong in the common case: in a video
   * where every other sentence carries a figure, every candidate ties, the
   * tie-break is time, and the whole budget is spent in the first two
   * minutes — the exact failure of a cadence, arrived at from the other
   * direction. Editors do not think "the eight best moments", they think
   * "one a minute, on the best line in that minute". So the video is cut into
   * as many slots as there is budget and each slot picks its own.
   */
  const slot = durationSec / budget;
  const kept: Array<PunchMoment & { score: number }> = [];

  for (let n = 0; n < budget; n++) {
    const from = n * slot;
    const to = from + slot;
    const best = scored
      .filter((m) => m.startSec >= from && m.startSec < to)
      .sort((a, b) => b.score - a.score || a.startSec - b.startSec)
      .find((m) =>
        kept.every(
          (k) =>
            m.startSec - k.startSec >= minGap &&
            m.startSec >= k.endSec + 0.3,
        ),
      );
    // A slot with nothing worth a move in it gets no move. Fewer than the
    // budget is the right answer there, not the next-best sentence.
    if (best) kept.push(best);
  }

  /* -------------------------------- vary ---------------------------------- */

  /*
   * The same move twice running is the metronome again, one level up.
   *
   * Two crash zooms in a row do not read as two emphatic lines, they read as
   * a zoom effect. So a repeat is demoted to the next-closest move the style
   * has — which keeps it inside the style's character, where simply dropping
   * it would lose a moment the script earned.
   */
  for (let i = 1; i < kept.length; i++) {
    if (kept[i].move !== kept[i - 1].move) continue;
    /*
     * A repeat only matters for a move you NOTICE.
     *
     * Two crash zooms running read as a zoom effect rather than as two
     * emphatic lines. Two slow pushes running read as nothing at all, which
     * is what a push is for — so leaving them is right, and the first version
     * of this rule instead promoted the second one to a speed-ramp and put an
     * emphasis on a sentence whose entire qualification was that nothing had
     * happened for a while.
     */
    if (ENERGY[kept[i].move] <= 1) continue;
    const asked = SIGNALS[kept[i].signal].energy;
    const alternative = nearestMove(
      // Within a register of what the line asked for: the swap is for
      // variety, and a swap that changes how hard the line hits is not that.
      moves.filter((m) => m !== kept[i].move && Math.abs(ENERGY[m] - asked) <= 2),
      asked,
    );
    if (alternative) kept[i] = { ...kept[i], move: alternative };
  }

  return kept.map(({ score: _score, ...moment }) => moment);
}

/** The strongest signal a sentence carries, if any. */
function signalFor(
  text: string,
  sinceEvent: number,
  cadence: number,
  pack: LanguagePack,
): PunchSignal | null {
  if (pack.punch.figure.test(text)) return 'figure';
  /*
   * The turn outranks the claim, and most turns contain one.
   *
   * "But here's the thing nobody tells you" is a pivot with a superlative
   * inside it — they are the same idiom. Scored the other way round it came
   * out as an absolute claim, which asks for a harder move than a sentence
   * whose job is to change direction wants.
   */
  if (pack.punch.pivotOpens.test(text.trim()) || pack.punch.pivotAnywhere.test(text)) return 'pivot';
  if (pack.punch.superlative.test(text)) return 'superlative';
  if (text.trim().endsWith('?')) return 'question';
  // Twice the cadence with an unchanged frame is the point at which a locked
  // shot starts to read as a still. Below that, nothing in the script asked
  // for a move and nothing on screen needs one.
  if (sinceEvent > cadence * 2) return 'drift';
  return null;
}

/**
 * How long the move runs.
 *
 * Not one number, because the moves are not one thing. An emphasis is the
 * sentence it emphasises and stops. A question has to be held through the
 * answer or the tension resolves before the sentence that resolves it. And a
 * drift push needs ROOM — it is slow by definition, and a creep given three
 * seconds is just a ramp — so it runs across the paragraph, as far as the
 * sentences stay joined up.
 */
function spanFor(
  sentences: TranscriptSentence[],
  i: number,
  signal: PunchSignal,
  durationSec: number,
  cadence: number,
): number {
  const s = sentences[i];
  const cap = (end: number, max: number) => Math.min(end, s.startSec + max, durationSec - 0.3);

  if (signal === 'drift') {
    /*
     * A creep lasts about as long as the style's attention span.
     *
     * It is filling the time until the next thing happens, so a style that
     * cuts away every four seconds must not produce an eleven-second push —
     * a run of the sample script had `punchy` holding two of them across more
     * than half the video, which is not a punctuation mark any more, it is
     * the video slowly zooming in.
     */
    const longest = Math.min(11, Math.max(4.5, cadence * 1.2));
    let end = s.endSec;
    for (let j = i + 1; j < sentences.length; j++) {
      // A pause longer than a breath is a new paragraph, and a push across a
      // paragraph break lands its tightest frame on a thought it is not about.
      if (sentences[j].startSec - end > 0.7) break;
      end = sentences[j].endSec;
      if (end - s.startSec > longest) break;
    }
    return cap(Math.max(end, s.startSec + 4), longest);
  }

  if (signal === 'question') {
    const answer = sentences[i + 1];
    return cap(answer && answer.startSec - s.endSec < 0.9 ? answer.endSec : s.endSec, 7);
  }

  return cap(s.endSec, 3.6);
}

/** The move in this style's palette that hits closest to the asked-for energy. */
function nearestMove(moves: PunchMove[], energy: number): PunchMove | undefined {
  // Ties go to the softer move. Overshooting the attack a line asked for is
  // the more expensive mistake: a crash zoom on a merely firm sentence reads
  // as a different video, where a ramp on an emphatic one just reads as calm.
  return [...moves].sort(
    (a, b) => Math.abs(ENERGY[a] - energy) - Math.abs(ENERGY[b] - energy) || ENERGY[a] - ENERGY[b],
  )[0];
}

/** One line, in the editor, saying what the camera is reacting to. */
function reasonFor(signal: PunchSignal, text: string): string {
  const words = text.trim().split(/\s+/).slice(0, 6).join(' ');
  const what: Record<PunchSignal, string> = {
    figure: 'a figure',
    superlative: 'an absolute claim',
    pivot: 'the sentence turns',
    question: 'a question, held to the answer',
    drift: 'the frame had not changed',
  };
  return `${what[signal]} · ${words}`;
}
