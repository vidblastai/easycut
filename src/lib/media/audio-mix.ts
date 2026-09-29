import { ffmpeg } from './ffmpeg';
import type { Edl } from '@/lib/edl/types';

/**
 * Builds the finished audio in a single ffmpeg pass.
 *
 * This runs concurrently with the video render, which is why the whole pipeline
 * fits the speed budget: the fiddly DSP (cut-and-join, loudness, ducking,
 * effect placement) is essentially free in ffmpeg and finishes long before the
 * frames do.
 *
 * The graph, in order:
 *
 *   source audio ─ trim per segment ─ concat ─ HPF ─ denoise ─ compress ─ loudnorm ─┐
 *                                                                                   ├─ amix ─ limiter
 *   music ─ trim/loop ─ volume ─ fades ─ sidechain-ducked by speech ────────────────┤
 *   sfx[] ─ adelay ─ volume ────────────────────────────────────────────────────────┘
 */

/**
 * Past this many segments the J/L cut is dropped and the hard concat returns.
 *
 * The overlap costs one `amix` input per segment. A short has twenty and a
 * forty-minute lecture can have six hundred, where the filter graph alone
 * takes longer to parse than the polish is worth — and the audio pass has to
 * finish inside the video render or the whole speed budget goes.
 */
const J_CUT_MAX_SEGMENTS = 160;

export interface AudioMixOptions {
  sourceAudioPath: string;
  /** Local path per SFX name, resolved before the mix. */
  sfxPaths: Record<string, string>;
  musicPath?: string | null;
  outputPath: string;
}

export interface AudioMixPlan {
  filterGraph: string;
  inputs: string[];
  outputLabel: string;
}

