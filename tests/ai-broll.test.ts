import { describe, expect, it, vi } from 'vitest';
import {
  BROLL_SOURCES,
  isBrollSource,
  moveForStill,
} from '@/lib/assets/ai-broll';
import { KIE_IMAGE_COST_USD, KIE_VIDEO_MODELS, kieVideoModel } from '@/lib/assets/kie';
import { brollPrompt, subjectHasPeople } from '@/lib/assets/broll-prompt';
import { BROLL_OVERLAYS, BrollClipSchema } from '@/lib/edl/types';
import { OVERLAY_COPY, OVERLAY_GROUPS } from '@/lib/edl/overlay-copy';
import { STYLE_LIST, getStyle } from '@/lib/styles/presets';
import { layoutPlan } from '@/lib/styles/layouts';

/**
 * B-roll that is made rather than found.
 *
 * The thing worth pinning is the economics, because they are the whole reason
 * this is a choice and not a default: a generated still and a generated clip
 * are not two flavours of one feature, they are three cents against dollars
 * and seconds against minutes.
 */
describe('AI B-roll', () => {
  it('keeps a still an order of magnitude cheaper than a clip', () => {
    // Four inserts of stills is twelve cents, inside a one-dollar short four
    // times over. Four clips from the best model is $2.48 — over budget on its
    // own, before a single frame is rendered. That gap is the design.
    const stills = 4 * KIE_IMAGE_COST_USD;
    const best = KIE_VIDEO_MODELS.find((m) => m.id === 'bytedance/seedance-2-fast')!;
    const clips = 4 * 5 * best.usdPerSec;

    expect(stills).toBeCloseTo(0.12, 5);
    expect(clips).toBeGreaterThan(2);
    expect(clips / stills).toBeGreaterThan(10);
  });

  it('prices every video model per second, and orders them by what they cost', () => {
    // The picker quotes these and the ledger charges them, so a number that
    // drifts here is a budget that silently stops meaning anything.
    for (const model of KIE_VIDEO_MODELS) {
      expect(model.usdPerSec).toBeGreaterThan(0);
      expect(model.durations.length).toBeGreaterThan(0);
      expect(model.typicalSec).toBeGreaterThan(0);
    }
    const costs = KIE_VIDEO_MODELS.map((m) => m.usdPerSec);
    expect([...costs].sort((a, b) => a - b)).toEqual(costs);
    // And the dearest is also the slowest, which is why it cannot be a default.
    expect(KIE_VIDEO_MODELS.at(-1)!.typicalSec).toBe(Math.max(...KIE_VIDEO_MODELS.map((m) => m.typicalSec)));
  });

  it('falls back to a known model rather than throwing on a stale id', () => {
    // A model name in a months-old deployment's env should cost a preference,
    // not every render that deployment attempts.
    expect(kieVideoModel('bytedance/does-not-exist').id).toBeTruthy();
    expect(kieVideoModel('bytedance/v1-lite-text-to-video').label).toBe('Seedance 1.0 Lite');
  });

  it('never gives two consecutive stills the same move', () => {
    /*
     * Four stills all pushing in at the same rate is its own kind of static —
     * it reads as a slideshow with a zoom effect on it rather than as B-roll.
     * By index rather than at random, because the rest of the pipeline is
     * deterministic and a generated insert must not be the one thing that is
     * not: the same footage has to cut the same way twice.
     */
    const moves = [0, 1, 2, 3, 4, 5].map(moveForStill);
    for (let i = 1; i < moves.length; i++) expect(moves[i]).not.toBe(moves[i - 1]);
    expect(moveForStill(0)).toBe(moveForStill(4));
    // And none of them is "none" — a generated still that holds still is the
    // thing this exists to avoid.
    expect(moves).not.toContain('none');
  });

  it('only accepts a source it knows', () => {
    expect(BROLL_SOURCES).toEqual(['stock', 'ai-image', 'ai-video']);
    expect(isBrollSource('ai-image')).toBe(true);
    expect(isBrollSource('ai-everything')).toBe(false);
    expect(isBrollSource(undefined)).toBe(false);
  });
});

