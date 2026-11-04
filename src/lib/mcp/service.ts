import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { LOOK_LIST } from '@/lib/scenes/looks';
import { styleGuideFor } from '@/lib/scenes/style-guides';
import { STYLE_LIST, getStyle } from '@/lib/styles/presets';
import { CAPTION_PRESETS, findCaptionPreset } from '@/lib/captions/presets';
import { db, parseJson, stringifyJson } from '@/lib/db';
import { env } from '@/lib/config/env';
import { AnimatedSceneSchema, EdlSchema, SCENE_LOOKS, type Edl, type SceneLook } from '@/lib/edl/types';
import { assetKey, storage } from '@/lib/storage';
import { queue } from '@/lib/queue';
import { entitlementsFor, entitlementsOf } from '@/lib/billing/entitlements';
import { allowsQuality, type RenderQuality } from '@/lib/render/quality';
import { isAuthEnabled } from '@/lib/auth';
import { withServerAi } from '@/lib/llm/server-ai';
import { startProjectJob } from '@/lib/projects/start';
import { patchProjectEdl, type EdlPatch } from '@/lib/projects/edl-patch';
import {
  auditComposition,
  briefFor,
  buildCompositionHtml,
  frameGuides,
  isFatal,
  parseComposition,
  reviewTimes,
  safeZone,
  systemPrompt,
  type CompositionRequest,
  type WordCue,
} from '@/lib/director/hyperframe';
import { wordsBetween, type ClientScene } from './scenes';
import { cutOperations, type CutRange } from '@/lib/edl/cut-ranges';
import { videosAhead, waitingLabel } from '@/lib/queue/position';
export { wordsBetween, type ClientScene } from './scenes';
import { allBlank, guideSheet, lintProject, snapshotProject, validateProject, writeProject } from '@/lib/render/hyperframes';

/**
 * What the MCP server can do on someone's account.
 *
 * Every function takes the caller and checks the project is theirs before it
 * touches it; with sign-in off (a self-hosted clone) every project is everyone's,
 * the same as in the web app. Errors are thrown as `McpUserError` with a message
 * written for the person reading Claude's reply, because that is where they land.
 */

export class McpUserError extends Error {}

export interface Caller {
  /** Null only when sign-in is off on this server. */
  userId: string | null;
  /** Where this deployment is reachable, for links in replies. */
  origin: string;
}

/* ---------------------------------------------------------------- helpers */

async function ownProject(caller: Caller, projectId: string) {
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project || (isAuthEnabled() && project.userId !== caller.userId)) {
    throw new McpUserError(`No project ${projectId} on this account. list_projects shows the ones there are.`);
  }
  return project;
}

function absolute(caller: Caller, url: string | null | undefined): string | null {
  if (!url) return null;
  return url.startsWith('http') ? url : `${caller.origin}${url.startsWith('/') ? '' : '/'}${url}`;
}

async function latestEdl(projectId: string): Promise<{ id: string; version: number; edl: Edl } | null> {
  const row = await db.edl.findFirst({ where: { projectId }, orderBy: { version: 'desc' } });
  if (!row) return null;
  return { id: row.id, version: row.version, edl: EdlSchema.parse(parseJson<Edl>(row.document, {} as Edl)) };
}

async function requireEdl(projectId: string) {
  const latest = await latestEdl(projectId);
  if (!latest) throw new McpUserError('This video has not been edited yet — wait for get_project to say it is ready.');
  return latest;
}

function lineOf(words: WordCue[]): string {
  return words.map((word) => word.text).join(' ').trim();
}

function clientScenesOf(json: string | null): Record<string, ClientScene> {
  return parseJson<Record<string, ClientScene>>(json, {});
}

/* ---------------------------------------------------------------- catalogue */

export function listStyles() {
  return {
    editStyles: STYLE_LIST.map((style) => ({ id: style.id, name: style.name, tagline: style.tagline, bestFor: style.bestFor })),
    sceneLooks: LOOK_LIST.map((look) => ({ id: look.id, name: look.name, tone: look.tone, bestFor: look.bestFor })),
    captionLooks: CAPTION_PRESETS.map((preset) => ({ id: preset.id, name: preset.name, blurb: preset.blurb, bestFor: preset.bestFor })),
  };
}

