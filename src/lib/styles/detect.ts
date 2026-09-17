import type { FormatMode } from '@/lib/styles/presets';

/**
 * Which format a piece of footage is, read off the footage.
 *
 * This used to be a question — "where is it going?" — and it was the wrong one
 * twice over. It asked about distribution when what it needed was a fact about
 * the file, and it asked it before the person had any idea what they were
 * choosing between. The answer is in the video: nobody shoots vertical for
 * YouTube, and nobody makes a ten-minute piece out of forty seconds of footage.
 *
 * Two signals, in order:
 *
 *  1. **Shape.** Portrait or square footage is short form. That is what the
 *     phone was held sideways for, and reframing it to widescreen would mean
 *     throwing away most of the picture.
 *  2. **Length.** Landscape footage under three minutes cannot become a long
 *     piece — there is nothing to cut. It becomes a vertical short, reframed,
 *     which is what people record a two-minute landscape clip for.
 *
 * Everything else is long form.
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
}

/** Landscape footage shorter than this has nothing to cut down from. */
export const LONG_FORM_MIN_SEC = 180;

export function detectFormat(probe: Probe | null): Detected {
  if (!probe || !probe.width || !probe.height) {
    return {
      mode: 'short',
      reason: "We couldn't read the file, so we've assumed a short.",
      confident: false,
    };
  }

  const portrait = probe.height >= probe.width;
  if (portrait) {
    return {
      mode: 'short',
      reason: `Shot ${probe.height > probe.width ? 'vertical' : 'square'}, so it's a short.`,
      confident: true,
    };
  }

  if (probe.durationSec > 0 && probe.durationSec < LONG_FORM_MIN_SEC) {
    return {
      mode: 'short',
      reason: `${formatClock(probe.durationSec)} of widescreen — short enough to cut vertical.`,
      confident: true,
    };
  }

  return {
    mode: 'long',
    reason: `${formatClock(probe.durationSec)} of widescreen, so it's long form.`,
    confident: probe.durationSec > 0,
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
