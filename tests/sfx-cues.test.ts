import { describe, expect, it } from 'vitest';
import { CUE_MIN_GAP_SEC, thinCues, transitionCues } from '@/lib/edl/sfx-cues';
import { clipTransitionSec } from '@/lib/edl/transition-timing';
import { BrollClipSchema, IconCueSchema, type BrollClip, type ClipTransition, type IconCue } from '@/lib/edl/types';

/**
 * Sounds on the transitions.
 *
 * The thing that makes this worth testing rather than eyeballing is that a
 * sound landing in the wrong place is not a subtle defect — a swipe 200ms after
 * the swipe reads as a bug in the video, not as a mix note. And the exit sound
 * in particular is placed from a number the RENDERER owns, so the test that
 * matters most is the one that would catch those two drifting apart.
 */

const FRAME = { width: 1080, height: 1920 };

function broll(enter: ClipTransition, exit: ClipTransition, span: [number, number]): BrollClip {
  return BrollClipSchema.parse({
    id: `b-${enter}-${exit}-${span[0]}`,
    outStartSec: span[0],
    outEndSec: span[1],
    kind: 'stock-video',
    url: 'u',
    query: 'coffee',
    enter,
    exit,
  });
}

function icons(at: number, offsets: number[]): IconCue {
  return IconCueSchema.parse({
    id: 'i-0',
    outStartSec: at,
    outEndSec: at + 3,
    cards: offsets.map((offsetSec, i) => ({ offsetSec, word: `w${i}`, query: `q${i}` })),
  });
}

describe('which transitions get a sound', () => {
  it('gives a slide a swipe and a glitch its own sound', () => {
    const cues = transitionCues([broll('slide-up', 'glitch', [2, 6])], [], FRAME);
    expect(cues.map((c) => c.sound)).toEqual(['swipe', 'glitch']);
  });

  it('leaves a fade and a cut silent', () => {
    // The point of a dissolve is that nothing announces it.
    expect(transitionCues([broll('fade', 'cut', [2, 6])], [], FRAME)).toHaveLength(0);
  });
});

describe('where the sound lands', () => {
  it('puts the enter sound exactly on the insert', () => {
    const [cue] = transitionCues([broll('slide-left', 'cut', [2.5, 6])], [], FRAME);
    expect(cue.atSec).toBeCloseTo(2.5, 5);
  });

  it('starts the exit sound when the picture starts leaving, not when the clip ends', () => {
    const clip = broll('cut', 'slide-right', [2, 6]);
    const [cue] = transitionCues([clip], [], FRAME);
    const length = clipTransitionSec('slide-right', FRAME);
    expect(length).toBeGreaterThan(0);
    // The number the composition animates with, read from the same module —
    // this is what pins the two together.
    expect(cue.atSec).toBeCloseTo(6 - length, 5);
  });

  it('drops an exit sound that would land before its own clip started', () => {
    // A 60ms insert is shorter than the transition it was given.
    expect(transitionCues([broll('cut', 'whip', [2, 2.06])], [], FRAME)).toHaveLength(0);
  });

  it('sounds every icon card, not just the row', () => {
    const cues = transitionCues([], [icons(4, [0, 0.35, 0.7])], FRAME);
    expect(cues.map((c) => c.atSec)).toEqual([4, 4.35, 4.7]);
    expect(cues.every((c) => c.sound === 'swipe')).toBe(true);
  });

  it('mixes the icon swipe below the full-frame one', () => {
    const [slide] = transitionCues([broll('slide-up', 'cut', [2, 6])], [], FRAME);
    const [icon] = transitionCues([], [icons(4, [0])], FRAME);
    expect(icon.gainTrimDb).toBeLessThan(slide.gainTrimDb);
  });

  it('returns them in time order even when the sources are not', () => {
    const cues = transitionCues(
      [broll('slide-up', 'cut', [8, 10]), broll('slide-up', 'cut', [2, 4])],
      [icons(5, [0])],
      FRAME,
    );
    const times = cues.map((c) => c.atSec);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

describe('cues that land on top of one another', () => {
  it('keeps the first and drops the flam', () => {
    const kept = thinCues([
      { atSec: 3, sound: 'swipe' },
      { atSec: 3.05, sound: 'swipe' },
      { atSec: 3.4, sound: 'whoosh' },
    ]);
    expect(kept.map((c) => c.atSec)).toEqual([3, 3.4]);
  });

  it('measures the gap from the kept cue, so a run does not silence itself', () => {
    // Three cues 80ms apart. Measured against the PREVIOUS cue the third would
    // also be dropped and a busy stretch would go silent; measured against the
    // last one KEPT it is 160ms clear and it plays. That is the right answer —
    // thinning is meant to remove doubles, not to punish density.
    const kept = thinCues([{ atSec: 1 }, { atSec: 1.08 }, { atSec: 1.16 }]);
    expect(kept).toEqual([{ atSec: 1 }, { atSec: 1.16 }]);
  });

  it('is a short enough window to leave real placements alone', () => {
    expect(CUE_MIN_GAP_SEC).toBeLessThan(0.2);
  });
});
