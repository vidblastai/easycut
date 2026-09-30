import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import '../src/lib/config/load-env';
import { EdlSchema, iconRowPlacement } from '../src/lib/edl/types';
import { env } from '../src/lib/config/env';
import { startAssetServer } from '../src/lib/render/asset-server';
import { SAMPLE_EDL } from '../remotion/sample-edl';
import { buildEdl } from '../src/lib/edl/builder';
import { DirectorPlanSchema } from '../src/lib/director/schema';
import { getStyle } from '../src/lib/styles/presets';
import { layoutSegments } from '../src/lib/timeline/time-mapper';
import { resolveCardIcons } from '../src/lib/assets/icon-cards';
import { deriveSentences, type TranscriptWord } from '../src/lib/transcribe/types';
import { muxVideoAudio, renderAudio } from '../src/lib/media/audio-mix';
import { sfxUrl, type SfxName } from '../src/lib/assets/sfx';

/**
 * A long-form minute with every layer on, built by the real builder.
 *
 *   npx tsx scripts/long-clip.ts [style] [seconds]
 *
 * The strips each prove one layer in isolation. This is the one that answers
 * the question they cannot: whether the layers a widescreen edit gets are
 * right TOGETHER — whether the icon row clears the captions at this aspect,
 * whether an insert reads at 16:9, whether the style's restraint survives
 * contact with its own transitions. It goes through `buildEdl`, so what comes
 * out is what the pipeline would have made.
 */

const OUT = 'out/long-clip';

/** Said aloud, so the captions and the cues have something real to sit on. */
const LINE =
  'The first thing nobody tells you about pricing is that it is a positioning decision. ' +
  'You can move the number later but the banana you picked on day one is the anchor. ' +
  'Every deadline you set after that is measured against it, and the phone call you dread ' +
  'is the one where somebody asks you to justify it.';

async function main() {
  const styleId = process.argv[2] ?? 'documentary';
  const seconds = Number(process.argv[3] ?? 42);
  await mkdir(OUT, { recursive: true });

  const words: TranscriptWord[] = LINE.split(/\s+/).map((text, i, all) => {
    const per = seconds / all.length;
    return {
      text, startSec: i * per, endSec: i * per + per * 0.86,
      confidence: 1, speaker: 0, isFiller: false, endsSentence: /[.!?]$/.test(text),
    };
  });
  const transcript = {
    provider: 'fixture', language: 'en', durationSec: seconds,
    text: LINE, words, sentences: deriveSentences(words),
  };

  const assets = await startAssetServer(process.cwd());
  const speaker = assets.urlFor(resolve('out/long.mp4')) ?? '';
  const insert = assets.urlFor(resolve('out/broll.mp4')) ?? '';
  if (!speaker || !insert) throw new Error('Cannot serve out/long.mp4 and out/broll.mp4');

  const style = getStyle(styleId);
  const at = (f: number) => seconds * f;

  // Three inserts and two icon words — roughly what this length earns.
  const plan = DirectorPlanSchema.parse({
    broll: [
      { atSec: at(0.16), durationSec: 4.5, query: 'coffee on a desk', intent: '', kind: 'stock-video' },
      { atSec: at(0.46), durationSec: 4.5, query: 'city at night', intent: '', kind: 'stock-video' },
      { atSec: at(0.76), durationSec: 4.5, query: 'open notebook', intent: '', kind: 'stock-video' },
    ],
    icons: [
      { atSec: at(0.36), word: 'banana', query: 'banana' },
      { atSec: at(0.66), word: 'deadline', query: 'calendar' },
    ],
    graphics: [{ atSec: at(0.30), durationSec: 3, type: 'stat', text: '40%', subtext: 'of the decision' }],
  });

  const edl = buildEdl({
    projectId: `long-${styleId}`, style, mode: 'long', aspect: '16:9', fps: 30,
    transcript, plan,
    segments: layoutSegments([{ sourceStartSec: 0, sourceEndSec: seconds }]),
    source: {
      assetId: 'src', url: speaker, width: 1920, height: 1080,
      fps: 30, durationSec: 600, hasAudio: true,
    },
    reframe: null, degraded: [],
  });

  // The builder leaves assets to the asset stage, so fill them in here.
  process.stdout.write('resolving icons… ');
  for (const cue of edl.icons) {
    const found = await resolveCardIcons(cue.cards.map((c) => c.query), style.accent);
    cue.cards.forEach((card, k) => {
      card.markup = found[k]?.markup ?? null;
      card.iconId = found[k]?.id ?? '';
    });
    cue.y = iconRowPlacement(cue.cards.length, edl.format.width, edl.format.height).y;
  }
  console.log(`${edl.icons.length} rows`);
  for (const clip of edl.broll) clip.url = insert;

  console.log(
    `${styleId}: ${edl.broll.length} inserts (${edl.broll[0]?.enter}/${edl.broll[0]?.exit}, ` +
    `overlay ${edl.broll[0]?.overlay}), ${edl.icons.length} icon rows, ` +
    `${edl.graphics.length} graphics, ${edl.punchIns.length} punch-ins, ${edl.sfx.length} sounds`,
  );
  for (const cue of edl.sfx) console.log(`   ${cue.atSec.toFixed(2)}s  ${cue.sound.padEnd(7)} ${cue.reason}`);

  const inputProps = { edl: EdlSchema.parse({ ...SAMPLE_EDL, ...edl }), previewAudio: false };

  const { bundle } = await import('@remotion/bundler');
  const { renderMedia, selectComposition } = await import('@remotion/renderer');
  process.stdout.write('bundling… ');
  const serveUrl = await bundle({
    entryPoint: join(process.cwd(), 'remotion', 'index.ts'),
    publicDir: join(process.cwd(), 'public'),
  });
  console.log('ok');

  const composition = await selectComposition({
    serveUrl, id: 'EasyCutVideo', inputProps,
    browserExecutable: env.render.browserExecutable,
    chromiumOptions: { ignoreCertificateErrors: env.render.ignoreCertificateErrors },
  });

  const silent = join(OUT, `${styleId}-silent.mp4`);
  await renderMedia({
    composition, serveUrl, inputProps, codec: 'h264', outputLocation: silent, audioCodec: null,
    browserExecutable: env.render.browserExecutable,
    chromiumOptions: { gl: env.render.gl, ignoreCertificateErrors: env.render.ignoreCertificateErrors },
    onProgress: ({ progress }) => process.stdout.write(`\r  ${Math.round(progress * 100)}%   `),
  });

  process.stdout.write('\nmixing audio… ');
  const audio = await renderAudio(inputProps.edl, {
    sourceAudioPath: resolve('out/long.mp4'),
    sfxPaths: Object.fromEntries(
      edl.sfx.map((c) => [c.sound, join('public', sfxUrl(c.sound as SfxName))]),
    ),
    outputPath: join(OUT, `${styleId}.m4a`),
  });
  console.log('ok');

  const output = join(OUT, `${styleId}.mp4`);
  await muxVideoAudio(silent, audio, output);
  await assets.close();
  console.log(`\n${output}`);
}

void main();
