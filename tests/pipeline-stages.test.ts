import { describe, expect, it } from 'vitest';
import { STAGES, STAGE_LABELS, STAGE_WEIGHTS } from '@/lib/pipeline/types';

/**
 * A job produces an EDIT, not a file.
 *
 * Rendering inside the job meant everybody waited for a video before seeing
 * the edit, and the first change they made in the editor threw that video
 * away. The frames are drawn when somebody asks to export.
 */
describe('the stages of a job', () => {
  it('does not render', () => {
    expect(STAGES).not.toContain('render');
  });

  it('ends at the document and the finishing touches', () => {
    expect(STAGES[STAGES.length - 2]).toBe('deliver');
    expect(STAGES[STAGES.length - 1]).toBe('done');
    expect(STAGES.indexOf('edl')).toBe(STAGES.indexOf('deliver') - 1);
  });

  it('still adds up to a full progress bar', () => {
    const total = STAGES.reduce((sum, stage) => sum + STAGE_WEIGHTS[stage], 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it('names every stage it runs', () => {
    for (const stage of STAGES) expect(STAGE_LABELS[stage]).toBeTruthy();
  });
});
