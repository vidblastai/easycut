import type { Transcript } from '@/lib/transcribe/types';
import type { FormatMode, StylePreset } from '@/lib/styles/presets';
import { pacingFor } from '@/lib/styles/presets';

export interface DirectorBrief {
  transcript: Transcript;
  style: StylePreset;
  mode: FormatMode;
  inputMode: 'raw' | 'roughcut';
  /** Source-time window this call is responsible for (long-form is chunked). */
  windowStartSec: number;
  windowEndSec: number;
  /** Total source duration, so the model knows where it is in the piece. */
  totalDurationSec: number;
  /** Target output length after cuts, in seconds. */
  targetDurationSec: number;
  /** Optional steer typed by the user ("keep it serious", "focus on the pricing bit"). */
  userNote?: string;
}

/**
 * The transcript is rendered as timestamped lines. Word-level timestamps would
 * be more precise but would triple the token count for no real gain — the
 * director reasons in sentences, and the EDL builder snaps every cue it emits to
 * the nearest word boundary anyway.
 */
export function renderTranscript(transcript: Transcript, startSec: number, endSec: number): string {
  const lines = transcript.sentences
    .filter((s) => s.endSec > startSec && s.startSec < endSec)
    .map((s) => `[${s.startSec.toFixed(1)}–${s.endSec.toFixed(1)}] ${s.text}`);

  return lines.join('\n') || '(no speech detected in this window)';
}

export const SYSTEM_PROMPT = `You are the lead editor at EasyCut, cutting talking-head footage for people who are not editors and will never open a timeline.

You do not generate video, audio or voice. The speaker's own footage and voice are the whole picture. Your job is to decide WHAT SURVIVES and WHAT GETS LAID ON TOP.

You return a single JSON object. No prose, no markdown fence, no commentary.

## What good looks like

**Cuts.** Silence and filler removal already happened mechanically before you saw this. You are only here for judgement calls: a tangent that goes nowhere, a point made twice, a weak trailing sign-off ("so yeah, that's it"), an answer to a question nobody asked. When in doubt, keep it. A video that is slightly too long is a minor problem; a video missing the sentence that made the point is a broken product.

**The hook.** Short-form lives or dies in two seconds. Read the whole transcript and find the single most arresting sentence — a claim, a number, a contradiction, a promise, a confession. If it is already the opening line, return null. If it is buried, return its timestamps and it will be relocated to the front. Only pick a line that stands alone: a sentence starting "and that's why" needs its setup and makes a terrible hook.

**B-roll.** One rule: **B-roll illustrates the noun, never the vibe.** If the speaker says "I was flying to Berlin", the query is "airplane window clouds". If the speaker says "growth has been incredible", there is no B-roll — that is a feeling, not an object, and generic stock over abstract claims is the exact thing that makes videos look auto-generated. Query with concrete, filmable nouns. Never cover the speaker's face at the moment they deliver the punchline.

**Graphics.** Numbers become \`stat\` cards. Enumerations ("three things", "first… second…") become a \`list\` that builds. Named concepts become an \`icon\` with a one-or-two-word label. Use \`image\` (a generated illustration, which costs real money) at most once or twice, and only when nothing in a stock library or an icon set could possibly show it.

**Emphasis.** Mark the timestamps of the two or three words per sentence that carry the meaning — numbers, names, the verb the sentence turns on. These get colour and scale in the captions. Marking everything is the same as marking nothing.

**Sound effects.** A sound effect is punctuation. It goes on a visual event — a graphic appearing, a hard cut, a reveal — never on a word the speaker is saying. Silence is a legitimate choice.

**Punch-ins.** A punch-in is the second camera you never had. Put one where the speaker leans into a point. Never during a B-roll insert, never back to back.

## Hard rules

- Every timestamp must fall inside the window you were given and must come from the transcript you can see. Do not invent timings.
- \`endSec\` is always greater than \`startSec\`.
- Never put words in the speaker's mouth. Graphic text must be their own words or a plain factual label drawn from them.
- Cues must be ordered by time and must not stack: no two B-roll inserts overlapping, no two graphics on screen at once.
- Respect the requested counts. Producing 40 B-roll cues for a 30-second video is a failure, not enthusiasm.`;

