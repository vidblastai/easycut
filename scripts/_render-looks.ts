import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseComposition, buildCompositionHtml } from '@/lib/director/hyperframe';
import { writeProject, renderProject } from '@/lib/render/hyperframes';
import { styleGuideFor } from '@/lib/scenes/style-guides';
import { ffmpeg } from '@/lib/media/ffmpeg';

const words = JSON.parse(readFileSync('src/lib/director/references/words.json', 'utf8')) as Record<string, Array<{ text: string; atSec: number }>>;
const looks = process.argv.slice(2);
(async () => {
  for (const look of looks) {
    const out = 'public/looks/' + look;
    if (existsSync(out + '.mp4')) { console.log(look, 'exists'); continue; }
    const t = Date.now();
    try {
      const parts = parseComposition(readFileSync('src/lib/director/references/' + look + '.txt', 'utf8'));
      if (!parts) throw new Error('unparsable');
      const w = words[look] ?? [];
      const durationSec = Math.min(6, Math.max(4, (w.at(-1)?.atSec ?? 4) + 0.8));
      const frame = { width: 1080, height: 1920, durationSec, ground: styleGuideFor(look as never).ground, words: w };
      const dir = join('/tmp/claude-0/-home-user-easycut/bc5c9376-212c-5a0e-af35-f0522ce96f46/scratchpad/looks', look);
      await writeProject(dir, buildCompositionHtml(parts, frame));
      const full = join('/tmp/claude-0/-home-user-easycut/bc5c9376-212c-5a0e-af35-f0522ce96f46/scratchpad/looks', look + '.mp4');
      await renderProject(dir, full, { fps: 30 });
      await ffmpeg(['-y', '-i', full, '-vf', 'scale=270:-2', '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '28', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out + '.mp4']);
      await ffmpeg(['-y', '-ss', String(durationSec * 0.7), '-i', full, '-frames:v', '1', '-vf', 'scale=270:-2', '-q:v', '4', out + '.jpg']);
      console.log(look, 'ok', ((Date.now() - t) / 1000).toFixed(0) + 's', durationSec.toFixed(1) + 's');
    } catch (e) { console.log(look, 'FAIL', String((e as Error).message).slice(0, 200)); }
  }
})();
