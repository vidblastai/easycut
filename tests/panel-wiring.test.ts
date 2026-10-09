import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LAYOUTS, type Layout } from '@/lib/edl/types';
import { layoutPlan, layoutPlanFor, type Region } from '@/lib/styles/layouts';

/**
 * The bug this file exists for.
 *
 * The explainer panel was written, prompted, rendered, tested and shipped —
 * and the pipeline imported `writePanel` without ever calling it. Nothing
 * failed. `tsc` does not mind an unused import, every unit test passed
 * because every unit worked, and the job log was clean. What the customer got
 * was a video with a black band across the top 42.5% of the frame for its
 * whole length, because the speaker is sized to the layout's lower region and
 * the panel that owns the strip above it had nothing to draw.
 *
 * Two guards, because one would not have caught it:
 *
 *  - the geometry must never describe a region nothing fills, so even a
 *    panel pass that fails outright degrades to a full-frame edit;
 *  - the pipeline must actually CALL the passes it imports.
 */

const FRAME = { width: 1080, height: 1920 } as const;
const PANEL_LAYOUTS = LAYOUTS.filter((name) => layoutPlan(name, FRAME).panel);

function edlStub(layout: Layout, panel: readonly unknown[]) {
  return { format: { layout, ...FRAME }, panel };
}

/** Fraction of the frame's height left unpainted by any region. */
function uncovered(regions: readonly Region[]): number {
  // Every layout here divides the frame in horizontal bands, so coverage is a
  // question about the vertical axis alone.
  const bands = regions
    .map((r) => [r.y, r.y + r.h] as const)
    .sort((a, b) => a[0] - b[0]);

  let painted = 0;
  let reach = 0;
  for (const [top, bottom] of bands) {
    if (bottom <= reach) continue;
    painted += bottom - Math.max(top, reach);
    reach = bottom;
  }
  return Math.max(0, 1 - painted);
}

describe('a layout that reserves a strip for the panel', () => {
  it('is a layout we actually have', () => {
    // If this list ever empties, the two tests below pass by vacuum.
    expect(PANEL_LAYOUTS.length).toBeGreaterThan(0);
  });

  it('covers the whole frame when the panel has something in it', () => {
    for (const layout of PANEL_LAYOUTS) {
      const plan = layoutPlanFor(edlStub(layout, [{ id: 'a' }]));
      expect(plan.panel, layout).not.toBeNull();
      expect(uncovered([plan.speaker, plan.panel!]), layout).toBeCloseTo(0, 4);
    }
  });

  it('gives the strip back to the speaker when the panel is empty', () => {
    for (const layout of PANEL_LAYOUTS) {
      const asked = layoutPlan(layout, FRAME);
      const plan = layoutPlanFor(edlStub(layout, []));

      // No reserved region at all, so `Panel` cannot be asked to paint one.
      expect(plan.panel, layout).toBeNull();
      // And the speaker has taken it: nothing is left for the composition's
      // background to show through.
      expect(uncovered([plan.speaker]), layout).toBeCloseTo(0, 4);
      expect(plan.speaker.h, layout).toBeGreaterThan(asked.speaker.h);
      // B-roll replaces the speaker on these layouts, so it has to grow too —
      // otherwise an insert letterboxes itself inside the old lower band.
      if (plan.broll) expect(uncovered([plan.broll]), layout).toBeCloseTo(0, 4);
      // The caption band was pinned to a seam that no longer exists.
      expect(plan.captionY, layout).toBeNull();
    }
  });
});

/**
 * An imported-and-never-called pass is invisible to every other kind of test,
 * so it gets checked as text. Crude, and it is the only thing that would have
 * caught the black band before a person watched the video.
 */
describe('the pipeline', () => {
  const source = readFileSync(join(process.cwd(), 'src/lib/pipeline/run.ts'), 'utf8');

  it('calls every director pass it imports', () => {
    const imports = [...source.matchAll(/import \{([^}]+)\} from '@\/lib\/director[^']*';/g)];
    expect(imports.length).toBeGreaterThan(0);

    const names = imports
      .flatMap((m) => m[1].split(','))
      .map((n) => n.trim())
      .filter((n) => n && !n.startsWith('type ') && /^[a-z]/.test(n));
    expect(names).toContain('writePanel');

    const body = source.replace(/^import [\s\S]*?;$/gm, '');
    for (const name of names) {
      expect(new RegExp(`\\b${name}\\s*\\(`).test(body), `${name} is imported but never called`)
        .toBe(true);
    }
  });

  it('writes the panel for a layout that has one', () => {
    // The call is guarded, and the guard has to be the layout asking for a
    // panel rather than anything to do with scenes — they were the same
    // `if` once, and the panel inherited the scene layer's switch.
    expect(source).toMatch(/layoutPlan(?:For)?\(ctx\.style\.layout[\s\S]{0,80}\)\.panel/);
    expect(source).toMatch(/writePanel\(ctx\.transcript, ctx\.media\.durationSec\)/);
  });
});

/**
 * The bug that only exists in the preview.
 *
 * The editor's Player composes on a smaller canvas than the export so a
 * browser can keep up — `PREVIEW_LONG_EDGE` is 720, so a 1080×1920 video
 * previews at 406×720. A component that measures itself against
 * `edl.format` is then wrong by that ratio: the panel's `u` came out 2.7×
 * too big inside a box 2.7× too small, so the eyebrow ran off both edges
 * and a toggle-pair's tiles hung over the sides of the frame.
 *
 * It rendered perfectly at export resolution, which is why nobody caught it
 * — the only place it was wrong was the only place anybody looks.
 */
describe('a component that draws to the canvas', () => {
  const files = [
    'remotion/components/Panel.tsx',
    'remotion/components/VideoTrack.tsx',
    'remotion/components/BrollLayer.tsx',
    'remotion/components/Captions.tsx',
    'remotion/components/Scenes.tsx',
  ];

  it('takes its pixel sizes from useVideoConfig, never from edl.format', () => {
    for (const file of files) {
      const source = readFileSync(join(process.cwd(), file), 'utf8');
      // `edl.format.layout`, `.aspect`, `.fps` and `.durationSec` are facts
      // about the document. `.width` and `.height` are a canvas measurement,
      // and the canvas is not the document.
      const geometry = source.match(/edl\.format\.(width|height)/g) ?? [];
      expect(geometry, `${file} measures itself against the document`).toEqual([]);
    }
  });
});