/** Builds the filter graph. Split out from execution so it can be unit-tested. */
export function buildAudioGraph(edl: Edl, options: AudioMixOptions): AudioMixPlan {
  const inputs: string[] = [options.sourceAudioPath];
  const parts: string[] = [];

  /* ------------------------------- speech -------------------------------- */

  const segments = [...edl.segments].sort((a, b) => a.outStartSec - b.outStartSec);
  const speechLabels: string[] = [];

  /*
   * ── J and L cuts ───────────────────────────────────────────────────────
   *
   * `concat` butts every segment's audio hard against the next, which puts
   * the audio join on the same frame as the picture join, every time, all the
   * way down a video. That is precisely what makes an automated edit sound
   * automated — a real editor lets the next line's audio start a breath early
   * and the last line's room carry a breath late, so the seam is heard
   * somewhere the eye is not looking for it.
   *
   * So each segment is trimmed WIDER than its picture and placed absolutely
   * with `adelay`, overlapping its neighbours by `jCutSec` at each end, with
   * fades across the overlaps. One segment's fade-out and the next one's
   * fade-in span the same moment, which is a crossfade — and because only the
   * placement moved and not the length, the timeline is exactly as long as it
   * was.
   *
   * It costs one mix input per segment, which is nothing for a short and a
   * very large filter graph for an hour-long lecture. Past the cap the hard
   * concat comes back: the effect is worth a few milliseconds of polish, not
   * worth a render that takes longer than the video.
   */
  const lead = edl.audio.jCutSec;
  const overlapping = lead > 0 && segments.length > 1 && segments.length <= J_CUT_MAX_SEGMENTS;

  segments.forEach((seg, i) => {
    const label = `s${i}`;
    const outLen = Math.max(0.001, seg.outEndSec - seg.outStartSec);
    const speed = Math.abs(seg.speed - 1) > 0.001 ? seg.speed : 1;

    /*
     * Never more than 40% of the segment from either end.
     *
     * A 0.3s segment given a 0.14s lead AND a 0.14s tail is a segment that is
     * fading in until it starts fading out — no part of it is ever at full
     * level, and a run of short segments turns into mush.
     */
    const room = outLen * 0.4;
    // Nothing to lead into on the first, nothing to carry past on the last.
    // And a lead can never reach back before the start of the source file.
    const leadIn = overlapping && i > 0 ? Math.min(lead, room, seg.sourceStartSec / speed) : 0;
    const tailOut = overlapping && i < segments.length - 1 ? Math.min(lead, room) : 0;

    const chain = [
      // Widened in SOURCE seconds: a lead of `leadIn` output-seconds is
      // `leadIn * speed` of source, or a sped-up segment leads by the wrong
      // amount and drifts off its own picture.
      `atrim=start=${Math.max(0, seg.sourceStartSec - leadIn * speed).toFixed(4)}` +
        `:end=${(seg.sourceEndSec + tailOut * speed).toFixed(4)}`,
      'asetpts=PTS-STARTPTS',
    ];
    // A speed change has to be applied to audio too or lips stop matching.
    if (speed !== 1) chain.push(`atempo=${clampTempo(seg.speed)}`);

    // 12ms minimum at every join even with no overlap: a hard splice on a
    // waveform is an audible click.
    const fadeIn = Math.max(0.012, leadIn);
    const fadeOut = Math.max(0.012, tailOut);
    const total = outLen + leadIn + tailOut;
    chain.push(
      `afade=t=in:st=0:d=${fadeIn.toFixed(4)}`,
      `afade=t=out:st=${Math.max(0, total - fadeOut).toFixed(4)}:d=${fadeOut.toFixed(4)}`,
    );

    if (overlapping) {
      // Placed absolutely rather than concatenated, which is what lets it sit
      // earlier than its own picture.
      const atMs = Math.max(0, Math.round((seg.outStartSec - leadIn) * 1000));
      chain.push(`adelay=${atMs}|${atMs}:all=1`);
    }

    parts.push(`[0:a]${chain.join(',')}[${label}]`);
    speechLabels.push(`[${label}]`);
  });

  if (!speechLabels.length) {
    // No segments at all — emit silence so the mux still produces a valid file.
    parts.push(`anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${edl.format.durationSec}[speech]`);
  } else {
    if (overlapping) {
      // `normalize=0`, or mixing N streams divides every one of them by N and
      // the whole voice track drops through the floor.
      parts.push(
        `${speechLabels.join('')}amix=inputs=${speechLabels.length}:duration=longest:dropout_transition=0:normalize=0[speechRaw]`,
      );
    } else {
      parts.push(`${speechLabels.join('')}concat=n=${speechLabels.length}:v=0:a=1[speechRaw]`);
    }

    // The cleanup runs whichever way the segments were joined. Levelling the
    // voice is not a property of the join — and `[speech]` is what the music
    // and the final mix both read, so a branch that skips this stage does not
    // merely sound unprocessed, it leaves the label undefined and ffmpeg
    // refuses the whole graph.
    const cleanup: string[] = [];
    if (edl.audio.highPassHz > 0) cleanup.push(`highpass=f=${edl.audio.highPassHz}`);
    // Gentle spectral denoise: enough for room hiss, not enough to sound processed.
    if (edl.audio.denoise) cleanup.push('afftdn=nr=12:nf=-30');
    if (edl.audio.compress) {
      // Broadcast-style levelling so quiet asides stay audible on a phone speaker.
      cleanup.push('acompressor=threshold=-18dB:ratio=3:attack=8:release=180:makeup=2');
    }
    cleanup.push(`loudnorm=I=${edl.audio.targetLufs}:TP=-1.5:LRA=11`);
    cleanup.push('aresample=48000');

    parts.push(`[speechRaw]${cleanup.join(',')}[speech]`);
  }

  /* -------------------------------- music -------------------------------- */

  let musicLabel: string | null = null;
  if (edl.music && options.musicPath) {
    const musicIndex = inputs.length;
    inputs.push(options.musicPath);

    const m = edl.music;
    const chain = [
      // Loop rather than fail when the bed is shorter than the video.
      `aloop=loop=-1:size=2e9`,
      `atrim=start=${m.startAtSec.toFixed(3)}:duration=${edl.format.durationSec.toFixed(3)}`,
      'asetpts=PTS-STARTPTS',
      `volume=${dbToLinear(m.gainDb).toFixed(4)}`,
      `afade=t=in:st=0:d=${m.fadeInSec}`,
      `afade=t=out:st=${Math.max(0, edl.format.durationSec - m.fadeOutSec).toFixed(3)}:d=${m.fadeOutSec}`,
      'aresample=48000',
    ];
    parts.push(`[${musicIndex}:a]${chain.join(',')}[musicRaw]`);

    // Duck the bed using the speech itself as the sidechain key. This is what
    // separates "music under a video" from "music fighting the voice".
    parts.push('[speech]asplit=2[speechOut][speechKey]');
    parts.push(
      `[musicRaw][speechKey]sidechaincompress=threshold=${dbToLinear(-28).toFixed(5)}:ratio=${duckRatio(m.duckDb)}:attack=12:release=350:makeup=1[music]`,
    );
    musicLabel = '[music]';
  } else {
    parts.push('[speech]acopy[speechOut]');
  }

  /* --------------------------------- sfx --------------------------------- */

  const sfxLabels: string[] = [];
  edl.sfx.forEach((cue, i) => {
    const path = options.sfxPaths[cue.sound];
    if (!path) return;
    const index = inputs.length;
    inputs.push(path);
    const label = `fx${i}`;
    parts.push(
      `[${index}:a]volume=${dbToLinear(cue.gainDb).toFixed(4)},` +
        `adelay=${Math.round(cue.atSec * 1000)}|${Math.round(cue.atSec * 1000)},` +
        `aresample=48000[${label}]`,
    );
    sfxLabels.push(`[${label}]`);
  });

  /* --------------------------------- mix --------------------------------- */

  const mixInputs = ['[speechOut]', ...(musicLabel ? [musicLabel] : []), ...sfxLabels];
  if (mixInputs.length === 1) {
    parts.push(`[speechOut]alimiter=limit=0.97[out]`);
  } else {
    parts.push(
      `${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=first:dropout_transition=0:normalize=0,` +
        `alimiter=limit=0.97[out]`,
    );
  }

  return { filterGraph: parts.join(';'), inputs, outputLabel: '[out]' };
}