/* ---------------------------------------------------------------- projects */

export async function listProjects(caller: Caller) {
  const projects = await db.project.findMany({
    where: isAuthEnabled() ? { userId: caller.userId ?? '__none__' } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 25,
    include: { jobs: { orderBy: { queuedAt: 'desc' }, take: 1 } },
  });
  return projects.map((project) => ({
    id: project.id,
    title: project.title,
    status: project.status,
    madeWith: project.aiMode === 'client' ? 'claude' : 'easycut',
    durationSec: project.durationSec,
    createdAt: project.createdAt,
    link: `${caller.origin}/projects/${project.id}`,
  }));
}

export interface CreateInput {
  title?: string;
  videoUrl?: string;
  filename?: string;
  styleId?: string;
  sceneLook?: string;
  captionPreset?: string;
  inputMode?: 'raw' | 'roughcut';
  note?: string;
}

export async function createProject(caller: Caller, input: CreateInput, bearer: string | null) {
  if (input.sceneLook && !(SCENE_LOOKS as readonly string[]).includes(input.sceneLook)) {
    throw new McpUserError(`Unknown scene look "${input.sceneLook}". list_styles has the ids.`);
  }
  if (input.captionPreset && !findCaptionPreset(input.captionPreset)) {
    throw new McpUserError(`Unknown caption look "${input.captionPreset}". list_styles has the ids.`);
  }
  const filename = (input.filename ?? (input.videoUrl ? fileNameFromUrl(input.videoUrl) : 'video.mp4')).replace(/[^\w.\-]+/g, '-').slice(-120);
  const project = await db.project.create({
    data: {
      userId: caller.userId,
      title: input.title?.trim() || filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') || 'Untitled',
      mode: 'short',
      styleId: getStyle(input.styleId ?? 'clean').id,
      captionPreset: input.captionPreset ?? null,
      sceneLook: input.sceneLook ?? null,
      inputMode: input.inputMode ?? 'raw',
      userNote: input.note,
      aiMode: 'client',
      status: 'draft',
      layersOff: '[]',
    },
  });

  if (input.videoUrl) {
    const key = assetKey(project.id, 'source', filename);
    const { bytes, contentType } = await downloadToStorage(input.videoUrl, key);
    const started = await startProjectJob({ projectId: project.id, userId: caller.userId, storageKey: key, contentType, sizeBytes: bytes });
    if (!started.ok) throw new McpUserError(started.error);
    return {
      projectId: project.id,
      status: 'processing',
      next: 'Call get_project until status is "ready" (usually 1–3 minutes once it starts). It waits for the next step itself, so call it again straight away.',
      link: `${caller.origin}/projects/${project.id}`,
    };
  }

  const uploadUrl = `${caller.origin}/api/projects/${project.id}/upload`;
  const auth = bearer ? ` -H "Authorization: Bearer ${bearer.slice(0, 6)}…"` : '';
  return {
    projectId: project.id,
    status: 'waiting_for_footage',
    upload: {
      howTo:
        'Send the video file to this address, then call start_edit. From a terminal (Claude Code): ' +
        `curl -X POST "${uploadUrl}"${auth} -H "Content-Type: video/mp4" -H "x-filename: ${filename}" --data-binary @your-video.mp4` +
        ' — use the same token this connection uses. From claude.ai, ask for a public link (Google Drive, Dropbox) instead and pass it as video_url, or upload on the website and use the project from list_projects.',
      url: uploadUrl,
      method: 'POST',
    },
    link: `${caller.origin}/projects/${project.id}`,
  };
}

export async function startEdit(caller: Caller, projectId: string) {
  await ownProject(caller, projectId);
  const started = await startProjectJob({ projectId, userId: caller.userId });
  if (!started.ok) throw new McpUserError(started.error);
  return { projectId, status: 'processing', jobId: started.jobId, next: 'Call get_project until status is "ready".' };
}

