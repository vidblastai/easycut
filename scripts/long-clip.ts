import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import '../src/lib/config/load-env';
import { EdlSchema } from '../src/lib/edl/types';
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
import { probe } from '../src/lib/media/ffmpeg';

/**
 * A long-form minute with every layer on, built by the real builder.
 *
 *   npx tsx scripts/long-clip.ts [style] [seconds] [--short]
 *
 * The strips each prove one layer in isolation. This is the one that answers
 * the question they cannot: whether the layers a widescreen edit gets are
 * right TOGETHER — whether the icon row clears the captions at this aspect,
 * whether an insert reads at 16:9, whether the style's restraint survives
 * contact with its own transitions. It goes through `buildEdl`, so what comes
 * out is what the pipeline would have made.
 */

const OUT = 'out/long-clip';

/** Long enough to cover a row's own hold, so nothing is placed under its exit. */
const ICON_HOLD_GUESS = 3;

/**
 * Said aloud, so the captions and the cues have something real to sit on.
 *
 * The three nouns in the LAST sentence are deliberately in one breath. Two
 * things are being dodged at once: a row of cards only forms from words said
 * within `ICON_ROW_WINDOW_SEC` of each other, so nouns spread seven seconds
 * apart make three separate single-card rows and prove nothing about the
 * column — and the builder puts its animated scene near the top of the video,
 * where it owns the frame and every card underneath it is correctly dropped.
 */
const LINE =
  'The first thing nobody tells you about pricing is that it is a positioning decision. ' +
  'You can move the number later, but the one you picked on day one is the anchor. ' +
  'Every rocket you launch after it is measured against that very first one, which is ' +
  'why the opening matters. So before you decide, put a banana, a calendar and a ' +
  'telephone on the table, and ask which of them is worth the most.';

