'use client';

import React, { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { CAPTION_FONTS } from '@/lib/captions/fonts';
import { fontStackFor } from '@/lib/captions/fonts';
import type { CaptionCue, CaptionStyle, CaptionWordStyle, Edl } from '@/lib/edl/types';
import type { EdlOperation } from '@/lib/edl/operations';

/**
 * Style one word differently from the rest of its line.
 *
 * ── The shape of this is the whole point ────────────────────────────────
 *
 * The thing people want is "make THAT word blue". Not "open a panel, find the
 * caption track, locate cue 14, expand it, select word 3". So the words of the
 * caption under the playhead are printed here as they read, and you click the
 * one you mean. Tapping a colour applies it immediately — no Apply step —
 * because the preview beside it is already live and a change you have to
 * confirm is a change you cannot see while deciding.
 *
 * Everything is a patch. Setting a colour leaves a font chosen a minute ago
 * alone, and "Reset" is the one control that clears the lot — so experimenting
 * is free and nothing accumulates invisibly.
 */

/**
 * Whole looks, in one tap.
 *
 * ── Why these exist alongside the individual knobs ──────────────────────
 *
 * The look people actually point at — a heavy line interrupted by one word in
 * a brush script, bigger, slanted, glowing, overlapping the line above — is
 * six separate decisions: face, gradient, size, slant, glow, nudge. Offering
 * only the six knobs means the look is reachable in principle and reached by
 * nobody, because you have to already know the recipe.
 *
 * Each of these IS the recipe. The knobs underneath stay, for adjusting one
 * afterwards.
 *
 * Every field is spelled out rather than left to fall through, so tapping a
 * second look REPLACES the first cleanly instead of inheriting half of it.
 */
const LOOKS: Array<{ id: string; label: string; hint: string; style: CaptionWordStyle }> = [
  {
    id: 'script-pop',
    label: 'Script pop',
    hint: 'Brush script, cyan, tucked under the line',
    style: {
      fontFamily: 'Yellowtail',
      // Sampled off the reference frame: deeper blue at the top, bright cyan
      // at the bottom. The direction matters — flipped, it reads as a puddle
      // rather than as light coming from above.
      gradient: { from: '#2AB9FB', to: '#24F6FF', angle: 180 },
      glow: { color: 'rgba(42,214,255,0.55)', blur: 26 },
      /*
       * LOWERCASE, whatever the line says.
       *
       * A brush script is made of the strokes that join lowercase letters.
       * Capitals have none of them, so a script word set in caps is a row of
       * disconnected shapes — it was the single biggest reason the first
       * attempt at this look did not match its reference.
       */
      uppercase: false,
      /* 1.35, not 1.7. A script face is much wider per letter than the
         condensed caps beside it, and at 1.7 an eight-letter word is wider
         than the frame. The renderer clamps anything that would overflow, but
         a value that is CONSTANTLY being clamped is a value that lies about
         what you will get. */
      scale: 1.35,
      rotate: null,
      /* A script sits on its own slanted baseline, so it rides UP into the
         line above to look tucked in rather than dropped below. */
      offsetY: -0.12,
      italic: null,
      color: null,
      fontWeight: null,
      box: null,
    },
  },
  {
    id: 'chrome',
    label: 'Chrome',
    hint: 'Silver fade, same face, same size',
    style: {
      gradient: { from: '#FFFFFF', to: '#8E9AAF', angle: 180 },
      fontFamily: null, glow: null, scale: null, rotate: null, uppercase: null,
      offsetY: null, italic: null, color: null, fontWeight: null, box: null,
    },
  },
  {
    id: 'marker',
    label: 'Marker',
    hint: 'Handwritten, tilted, in the accent colour',
    style: {
      fontFamily: 'Caveat',
      fontWeight: 700,
      scale: 1.55,
      rotate: -4,
      offsetY: -0.06,
      gradient: null, glow: null, italic: null, color: null, box: null, uppercase: null,
    },
  },
  {
    id: 'sticker',
    label: 'Sticker',
    hint: 'On its own plate, straight',
    style: {
      box: { color: '#9B7BFF', padding: 10, radius: 12 },
      color: '#0D0D10',
      scale: 1.1,
      fontFamily: null, gradient: null, glow: null, rotate: null, uppercase: null,
      offsetY: null, italic: null, fontWeight: null,
    },
  },
];

/** The presets people reach for, and the reason there is no colour wheel here. */
const QUICK_COLORS = [
  { label: 'Accent', value: null },
  { label: 'Blue', value: '#2E9BFF' },
  { label: 'Cyan', value: '#22D3EE' },
  { label: 'Violet', value: '#9B7BFF' },
  { label: 'Lime', value: '#A3E635' },
  { label: 'Amber', value: '#FBBF24' },
  { label: 'Red', value: '#F43F5E' },
  { label: 'White', value: '#FFFFFF' },
];

/** Two-stop fills, which is what the "chrome / glow" look actually is. */
const QUICK_GRADIENTS = [
  { label: 'Sky', from: '#7DD3FC', to: '#2563EB' },
  { label: 'Chrome', from: '#FFFFFF', to: '#8E9AAF' },
  { label: 'Sunset', from: '#FDE68A', to: '#F43F5E' },
  { label: 'Mint', from: '#A7F3D0', to: '#059669' },
];

function WordStylerImpl({
  edl,
  style,
  playheadSec,
  onCommit,
  busy = false,
}: {
  edl: Edl;
  style: CaptionStyle;
  /** Which caption is on screen — the one whose words are offered. */
  playheadSec: number;
  onCommit: (operations: EdlOperation[]) => void;
  busy?: boolean;
}) {
  const [selected, setSelected] = useState<number | null>(null);

  /*
   * The cue under the playhead, or the next one along.
   *
   * Falling forward matters: park the playhead in a gap between captions and a
   * strict "which cue contains this instant" returns nothing, so the panel
   * empties and the feature looks broken at exactly the moment somebody is
   * hunting for a word.
   */
  const cue: CaptionCue | null = useMemo(() => {
    if (!edl.captions.length) return null;
    const here = edl.captions.find((c) => playheadSec >= c.startSec && playheadSec < c.endSec);
    if (here) return here;
    return edl.captions.find((c) => c.startSec >= playheadSec) ?? edl.captions.at(-1) ?? null;
  }, [edl.captions, playheadSec]);

  if (!cue) {
    return (
      <p className="text-[12.5px] leading-relaxed text-muted">
        No captions on this video yet. They appear once the edit has run.
      </p>
    );
  }

  const word = selected != null ? cue.words[selected] : null;
  const current: CaptionWordStyle | null | undefined = word?.style;

  const patch = (next: CaptionWordStyle | null) => {
    if (selected == null) return;
    onCommit([{ op: 'caption.wordStyle', id: cue.id, wordIndex: selected, style: next }]);
  };

  return (
    <div>
      <h3 className="mb-1 text-[14px] font-bold">This line</h3>
      <p className="mb-3 text-[12px] leading-relaxed text-muted">
        Tap a word, then give it its own colour, face or size. Everything else stays as it is.
      </p>

      {/* The line as it reads, so the word you want is the word you click. */}
      <div className="flex flex-wrap gap-1.5">
        {cue.words.map((w, i) => {
          const styled = Boolean(w.style);
          return (
            <button
              key={`${cue.id}-${i}`}
              type="button"
              onClick={() => setSelected(i === selected ? null : i)}
              className={clsx(
                'rounded-[7px] px-2 py-1 text-[13px] font-semibold transition-colors',
                i === selected
                  ? 'bg-violet text-ink'
                  : styled
                    ? 'bg-violet-dim text-chalk'
                    : 'bg-charcoal text-muted hover:text-chalk',
              )}
              style={
                // A styled word previews its own colour in the list, so you can
                // see what you have already done without hunting for it.
                i !== selected && w.style?.color ? { color: w.style.color } : undefined
              }
            >
              {style.uppercase ? w.text.toUpperCase() : w.text}
            </button>
          );
        })}
      </div>

      {word ? (
        <div className="mt-4 space-y-3.5 border-t border-line-soft pt-3.5">
          <Row label="Look">
            {LOOKS.map((l) => (
              <button
                key={l.id}
                type="button"
                disabled={busy}
                title={l.hint}
                onClick={() => patch(l.style)}
                className="rounded-lg bg-charcoal px-2.5 py-1 text-[12px] font-semibold text-muted transition-colors hover:bg-violet-dim hover:text-chalk"
              >
                {l.label}
              </button>
            ))}
          </Row>

          <Row label="Colour">
            {QUICK_COLORS.map((c) => (
              <button
                key={c.label}
                type="button"
                disabled={busy}
                title={c.label}
                onClick={() => patch({ color: c.value, gradient: null })}
                className={clsx(
                  'h-6 w-6 rounded-full border transition-transform hover:scale-110',
                  (current?.color ?? null) === c.value && !current?.gradient
                    ? 'border-chalk'
                    : 'border-line',
                )}
                style={{
                  // "Accent" is the line's own highlight colour, so the swatch
                  // shows what it will actually be rather than a grey blank.
                  background: c.value ?? style.emphasisColor,
                }}
              />
            ))}
          </Row>

          <Row label="Gradient">
            {QUICK_GRADIENTS.map((g) => (
              <button
                key={g.label}
                type="button"
                disabled={busy}
                title={g.label}
                onClick={() => patch({ gradient: { from: g.from, to: g.to, angle: 180 }, color: null })}
                className={clsx(
                  'h-6 w-9 rounded-md border transition-transform hover:scale-105',
                  current?.gradient?.from === g.from ? 'border-chalk' : 'border-line',
                )}
                style={{ background: `linear-gradient(180deg, ${g.from}, ${g.to})` }}
              />
            ))}
          </Row>

          <Row label="Face">
            <select
              disabled={busy}
              value={current?.fontFamily ?? ''}
              onChange={(e) => patch({ fontFamily: e.target.value || null })}
              className="w-full rounded-lg border border-line bg-charcoal px-2.5 py-1.5 text-[12.5px] text-chalk"
              style={current?.fontFamily ? { fontFamily: fontStackFor(current.fontFamily) } : undefined}
            >
              <option value="">Same as the line</option>
              {CAPTION_FONTS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.id}
                </option>
              ))}
            </select>
          </Row>

          <Row label="Size">
            {[
              { label: 'Normal', value: null },
              { label: 'Bigger', value: 1.25 },
              { label: 'Huge', value: 1.6 },
            ].map((s) => (
              <Chip
                key={s.label}
                on={(current?.scale ?? null) === s.value}
                disabled={busy}
                onClick={() => patch({ scale: s.value })}
              >
                {s.label}
              </Chip>
            ))}
          </Row>

          <Row label="Slant">
            {[
              { label: 'Straight', rotate: null, italic: null },
              { label: 'Italic', rotate: null, italic: true },
              { label: 'Tilted', rotate: -6, italic: true },
            ].map((s) => (
              <Chip
                key={s.label}
                on={(current?.rotate ?? null) === s.rotate && (current?.italic ?? null) === s.italic}
                disabled={busy}
                onClick={() => patch({ rotate: s.rotate, italic: s.italic })}
              >
                {s.label}
              </Chip>
            ))}
          </Row>

          <Row label="Nudge">
            {[
              { label: 'In line', value: null },
              { label: 'Up', value: -0.12 },
              { label: 'Down', value: 0.12 },
            ].map((s) => (
              <Chip
                key={s.label}
                on={(current?.offsetY ?? null) === s.value}
                disabled={busy}
                onClick={() => patch({ offsetY: s.value })}
              >
                {s.label}
              </Chip>
            ))}
          </Row>

          {current ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => patch(null)}
              className="btn-ghost w-full py-2 text-[12.5px]"
            >
              Reset this word
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="eyebrow mb-1.5 block text-faint">{label}</span>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

function Chip({
  on,
  disabled,
  onClick,
  children,
}: {
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'rounded-lg px-2.5 py-1 text-[12px] font-semibold transition-colors',
        on ? 'bg-violet text-ink' : 'bg-charcoal text-muted hover:text-chalk',
      )}
    >
      {children}
    </button>
  );
}


/*
 * Memoised. The editor's top-level component re-renders for reasons that have
 * nothing to do with this panel — a poll landing, a playhead crossing a
 * caption — and this is heavy enough that re-rendering it for free is not
 * free at all.
 */
export const WordStyler = React.memo(WordStylerImpl);
