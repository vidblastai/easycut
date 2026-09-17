/**
 * Turning a crash into something a person can act on.
 *
 * The people using this are not editors and are certainly not reading ffprobe
 * output, but that is exactly what they got: two absolute paths and the words
 * "moov atom not found". Worse, it was usually a lie about whose fault it was
 * — that particular message meant OUR upload had truncated their file.
 *
 * So: one sentence saying what happened, one saying what to do, and the raw
 * text kept underneath for whoever actually wants it.
 */

export interface Explained {
  /** What went wrong, in words somebody who films themselves would use. */
  headline: string;
  /** What to do about it. Empty when there is genuinely nothing to try. */
  advice: string;
  /** Whether running the same job again could plausibly work. */
  retryable: boolean;
}

/**
 * Does this message already speak to a person?
 *
 * Plenty of our own failures do — "This file has no audio track. EasyCut edits
 * talking-head footage — it needs a voice to work from." is better than any
 * paraphrase of it, and an early version of this file replaced exactly that
 * with something vaguer. So the translation layer only runs on machine noise:
 * paths, bracketed codec tags, exit codes, bare errnos.
 */
function looksHuman(raw: string): boolean {
  if (raw.length === 0 || raw.length > 300) return false;
  if (/(^|\s)[\/~]|[A-Za-z]:\\|\\\\/.test(raw)) return false;   // a path
  if (/\[[^\]]*@[^\]]*\]|\bexited \d/.test(raw)) return false;    // ffmpeg tag, exit code
  if (/\b(E[A-Z]{3,}|ERR_[A-Z_]+)\b/.test(raw)) return false;   // a bare errno
  if (!/\s/.test(raw)) return false;                            // one token is not a sentence
  return /[.!]$/.test(raw);
}

const RULES: Array<{ match: RegExp; headline: string; advice: string; retryable: boolean }> = [
  {
    match: /upload was cut short/i,
    headline: 'Your footage did not finish uploading.',
    advice: '',
    retryable: true,
  },
  {
    match: /moov atom not found|invalid data found|end of file|truncat/i,
    headline: "We couldn't read the whole video file.",
    advice:
      'It looks incomplete — often a transfer that stopped early, or a recording that was interrupted. ' +
      'Try uploading it again, or re-export it from wherever you filmed it.',
    retryable: true,
  },
  {
    match: /no such file|not found|ENOENT/i,
    headline: 'The footage for this project is missing.',
    advice: 'Start a new video and upload the file again.',
    retryable: false,
  },
  {
    match: /unknown (encoder|decoder)|codec|unsupported|invalid argument/i,
    headline: "We couldn't decode that video.",
    advice: 'Re-export it as an MP4 or MOV — those two always work.',
    retryable: false,
  },
  {
    match: /no space left|ENOSPC|disk/i,
    headline: 'The server ran out of room while rendering.',
    advice: 'Try again in a few minutes.',
    retryable: true,
  },
  {
    match: /timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up|fetch failed/i,
    headline: 'A connection dropped partway through.',
    advice: 'Nothing is wrong with your footage — run it again.',
    retryable: true,
  },
  {
    match: /no audio|silent|could not find any stream/i,
    headline: "We couldn't find any speech in that file.",
    advice: 'Check the recording has sound — the whole edit is built from what you say.',
    retryable: false,
  },
  {
    match: /rate limit|quota|429|insufficient.*credit|billing/i,
    headline: 'A service we use turned us away.',
    advice: 'Usually a rate limit that clears on its own. Try again shortly.',
    retryable: true,
  },
];

export function explainFailure(message: string | null | undefined): Explained {
  const raw = (message ?? '').trim();
  const hit = RULES.find((rule) => rule.match.test(raw));

  // Already plain: keep the words, and take only the judgement — whether
  // pressing the button again could possibly help — from the rules. Restating
  // a clear sentence underneath itself is not advice.
  if (looksHuman(raw)) {
    return { headline: raw, advice: '', retryable: hit?.retryable ?? true };
  }

  if (hit) return { headline: hit.headline, advice: hit.advice, retryable: hit.retryable };

  return {
    headline: 'Something went wrong while making your video.',
    advice: 'Running it again is usually enough. If it keeps failing, the details below say why.',
    retryable: true,
  };
}
