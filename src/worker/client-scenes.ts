import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { db, parseJson, stringifyJson } from '@/lib/db';
import { EdlSchema, type Edl } from '@/lib/edl/types';
import { buildCompositionHtml, parseComposition } from '@/lib/director/hyperframe';
import { isBlank, renderProject, writeProject } from '@/lib/render/hyperframes';
import { styleGuideFor } from '@/lib/scenes/style-guides';
import { assetKey, storage } from '@/lib/storage';
import { wordsBetween, type ClientScene } from '@/lib/mcp/scenes';
import type { RenderQuality } from '@/lib/render/quality';
import { rerenderProject } from './process-project';

/**
 * The last step of a video edited from Claude.
 *
 * Every scene the person's Claude submitted is rendered to a clip — the same
 * HyperFrames page, checks and blank test the pipeline's own scenes go
 * through — and laid into its slot in the edit. A scene that fails to render,
 * or renders blank, keeps the drawn version it already had: the video still
 * finishes. Then the whole video is rendered from the new version.
 */
export async function finishClientScenes(projectId: string, quality: RenderQuality): Promise<void> {
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) throw new Error(`Project ${projectId} not found`);
  const row = await db.edl.findFirst({ where: { projectId }, orderBy: { version: 'desc' } });
  if (!row) throw new Error('Project has no edit yet');

  const edl = EdlSchema.parse(parseJson<Edl>(row.document, {} as Edl));
  const submitted = parseJson<Record<string, ClientScene>>(project.clientScenesJson, {});
  const failures: string[] = [];
  let changed = 0;

  const scenes = [];
  for (const scene of edl.scenes) {
    const written = submitted[scene.id];
    const parts = written ? parseComposition(written.html) : null;
    if (!written || !parts) {
      scenes.push(scene);
      continue;
    }
    const durationSec = Math.max(0.5, scene.outEndSec - scene.outStartSec);
    const words = wordsBetween(edl, scene.outStartSec, scene.outEndSec);
    const frame = { width: edl.format.width, height: edl.format.height, durationSec, ground: styleGuideFor(written.look).ground, words };
    const dir = join(tmpdir(), 'easycut-client-scenes', projectId, scene.id);
    try {
      await writeProject(dir, buildCompositionHtml(parts, frame));
      const out = join(dir, 'scene.mp4');
      await renderProject(dir, out, { fps: edl.format.fps });
      if (await isBlank(out).catch(() => false)) {
        failures.push(`${scene.id}: rendered blank`);
        scenes.push(scene);
        continue;
      }
      const stored = await storage().putFile(assetKey(projectId, 'scenes', `${scene.id}-claude.mp4`), out, 'video/mp4');
      await storage()
        .put(assetKey(projectId, 'scenes', `${scene.id}-claude.html`), Buffer.from(written.html), 'text/plain; charset=utf-8')
        .catch(() => undefined);
      scenes.push({ ...scene, look: written.look, clipUrl: stored.url });
      changed++;
    } catch (error) {
      failures.push(`${scene.id}: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`);
      scenes.push(scene);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  let edlId = row.id;
  if (changed) {
    const next = EdlSchema.parse({ ...edl, scenes });
    const created = await db.edl.create({
      data: { projectId, version: row.version + 1, document: stringifyJson(next), origin: 'claude' },
    });
    edlId = created.id;
  }
  if (failures.length) console.warn(`[client-scenes] ${projectId}: ${failures.join('; ')}`);
  await rerenderProject(projectId, edlId, quality);
}
