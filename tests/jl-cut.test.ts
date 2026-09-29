import { describe, expect, it } from 'vitest';
import { buildAudioGraph } from '@/lib/media/audio-mix';
import { EdlSchema, type Edl } from '@/lib/edl/types';
import { layoutSegments } from '@/lib/timeline/time-mapper';

/**
 * J and L cuts.
 *
 * The whole effect is that the audio join and the picture join stop happening
 * on the same frame. So the two things worth testing are that the audio really
 * does reach outside its own picture, and that doing so did not change how long
 * anything is — a J cut that also desynced the video would be a catastrophe
 * dressed as a polish pass.
 */

function makeEdl(over: { jCutSec?: number; spans?: [number, number][] } = {}): Edl {
  const spans = over.spans ?? [
    [10, 14],
    [30, 34],
    [50, 54],
  ];
  const segments = layoutSegments(spans.map(([sourceStartSec, sourceEndSec]) => ({ sourceStartSec, sourceEndSec })));
  const durationSec = segments.length ? segments[segments.length - 1].outEndSec : 0;

  return EdlSchema.parse({
    version: '1.0',
    projectId: 'test',
    styleId: 'punchy',
    format: { aspect: '9:16', width: 1080, height: 1920, fps: 30, durationSec },
    source: {
      assetId: 'src', url: 'file://x.mp4', width: 1920, height: 1080,
      fps: 30, durationSec: 120, hasAudio: true,
    },
    segments,
    captions: [],
    captionStyle: {},
    audio: over.jCutSec === undefined ? {} : { jCutSec: over.jCutSec },
    deliverable: {},
  });
}

const graph = (edl: Edl) =>
  buildAudioGraph(edl, { sourceAudioPath: 'in.wav', sfxPaths: {}, outputPath: 'out.m4a' }).filterGraph;

/** Every `atrim=start=A:end=B` in the graph, as numbers. */
function trims(g: string): { start: number; end: number }[] {
  return [...g.matchAll(/atrim=start=([\d.]+):end=([\d.]+)/g)].map((m) => ({
    start: Number(m[1]),
    end: Number(m[2]),
  }));
}

describe('with the overlap on', () => {
  it('reaches earlier into the source than the picture it belongs to', () => {
    const cut = trims(graph(makeEdl()));
    expect(cut).toHaveLength(3);
    // First segment has nothing to lead into, so it starts where its picture does.
    expect(cut[0].start).toBeCloseTo(10, 3);
    // The middle one pulls its audio in before frame one of its own shot.
    expect(cut[1].start).toBeLessThan(30);
    expect(cut[2].start).toBeLessThan(50);
  });

  it('carries the previous line past its own last frame', () => {
    const cut = trims(graph(makeEdl()));
    expect(cut[0].end).toBeGreaterThan(14);
    expect(cut[1].end).toBeGreaterThan(34);
    // Nothing follows the last one, so it ends on its picture.
    expect(cut[2].end).toBeCloseTo(54, 3);
  });

  it('places each segment absolutely, earlier than its picture by exactly the lead', () => {
    const g = graph(makeEdl({ jCutSec: 0.14 }));
    const delays = [...g.matchAll(/adelay=(\d+)\|\1:all=1/g)].map((m) => Number(m[1]));
    // Segment 0 sits at 0 with no lead; 1 and 2 start 140ms before out 4s and 8s.
    expect(delays).toEqual([0, 3860, 7860]);
  });

  it('mixes rather than concatenates, without dividing the voice by the segment count', () => {
    const g = graph(makeEdl());
    expect(g).toContain('amix=inputs=3');
    expect(g).toContain('normalize=0');
    expect(g).not.toContain('concat=');
  });

  it('still levels the voice, because the join is not what loudness depends on', () => {
    // The cleanup chain used to live inside the concat branch only, which left
    // `[speech]` — the label the music duck and the final mix both read —
    // undefined the moment the overlap turned on.
    const g = graph(makeEdl());
    expect(g).toContain('[speech]');
    expect(g).toContain('loudnorm=I=-14');
    expect(g).toContain('highpass=');
  });

  it('fades across the overlap so the two halves crossfade', () => {
    const g = graph(makeEdl({ jCutSec: 0.14 }));
    expect(g).toContain('afade=t=in:st=0:d=0.1400');
  });

  it('never leads back before the start of the source file', () => {
    // Second segment begins 50ms into the file: a 140ms lead would ask ffmpeg
    // for a negative timestamp.
    const cut = trims(graph(makeEdl({ spans: [[10, 14], [0.05, 4]] })));
    expect(cut[1].start).toBeGreaterThanOrEqual(0);
  });

  it('never spends more than 40% of a short segment on the overlap', () => {
    // A 0.2s segment given a full 0.14s lead AND tail would never reach level.
    const cut = trims(graph(makeEdl({ spans: [[10, 14], [30, 30.2], [50, 54]] })));
    const widened = (cut[1].end - cut[1].start) - 0.2;
    expect(widened).toBeLessThanOrEqual(0.2 * 0.8 + 0.001);
  });
});

describe('with the overlap off', () => {
  it('falls back to the hard concat at zero', () => {
    const g = graph(makeEdl({ jCutSec: 0 }));
    expect(g).toContain('concat=n=3');
    expect(g).not.toContain('amix=inputs=3');
  });

  it('still fades 12ms at every join, because a hard splice clicks', () => {
    expect(graph(makeEdl({ jCutSec: 0 }))).toContain('afade=t=in:st=0:d=0.0120');
  });

  it('has nothing to overlap with one segment', () => {
    const g = graph(makeEdl({ jCutSec: 0.14, spans: [[10, 14]] }));
    expect(g).not.toContain('adelay=0|0:all=1');
  });
});
