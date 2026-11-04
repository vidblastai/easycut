import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { LOOK_LIST } from '@/lib/scenes/looks';
import { guideAsPrompt, styleGuideFor } from '@/lib/scenes/style-guides';
import { referenceFor } from '@/lib/director/reference-scene';
import { SCENE_LOOKS, type SceneLook } from '@/lib/edl/types';
import {
  createProject,
  getProject,
  getSceneBrief,
  getTranscript,
  listProjects,
  listStyles,
  McpUserError,
  previewScene,
  renderVideo,
  setScenes,
  startEdit,
  submitScene,
  updateEdit,
  type Caller,
} from './service';

/**
 * The MCP server: JSON-RPC 2.0 over Streamable HTTP, stateless, answering
 * every POST with a JSON body (the spec allows a server never to open an SSE
 * stream, and nothing here needs one — progress is read by polling).
 *
 * Written against the protocol rather than an SDK so it runs inside a Next
 * route handler as-is; the surface is small — initialize, the tool, prompt
 * and resource lists, ping — and every method is below.
 */

export const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;
const SERVER_INFO = { name: 'easycut', title: 'EasyCut', version: '1.0.0' };

export const INSTRUCTIONS = `EasyCut turns raw talking-head footage into a finished short video: it transcribes, removes silences and fillers, adds captions, B-roll and sound, reframes, and renders. Through this server YOU are the creative AI: you choose which moments become full-screen animated scenes and write those scenes yourself, following EasyCut's scene rules, while EasyCut does every mechanical step.

The usual flow:
1. list_styles (once) to see edit styles, scene looks and caption looks.
2. create_project with a public video_url (pass spell_right with any product, brand or person names in the video) (or upload, then start_edit). Call get_project until status is "ready" — it waits for the next step itself, so there is no need to pause between calls.
3. get_transcript, then set_scenes: pick 1–4 moments (2.5–6 s each) where an animation explains or sells what is said better than the face does.
4. For each scene: get_scene_brief (it holds the full rules, the look's reference scene and the timed words), write the scene, preview_scene and LOOK at the frames, fix, then submit_scene.
5. update_edit for captions or style changes if wanted, then render_video and poll get_project until "video" has a link.
Show the person the link to the editor too — they can fine-tune there.`;

/* ------------------------------------------------------------------ tools */

const looks = [...SCENE_LOOKS] as [string, ...string[]];

