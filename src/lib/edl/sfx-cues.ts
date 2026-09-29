import { clipTransitionSec } from './transition-timing';
import type { BrollClip, ClipTransition, Edl, IconCue } from './types';

/**
 * The sounds a transition makes.
 *
 * ── Why the mapping is a table and not a prompt ─────────────────────────
 *
 * A whoosh under a slide is not a creative decision — it is the same decision
 * every editor makes every time, and asking a language model to make it again
 * per video buys nothing but variance and latency. What a person actually
 * wants to change is whether the sound is there at all, and that is what the
 * timeline is for.
 *
 * ── Silence is a choice here too ────────────────────────────────────────
 *
 * `fade` and `cut` get nothing. A dissolve that whooshes is the single most
 * recognisable sign of somebody who has just discovered sound effects: the
 * picture is deliberately doing the quietest thing it can and the audio is
 * shouting over it. A cut gets nothing for the same reason — there is no
 * movement to sell.
 */
const TRANSITION_SOUND: Record<ClipTransition, string | null> = {
  cut: null,
  fade: null,
  'slide-left': 'swipe',
  'slide-right': 'swipe',
  'slide-up': 'swipe',
  'slide-down': 'swipe',
  // A zoom moves the whole frame rather than crossing it: lower, longer, less
  // "sideways" than a swipe.
  zoom: 'whoosh',
  whip: 'whoosh',
  glitch: 'glitch',
  // The two optical ones are soft, and so is what goes under them. A light
  // leak with an impact on it is a fight between the two halves of the effect.
  'film-burn': 'whoosh',
  'light-leak': 'whoosh',
  flash: 'impact',
};

/** What an icon card rising into frame sounds like. */
const ICON_SOUND = 'swipe';

/**
 * Gain per placement, relative to the sound's own default.
 *
 * An icon card is punctuation under a sentence somebody is still speaking, so
 * its swipe sits well below the same swipe under a full-frame slide — the
 * slide has taken the picture away and has the room to be heard.
 */
const ICON_TRIM_DB = -7;
const EXIT_TRIM_DB = -3;

export interface CueSource {
  /** Where it came from, so the editor can say what deleting it would unhook. */
  reason: string;
  sound: string;
  atSec: number;
  gainTrimDb: number;
}

/**
 * Every sound the visuals imply, in order.
 *
 * Returned as data rather than pushed onto the document, so the builder can
 * merge them with the director's own cues and drop any that collide — and so
 * this is testable without building an EDL.
 */
export function transitionCues(
  broll: BrollClip[],
  icons: IconCue[],
  frame: { width: number; height: number },
): CueSource[] {
  const cues: CueSource[] = [];

  for (const clip of broll) {
    const enter = TRANSITION_SOUND[clip.enter];
    if (enter) {
      cues.push({
        reason: `${clip.enter} in · ${clip.query || 'insert'}`,
        sound: enter,
        // The picture starts moving the instant the insert appears, so this is
        // exact rather than approximate.
        atSec: clip.outStartSec,
        gainTrimDb: 0,
      });
    }

    const exit = TRANSITION_SOUND[clip.exit];
    if (exit) {
      /*
       * The exit sound starts when the picture starts LEAVING, which is one
       * transition-length before the clip ends — not at the clip's end, where
       * the movement is already over and the whoosh would be scoring the shot
       * that replaced it.
       *
       * This is the whole reason `clipTransitionSec` had to move out of the
       * renderer: the number that decides where this lands is the same number
       * the composition animates with, and two copies of it drift apart.
       */
      const at = clip.outEndSec - clipTransitionSec(clip.exit, frame);
      if (at > clip.outStartSec) {
        cues.push({
          reason: `${clip.exit} out · ${clip.query || 'insert'}`,
          sound: exit,
          atSec: at,
          gainTrimDb: EXIT_TRIM_DB,
        });
      }
    }
  }

  for (const cue of icons) {
    /*
     * One sound per CARD, not per row.
     *
     * A row of two cards arrives one at a time — banana, then apple — and each
     * one climbing into frame is its own movement. A single swipe for the pair
     * lands on the first and leaves the second silent, which reads as the
     * second one being broken rather than as restraint.
     */
    for (const card of cue.cards) {
      cues.push({
        reason: `icon card · ${card.word || card.query}`,
        sound: ICON_SOUND,
        atSec: cue.outStartSec + card.offsetSec,
        gainTrimDb: ICON_TRIM_DB,
      });
    }
  }

  return cues.sort((a, b) => a.atSec - b.atSec);
}

/**
 * How close two cues may be before the second is dropped.
 *
 * Two swipes 80ms apart is not two sounds, it is one sound with a flam on it,
 * and it is what you get where a B-roll insert leaves on the same beat an icon
 * card arrives. The FIRST one wins, because it is the one already aligned to
 * whatever put it there.
 */
export const CUE_MIN_GAP_SEC = 0.12;

/** Drops cues that land on top of one another, keeping the earlier. */
export function thinCues<T extends { atSec: number }>(cues: T[], minGap = CUE_MIN_GAP_SEC): T[] {
  const kept: T[] = [];
  for (const cue of cues) {
    const last = kept[kept.length - 1];
    if (last && cue.atSec - last.atSec < minGap) continue;
    kept.push(cue);
  }
  return kept;
}

/** Cues the director asked for, so a generated one never doubles them. */
export function existingCueTimes(edl: Pick<Edl, 'sfx'>): number[] {
  return edl.sfx.map((cue) => cue.atSec).sort((a, b) => a - b);
}
