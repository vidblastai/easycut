import '../src/lib/config/load-env';
import { basename } from 'node:path';
import { detectLanguage, packFor } from '../src/lib/lang';
import { transcribeAudio } from '../src/lib/transcribe';
import { CLEANUP_PRESETS, findCleanupTargets, pendingRestatements } from '../src/lib/timeline/cleanup';
import { punchMoments } from '../src/lib/edl/punch-script';
import { reviewRestatements } from '../src/lib/director/retakes';

/**
 * `npm run langs <audio…>` — does the editor understand this language?
 *
 * Transcribes a clip with the real provider chain and then runs the three
 * passes that read MEANING rather than sound: the filler cutter, the retake
 * detector, and the camera-move script. Those are the three that need a
 * language pack, and the three that fail SILENTLY without one — a German
 * video edited with English tables comes back with every "ähm" still in it,
 * no retakes found, and a camera that only moves on digits.
 *
 * Pass it a file per language and read the three counts. Zero fillers and
 * zero camera moves on a clip that obviously has both is the symptom.
 */

async function main() {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.log('usage: npm run langs -- <audio file> [more…]');
    return;
  }

  for (const file of files) {
    console.log(`\n──────────── ${basename(file)}`);
    const { transcript, attempts } = await transcribeAudio(file, 0, {});
    const pack = packFor(transcript.language);
    const read = detectLanguage(transcript.text);

    console.log(
      `  ${transcript.provider} · ${pack.endonym} (${transcript.language})` +
        ` · text reads as ${read.code} at ${read.confidence.toFixed(2)}` +
        ` · ${transcript.words.length} words · ${transcript.durationSec.toFixed(1)}s`,
    );
    if (attempts.some((a) => a.error)) {
      console.log(`  attempts: ${attempts.map((a) => `${a.provider}${a.error ? ` (${a.error})` : ''}`).join(' → ')}`);
    }
    console.log(`  "${transcript.text.slice(0, 220)}"`);

    const findings = findCleanupTargets(transcript, CLEANUP_PRESETS.raw);
    const applied = findings.filter((f) => f.confidence >= CLEANUP_PRESETS.raw.confidenceFloor);
    console.log(`\n  cleanup — ${findings.length} found, ${applied.length} over the floor`);
    for (const f of findings) {
      const mark = f.confidence >= CLEANUP_PRESETS.raw.confidenceFloor ? 'cut ' : 'flag';
      console.log(
        `    ${mark} ${f.kind.padEnd(11)} ${f.confidence.toFixed(2)} ` +
          `${f.startSec.toFixed(1)}–${f.endSec.toFixed(1)}s  "${f.text.slice(0, 70)}"`,
      );
      if (f.review?.reasons.length) console.log(`         ${f.review.reasons.join('; ')}`);
    }

    const moments = punchMoments({
      sentences: transcript.sentences,
      language: transcript.language,
      busy: [],
      hints: [],
      palette: ['push', 'ramp', 'snap', 'bounce', 'speed-ramp', 'pull', 'handheld'],
      cadenceSec: [6, 10],
      durationSec: transcript.durationSec || (transcript.words.at(-1)?.endSec ?? 0),
      hookSec: 2.5,
    });
    console.log(`\n  camera — ${moments.length} moves`);
    for (const m of moments) {
      console.log(
        `    ${m.signal.padEnd(11)} ${m.move.padEnd(10)} ${m.startSec.toFixed(1)}–${m.endSec.toFixed(1)}s  ${m.reason}`,
      );
    }

    const pending = pendingRestatements(findings);
    if (pending.length) {
      const judged = await reviewRestatements(pending);
      console.log(`\n  asked a reader about ${pending.length}${judged.error ? ` (${judged.error})` : ''}`);
      for (const q of pending) {
        const a = judged.answers.get(q.id);
        console.log(`    ${(a?.verdict ?? 'no answer').padEnd(10)} keep ${a?.keep ?? '—'}  "${a?.why ?? ''}"`);
      }
    }
  }
  console.log();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