const TOOLS = {
  list_styles: {
    description: 'The edit styles, animated-scene looks and caption looks available, with what each is best for.',
    input: z.object({}),
    annotations: { readOnlyHint: true, title: 'List styles' },
  },
  list_projects: {
    description: "The person's most recent EasyCut projects (newest first), with status and editor links.",
    input: z.object({}),
    annotations: { readOnlyHint: true, title: 'List projects' },
  },
  create_project: {
    description:
      'Create a video project. Pass video_url (a public link to the video file — Google Drive and Dropbox share links work) to start the edit straight away; without it you get upload instructions and must call start_edit after uploading. The project is edited without EasyCut AI: you write the scenes.',
    input: z.object({
      video_url: z.string().url().optional().describe('Public link to the source video file.'),
      title: z.string().max(80).optional(),
      style: z.string().optional().describe('Edit style id from list_styles. Default "clean".'),
      scene_look: z.enum(looks).optional().describe('Default look for animated scenes.'),
      caption_look: z.string().optional().describe('Caption look id from list_styles.'),
      footage: z.enum(['raw', 'roughcut']).optional().describe('"raw" (default): retakes and silences are cut. "roughcut": already edited, keep it tight.'),
      note: z.string().max(500).optional().describe('Anything EasyCut should know about the video.'),
      spell_right: z.array(z.string().max(60)).max(30).optional().describe('Names and words the captions must spell exactly so — a product, brand or person, e.g. ["Claude Code", "EasyCut"]. Speech recognition gets these wrong most often.'),
    }),
    annotations: { title: 'Create project' },
  },
  start_edit: {
    description: 'Start editing a project whose footage was uploaded separately.',
    input: z.object({ project_id: z.string() }),
    annotations: { title: 'Start edit' },
  },
  get_project: {
    description:
      'Status, progress (including its place in line), the scene slots (with the line spoken over each and whether you have written it), and the finished video link once rendered. While the video is processing this waits up to 20 s for the next step before answering, so call it again straight away — no need to pause between calls.',
    input: z.object({ project_id: z.string() }),
    annotations: { readOnlyHint: true, title: 'Get project' },
  },
  get_transcript: {
    description: 'The finished cut\'s captions with times (seconds into the edited video) — read this before choosing scenes.',
    input: z.object({ project_id: z.string() }),
    annotations: { readOnlyHint: true, title: 'Get transcript' },
  },
  set_scenes: {
    description:
      'Choose which moments of the edited video become full-screen animated scenes, replacing the current choice. 1–4 is typical; each 1.5–8 s (2.5–6 s is best), not overlapping, on moments where a picture explains or sells the line. The text-led looks signal and slate are for long-form: a cutaway carries a whole thought (a figure, a list, a comparison) and may run up to 20 s — in a long-form video put one on most figures, lists and key claims, as often as every 20–40 seconds. Times are from get_transcript.',
    input: z.object({
      project_id: z.string(),
      scenes: z
        .array(z.object({ start_sec: z.number().nonnegative(), end_sec: z.number().positive(), look: z.enum(looks).optional() }))
        .min(0)
        .max(8),
    }),
    annotations: { title: 'Set scenes' },
  },
  get_scene_brief: {
    description:
      "EasyCut's complete instructions for writing one scene: the rules (safe area, layouts, motion, traps), a finished reference scene in the chosen look, the style guide, and the words with their times. Read it fully before writing.",
    input: z.object({ project_id: z.string(), scene_id: z.string(), look: z.enum(looks).optional() }),
    annotations: { readOnlyHint: true, title: 'Get scene brief' },
  },
  preview_scene: {
    description:
      'Render four frames of a scene you wrote (at 20/45/70/93 % of its length) and run every check: the audit, a real page load for script errors, the lint and the blank test. Returns the frames as an image, with the safe area and the caption band drawn on — look at them, then fix and preview again until it is right.',
    input: z.object({
      project_id: z.string(),
      scene_id: z.string(),
      composition: z.string().describe('The concept comment, <style>, <div id="scene"> and <script> blocks.'),
      look: z.enum(looks).optional(),
    }),
    annotations: { readOnlyHint: true, title: 'Preview scene' },
  },
  submit_scene: {
    description: 'Save a finished scene for the final render. It is rendered to a clip when render_video runs.',
    input: z.object({ project_id: z.string(), scene_id: z.string(), composition: z.string(), look: z.enum(looks).optional() }),
    annotations: { title: 'Submit scene' },
  },
  update_edit: {
    description:
      'Change the edit without re-running it: cut parts out (a retake, a false start, the intro), caption look, caption text fixes, edit style, or switching layers (captions, broll, scenes, music, sfx…) on or off. Saved as a new version; call render_video afterwards.',
    input: z.object({
      project_id: z.string(),
      caption_look: z.string().optional(),
      style: z.string().optional(),
      caption_edits: z.array(z.object({ cue_id: z.string(), text: z.string().max(200) })).optional(),
      cuts: z
        .array(z.object({ start_sec: z.number().nonnegative(), end_sec: z.number().positive() }))
        .max(20)
        .optional()
        .describe('Stretches to remove, in the edited video\'s current times (as get_transcript gives them). Cut from the first word to just before the word you keep, e.g. a retake.'),
      layers: z
        .object({
          captions: z.boolean(),
          broll: z.boolean(),
          graphics: z.boolean(),
          icons: z.boolean(),
          scenes: z.boolean(),
          music: z.boolean(),
          sfx: z.boolean(),
          punchIns: z.boolean(),
          transitions: z.boolean(),
        })
        .partial()
        .optional(),
      shuffle_music: z.boolean().optional(),
    }),
    annotations: { title: 'Update edit' },
  },
  render_video: {
    description: 'Render the finished video, including every scene you submitted. Poll get_project for the link.',
    input: z.object({ project_id: z.string(), quality: z.enum(['hd', '4k']).optional() }),
    annotations: { title: 'Render video' },
  },
} as const;

type ToolName = keyof typeof TOOLS;