export async function renderAudio(edl: Edl, options: AudioMixOptions): Promise<string> {
  const plan = buildAudioGraph(edl, options);

  const args = ['-y'];
  for (const input of plan.inputs) args.push('-i', input);
  args.push(
    '-filter_complex', plan.filterGraph,
    '-map', plan.outputLabel,
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ar', '48000',
    '-ac', '2',
    options.outputPath,
  );

  await ffmpeg(args, { timeoutMs: 10 * 60 * 1000 });
  return options.outputPath;
}

/* -------------------------------- helpers -------------------------------- */

export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

/** `atempo` only accepts 0.5–2.0, so larger changes chain multiple stages. */
function clampTempo(speed: number): string {
  if (speed >= 0.5 && speed <= 2) return speed.toFixed(4);
  const stages: number[] = [];
  let remaining = speed;
  while (remaining > 2) {
    stages.push(2);
    remaining /= 2;
  }
  while (remaining < 0.5) {
    stages.push(0.5);
    remaining /= 0.5;
  }
  stages.push(remaining);
  return stages.map((s) => s.toFixed(4)).join(',atempo=');
}

/**
 * Converts "duck the music by N dB" into a sidechain ratio.
 * −12 dB of ducking is about 4:1 against our −28 dB threshold.
 */
function duckRatio(duckDb: number): number {
  const ratio = Math.max(1.5, Math.min(20, Math.abs(duckDb) / 3));
  return Number(ratio.toFixed(2));
}

/** Mux a rendered video track and a rendered audio track without re-encoding. */
export async function muxVideoAudio(videoPath: string, audioPath: string, outputPath: string): Promise<string> {
  await ffmpeg([
    '-y',
    '-i', videoPath,
    '-i', audioPath,
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    '-movflags', '+faststart',
    outputPath,
  ], { timeoutMs: 5 * 60 * 1000 });
  return outputPath;
}
