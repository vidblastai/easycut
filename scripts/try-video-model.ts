import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import '../src/lib/config/load-env';
import { env } from '../src/lib/config/env';

/**
 * Put one reference frame and one prompt through a reference-to-video model.
 *
 *   npx tsx scripts/try-video-model.ts <model path> [reference png]
 *
 * This exists to answer a question honestly rather than from memory: can a
 * video model take our own style and animate it better than the vector engine
 * does? Opinions about what diffusion models do to text and geometry are
 * cheap; a 5-second clip costs a few cents and settles it.
 *
 * Every model that takes reference images takes them the same way here — an
 * `images` array of URLs or data URIs — so one script covers the candidates.
 */

const API_BASE = 'https://api.wavespeed.ai/api/v3';
const OUT = 'out/model-test';

const PROMPT =
  process.env.MOTION_PROMPT ??
  'Dark neon motion graphics, exactly the style and palette of the reference image. ' +
    'A glowing outlined figure stands alone between two faint dashed silhouettes on a near-black ground. ' +
    'The glow pulses, the dashed outlines fade away one at a time, the camera pushes in slowly. ' +
    'Flat vector neon line art, deep navy and violet, no photorealism, no new text, no watermark.';

async function main() {
  await mkdir(OUT, { recursive: true });
  const model = process.argv[2];
  if (!model) throw new Error('Pass a model path, e.g. vidu/reference-to-video-q2');
  const refPath = process.argv[3] ?? join(OUT, 'ref.png');

  const key = env.llm.wavespeedKey;
  if (!key) throw new Error('WAVESPEED_API_KEY is not set');

  // Base64 rather than a URL: the reference is a frame we just rendered, and
  // hosting it publicly to show it to a model would be a whole deployment.
  const png = await readFile(refPath);
  const dataUri = `data:image/png;base64,${png.toString('base64')}`;

  /*
   * The two shapes of this API.
   *
   * A reference-to-video model takes an `images` array — several pictures that
   * define a style or a character. An image-to-video model takes one `image`
   * and animates that exact frame. Which one a model wants is in its schema,
   * and the only reliable tell from the path is the segment itself.
   */
  const wantsMany = model.includes('reference-to-video');
  const input: Record<string, unknown> = {
    prompt: PROMPT,
    ...(wantsMany ? { images: [dataUri] } : { image: dataUri }),
    duration: 5,
    resolution: '720p',
  };
  // Not every model takes one, and an unknown key is a 400 on most of them.
  if (!model.includes('ltx') && !model.includes('pixverse')) input.aspect_ratio = '9:16';

  const started = Date.now();
  const submit = await fetch(`${API_BASE}/${model}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify(input),
  });
  const submitted = (await submit.json().catch(() => ({}))) as { data?: { id?: string }; message?: string };
  if (!submit.ok || !submitted.data?.id) {
    throw new Error(`refused: ${submitted.message ?? `${submit.status} ${submit.statusText}`}`);
  }

  const id = submitted.data.id;
  process.stdout.write(`submitted ${id} `);

  for (;;) {
    await new Promise((r) => setTimeout(r, 4000));
    const poll = await fetch(`${API_BASE}/predictions/${id}/result`, {
      headers: { authorization: `Bearer ${key}` },
    });
    const body = (await poll.json()) as {
      data?: { status?: string; outputs?: string[]; error?: string; timings?: { inference?: number } };
    };
    const status = body.data?.status;
    process.stdout.write('.');

    if (status === 'completed') {
      const url = body.data?.outputs?.[0];
      if (!url) throw new Error('completed with no output');
      const file = join(OUT, `${model.replace(/\//g, '_')}.mp4`);
      await writeFile(file, Buffer.from(await (await fetch(url)).arrayBuffer()));
      console.log(
        `\n  ${file}  (${((Date.now() - started) / 1000).toFixed(0)}s wall, ` +
          `${body.data?.timings?.inference ?? '?'}ms inference)`,
      );
      return;
    }
    if (status === 'failed') throw new Error(body.data?.error ?? 'failed');
    if (Date.now() - started > 8 * 60_000) throw new Error('timed out');
  }
}

void main();
