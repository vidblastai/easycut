/**
 * The sound-effect library.
 *
 * Every other approach here is a trap. Licensing a commercial SFX pack costs
 * money per seat and can't be redistributed with the repo; generative audio
 * models cost money per cue and take seconds; scraping "free" packs is a
 * licensing landmine.
 *
 * So we synthesise them. Each effect below is a short ffmpeg expression —
 * a handful of oscillators and noise with an envelope — rendered once at setup
 * into `public/audio/sfx/`. They are small, instant, royalty-free by
 * construction, and they sound like what a video editor reaches for.
 *
 * Run `npm run setup` (or `tsx scripts/generate-sfx.ts`) to build them.
 */

export type SfxName = 'whoosh' | 'pop' | 'riser' | 'impact' | 'click' | 'swipe' | 'ding' | 'sub-drop';

export interface SfxDefinition {
  name: SfxName;
  durationSec: number;
  /** What it's for, so the director's choices stay legible in the editor. */
  use: string;
  /** ffmpeg `-filter_complex` source graph producing mono audio at 48 kHz. */
  recipe: string;
  /** Sensible level relative to the speech bed. */
  defaultGainDb: number;
}

const SR = 48000;

export const SFX_LIBRARY: Record<SfxName, SfxDefinition> = {
  whoosh: {
    name: 'whoosh',
    durationSec: 0.55,
    use: 'Hard cuts and B-roll entrances.',
    defaultGainDb: -14,
    // Pink noise swept through a resonant band, with an exponential swell and tail.
    recipe: [
      `anoisesrc=color=pink:sample_rate=${SR}:duration=0.55:amplitude=0.9`,
      `bandpass=frequency=900:width_type=o:width=2.6`,
      `aecho=0.7:0.6:28:0.35`,
      `volume='min(1,pow(t/0.18,2))*exp(-3.2*max(0,t-0.18))':eval=frame`,
      `highpass=f=180`,
    ].join(','),
  },

  pop: {
    name: 'pop',
    durationSec: 0.14,
    use: 'A graphic, icon or caption word appearing.',
    defaultGainDb: -16,
    // A pitched blip that falls fast — the classic UI "appear".
    recipe: [
      `aevalsrc='0.85*sin(2*PI*(1180-2600*t)*t)*exp(-34*t)':s=${SR}:d=0.14`,
      `lowpass=f=6000`,
    ].join(','),
  },

  riser: {
    name: 'riser',
    durationSec: 1.4,
    use: 'Building tension before a reveal or a list payoff.',
    defaultGainDb: -18,
    // Rising sweep plus rising filtered noise, the two halves of a real riser.
    recipe: [
      `aevalsrc='0.5*sin(2*PI*(160+620*t*t)*t)':s=${SR}:d=1.4[tone];` +
        `anoisesrc=color=white:sample_rate=${SR}:duration=1.4:amplitude=0.5,` +
        `highpass=f=800,volume='pow(t/1.4,2.2)':eval=frame[air];` +
        `[tone][air]amix=inputs=2:weights=1 0.8,volume='pow(t/1.4,1.6)':eval=frame`,
    ].join(''),
  },

  impact: {
    name: 'impact',
    durationSec: 0.8,
    use: 'Landing a statement. Pairs with a punch-in.',
    defaultGainDb: -12,
    recipe: [
      `aevalsrc='0.95*sin(2*PI*(78-46*t)*t)*exp(-6.5*t)':s=${SR}:d=0.8[sub];` +
        `anoisesrc=color=brown:sample_rate=${SR}:duration=0.8:amplitude=0.55,` +
        `lowpass=f=2200,volume='exp(-16*t)':eval=frame[body];` +
        `[sub][body]amix=inputs=2:weights=1 0.6`,
    ].join(''),
  },

  click: {
    name: 'click',
    durationSec: 0.06,
    use: 'Small state changes — a list item ticking in.',
    defaultGainDb: -20,
    recipe: [
      `anoisesrc=color=white:sample_rate=${SR}:duration=0.06:amplitude=0.7`,
      `highpass=f=2400`,
      `volume='exp(-90*t)':eval=frame`,
    ].join(','),
  },

  swipe: {
    name: 'swipe',
    durationSec: 0.3,
    use: 'Whip pans and slide transitions.',
    defaultGainDb: -16,
    recipe: [
      `anoisesrc=color=pink:sample_rate=${SR}:duration=0.3:amplitude=0.85`,
      `bandpass=frequency=2200:width_type=o:width=2`,
      `volume='min(1,t/0.06)*exp(-9*max(0,t-0.06))':eval=frame`,
    ].join(','),
  },

  ding: {
    name: 'ding',
    durationSec: 1.0,
    use: 'A positive confirmation — a tick, a result, a win.',
    defaultGainDb: -18,
    // Two partials a fifth apart: a bell, without a sample library.
    recipe: [
      `aevalsrc='0.55*sin(2*PI*1320*t)*exp(-4.5*t)+0.3*sin(2*PI*1980*t)*exp(-6.5*t)':s=${SR}:d=1.0`,
      `aecho=0.8:0.7:60:0.25`,
    ].join(','),
  },

  'sub-drop': {
    name: 'sub-drop',
    durationSec: 1.2,
    use: 'Dropping into a new section, under a hard cut.',
    defaultGainDb: -13,
    recipe: `aevalsrc='0.9*sin(2*PI*(120*exp(-2.6*t))*t)*exp(-2.1*t)':s=${SR}:d=1.2,lowpass=f=320`,
  },
};

export const SFX_NAMES = Object.keys(SFX_LIBRARY) as SfxName[];

export function sfxUrl(name: SfxName): string {
  return `/audio/sfx/${name}.wav`;
}

export function sfxDefaultGain(name: SfxName): number {
  return SFX_LIBRARY[name]?.defaultGainDb ?? -14;
}