function toolList() {
  return Object.entries(TOOLS).map(([name, tool]) => ({
    name,
    title: tool.annotations.title,
    description: tool.description,
    inputSchema: jsonSchema(tool.input),
    annotations: tool.annotations,
  }));
}

/** A JSON Schema for a zod object, enough for MCP clients (types, enums, descriptions, required). */
export function jsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const describe = (node: z.ZodTypeAny, out: Record<string, unknown>) => (node.description ? { ...out, description: node.description } : out);
  const unwrap = (node: z.ZodTypeAny): z.ZodTypeAny =>
    node instanceof z.ZodOptional || node instanceof z.ZodDefault || node instanceof z.ZodNullable ? unwrap(node._def.innerType) : node;
  const convert = (raw: z.ZodTypeAny): Record<string, unknown> => {
    const node = unwrap(raw);
    if (node instanceof z.ZodObject) {
      const shape = node.shape as Record<string, z.ZodTypeAny>;
      const required = Object.entries(shape)
        .filter(([, value]) => !(value instanceof z.ZodOptional) && !(value instanceof z.ZodDefault))
        .map(([key]) => key);
      return describe(raw, {
        type: 'object',
        properties: Object.fromEntries(Object.entries(shape).map(([key, value]) => [key, convert(value)])),
        ...(required.length ? { required } : {}),
        additionalProperties: false,
      });
    }
    if (node instanceof z.ZodArray) return describe(raw, { type: 'array', items: convert(node.element) });
    if (node instanceof z.ZodEnum) return describe(raw, { type: 'string', enum: node.options });
    if (node instanceof z.ZodNumber) return describe(raw, { type: 'number' });
    if (node instanceof z.ZodBoolean) return describe(raw, { type: 'boolean' });
    return describe(raw, { type: 'string' });
  };
  return convert(schema);
}

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

function text(value: unknown): Content {
  return { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) };
}

async function callTool(name: string, rawArgs: unknown, caller: Caller, bearer: string | null): Promise<{ content: Content[]; isError?: boolean; structuredContent?: unknown }> {
  const tool = TOOLS[name as ToolName];
  if (!tool) throw new RpcError(-32602, `Unknown tool: ${name}`);
  const parsed = tool.input.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ');
    return { content: [text(`Invalid arguments — ${issues}`)], isError: true };
  }
  const args = parsed.data as Record<string, never>;
  try {
    switch (name as ToolName) {
      case 'list_styles':
        return result(listStyles());
      case 'list_projects':
        return result({ projects: await listProjects(caller) });
      case 'create_project':
        return result(
          await createProject(
            caller,
            {
              videoUrl: args.video_url,
              title: args.title,
              styleId: args.style,
              sceneLook: args.scene_look,
              captionPreset: args.caption_look,
              inputMode: args.footage,
              note: args.note,
              spellRight: args.spell_right as unknown as string[] | undefined,
            },
            bearer,
          ),
        );
      case 'start_edit':
        return result(await startEdit(caller, args.project_id));
      case 'get_project':
        return result(await getProject(caller, args.project_id, 20));
      case 'get_transcript':
        return result(await getTranscript(caller, args.project_id));
      case 'set_scenes': {
        const scenes = (args.scenes as unknown as Array<{ start_sec: number; end_sec: number; look?: string }>).map((scene) => ({
          startSec: scene.start_sec,
          endSec: scene.end_sec,
          look: scene.look,
        }));
        return result(await setScenes(caller, args.project_id, scenes));
      }
      case 'get_scene_brief': {
        const brief = await getSceneBrief(caller, args.project_id, args.scene_id, args.look);
        return {
          content: [
            text(`Scene ${brief.sceneId} — ${brief.durationSec} s, look "${brief.look}". ${brief.next}`),
            text(`# EasyCut scene rules\n\n${brief.instructions}`),
            text(`# This scene\n\n${brief.brief}`),
          ],
        };
      }
      case 'preview_scene': {
        const preview = await previewScene(caller, args.project_id, args.scene_id, args.composition, args.look);
        const summary = preview.faults.length
          ? `${preview.ok ? 'Renders, with things to improve' : 'NOT ready'}:\n- ${preview.faults.join('\n- ')}`
          : 'Renders cleanly. Check the frames: on topic, inside the safe area, readable on a phone, never stalled, ending on the payoff.';
        const legend = !preview.guided
          ? ''
          : preview.textLook
            ? ' Drawn over them: the cyan outline is the safe area. The captions are switched off while this scene plays, so your words are the only words on screen.'
            : ' Drawn over them: the cyan outline is the safe area, the red band is where the captions sit, the dark corner is the like/share buttons. Nothing that matters may sit in the red band when its word is said.';
        const content: Content[] = [text(`${summary}\nFrames at ${preview.times.map((t) => `${t}s`).join(', ')}.${legend}`)];
        if (preview.image) content.push({ type: 'image', data: preview.image, mimeType: 'image/jpeg' });
        return { content };
      }
      case 'submit_scene':
        return result(await submitScene(caller, args.project_id, args.scene_id, args.composition, args.look));
      case 'update_edit':
        return result(
          await updateEdit(caller, args.project_id, {
            captionPreset: args.caption_look,
            styleId: args.style,
            captionEdits: (args.caption_edits as unknown as Array<{ cue_id: string; text: string }> | undefined)?.map((edit) => ({ cueId: edit.cue_id, text: edit.text })),
            layers: args.layers,
            music: args.shuffle_music ? { shuffle: true } : undefined,
          }, (args.cuts as unknown as Array<{ start_sec: number; end_sec: number }> | undefined)?.map((cut) => ({ startSec: cut.start_sec, endSec: cut.end_sec }))),
        );
      case 'render_video':
        return result(await renderVideo(caller, args.project_id, args.quality));
    }
  } catch (error) {
    if (error instanceof McpUserError) return { content: [text(error.message)], isError: true };
    throw error;
  }
  throw new RpcError(-32602, `Unknown tool: ${name}`);
}

