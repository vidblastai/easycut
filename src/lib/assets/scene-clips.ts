import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '@/lib/config/env';
import {
  auditComposition,
  buildCompositionHtml,
  composeScene,
  isComposerConfigured,
  isFatal,
  reviewScene,
  reviewTimes,
  type CompositionFrame,
  type CompositionParts,
  type CompositionRequest,
  type WordCue,
} from '@/lib/director/hyperframe';
import { photoSlotsFor, type AnimatedScene } from '@/lib/edl/types';
import { allBlank, isBlank, lintProject, renderProject, snapshotProject, validateProject, writeProject } from '@/lib/render/hyperframes';
import { styleGuideFor } from '@/lib/scenes/style-guides';
import { assetKey, storage } from '@/lib/storage';

/**
 * Scenes as HyperFrames clips — the `SCENE_ENGINE=hyperframes` path.
 *
 * Compositions are written in parallel, because that half is a model call and
 * waiting on four of them in sequence is minutes for nothing. They RENDER one
 * at a time, because that half is a headless Chrome with its own capture
 * workers, and two of those fighting over the same cores are slower together
 * than apart.
 *
 * Nothing in here can take a scene away. A scene whose composition fails,
 * lints dirty or will not render simply gets no clip, and the caller draws it
 * the SVG way instead.
 */

/** Same budget as the drawings: the first few scenes, where attention is. */
export const MAX_COMPOSED_SCENES = 4;

export interface SceneClipOptions {
  projectId: string;
  workDir: string;
  width: number;
  height: number;
  fps: number;
  lineFor: (scene: AnimatedScene) => string;
  wordsFor: (scene: AnimatedScene) => WordCue[];
}

export interface SceneClipResult {
  clips: Map<string, string>;
  costUsd: number;
  errors: string[];
  /** One line per scene — concept, review outcome, fate — for the project log. */
  notes: string[];
}

export function isSceneComposerConfigured(): boolean {
  return isComposerConfigured();
}

function frameFor(scene: AnimatedScene, options: SceneClipOptions): CompositionFrame {
  return {
    width: options.width,
    height: options.height,
    durationSec: Math.max(0.5, scene.outEndSec - scene.outStartSec),
    ground: styleGuideFor(scene.look).ground,
    words: options.wordsFor(scene),
  };
}

export interface DesignResult {
  parts: CompositionParts | null;
  costUsd: number;
  error?: string;
  /** What happened in the look-and-fix round, for the log. */
  review: 'approved' | 'revised' | 'kept' | 'skipped' | 'blank';
}

/**
 * Write the scene, check its source, then LOOK at it and fix it.
 *
 * The look-and-fix round renders four stills, shows them to the model, and
 * takes its revision only if the revision passes the same source checks and
 * is no worse by them — the model looking at its own work can still break
 * the markup while improving the picture, and a broken page is a blank clip.
 *
 * Stills that are all bare ground are the one thing never let through: the
 * model is told so in plain words, and if its fix is blank too the scene goes
 * back to being drawn.
 */
