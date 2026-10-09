import { describe, expect, it, vi, afterEach } from 'vitest';
import type { PanelScene } from '@/lib/edl/types';

/**
 * The panel's exhibits are drawn, not chosen.
 *
 * Eight React components with a model picking between them is a template
 * library: twenty exhibits in a video are the same eight animations with
 * different words in them, and the next upload is the same eight again. This
 * pass is what makes an exhibit specific to the sentence it sits over, so
 * what it has to get right is the failure modes — every one of them falls
 * back to the template, silently, and a panel that quietly stops being drawn
 * looks exactly like the thing this replaced.
 */

function scene(id: string, reason: string): PanelScene {
  return {
    id, outStartSec: 0, outEndSec: 2, kind: 'list-panel',
    eyebrow: ['THE EDIT', 'IN PROGRESS'] as [string, string], chip: '', items: ['a', 'b'],
    values: [], figure: '', label: '', icons: [], iconSvgs: [], imageUrl: '',
    imagePrompt: '', winner: -1, art: null, reason,
  } as unknown as PanelScene;
}

const SVG = (tint: string) =>
  `<svg viewBox="0 0 1000 756" xmlns="http://www.w3.org/2000/svg">` +
  `<desc data-stage="0">The bar fills.</desc>` +
  [0, 1, 2, 3].map((i) =>
    `<g data-stage="0" data-depth="0.${i + 2}" data-enter="rise" data-idle="bob">` +
    [0, 1, 2, 3, 4, 5].map((j) =>
      `<rect x="${60 + j * 40}" y="${80 + i * 90}" width="${160 + j}" height="40" rx="8" fill="${tint}"/>`,
    ).join('') + `</g>`,
  ).join('') + `</svg>`;

function reply(content: string, usage = { prompt_tokens: 900, completion_tokens: 4000 }) {
  return { ok: true, json: async () => ({ choices: [{ message: { content } }], usage }) };
}

async function drawWith(responder: (call: number) => unknown, scenes: PanelScene[]) {
  vi.resetModules();
  let call = 0;
  const fetchMock = vi.fn(async () => {
    const answer = responder(++call);
    if (answer instanceof Error) throw answer;
    return answer;
  });
  vi.stubGlobal('fetch', fetchMock as never);
  vi.stubEnv('WAVESPEED_API_KEY', 'test-key');
  vi.stubEnv('MOTION_MODEL', 'anthropic/claude-opus-5.5');
  const { drawPanel } = await import('@/lib/director/panel-art');
  return { result: await drawPanel(scenes, '#C96442'), calls: () => fetchMock.mock.calls.length };
}

describe('drawing the panel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('draws every exhibit in the batch', async () => {
    const scenes = [scene('a', 'one'), scene('b', 'two'), scene('c', 'three')];
    const { result } = await drawWith(
      () => reply(SVG('#15151A') + '\n' + SVG('#8C8C98') + '\n' + SVG('#2E9E5B')),
      scenes,
    );
    expect([...result.drawn.keys()].sort()).toEqual(['a', 'b', 'c']);
    expect(result.costUsd).toBeGreaterThan(0);
  });

  it('keeps the drawings that did arrive when the last one ran out of tokens', async () => {
    // Split on the `<svg>` tags rather than a JSON envelope, so a truncated
    // final drawing costs that one exhibit and not the whole reply.
    const scenes = [scene('a', 'one'), scene('b', 'two'), scene('c', 'three')];
    const { result } = await drawWith(
      () => reply(SVG('#15151A') + '\n' + SVG('#8C8C98') + '\n<svg viewBox="0 0 1000 756"><g data-stage="0"><rect'),
      scenes,
    );
    expect([...result.drawn.keys()].sort()).toEqual(['a', 'b']);
  });

  it('tries a dropped connection again', async () => {
    // Eight of twenty exhibits fell back to a template on one real run
    // because two batches returned `fetch failed` and nothing retried.
    const scenes = [scene('a', 'one')];
    const { result, calls } = await drawWith(
      (n) => (n === 1 ? new TypeError('fetch failed') : reply(SVG('#15151A'))),
      scenes,
    );
    expect(calls()).toBe(2);
    expect(result.drawn.has('a')).toBe(true);
  });

  it('does not try a refusal again', async () => {
    const scenes = [scene('a', 'one')];
    const { result, calls } = await drawWith(
      () => ({ ok: false, status: 400, statusText: 'Bad Request', json: async () => ({ error: { message: 'bad model' } }) }),
      scenes,
    );
    expect(calls()).toBe(1);
    expect(result.drawn.size).toBe(0);
    expect(result.errors[0]).toContain('bad model');
  });

  it('gives up quietly rather than failing the edit', async () => {
    const scenes = [scene('a', 'one')];
    const { result } = await drawWith(() => new TypeError('fetch failed'), scenes);
    expect(result.drawn.size).toBe(0);
    expect(result.errors).toHaveLength(1);
  });

  it('refuses a drawing too sparse to be one', async () => {
    const scenes = [scene('a', 'one')];
    const { result } = await drawWith(
      () => reply('<svg viewBox="0 0 1000 756"><g data-stage="0"><rect x="0" y="0" width="10" height="10" fill="#000"/></g></svg>'),
      scenes,
    );
    expect(result.drawn.size).toBe(0);
  });

  it('says nothing and spends nothing when there is no model', async () => {
    vi.resetModules();
    vi.stubEnv('WAVESPEED_API_KEY', '');
    const { drawPanel } = await import('@/lib/director/panel-art');
    const result = await drawPanel([scene('a', 'one')], '#C96442');
    expect(result.costUsd).toBe(0);
    expect(result.errors).toEqual(['no motion model configured']);
  });
});
