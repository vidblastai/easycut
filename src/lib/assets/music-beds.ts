/**
 * The music beds, as synthesis recipes.
 *
 * The library used to ship empty, which meant the pipeline reported `music` as
 * a degraded layer on every single job while the README listed it as something
 * the product does. Two ways to close that: licence some tracks, or make some.
 *
 * Making them is the better answer here for the same reason the sound effects
 * are synthesised: royalty-free by construction, auditable, a few megabytes,
 * and retunable by editing one expression rather than renegotiating a licence.
 * It is not the better answer musically — a real composer's track beats this —
 * so the curated manifest stays, and anything an operator adds outranks these
 * by being a better match rather than by being special-cased.
 *
 * What a bed has to do. It plays under a voice, ducked 8–14 dB, for anywhere up
 * to ten minutes. So: no melody to follow, no dynamics to fight the compressor,
 * nothing loud between 1 kHz and 3 kHz where consonants live, and it has to loop
 * without a seam because the mixer loops it (`aloop=loop=-1`) rather than
 * fading out at the end of the file.
 *
 * Seamlessness is the whole reason for the odd numbers below. Every frequency
 * is snapped to a multiple of 1/48 Hz so each one completes a whole number of
 * cycles in the 48-second loop, and every rhythmic period divides 48 exactly.
 * The chord change is a cosine crossfade over the full loop, which is both the
 * musical movement and the thing that guarantees the last sample meets the
 * first.
 */

/** The loop length, in seconds. Everything below is periodic in this. */
export const LOOP_SEC = 48;

/** Equal temperament, A4 = 440. */
const SEMITONES: Record<string, number> = {
  C: -9, 'C#': -8, Db: -8, D: -7, 'D#': -6, Eb: -6, E: -5, F: -4,
  'F#': -3, Gb: -3, G: -2, 'G#': -1, Ab: -1, A: 0, 'A#': 1, Bb: 1, B: 2,
};

/**
 * A note name to a frequency that completes a whole number of cycles per loop.
 *
 * The snap is at most 1/96 Hz of detuning — about a thousandth of a semitone at
 * the bottom of the range, and inaudible. Without it every sustained voice
 * clicks at the loop point.
 */
