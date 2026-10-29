import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  auditComposition,
  buildCompositionHtml,
  COMPOSITION_ID,
  isFatal,
  parseComposition,
  safeZone,
  systemPrompt,
  type CompositionParts,
} from '@/lib/director/hyperframe';
import { sceneHasText, sceneIsDrawn, type AnimatedScene } from '@/lib/edl/types';

const FIXTURES = ['drafts', 'everywhere', 'hours', 'neurons'];
const read = (name: string) => readFileSync(`tests/fixtures/hyperframes/${name}.txt`, 'utf8');
const fixture = read('drafts');
const frame = { width: 1080, height: 1920, durationSec: 4.5, ground: '#FCFCFD', words: [{ text: 'buzzes', atSec: 0.4 }] };

const scene = (over: Partial<AnimatedScene> = {}): AnimatedScene => ({
  id: 'sc1', outStartSec: 4, outEndSec: 8, kind: 'kinetic-text', look: 'studio', backdrop: 'auto',
  headline: 'You do not need a team', items: [], iconQueries: [], iconSvgs: [], photoUrls: [], art: null,
  clipUrl: null, accent: '#9B7BFF', reason: '', enter: null, exit: null, ...over,
});

describe('parsing what the model returns', () => {
  it('finds the three blocks in every hand-written fixture', () => {
    for (const name of FIXTURES) {
      const parts = parseComposition(read(name));
      expect(parts, name).not.toBeNull();
      expect(parts!.script, name).toContain('tl.');
    }
    const parts = parseComposition(fixture)!;
    expect(parts.style).toContain('#pool');
    expect(parts.markup.startsWith('<div id="scene">')).toBe(true);
    expect(parts.script).toContain('tl.fromTo');
  });

  it('reads through a code fence and a sentence of preamble', () => {
    const parts = parseComposition('Here it is:\n```html\n' + fixture + '\n```');
    expect(parts?.script).toContain('tl.fromTo');
  });

  it('refuses a reply with no scene or no script', () => {
    expect(parseComposition('<style></style><div id="scene"></div>')).toBeNull();
    expect(parseComposition('<script>tl.to("#a", {x: 1}, 0)</script>')).toBeNull();
  });
});

describe('the audit', () => {
  const parts = parseComposition(fixture)!;
  const broken = (over: Partial<CompositionParts>) => auditComposition({ ...parts, ...over });

  it('passes every fixture clean', () => {
    for (const name of FIXTURES) expect(auditComposition(parseComposition(read(name))!), name).toEqual([]);
  });

  it('catches words on screen, which the captions own', () => {
    const problems = broken({ markup: parts.markup.replace('<div id="cards">', '<div id="cards"><svg><text>Focus</text></svg>') });
    expect(problems.some((p) => p.includes('SVG text'))).toBe(true);
    expect(problems.some((p) => p.includes('puts words on screen'))).toBe(true);
    expect(problems.every(isFatal)).toBe(true);
  });

  it('catches anything that would make two renders differ', () => {
    for (const bad of ['Math.random()', 'Date.now()', 'setTimeout(f, 10)', 'tl.to("#a", {x: 1, repeat: -1}, 0)', 'gsap.timeline()']) {
      expect(broken({ script: parts.script + '\n' + bad }).length, bad).toBeGreaterThan(0);
    }
  });

  it('catches anything that reaches the network', () => {
    expect(broken({ markup: parts.markup + '<img src="https://x/y.png">' }).length).toBeGreaterThan(0);
    expect(broken({ style: '@import url("https://fonts/x.css");' }).length).toBeGreaterThan(0);
  });

  it('treats a thin composition as weak, not fatal', () => {
    const problems = broken({ script: 'tl.to("#cam", {scale: 1.1, duration: 4}, 0);' });
    expect(problems).toHaveLength(1);
    expect(isFatal(problems[0])).toBe(false);
  });
});

describe('the page HyperFrames renders', () => {
  const html = buildCompositionHtml(parseComposition(fixture)!, frame);

  it('inlines GSAP rather than reaching for a CDN', () => {
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).toContain('gsap');
  });

  it('registers the timeline after the model has added to it', () => {
    expect(html.indexOf('tl.fromTo')).toBeLessThan(html.indexOf(`window.__timelines["${COMPOSITION_ID}"] = tl`));
  });

  it('pads the timeline to the scene, and sizes the root to the frame', () => {
    expect(html).toContain('tl.set({}, {}, DURATION)');
    expect(html).toContain('data-duration="4.5"');
    expect(html).toContain('data-width="1080" data-height="1920"');
  });

  it('hands the model its word timings', () => {
    expect(html).toContain('"text":"buzzes","atSec":0.4');
  });
});

describe('the prompt', () => {
  it('names the caption band in the frame it is writing for', () => {
    expect(systemPrompt(1080, 1920, 4)).toContain('y 1056–1440');
    expect(systemPrompt(1920, 1080, 4)).toContain('y 594–810');
  });

  it('keeps a vertical shot inside the platforms\' safe area, button column included', () => {
    expect(safeZone(1080, 1920)).toEqual({ left: 60, right: 1020, top: 220, bottom: 1520, notchTop: 1020, notchRight: 900 });
    const prompt = systemPrompt(1080, 1920, 4);
    expect(prompt).toContain('x 60–1020, y 220–1520, and below y 1020 only up to x 900');
    // A decision, not a quota: no layout is required and the space used is chosen.
    expect(prompt).toContain('DECIDE the layout');
    expect(prompt).not.toContain('at least 70%');
    expect(prompt).toContain('**Stack**');
    // A landscape frame has no platform overlay, just a margin.
    expect(safeZone(1920, 1080)).toMatchObject({ left: 115, top: 86, notchRight: 1805 });
  });
});

describe('a scene that arrived as a clip', () => {
  it('counts as drawn, so the captions stay on over it', () => {
    const composed = scene({ clipUrl: 'https://cdn/scene.mp4' });
    expect(sceneIsDrawn(composed)).toBe(true);
    expect(sceneHasText(composed)).toBe(false);
  });

  it('never replaces a photo scene', () => {
    expect(sceneIsDrawn(scene({ kind: 'photo-hero', items: ['boot'], clipUrl: 'https://cdn/scene.mp4' }))).toBe(false);
  });
});
