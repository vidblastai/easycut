import type { FormatMode } from '@/lib/styles/presets';

/**
 * Which of the two pipelines a piece of footage goes down, read off the file.
 *
 * EasyCut is not a repurposing tool. It is two editors in one app: a vertical
 * one for Reels, TikTok and Shorts, and a widescreen one for YouTube. You
 * bring the footage for the thing you are making, and it is edited as that
 * thing. Nothing is turned into the other format behind your back.
 *
 * So there is exactly one signal, and it is the shape of the picture:
 *
 *  - **Portrait or square** footage is the short-form pipeline. Vertical in,
 *    vertical out.
 *  - **Landscape** footage is the long-form pipeline. Widescreen in,
 *    widescreen out.
 *
 * Length used to be a second rule — landscape under three minutes became a
 * vertical short, reframed. That was reframing somebody's footage into a
 * format they had not asked for, and it made the product look like a
 * repurposer. A two-minute widescreen clip is a short widescreen video, and it
 * comes out widescreen.
 *
 * This also means nothing is cropped on the default path: the output aspect is
 * the input aspect, every time. Exporting a different aspect is still possible
 * from the editor, where it is a deliberate choice somebody made rather than a
 * guess we made for them.
 *
 * The verdict is shown with its reason and can be overridden in one click. A
 * guess presented as a fact is worse than the question it replaced.
 */

export interface Probe {
  width: number;
  height: number;
  durationSec: number;
}

export interface Detected {
  mode: FormatMode;
  /** Plain language, for the chip that shows what was decided. */
  reason: string;
  /** False when the file told us nothing and this is just the default. */
  confident: boolean;
  /**
   * What the browser measured, in seconds.
   *
   * Carried through so the wizard can check the job against the account's
   * remaining allowance BEFORE a gigabyte goes over the wire. It is a claim
   * from a client, so the server re-measures with ffprobe and meters against
   * that — but refusing early is the difference between a clear message and a
   * ten-minute upload that ends in one.
   */
  durationSec: number;
}

/**
 * The rule itself, as one function, so the browser and the server cannot
 * disagree about which pipeline a file belongs to.
 *
 * Takes the DISPLAYED dimensions. Phone footage is routinely stored 1920×1080
 * with a 90° rotation tag, and the stored shape is the opposite of the shape
 * the viewer sees — `probe()` in src/lib/media/ffmpeg.ts already transposes for
 * that, and `videoWidth`/`videoHeight` in the browser are post-rotation too.
 * Handing this raw stream dimensions would send every rotated phone video down
 * the widescreen pipeline.
 */
export function formatForShape(width: number, height: number): FormatMode {
  return height >= width ? 'short' : 'long';
}

export function detectFormat(probe: Probe | null): Detected {
  if (!probe || !probe.width || !probe.height) {
    /*
     * The browser could not decode this one — an unusual codec, or a file
     * whose index sits at the end. Not a problem: this reading only exists to
     * fill the screen before the upload, and the server settles the format
     * from ffprobe once it has the bytes. Say so, rather than presenting a
     * fallback as a decision.
     */
    return {
      mode: 'short',
      reason: "We couldn't read this file in the browser — we'll set the format from the file itself when it uploads.",
      confident: false,
      durationSec: 0,
    };
  }

  if (formatForShape(probe.width, probe.height) === 'short') {
    return {
      mode: 'short',
      reason: `Shot ${probe.height > probe.width ? 'vertical' : 'square'}, so it's a short — and it stays vertical.`,
      confident: true,
      durationSec: probe.durationSec,
    };
  }

  // Landscape is long form whatever it runs. A short widescreen clip is a
  // short WIDESCREEN clip; it does not become a vertical one.
  return {
    mode: 'long',
    reason: probe.durationSec > 0
      ? `${formatClock(probe.durationSec)} of widescreen, so it's long form — and it stays widescreen.`
      : "Shot widescreen, so it's long form — and it stays widescreen.",
    confident: true,
    durationSec: probe.durationSec,
  };
}

function formatClock(seconds: number): string {
  if (!seconds) return 'Widescreen';
  const whole = Math.round(seconds);
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return m ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}

/**
 * Reads shape and length out of a video file, in the browser, before anything
 * is uploaded.
 *
 * A `<video>` element knows both as soon as it has the header, which is a few
 * kilobytes — so the answer arrives in the moment the file is chosen rather
 * than after a server round trip on a two-gigabyte upload.
 *
 * The timeout is generous because a file exported without `+faststart` keeps
 * its index at the END, and the browser has to read the whole thing to find it.
 * That is local disk rather than network, but two gigabytes of it is still
 * seconds. Running out of patience is not a failure: the caller shows what it
 * assumed and offers the other answer in one click.
 */
export function probeInBrowser(file: File, timeoutMs = 15000): Promise<Probe | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    let settled = false;

    const done = (probe: Probe | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      resolve(probe);
    };

    const timer = setTimeout(() => done(null), timeoutMs);

    video.preload = 'metadata';
    video.muted = true;
    video.onloadedmetadata = () =>
      done({
        width: video.videoWidth,
        height: video.videoHeight,
        // Infinity for some streamed files; treat it as unknown rather than long.
        durationSec: Number.isFinite(video.duration) ? video.duration : 0,
      });
    // A codec the browser cannot decode still uploads fine — the server can read
    // it. Here it just means we fall back to the default.
    video.onerror = () => done(null);
    video.src = url;
  });
}