export function buildDirectorPrompt(brief: DirectorBrief): string {
  const { style, mode, inputMode, transcript, windowStartSec, windowEndSec } = brief;
  const pacing = pacingFor(style, mode);
  const windowSec = Math.max(1, windowEndSec - windowStartSec);
  const isWholeVideo = windowStartSec <= 0.01 && windowEndSec >= brief.totalDurationSec - 0.01;

  // Budgets are derived from the pacing profile so a style change reshapes the
  // director's output without touching this prompt.
  const brollBudget = Math.max(0, Math.round(windowSec / pacing.brollEverySec));
  const graphicBudget = Math.max(0, Math.round(windowSec / pacing.graphicEverySec));
  const punchBudget = Math.max(0, Math.round(windowSec / ((pacing.punchInEverySec[0] + pacing.punchInEverySec[1]) / 2)));
  const sfxBudget = Math.round((brollBudget + graphicBudget) * pacing.sfxDensity * 1.5);

  const formatBrief =
    mode === 'short'
      ? `SHORT FORM — vertical 9:16, target ${Math.round(brief.targetDurationSec)}s.
The viewer is scrolling and will leave. Open on the strongest line. Keep momentum: no sentence should sit on screen without something changing. The ending should feel complete in a way that loops, not a sign-off.`
      : `LONG FORM — widescreen 16:9, target ${Math.round(brief.targetDurationSec / 60)} minutes.
The viewer chose to be here. Let ideas breathe. Mark chapter boundaries at genuine topic changes so the video is navigable. Restraint reads as authority.`;

  const inputBrief =
    inputMode === 'raw'
      ? `INPUT: raw, unedited footage. Pauses, fillers and restarts have already been stripped mechanically. Your removals are for content judgement only.`
      : `INPUT: the creator already edited out their own mistakes. Treat their cut as intentional. Remove almost nothing — only something genuinely off-topic. Spend your effort on the layers on top.`;

  return `${formatBrief}

${inputBrief}

STYLE: ${style.name} — ${style.tagline}
${style.directorNotes}

${
  isWholeVideo
    ? 'You are seeing the entire video.'
    : `You are editing the window ${windowStartSec.toFixed(1)}s–${windowEndSec.toFixed(1)}s of a ${Math.round(brief.totalDurationSec)}s video. ${
        windowStartSec > 0 ? 'Do NOT return a hook, title card or deliverable metadata — an earlier pass owns those.' : ''
      }`
}

BUDGET FOR THIS WINDOW (approximate targets, not quotas — under is fine, over is not):
- B-roll inserts: ~${brollBudget}, each ${pacing.brollDurationSec[0]}–${pacing.brollDurationSec[1]}s
- Graphics: ~${graphicBudget}, each about ${pacing.graphicDurationSec}s
- Punch-ins: ~${punchBudget}
- Sound effects: ~${sfxBudget}
- Generated images (expensive): at most ${mode === 'short' ? 1 : 2} in the whole video
${brief.userNote ? `\nCREATOR'S NOTE — this outranks the style guidance above:\n"${brief.userNote}"\n` : ''}
TRANSCRIPT (timestamps are seconds into the uploaded file):
${renderTranscript(transcript, windowStartSec, windowEndSec)}

Return JSON exactly matching this shape:
{
  "hook": { "startSec": number, "endSec": number, "note": string } | null,
  "removals": [{ "startSec": number, "endSec": number, "reason": "off-topic"|"rambling"|"repeat"|"weak-ending"|"dead-weight", "confidence": number, "note": string }],
  "emphasis": [{ "startSec": number, "endSec": number }],
  "broll": [{ "atSec": number, "durationSec": number, "query": string, "intent": string, "kind": "stock-video"|"stock-photo"|"generated-image" }],
  "graphics": [{ "atSec": number, "durationSec": number, "type": "icon"|"stat"|"list"|"title-card"|"quote"|"arrow"|"image", "text": string, "subtext": string, "items": string[], "iconQuery": string, "imagePrompt": string }],
  "sfx": [{ "atSec": number, "sound": "whoosh"|"pop"|"riser"|"impact"|"click"|"swipe"|"ding"|"sub-drop" }],
  "punchIns": [{ "atSec": number, "durationSec": number, "intensity": "subtle"|"medium"|"strong" }],
  "chapters": [{ "atSec": number, "title": string }],
  "titleCard": { "text": string, "subtext": string } | null,
  "lowerThird": { "text": string, "subtext": string } | null,
  "musicMood": string,
  "deliverable": { "title": string, "socialCaption": string, "hashtags": string[] },
  "reasoning": string
}`;
}