/**
 * What the project is doing, in words. The jobs after the first edit (the
 * scene clips and the final render) do not report stages, so while one runs
 * the last job still reads "Done" — which is exactly wrong for a caller
 * polling until it is.
 */
function progressOf(
  status: string,
  job: { type: string; stage: string; progressLabel: string; progress: number; status: string } | null,
) {
  if (!job) return null;
  const finishing = status === 'processing' && (job.type !== 'pipeline' || job.status === 'succeeded');
  if (finishing) return { stage: 'render', label: 'Rendering the scenes and the video', fraction: null, state: job.status === 'failed' ? 'failed' : 'running' };
  return { stage: job.stage, label: job.progressLabel, fraction: job.progress, state: job.status };
}

/** What changes when a video moves on — status, stage, or its place in line. */
async function progressKey(projectId: string): Promise<string> {
  const [project, job, ahead] = await Promise.all([
    db.project.findUnique({ where: { id: projectId }, select: { status: true } }),
    db.job.findFirst({ where: { projectId }, orderBy: { queuedAt: 'desc' }, select: { stage: true, status: true } }),
    videosAhead(projectId),
  ]);
  return `${project?.status}|${job?.stage}|${job?.status}|${ahead}`;
}

/**
 * Waits, up to `seconds`, for a processing video to move on before answering.
 *
 * A person's Claude in claude.ai has no way to pause between checks, so a
 * "call again in 30 seconds" turns into a call every second. Holding the
 * answer until something changes makes each call worth one step.
 */
async function waitForChange(projectId: string, seconds: number): Promise<void> {
  const deadline = Date.now() + seconds * 1000;
  const before = await progressKey(projectId);
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    if ((await progressKey(projectId)) !== before) return;
  }
}

export async function getProject(caller: Caller, projectId: string, waitSeconds = 0) {
  const owned = await ownProject(caller, projectId);
  if (waitSeconds > 0 && owned.status === 'processing') await waitForChange(projectId, waitSeconds);
  const project = waitSeconds > 0 ? await ownProject(caller, projectId) : owned;
  const job = await db.job.findFirst({ where: { projectId }, orderBy: { queuedAt: 'desc' } });
  const ahead = project.status === 'processing' ? await videosAhead(projectId) : null;
  const render = await db.render.findFirst({ where: { projectId, status: 'done' }, orderBy: { createdAt: 'desc' } });
  const latest = await latestEdl(projectId);
  const submitted = clientScenesOf(project.clientScenesJson);
  return {
    id: project.id,
    title: project.title,
    status: project.status,
    error: project.errorMessage,
    progress:
      ahead !== null
        ? { stage: 'queued', label: waitingLabel(ahead), fraction: 0, state: 'queued' }
        : progressOf(project.status, job),
    durationSec: project.durationSec,
    video: absolute(caller, render?.url ?? project.previewUrl),
    editor: `${caller.origin}/projects/${project.id}`,
    scenes: latest
      ? latest.edl.scenes.map((scene) => ({
          id: scene.id,
          startSec: Number(scene.outStartSec.toFixed(2)),
          endSec: Number(scene.outEndSec.toFixed(2)),
          look: scene.look,
          line: lineOf(wordsBetween(latest.edl, scene.outStartSec, scene.outEndSec)),
          writtenByClaude: Boolean(submitted[scene.id]),
          hasClip: Boolean(scene.clipUrl),
        }))
      : [],
    captionLook: latest?.edl.captionStyle ? project.captionPreset : null,
  };
}

export async function getTranscript(caller: Caller, projectId: string) {
  await ownProject(caller, projectId);
  const { edl } = await requireEdl(projectId);
  return {
    durationSec: Number(edl.format.durationSec.toFixed(2)),
    cues: edl.captions.map((cue) => ({
      id: cue.id,
      startSec: Number(cue.startSec.toFixed(2)),
      endSec: Number(cue.endSec.toFixed(2)),
      text: cue.words.map((word) => word.text).join(' '),
    })),
  };
}

/* ---------------------------------------------------------------- scenes */