function result(value: unknown) {
  return { content: [text(value)], structuredContent: value };
}

/* ------------------------------------------------------- prompts, resources */

const PROMPTS = [
  {
    name: 'edit_video',
    title: 'Edit a video with EasyCut',
    description: 'Walks Claude through turning a raw video into a finished short with animated scenes.',
    arguments: [{ name: 'video_url', description: 'Public link to the video (optional).', required: false }],
  },
  {
    name: 'write_scene',
    title: 'Write an EasyCut scene',
    description: 'EasyCut\'s full scene-writing rules for a line, in a look, for testing a scene on its own.',
    arguments: [
      { name: 'line', description: 'What is said over the scene.', required: true },
      { name: 'look', description: `One of: ${SCENE_LOOKS.join(', ')}.`, required: false },
      { name: 'seconds', description: 'Length, 2–8 seconds.', required: false },
    ],
  },
];

async function getPrompt(name: string, args: Record<string, string>) {
  if (name === 'edit_video') {
    return {
      description: 'Edit a video with EasyCut',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `${INSTRUCTIONS}\n\n${args.video_url ? `The video: ${args.video_url}` : 'Ask me for the video (a public link), or let me pick one of my projects.'}\nGo step by step and show me each scene's preview frames before rendering.`,
          },
        },
      ],
    };
  }
  if (name === 'write_scene') {
    const { systemPrompt, briefFor } = await import('@/lib/director/hyperframe');
    const look = (SCENE_LOOKS as readonly string[]).includes(args.look ?? '') ? (args.look as SceneLook) : 'science';
    const seconds = Math.min(8, Math.max(2, Number(args.seconds) || 5));
    const line = args.line || 'Your brain has eighty six billion neurons.';
    const words = line.split(/\s+/).map((word, i, all) => ({ text: word.replace(/[^\p{L}\p{N}'-]/gu, ''), atSec: (i / all.length) * seconds * 0.9 }));
    const request = { line, words, headline: '', items: [], kind: 'kinetic-text', look, width: 1080, height: 1920, durationSec: seconds };
    return {
      description: 'Write an EasyCut scene',
      messages: [
        { role: 'user', content: { type: 'text', text: `${systemPrompt(1080, 1920, seconds, look)}\n\n---\n\n${briefFor(request)}` } },
      ],
    };
  }
  throw new RpcError(-32602, `Unknown prompt: ${name}`);
}

function resourceList() {
  return [
    { uri: 'easycut://guide/scene-design', name: 'Scene design guide', mimeType: 'text/markdown', description: 'How EasyCut scenes are designed, checked and shipped.' },
    ...LOOK_LIST.map((look) => ({
      uri: `easycut://looks/${look.id}`,
      name: `Look: ${look.name}`,
      mimeType: 'text/markdown',
      description: look.bestFor,
    })),
  ];
}

function readResource(uri: string) {
  if (uri === 'easycut://guide/scene-design') {
    let guide = INSTRUCTIONS;
    try {
      guide = readFileSync(join(process.cwd(), '.claude/skills/scene-design/SKILL.md'), 'utf8').replace(/^---[\s\S]*?---\n/, '');
    } catch {
      // A build that left the guide out still answers with the workflow.
    }
    return [{ uri, mimeType: 'text/markdown', text: guide }];
  }
  const look = /^easycut:\/\/looks\/([\w-]+)$/.exec(uri)?.[1];
  if (look && (SCENE_LOOKS as readonly string[]).includes(look)) {
    const meta = LOOK_LIST.find((entry) => entry.id === look);
    const reference = referenceFor(look as SceneLook);
    const body = `# ${meta?.name ?? look}\n\n${meta?.bestFor ?? ''}\n\n## Style guide\n\n${guideAsPrompt(styleGuideFor(look as SceneLook), ['palette', 'rendering', 'lighting', 'ground_rule', 'motion', 'camera'])}\n\n## Reference scene${reference.look === look ? '' : ` (from the ${reference.look} look)`}\n\nWritten for: "${reference.line}"\n\n\`\`\`html\n${reference.scene}\n\`\`\`\n`;
    return [{ uri, mimeType: 'text/markdown', text: body }];
  }
  throw new RpcError(-32002, `Resource not found: ${uri}`);
}

/* ------------------------------------------------------------- dispatcher */

export class RpcError extends Error {
  constructor(
    public code: number,
    message: string,
  ) {
    super(message);
  }
}

interface RpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

/** One JSON-RPC message in, its response out — or null for a notification. */
export async function handleMessage(message: RpcMessage, caller: Caller, bearer: string | null): Promise<Record<string, unknown> | null> {
  const isRequest = message.id !== undefined && message.id !== null;
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return isRequest ? { jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32600, message: 'Invalid request' } } : null;
  }
  if (!isRequest) return null; // notifications/initialized, cancellations: nothing to say.

  const params = message.params ?? {};
  try {
    let value: unknown;
    switch (message.method) {
      case 'initialize': {
        const wanted = String(params.protocolVersion ?? '');
        value = {
          protocolVersion: (SUPPORTED_VERSIONS as readonly string[]).includes(wanted) ? wanted : SUPPORTED_VERSIONS[0],
          capabilities: { tools: { listChanged: false }, prompts: { listChanged: false }, resources: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        };
        break;
      }
      case 'ping':
        value = {};
        break;
      case 'tools/list':
        value = { tools: toolList() };
        break;
      case 'tools/call':
        value = await callTool(String(params.name ?? ''), params.arguments, caller, bearer);
        break;
      case 'prompts/list':
        value = { prompts: PROMPTS };
        break;
      case 'prompts/get':
        value = await getPrompt(String(params.name ?? ''), (params.arguments ?? {}) as Record<string, string>);
        break;
      case 'resources/list':
        value = { resources: resourceList() };
        break;
      case 'resources/templates/list':
        value = { resourceTemplates: [] };
        break;
      case 'resources/read':
        value = { contents: readResource(String(params.uri ?? '')) };
        break;
      default:
        throw new RpcError(-32601, `Method not found: ${message.method}`);
    }
    return { jsonrpc: '2.0', id: message.id, result: value };
  } catch (error) {
    if (error instanceof RpcError) return { jsonrpc: '2.0', id: message.id, error: { code: error.code, message: error.message } };
    console.error('[mcp]', error);
    return {
      jsonrpc: '2.0',
      id: message.id,
      result: { content: [text('Something went wrong on EasyCut\'s side. Try again in a moment.')], isError: true },
    };
  }
}