async function main() {
  const args = process.argv.slice(2);
  /*
   * `--short` renders the vertical funnel instead.
   *
   * Same script, because the whole question it answers is whether the layers
   * are right TOGETHER, and the answer differs by shape: three icons go across
   * the middle in both, a lone one goes to the margin only where there is a
   * margin, and the numbers move off the subject only in a wide frame. Two
   * scripts would drift, and the one nobody ran would be the one that broke.
   */
  const short = args.includes('--short');
  const positional = args.filter((a) => !a.startsWith('--'));
  const styleId = positional[0] ?? (short ? 'punchy' : 'documentary');
  const seconds = Number(positional[1] ?? 42);
  /*
   * Both shapes read the ten-minute fixture, and the vertical one is not a
   * mistake: a 16:9 source in a 9:16 frame is exactly what the real pipeline
   * gets and reframes.
   *
   * `out/fixture.mp4` is twenty seconds, so asking it for a forty-second edit
   * produced twenty seconds of speech, and `-shortest` in the mux quietly cut
   * the picture to match — a render that looked fine and was missing half its
   * layers. A short source is a silent truncation, so this one refuses.
   */
  const shape = short
    ? { mode: 'short' as const, aspect: '9:16' as const, source: 'out/long.mp4' }
    : { mode: 'long' as const, aspect: '16:9' as const, source: 'out/long.mp4' };
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

  const sourceSec = (await probe(shape.source)).durationSec;
  if (sourceSec < seconds) {
    throw new Error(
      `${shape.source} is ${sourceSec.toFixed(1)}s but this asks for ${seconds}s. ` +
      'The mux would cut the picture to the length of the audio and the render would ' +
      'silently lose whatever came after.',
    );
  }

  const assets = await startAssetServer(process.cwd());
  const speaker = assets.urlFor(resolve(shape.source)) ?? '';
  const insert = assets.urlFor(resolve('out/broll.mp4')) ?? '';
  if (!speaker || !insert) throw new Error(`Cannot serve ${shape.source} and out/broll.mp4`);

  const style = getStyle(styleId);

  /*
   * The icon words first, off the transcript — everything else is placed
   * around them.
   *
   * That order matters, and getting it wrong is most of what makes a fixture
   * like this lie. An icon card is dropped when its word is spoken while a
   * B-roll insert, an animated scene or a graphic owns the frame, which is
   * correct — it would be a second focal point over the first. So a demo that
   * scatters inserts and graphics at round fractions of the runtime lands them
   * on the nouns roughly half the time and renders an empty margin, which is
   * indistinguishable from the column being broken until you go and look.
   *
   * `snapToWord` only searches within two seconds of the timestamp it is
   * given, so these are read off the words rather than guessed at.
   */
  /*
   * A group of three AND a lone noun, because they are laid out differently.
   *
   * Three is a group and goes across the middle from the floor; one is not,
   * and goes out to the side. A demo with only one of those shapes in it
   * proves half the layout.
   */
  const NOUNS = ['rocket', 'banana', 'calendar', 'telephone'];
  const nounAt = NOUNS.map(
    (word) => words.find((w) => w.text.replace(/[^a-z]/gi, '').toLowerCase() === word)?.startSec ?? 0,
  );
  /*
   * One protected window per WORD, not one spanning all of them.
   *
   * Spanning them reserved everything between the first noun and the last,
   * which here is most of the video — so every insert and graphic got walked
   * off the end of the timeline and the render came back with none of them.
   */
  const keepClear: Array<[number, number]> = nounAt.map((t) => [t - 1, t + ICON_HOLD_GUESS]);

  /** Somewhere this long that does not sit on any of the icon words. */
  const clearOf = (wanted: number, length: number): number => {
    const collides = (t: number) => keepClear.some(([a, b]) => t < b && t + length > a);
    let t = wanted;
    // Walked in half-seconds rather than solved: all that matters is that the
    // demo is deterministic and the cues do not land on each other.
    while (collides(t) && t + length < seconds - 1) t += 0.5;
    return t;
  };

  const plan = DirectorPlanSchema.parse({
    broll: [
      { atSec: clearOf(seconds * 0.06, 4), durationSec: 4, query: 'coffee on a desk', intent: '', kind: 'stock-video' },
      { atSec: clearOf(seconds * 0.62, 4), durationSec: 4, query: 'city at night', intent: '', kind: 'stock-video' },
      { atSec: clearOf(seconds * 0.84, 4), durationSec: 4, query: 'open notebook', intent: '', kind: 'stock-video' },
    ],
    icons: NOUNS.map((word, i) => ({ word, query: word, atSec: nounAt[i] })),
    graphics: [{
      atSec: clearOf(seconds * 0.42, 3), durationSec: 3,
      type: 'stat', text: '40%', subtext: 'of the decision',
    }],
    /*
     * A chapter card, which the rule-based director only emits every two
     * minutes — so a forty-second demo would never show one, and the one
     * long-form device most worth looking at would go unlooked at.
     */
    chapters: [{ atSec: seconds * 0.22, title: 'Why the first number is the one that sticks' }],
  });

  const edl = buildEdl({
    projectId: `${shape.mode}-${styleId}`, style, mode: shape.mode, aspect: shape.aspect, fps: 30,
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
    // The builder already placed it — side, x and y. Recomputing here is how
    // the script ends up testing a layout the pipeline would never produce.
  }
  console.log(
    `scenes ${edl.scenes.map((x) => `${x.kind} head="${x.headline}" items=[${x.items.join(' | ')}]`).join(',') || 'none'}` +
    ` | graphics ${edl.graphics.map((g) => `${g.type}@${g.outStartSec.toFixed(1)}-${g.outEndSec.toFixed(1)}`).join(',')}` +
    ` | icons ${edl.icons.map((c) => `${c.side}:${c.cards.length}@${c.outStartSec.toFixed(1)}-${c.outEndSec.toFixed(1)}x${c.x.toFixed(2)}`).join(',') || 'none'}`,
  );
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

  const tag = short ? `${styleId}-short` : styleId;
  const silent = join(OUT, `${tag}-silent.mp4`);
  await renderMedia({
    composition, serveUrl, inputProps, codec: 'h264', outputLocation: silent, audioCodec: null,
    browserExecutable: env.render.browserExecutable,
    chromiumOptions: { gl: env.render.gl, ignoreCertificateErrors: env.render.ignoreCertificateErrors },
    onProgress: ({ progress }) => process.stdout.write(`\r  ${Math.round(progress * 100)}%   `),
  });

  process.stdout.write('\nmixing audio… ');
  const audio = await renderAudio(inputProps.edl, {
    sourceAudioPath: resolve(shape.source),
    sfxPaths: Object.fromEntries(
      edl.sfx.map((c) => [c.sound, join('public', sfxUrl(c.sound as SfxName))]),
    ),
    outputPath: join(OUT, `${tag}.m4a`),
  });
  console.log('ok');

  const output = join(OUT, `${tag}.mp4`);
  await muxVideoAudio(silent, audio, output);
  await assets.close();
  console.log(`\n${output}`);
}

void main();
