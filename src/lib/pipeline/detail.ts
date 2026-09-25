import type { PipelineContext, Stage } from './types';

/**
 * One line per finished stage, saying what it FOUND.
 *
 * ── Why a duration is not enough ────────────────────────────────────────
 *
 * The progress screen used to put the wall-clock beside each finished stage:
 * "Listening to what you said — 4.2s". That tells you the machine was busy,
 * which you could already see from the spinner. What somebody watching this
 * screen for ninety seconds actually wants to know is whether it UNDERSTOOD
 * their video — and "118 words · deepgram nova-3" answers that, where "4.2s"
 * does not. It is also the only place the work is ever visible: by the time
 * the editor opens, eleven stages have collapsed into one finished video.
 *
 * Every line here is read off the context AFTER the stage ran, so it reports
 * what happened rather than what was meant to happen. A stage that produced
 * nothing gets no line rather than a fabricated one — an empty slot is honest
 * and a made-up figure is not, and this screen's whole job is to be believed.
 *
 * Kept out of the stages themselves on purpose: eleven handlers each
 * formatting their own status string is eleven places for the wording to
 * drift, and each one would have to remember to do it at every early return.
 */
export function stageDetail(stage: Stage, c: PipelineContext): string {
  switch (stage) {
    case 'ingest': {
      const m = c.media;
      if (!m) return '';
      return [`${m.width}×${m.height}`, `${m.durationSec.toFixed(1)}s`, m.hasAudio ? 'audio extracted' : 'no audio track']
        .join(' · ');
    }

    case 'transcribe': {
      const t = c.transcript;
      if (!t) return '';
      if (t.degraded) return 'no provider — edited without a transcript';
      return `${t.words.length} words · ${t.provider}`;
    }

    case 'silence': {
      const gaps = c.silenceRemovals ?? [];
      if (!gaps.length) return 'no dead air worth cutting';
      return `${gaps.length} ${plural(gaps.length, 'gap')} · ${secs(total(gaps))} of dead air`;
    }

    case 'cleanup': {
      const found = c.cleanupFindings ?? [];
      if (!found.length) return 'nothing to tidy';
      const by = new Map<string, number>();
      for (const f of found) by.set(f.kind, (by.get(f.kind) ?? 0) + 1);
      return [...by].map(([kind, n]) => `${n} ${plural(n, kind.replace(/[-_]/g, ' '))}`).join(' · ');
    }

    case 'direct': {
      const p = c.plan;
      if (!p) return '';
      const parts = [];
      if (p.hook) parts.push('hook found');
      if (p.broll.length) parts.push(`${p.broll.length} B-roll`);
      if (p.graphics.length) parts.push(`${p.graphics.length} ${plural(p.graphics.length, 'graphic')}`);
      if (p.chapters.length) parts.push(`${p.chapters.length} ${plural(p.chapters.length, 'chapter')}`);
      return parts.length ? parts.join(' · ') : 'kept the footage as filmed';
    }

    case 'timeline': {
      const e = c.edl;
      if (!e) return '';
      return `${e.segments.length} ${plural(e.segments.length, 'segment')} · ${secs(e.format.durationSec)}`;
    }

    case 'reframe': {
      const r = c.edl?.reframe;
      if (!r) return 'kept the original framing';
      const how = { 'face-track': 'subject tracked', saliency: 'framed on the action', center: 'centred', manual: 'framed by hand' }[r.method];
      return `${how} · ${r.keyframes.length} ${plural(r.keyframes.length, 'keyframe')}`;
    }

    case 'assets': {
      const e = c.edl;
      if (!e) return '';
      const parts = [];
      if (e.broll.length) parts.push(`${e.broll.length} B-roll`);
      if (e.sfx.length) parts.push(`${e.sfx.length} sound ${plural(e.sfx.length, 'effect')}`);
      if (e.music) parts.push('music bed');
      return parts.length ? parts.join(' · ') : 'nothing to fetch';
    }

    case 'edl': {
      const e = c.edl;
      if (!e) return '';
      const layers = e.captions.length + e.broll.length + e.graphics.length + e.punchIns.length + e.sfx.length;
      return `${layers} ${plural(layers, 'layer')} · $${c.ledger.totalUsd.toFixed(2)} so far`;
    }

    // `render` and `deliver` run in the renderer rather than here, so they
    // have nothing on this context to read; the render reports its own.
    default:
      return '';
  }
}

const total = (spans: readonly { startSec: number; endSec: number }[]): number =>
  spans.reduce((sum, s) => sum + (s.endSec - s.startSec), 0);

const secs = (n: number): string => `${n.toFixed(1)}s`;

/** Good enough for the words this file actually pluralises. */
const plural = (n: number, word: string): string => (n === 1 ? word : `${word}s`);