describe('what a generated insert is asked for', () => {
  it('bans people even when the director asked for one', () => {
    /*
     * The giveaway, and it is not a matter of degree: a face is where every
     * one of these models fails, and hands are the second place — which is
     * why "hands only" is not the escape hatch it looks like.
     *
     * So the shot is RECAST rather than refused. The cue is illustrating a
     * noun either way; the noun that survives is the one that cannot look fake.
     */
    const asked = brollPrompt('a barista making coffee in a cafe', 'clip');
    expect(subjectHasPeople('a barista making coffee in a cafe')).toBe(true);
    expect(asked).toMatch(/OBJECTS and the SPACE/);
    expect(asked).toMatch(/NO PEOPLE/);
    expect(asked).toMatch(/no hands/);
    // The subject survives — the model still knows what the cue is about.
    expect(asked).toContain('a barista making coffee in a cafe');
  });

  it('still bans people when the subject never mentioned one', () => {
    // A model will put a figure in a street or an office unprompted, so the
    // clause is unconditional and only the recast sentence is conditional.
    const plain = brollPrompt('an espresso machine on a counter', 'still');
    expect(subjectHasPeople('an espresso machine on a counter')).toBe(false);
    expect(plain).not.toMatch(/OBJECTS and the SPACE/);
    expect(plain).toMatch(/NO PEOPLE/);
  });

  it('asks for something unremarkable rather than something cinematic', () => {
    /*
     * The words that read as quality in a prompt — cinematic, epic, 8K,
     * hyperreal — are the words that produce the over-lit, over-graded look
     * everybody now recognises on sight. This has to sit next to real footage
     * of a real person and not announce itself.
     */
    for (const medium of ['still', 'clip'] as const) {
      const prompt = brollPrompt('a rain-soaked bicycle against a wall', medium);
      expect(prompt).toMatch(/natural available light/);
      expect(prompt).toMatch(/unremarkable frame from real footage/);
      // "cinematic" appears, as something the shot must NOT be. The check is
      // that it is never asked FOR — an easy thing to reintroduce by accident
      // while making a prompt sound better.
      expect(prompt).toMatch(/Not cinematic, not stylised/);
      expect(prompt).not.toMatch(/\b(8k|hyperreal|award-winning|epic)\b/i);
    }
  });

  it('bans lettering in the scene, not just captions over it', () => {
    // The first test render put TKO SES LYOPE MOM across a cafe wall. Under
    // our own caption track that is the one artefact nobody can edit away.
    const prompt = brollPrompt('a quiet office at night', 'clip');
    expect(prompt).toMatch(/no signage/);
    expect(prompt).toMatch(/no labels/);
    expect(prompt).toMatch(/No text of any kind anywhere in the frame/);
  });

  it('asks a clip to move and a still to hold', () => {
    expect(brollPrompt('a harbour', 'clip')).toMatch(/one slow continuous move/);
    expect(brollPrompt('a harbour', 'still')).toMatch(/single documentary photograph/);
  });
});