export function hz(note: string): number {
  const match = /^([A-G][#b]?)(-?\d)$/.exec(note);
  if (!match) throw new Error(`bad note: ${note}`);
  const [, name, octave] = match;
  const midi = (Number(octave) + 1) * 12 + SEMITONES[name] + 9;
  const exact = 440 * Math.pow(2, (midi - 69) / 12);
  return Math.round(exact * LOOP_SEC) / LOOP_SEC;
}

/** Cosine crossfade between the two chords, one full cycle per loop. */
const CHORD_A = `(0.5+0.5*cos(2*PI*t/${LOOP_SEC}))`;
const CHORD_B = `(0.5-0.5*cos(2*PI*t/${LOOP_SEC}))`;

/** A sustained tone that breathes. `lfo` is snapped to the loop like the pitch. */
function pad(note: string, amp: number, lfoCycles: number, depth: number, chord: string): string {
  const lfo = lfoCycles / LOOP_SEC;
  return `${amp}*sin(2*PI*${hz(note)}*t)*(${(1 - depth).toFixed(3)}+${depth}*sin(2*PI*${lfo.toFixed(6)}*t))*${chord}`;
}

/** A pitched hit that decays — a kick, a sub, a stab. */
function hit(note: string, amp: number, periodSec: number, decay: number): string {
  return `${amp}*sin(2*PI*${hz(note)}*t)*exp(${-decay}*mod(t,${periodSec}))`;
}

/** A noise burst that decays — a hat, a shaker. Highpassed later. */
function tick(amp: number, periodSec: number, decay: number): string {
  return `${amp}*(random(0)-0.5)*exp(${-decay}*mod(t,${periodSec}))`;
}

export interface Bed {
  id: string;
  title: string;
  moods: string[];
  /** 0..1 — matched against short-form (high) and long-form (low). */
  energy: number;
  bpm: number | null;
  /** What it is for, in one line, for the manifest and the picker. */
  use: string;
  /** The voices, summed. */
  voices: string[];
  /** Where the top ends. Lower is further back in the mix. */
  lowpassHz: number;
  /** Reverb: `aecho` in:out:delays:decays. */
  echo: string;
}

export const BEDS: Bed[] = [
  {
    id: 'still-water',
    title: 'Still Water',
    moods: ['calm', 'ambient', 'reflective', 'documentary', 'gentle', 'quiet'],
    energy: 0.16,
    bpm: null,
    use: 'A room tone with a chord in it. For anything where the voice is the whole event.',
    lowpassHz: 1700,
    echo: '0.8:0.9:410|730|1130:0.42|0.3|0.2',
    voices: [
      pad('A2', 0.13, 3, 0.35, CHORD_A),
      pad('E3', 0.10, 5, 0.4, CHORD_A),
      pad('A3', 0.085, 7, 0.45, CHORD_A),
      pad('C4', 0.07, 4, 0.5, CHORD_A),
      pad('E4', 0.05, 9, 0.55, CHORD_A),
      pad('F2', 0.13, 4, 0.35, CHORD_B),
      pad('C3', 0.10, 6, 0.4, CHORD_B),
      pad('F3', 0.085, 8, 0.45, CHORD_B),
      pad('A3', 0.07, 5, 0.5, CHORD_B),
      pad('C4', 0.05, 11, 0.55, CHORD_B),
    ],
  },
  {
    id: 'slow-build',
    title: 'Slow Build',
    moods: ['cinematic', 'thoughtful', 'serious', 'story', 'build', 'documentary'],
    energy: 0.34,
    bpm: 90,
    use: 'Patient and a little sad. For long-form where something is being explained.',
    lowpassHz: 2500,
    echo: '0.8:0.88:330|610|950:0.38|0.26|0.16',
    voices: [
      pad('D2', 0.12, 3, 0.3, CHORD_A),
      pad('A2', 0.10, 5, 0.35, CHORD_A),
      pad('D3', 0.09, 4, 0.4, CHORD_A),
      pad('F3', 0.075, 7, 0.45, CHORD_A),
      pad('A3', 0.055, 6, 0.5, CHORD_A),
      pad('Bb1', 0.12, 4, 0.3, CHORD_B),
      pad('F2', 0.10, 6, 0.35, CHORD_B),
      pad('Bb2', 0.09, 5, 0.4, CHORD_B),
      pad('D3', 0.075, 8, 0.45, CHORD_B),
      pad('F3', 0.055, 7, 0.5, CHORD_B),
      // A heartbeat at a half note, felt more than heard.
      hit('D1', 0.16, 1.3333333, 9),
    ],
  },
  {
    id: 'steady-focus',
    title: 'Steady Focus',
    moods: ['neutral', 'explainer', 'tutorial', 'clean', 'focus', 'howto', 'corporate'],
    energy: 0.46,
    bpm: 120,
    use: 'Forward motion without an opinion. The safe default under a talking head.',
    lowpassHz: 3300,
    echo: '0.8:0.85:250|470:0.3|0.18',
    voices: [
      pad('C3', 0.10, 4, 0.28, CHORD_A),
      pad('G3', 0.085, 6, 0.32, CHORD_A),
      pad('C4', 0.07, 5, 0.36, CHORD_A),
      pad('E4', 0.05, 8, 0.44, CHORD_A),
      pad('A2', 0.10, 5, 0.28, CHORD_B),
      pad('E3', 0.085, 7, 0.32, CHORD_B),
      pad('A3', 0.07, 6, 0.36, CHORD_B),
      pad('C4', 0.05, 9, 0.44, CHORD_B),
      hit('C1', 0.14, 0.5, 13),
      tick(0.05, 0.25, 90),
    ],
  },
  {
    id: 'city-lights',
    title: 'City Lights',
    moods: ['upbeat', 'modern', 'lofi', 'warm', 'vlog', 'friendly', 'lifestyle'],
    energy: 0.62,
    bpm: 120,
    use: 'Warm and moving. For a vlog, a product walkthrough, anything with a smile in it.',
    lowpassHz: 4200,
    echo: '0.8:0.84:190|370:0.28|0.16',
    voices: [
      pad('F2', 0.10, 4, 0.26, CHORD_A),
      pad('C3', 0.085, 6, 0.3, CHORD_A),
      pad('F3', 0.075, 5, 0.34, CHORD_A),
      pad('A3', 0.06, 8, 0.38, CHORD_A),
      pad('E4', 0.04, 7, 0.46, CHORD_A),
      pad('D2', 0.10, 5, 0.26, CHORD_B),
      pad('A2', 0.085, 7, 0.3, CHORD_B),
      pad('D3', 0.075, 6, 0.34, CHORD_B),
      pad('F3', 0.06, 9, 0.38, CHORD_B),
      pad('C4', 0.04, 8, 0.46, CHORD_B),
      hit('F1', 0.17, 0.5, 12),
      tick(0.07, 0.25, 80),
      tick(0.035, 0.125, 140),
    ],
  },
  {
    id: 'hard-cut',
    title: 'Hard Cut',
    moods: ['punchy', 'energetic', 'hype', 'bold', 'short', 'dramatic', 'gym'],
    energy: 0.86,
    bpm: 120,
    use: 'Insistent. For a thirty-second short that has to land in the first second.',
    lowpassHz: 5200,
    echo: '0.8:0.8:130|250:0.22|0.12',
    voices: [
      pad('A1', 0.11, 2, 0.2, CHORD_A),
      pad('A2', 0.09, 4, 0.24, CHORD_A),
      pad('E3', 0.075, 6, 0.3, CHORD_A),
      pad('G1', 0.11, 3, 0.2, CHORD_B),
      pad('G2', 0.09, 5, 0.24, CHORD_B),
      pad('D3', 0.075, 7, 0.3, CHORD_B),
      hit('A0', 0.22, 0.5, 11),
      // The stab is what makes this one feel fast: a short pitched hit on the
      // off-beat, not more of the pad.
      hit('A3', 0.09, 0.25, 34),
      tick(0.085, 0.25, 70),
      tick(0.05, 0.125, 130),
    ],
  },
  {
    id: 'night-drive',
    title: 'Night Drive',
    moods: ['moody', 'dark', 'synthwave', 'tension', 'night', 'mystery', 'serious'],
    energy: 0.68,
    bpm: 120,
    use: 'Minor and a bit menacing. For a story with a turn in it.',
    lowpassHz: 3000,
    echo: '0.8:0.86:290|560|870:0.34|0.22|0.13',
    voices: [
      pad('C2', 0.12, 3, 0.24, CHORD_A),
      pad('G2', 0.09, 5, 0.28, CHORD_A),
      pad('C3', 0.08, 4, 0.32, CHORD_A),
      pad('Eb3', 0.07, 7, 0.38, CHORD_A),
      pad('G3', 0.05, 6, 0.44, CHORD_A),
      pad('Ab1', 0.12, 4, 0.24, CHORD_B),
      pad('Eb2', 0.09, 6, 0.28, CHORD_B),
      pad('Ab2', 0.08, 5, 0.32, CHORD_B),
      pad('C3', 0.07, 8, 0.38, CHORD_B),
      pad('Eb3', 0.05, 7, 0.44, CHORD_B),
      hit('C1', 0.19, 0.5, 10),
      tick(0.045, 0.25, 95),
    ],
  },
];

/**
 * The full ffmpeg filter graph for one bed.
 *
 * Shaping, in order and each for a reason:
 *  - highpass 34 Hz: nothing below this survives a phone speaker, and it eats
 *    headroom the limiter would rather spend on the kick.
 *  - a scoop at 1.9 kHz: the consonant band. This is the single most important
 *    filter in the file — it is why the bed does not have to be turned down so
 *    far that it stops being music.
 *  - lowpass per bed: how far forward the bed sits.
 *  - aecho for space, then a limiter so the sum of ten voices cannot clip.
 */
export function graphFor(bed: Bed, seconds: number = LOOP_SEC): string {
  const expression = bed.voices.join(' + ');
  return [
    `aevalsrc='${expression}':d=${seconds}:s=48000:c=mono`,
    'highpass=f=34',
    'equalizer=f=1900:width_type=o:width=2.2:g=-5.5',
    `lowpass=f=${bed.lowpassHz}`,
    `aecho=${bed.echo}`,
    'alimiter=limit=0.72:attack=4:release=90',
  ].join(',');
}