export async function designScene(
  request: CompositionRequest,
  frame: CompositionFrame,
  dir: string,
): Promise<DesignResult> {
  // HyperFrames' lint and a real page load, against the page as it will be
  // rendered, so their findings go into the repair round with the static audit.
  const check = async (parts: CompositionParts) => {
    await writeProject(dir, buildCompositionHtml(parts, frame));
    const [lint, thrown] = await Promise.all([
      lintProject(dir).catch(() => []),
      validateProject(dir).catch(() => []),
    ]);
    return [...thrown, ...lint];
  };
  const faultsOf = async (parts: CompositionParts) => [...auditComposition(parts), ...(await check(parts))];
  const times = reviewTimes(frame.durationSec);
  const look = async (parts: CompositionParts, name: string) => {
    await writeProject(dir, buildCompositionHtml(parts, frame));
    const shot = await snapshotProject(dir, times, join(dir, name));
    return { ...shot, blank: await allBlank(shot.frames) };
  };

  const composed = await composeScene(request, check);
  if (!composed.parts || !env.scenes.review) return { ...composed, review: 'skipped' };

  let costUsd = composed.costUsd;
  let blank = false;
  try {
    const shot = await look(composed.parts, 'review');
    blank = shot.blank;
    const dataUri = `data:image/jpeg;base64,${(await readFile(shot.sheet)).toString('base64')}`;

    const review = await reviewScene(request, composed.parts, { dataUri, times, blank });
    costUsd += review.costUsd;
    if (review.approved) return { parts: composed.parts, costUsd, review: 'approved' };
    if (!review.parts) {
      return blank
        ? { parts: null, costUsd, review: 'blank', error: 'scene rendered blank and the review could not fix it' }
        : { parts: composed.parts, costUsd, review: 'kept', error: review.error };
    }

    const before = await faultsOf(composed.parts);
    const after = await faultsOf(review.parts);
    const sound = !after.some(isFatal);
    if (blank) {
      // Anything visible beats nothing, so "no worse by the checks" gives way
      // to "not blank" — but the fix has to be seen to be not blank.
      if (sound && !(await look(review.parts, 'fixed')).blank) return { parts: review.parts, costUsd, review: 'revised' };
      return { parts: null, costUsd, review: 'blank', error: 'scene rendered blank, and so did its fix' };
    }
    return sound && after.length <= before.length
      ? { parts: review.parts, costUsd, review: 'revised' }
      : { parts: composed.parts, costUsd, review: 'kept' };
  } catch (caught) {
    // A review that cannot run costs nothing but the review. The clip is
    // still checked for blankness before it ships.
    const why = `review could not run: ${caught instanceof Error ? caught.message.slice(0, 160) : String(caught)}`;
    return blank
      ? { parts: null, costUsd, review: 'blank', error: 'scene rendered blank' }
      : { parts: composed.parts, costUsd, review: 'kept', error: why };
  }
}

export async function composeSceneClips(scenes: AnimatedScene[], options: SceneClipOptions): Promise<SceneClipResult> {
  const clips = new Map<string, string>();
  const errors: string[] = [];
  const notes: string[] = [];
  let costUsd = 0;

  // A photo scene is evidence, not an idea — it keeps its photographs.
  const chosen = scenes.filter((scene) => photoSlotsFor(scene) === 0).slice(0, MAX_COMPOSED_SCENES);
  if (!chosen.length) return { clips, costUsd, errors, notes };

  const composed = await Promise.all(
    chosen.map(async (scene) => {
      const frame = frameFor(scene, options);
      const dir = join(options.workDir, 'hyperframes', scene.id);
      const result = await designScene(
        {
          line: options.lineFor(scene),
          words: frame.words,
          headline: scene.headline,
          items: scene.items,
          kind: scene.kind,
          look: scene.look,
          width: frame.width,
          height: frame.height,
          durationSec: frame.durationSec,
        },
        frame,
        dir,
      );
      return { scene, frame, dir, result };
    }),
  );

  for (const { scene, frame, dir, result } of composed) {
    costUsd += result.costUsd;
    const concept = result.parts?.concept ? ` "${result.parts.concept.slice(0, 120)}"` : '';
    if (!result.parts) {
      if (result.error) errors.push(result.error);
      notes.push(`${scene.id}: no clip, review ${result.review} — ${result.error ?? 'no composition'}`);
      continue;
    }
    try {
      // Written again: the last page on disk may be a rejected repair.
      const html = buildCompositionHtml(result.parts, frame);
      await writeProject(dir, html);
      // Kept beside the clip, so a scene that looks wrong can be read back.
      await storage()
        .put(assetKey(options.projectId, 'scenes', `${scene.id}.html`), Buffer.from(html), 'text/plain; charset=utf-8')
        .catch(() => undefined);
      const out = join(dir, 'scene.mp4');
      await renderProject(dir, out, { fps: options.fps });
      // The last gate: a clip of bare ground is worse than the drawing.
      if (await isBlank(out).catch(() => false)) {
        errors.push('scene clip rendered blank');
        notes.push(`${scene.id}: blank clip refused, review ${result.review}${concept}`);
        continue;
      }
      const stored = await storage().putFile(assetKey(options.projectId, 'scenes', `${scene.id}.mp4`), out, 'video/mp4');
      clips.set(scene.id, stored.url);
      notes.push(`${scene.id}: clip, review ${result.review}${concept}${result.error ? ` (${result.error})` : ''}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message);
      notes.push(`${scene.id}: render failed — ${message.slice(0, 160)}`);
    }
  }

  return { clips, costUsd, errors, notes };
}