describe('B-roll overlays', () => {
  it('is off by default, so an old document renders the picture it rendered before', () => {
    // This is the whole safety property of adding a field to a stored
    // document: every EDL written before these existed must come back with
    // nothing painted over its inserts.
    const clip = BrollClipSchema.parse({ id: 'a', outStartSec: 0, outEndSec: 2, kind: 'stock-video', url: 'x' });
    expect(clip.overlay).toBe('none');
  });

  it('gives every style an overlay its own look would have chosen', () => {
    // A property of the LOOK, beside the transition vocabulary — grain belongs
    // to a documentary and scanlines belong to something loud, and neither is
    // a property of whichever clip the search happened to find.
    for (const style of STYLE_LIST) {
      expect(BROLL_OVERLAYS).toContain(getStyle(style.id).brollOverlay);
    }
    expect(getStyle('documentary').brollOverlay).toBe('grain');
    expect(getStyle('clean').brollOverlay).toBe('none');
  });

  it('names and describes every one of them', () => {
    // A name nobody has seen is not a choice. Same reason the transitions
    // carry a sentence each: nobody can tell "prism" from "scanlines" cold.
    for (const type of BROLL_OVERLAYS) {
      expect(OVERLAY_COPY[type].label.length).toBeGreaterThan(0);
      expect(OVERLAY_COPY[type].note.length).toBeGreaterThan(10);
    }
  });

  it('never ships a treatment that throws the footage away', () => {
    /*
     * The line an earlier pass crossed. "More visible" was read as "more
     * destructive" and it shipped datamosh, duotone and halftone — inverted
     * bands, a two-colour posterise, a print screen. All certainly visible,
     * and all things nobody puts on their own video, because each one throws
     * the FOOTAGE away and the footage is what the insert is for.
     *
     * Pinned by name because the failure was a judgement call, not a bug, and
     * the only thing that stops a judgement call recurring is writing it down
     * somewhere that fails.
     */
    for (const gone of ['datamosh', 'duotone', 'halftone']) {
      expect(BROLL_OVERLAYS).not.toContain(gone);
    }
  });

  it('opens an old document that names a treatment since removed', () => {
    // Degrades to an untreated insert rather than failing to parse. A whole
    // project that will not open because a treatment was renamed is not a
    // trade worth making for stricter typing.
    const clip = BrollClipSchema.parse({
      id: 'a', outStartSec: 0, outEndSec: 2, kind: 'stock-video', url: 'x', overlay: 'datamosh',
    });
    expect(clip.overlay).toBe('none');
  });

  it('sorts every one of them into subtle or strong, and none into both', () => {
    /*
     * The grouping is not decoration — it is the only distinction that helps
     * somebody choose. Subtle makes a video look better without anybody
     * noticing a filter; loud is a statement. An overlay missing from the
     * groups is one the pickers would never show, which is a silent way to
     * ship something nobody can reach.
     */
    const grouped = OVERLAY_GROUPS.flatMap((g) => g.types);
    expect([...grouped].sort()).toEqual([...BROLL_OVERLAYS].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
    // `none` belongs with the subtle ones: it is the absence of a treatment.
    expect(OVERLAY_GROUPS[0].types).toContain('none');
    expect(OVERLAY_GROUPS[1].types).toContain('crt');
  });

  it('leaves a permanent split-screen slot untreated', () => {
    /*
     * A layout whose B-roll owns half the frame is not an insert — it is the
     * other half of the video, from the first frame to the last. Grain running
     * for four minutes down one side of a split screen is a filter on the
     * video, and the `overlays` layer is where a filter on the video belongs.
     */
    const split = getStyle('split');
    expect(layoutPlan(split.layout).alwaysOn).toBe(true);
  });
});

/**
 * Load the module fresh with a particular set of keys.
 *
 * `env` is read once at import time and frozen, which is right for the
 * product and means a configuration branch cannot be tested by assignment.
 * Resetting the registry and importing again is what actually exercises the
 * wiring rather than a stand-in for it.
 */
async function withKeys(keys: Record<string, string>) {
  const before = { ...process.env };
  for (const [k, v] of Object.entries(keys)) {
    if (v) process.env[k] = v;
    else delete process.env[k];
  }
  vi.resetModules();
  try {
    return await import('@/lib/assets/ai-broll');
  } finally {
    process.env = before;
  }
}

const NO_IMAGE_KEYS = {
  KIE_API_KEY: '',
  WAVESPEED_API_KEY: '',
  REPLICATE_API_TOKEN: '',
  FAL_KEY: '',
};

describe('AI pictures without a Kie key', () => {
  it('unlocks on the image generator this product already has', async () => {
    // The tile was locked behind KIE_API_KEY while the same deployment's
    // WaveSpeed key could already make the picture — a feature shown as
    // unavailable to somebody who was paying for it.
    const m = await withKeys({ ...NO_IMAGE_KEYS, FAL_KEY: 'fal-x' });
    expect(m.isAiBrollConfigured('ai-image')).toBe(true);
    const rate = m.brollSourceRates().find((r) => r.source === 'ai-image')!;
    expect(rate.available).toBe(true);
    expect(rate.usdPerInsert).toBeGreaterThan(0);
  });

  it('still says what is missing when neither provider is there', async () => {
    const m = await withKeys(NO_IMAGE_KEYS);
    const rate = m.brollSourceRates().find((r) => r.source === 'ai-image')!;
    expect(rate.available).toBe(false);
    expect(rate.missing).toMatch(/WaveSpeed/i);
  });

  it('quotes the provider it will actually use', async () => {
    const kie = await withKeys({ ...NO_IMAGE_KEYS, KIE_API_KEY: 'kie-x' });
    const fallback = await withKeys({ ...NO_IMAGE_KEYS, FAL_KEY: 'fal-x' });
    const a = kie.estimateAiBrollUsd('ai-image', 4, 3);
    const b = fallback.estimateAiBrollUsd('ai-image', 4, 3);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
    expect(b).not.toBe(a);
  });

  it('waits less for the fallback than for the one it replaces', async () => {
    const kie = await withKeys({ ...NO_IMAGE_KEYS, KIE_API_KEY: 'kie-x' });
    const fallback = await withKeys({ ...NO_IMAGE_KEYS, FAL_KEY: 'fal-x' });
    expect(fallback.estimateAiBrollSeconds('ai-image', 1))
      .toBeLessThan(kie.estimateAiBrollSeconds('ai-image', 1));
  });
});
