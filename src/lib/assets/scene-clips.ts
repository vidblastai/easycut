import { join } from 'node:path';
import {
  buildCompositionHtml,
  composeScene,
  isComposerConfigured,
  type CompositionFrame,
  type CompositionParts,
  type WordCue,
} from '@/lib/director/hyperframe';
import { photoSlotsFor, type AnimatedScene } from '@/lib/edl/types';
import { lintProject, renderProject, writeProject } from '@/lib/render/hyperframes';
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

export async function composeSceneClips(scenes: AnimatedScene[], options: SceneClipOptions): Promise<SceneClipResult> {
  const clips = new Map<string, string>();
  const errors: string[] = [];
  let costUsd = 0;

  // A photo scene is evidence, not an idea — it keeps its photographs.
  const chosen = scenes.filter((scene) => photoSlotsFor(scene) === 0).slice(0, MAX_COMPOSED_SCENES);
  if (!chosen.length) return { clips, costUsd, errors };

  const composed = await Promise.all(
    chosen.map(async (scene) => {
      const frame = frameFor(scene, options);
      const dir = join(options.workDir, 'hyperframes', scene.id);
      // HyperFrames' own lint runs against the page as it will be rendered,
      // so its findings go into the repair round with the static audit.
      const check = async (parts: CompositionParts) => {
        await writeProject(dir, buildCompositionHtml(parts, frame));
        return lintProject(dir).catch(() => []);
      };
      const result = await composeScene(
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
        check,
      );
      return { scene, frame, dir, result };
    }),
  );

  for (const { scene, frame, dir, result } of composed) {
    costUsd += result.costUsd;
    if (!result.parts) {
      if (result.error) errors.push(result.error);
      continue;
    }
    try {
      // Written again: the last page on disk may be a rejected repair.
      await writeProject(dir, buildCompositionHtml(result.parts, frame));
      const out = join(dir, 'scene.mp4');
      await renderProject(dir, out, { fps: options.fps });
      const stored = await storage().putFile(assetKey(options.projectId, 'scenes', `${scene.id}.mp4`), out, 'video/mp4');
      clips.set(scene.id, stored.url);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return { clips, costUsd, errors };
}