export interface SceneMoment {
  startSec: number;
  endSec: number;
  look?: string;
}

/** Chooses which moments of the video become full-screen animated scenes. */
export async function setScenes(caller: Caller, projectId: string, moments: SceneMoment[]) {
  const project = await ownProject(caller, projectId);
  const latest = await requireEdl(projectId);
  const duration = latest.edl.format.durationSec;
  const sorted = [...moments].sort((a, b) => a.startSec - b.startSec);
  for (const [i, moment] of sorted.entries()) {
    if (!(moment.endSec > moment.startSec)) throw new McpUserError(`Scene ${i + 1}: endSec must be after startSec.`);
    if (moment.startSec < 0 || moment.endSec > duration + 0.05) throw new McpUserError(`Scene ${i + 1} is outside the video (0–${duration.toFixed(1)} s).`);
    if (moment.endSec - moment.startSec < 1.5 || moment.endSec - moment.startSec > 8) throw new McpUserError(`Scene ${i + 1} should last 1.5–8 seconds.`);
    if (i && moment.startSec < sorted[i - 1].endSec) throw new McpUserError(`Scenes ${i} and ${i + 1} overlap.`);
    if (moment.look && !(SCENE_LOOKS as readonly string[]).includes(moment.look)) throw new McpUserError(`Unknown look "${moment.look}".`);
  }
  const fallbackLook = (project.sceneLook ?? latest.edl.scenes[0]?.look ?? 'science') as SceneLook;
  const scenes = sorted.map((moment, i) =>
    AnimatedSceneSchema.parse({
      id: `claude-${i + 1}-${randomUUID().slice(0, 6)}`,
      outStartSec: moment.startSec,
      outEndSec: moment.endSec,
      kind: 'kinetic-text',
      look: moment.look ?? fallbackLook,
      enter: 'cut',
      exit: 'cut',
      headline: lineOf(wordsBetween(latest.edl, moment.startSec, moment.endSec)).slice(0, 80),
    }),
  );
  const edl = EdlSchema.parse({ ...latest.edl, scenes });
  const row = await db.edl.create({
    data: { projectId, version: latest.version + 1, document: stringifyJson(edl), origin: 'claude' },
  });
  // Scenes written for moments that no longer exist are dropped with them.
  await db.project.update({ where: { id: projectId }, data: { clientScenesJson: stringifyJson({}) } });
  return { version: row.version, scenes: scenes.map((scene) => ({ id: scene.id, startSec: scene.outStartSec, endSec: scene.outEndSec, look: scene.look })) };
}

async function sceneContext(caller: Caller, projectId: string, sceneId: string, look?: string) {
  const project = await ownProject(caller, projectId);
  const { edl } = await requireEdl(projectId);
  const scene = edl.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) throw new McpUserError(`No scene ${sceneId}. get_project lists the scenes; set_scenes chooses new ones.`);
  if (look && !(SCENE_LOOKS as readonly string[]).includes(look)) throw new McpUserError(`Unknown look "${look}".`);
  const chosen = (look ?? scene.look) as SceneLook;
  const words = wordsBetween(edl, scene.outStartSec, scene.outEndSec);
  const durationSec = Math.max(0.5, scene.outEndSec - scene.outStartSec);
  const request: CompositionRequest = {
    line: lineOf(words) || scene.headline || 'An animated scene.',
    words,
    headline: scene.headline,
    items: scene.items,
    kind: scene.kind,
    look: chosen,
    width: edl.format.width,
    height: edl.format.height,
    durationSec,
  };
  const frame = { width: edl.format.width, height: edl.format.height, durationSec, ground: styleGuideFor(chosen).ground, words };
  return { project, edl, scene, request, frame };
}

/** EasyCut's full brief for one scene: the rules, the look's reference and the timed words. */
export async function getSceneBrief(caller: Caller, projectId: string, sceneId: string, look?: string) {
  const { request } = await sceneContext(caller, projectId, sceneId, look);
  const zone = safeZone(request.width, request.height);
  return {
    sceneId,
    look: request.look,
    durationSec: Number(request.durationSec.toFixed(2)),
    safeArea: zone,
    instructions: systemPrompt(request.width, request.height, request.durationSec, request.look),
    brief: briefFor(request),
    next: 'Write the scene exactly as the instructions say (concept line, <style>, <div id="scene">, <script>), call preview_scene to see its frames, fix what is wrong, then submit_scene.',
  };
}

function compositionOf(text: string) {
  const parts = parseComposition(text);
  if (!parts) {
    throw new McpUserError('Could not find the scene in that text. Send the concept line, <style>…</style>, <div id="scene">…</div> and <script>…</script>.');
  }
  return parts;
}

/** Renders four stills of a scene and runs every check the pipeline runs. */
export async function previewScene(caller: Caller, projectId: string, sceneId: string, composition: string, look?: string) {
  const { frame } = await sceneContext(caller, projectId, sceneId, look);
  const parts = compositionOf(composition);
  const dir = join(tmpdir(), 'easycut-mcp', `${projectId}-${sceneId}-${randomUUID().slice(0, 8)}`);
  try {
    await writeProject(dir, buildCompositionHtml(parts, frame));
    const [lint, thrown] = await Promise.all([lintProject(dir).catch(() => []), validateProject(dir).catch(() => [])]);
    const faults = [...auditComposition(parts), ...thrown, ...lint];
    const times = reviewTimes(frame.durationSec);
    let image: string | null = null;
    let blank = false;
    let guided = false;
    if (!thrown.length) {
      const shot = await snapshotProject(dir, times, join(dir, 'review'));
      // The frames with the caption band and the safe area drawn on, so the
      // writer sees what the platform will cover; the plain sheet if that fails.
      const marked = await guideSheet(shot.frames, frameGuides(frame.width, frame.height), join(dir, 'guides.jpg'));
      image = (await readFile(marked ?? shot.sheet)).toString('base64');
      guided = marked !== null;
      blank = await allBlank(shot.frames);
    }
    if (blank) faults.unshift('Every frame is empty — nothing you drew is visible. Check opacity, positions and the script.');
    return {
      times,
      faults,
      fatal: faults.filter(isFatal),
      ok: !faults.some(isFatal),
      image,
      guided,
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Keeps a scene for the final render, once it passes the checks. */
export async function submitScene(caller: Caller, projectId: string, sceneId: string, composition: string, look?: string) {
  const { project, request } = await sceneContext(caller, projectId, sceneId, look);
  const parts = compositionOf(composition);
  const fatal = auditComposition(parts).filter(isFatal);
  if (fatal.length) throw new McpUserError(`Not saved — fix these first:\n- ${fatal.join('\n- ')}`);
  const stored = clientScenesOf(project.clientScenesJson);
  stored[sceneId] = { html: composition, look: request.look, concept: parts.concept ?? '', submittedAt: new Date().toISOString() };
  await db.project.update({ where: { id: projectId }, data: { clientScenesJson: stringifyJson(stored) } });
  return { saved: sceneId, scenesWritten: Object.keys(stored).length, next: 'Write the other scenes, or call render_video.' };
}

/* ---------------------------------------------------------------- finishing */

export async function updateEdit(caller: Caller, projectId: string, patch: Partial<EdlPatch>, cuts?: CutRange[]) {
  const project = await ownProject(caller, projectId);
  const latest = await requireEdl(projectId);
  let operations: EdlPatch['operations'];
  if (cuts?.length) {
    try {
      operations = cutOperations(latest.edl, cuts);
    } catch (error) {
      throw new McpUserError((error as Error).message);
    }
  }
  const outcome = await withServerAi(project.aiMode !== 'client', () =>
    patchProjectEdl(projectId, { render: false, ...patch, ...(operations ? { operations } : {}) } as EdlPatch, 'claude'),
  );
  if (outcome.status !== 200) throw new McpUserError(String(outcome.body.error ?? 'That change could not be applied.'));
  return { applied: true, rejected: outcome.body.rejected ?? [], next: 'Call render_video when the edit is how you want it.' };
}

export async function renderVideo(caller: Caller, projectId: string, quality: RenderQuality = 'hd') {
  const project = await ownProject(caller, projectId);
  if (quality === '4k' && !allowsQuality(entitlementsOf(project.planAtUpload).maxHeight, '4k')) {
    throw new McpUserError('4K export is not on this plan. Render in HD, or upgrade on the pricing page.');
  }
  const latest = await requireEdl(projectId);
  const pending = Object.keys(clientScenesOf(project.clientScenesJson)).filter((id) => latest.edl.scenes.some((scene) => scene.id === id));
  await db.project.update({ where: { id: projectId }, data: { status: 'processing' } });
  await queue().enqueue(
    'client-scenes',
    { projectId, quality },
    { priority: (await entitlementsFor(projectId)).priority },
  );
  return {
    status: 'rendering',
    claudeScenes: pending.length,
    next: `Call get_project until status is "ready"; "video" holds the link then. It waits for the next step itself. Scenes take about 30 s each to render, then the video renders.`,
  };
}

/* ---------------------------------------------------------------- downloads */

function fileNameFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
    return /\.(mp4|mov|m4v|webm|mkv)$/i.test(last) ? last : 'video.mp4';
  } catch {
    return 'video.mp4';
  }
}

/** Share links people actually paste, turned into ones that return the file. */
export function directDownloadUrl(raw: string): string {
  const url = new URL(raw);
  const drive = /\/file\/d\/([^/]+)/.exec(url.pathname);
  if (url.hostname === 'drive.google.com' && drive) return `https://drive.google.com/uc?export=download&id=${drive[1]}`;
  if (url.hostname.endsWith('dropbox.com')) {
    url.searchParams.set('dl', '1');
    return url.toString();
  }
  return url.toString();
}

/** True for an address no outside fetch should ever reach: loopback, private, link-local, metadata. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::' || lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
    const mapped = /::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    return mapped ? isPrivateAddress(mapped[1]) : false;
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new McpUserError('video_url is not a valid address.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new McpUserError('video_url must be an http(s) link.');
  const addresses = await lookup(url.hostname, { all: true }).catch(() => []);
  if (!addresses.length) throw new McpUserError(`Could not find ${url.hostname}.`);
  if (addresses.some((address) => isPrivateAddress(address.address))) throw new McpUserError('That address is not reachable from EasyCut.');
  return url;
}

async function downloadToStorage(raw: string, key: string): Promise<{ bytes: number; contentType: string }> {
  let url = await assertPublicUrl(directDownloadUrl(raw));
  let response: Response | null = null;
  for (let hop = 0; hop < 5; hop++) {
    response = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'EasyCut/1.0' } });
    const next = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && next) {
      url = await assertPublicUrl(new URL(next, url).toString());
      continue;
    }
    break;
  }
  if (!response || !response.ok || !response.body) throw new McpUserError(`Could not download the video (HTTP ${response?.status ?? '—'}). Is the link public?`);
  const contentType = response.headers.get('content-type')?.split(';')[0] ?? 'video/mp4';
  if (contentType.startsWith('text/html')) {
    throw new McpUserError('That link returns a web page, not a video file. Use a direct or public share link to the file.');
  }
  const limit = env.limits.maxUploadMb * 1024 * 1024;
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > limit) throw new McpUserError(`That video is larger than the ${env.limits.maxUploadMb} MB limit.`);

  const dir = join(tmpdir(), 'easycut-mcp');
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${randomUUID()}.bin`);
  let seen = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > limit) controller.error(new McpUserError(`That video is larger than the ${env.limits.maxUploadMb} MB limit.`));
      else controller.enqueue(chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(response.body.pipeThrough(counter) as never), createWriteStream(path));
    const bytes = (await stat(path)).size;
    await storage().putFile(key, path, contentType.startsWith('video/') ? contentType : 'video/mp4');
    return { bytes, contentType: contentType.startsWith('video/') ? contentType : 'video/mp4' };
  } finally {
    await rm(path, { force: true }).catch(() => undefined);
  }
}
