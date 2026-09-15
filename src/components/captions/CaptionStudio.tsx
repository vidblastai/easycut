'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import type { CaptionStyle } from '@/lib/edl/types';
import { CAPTION_ANIMATIONS } from '@/lib/edl/types';
import { CAPTION_PRESETS, captionPresetFor, type CaptionPreset } from '@/lib/captions/presets';
import { CAPTION_FONTS, findCaptionFont } from '@/lib/captions/fonts';
import { loadAllCaptionFonts, preloadCaptionFonts } from '@/lib/captions/web-fonts';
import { CaptionBand, CaptionPreview } from './CaptionPreview';
import { IconCheck } from '@/components/shell/Icons';

/**
 * Choosing what the captions look like.
 *
 * Two levels, deliberately. **Pick a look** is sixteen finished presets, each
 * previewed in the shape the video is actually going out in — that is the whole
 * job for most people, and it is one click. **Make it yours** is underneath for
 * the ones who want to move the type, change the colour or swap the face.
 *
 * The order matters: put the controls first and a person who just wants good
 * captions has to make nine typographic decisions to get them. Put the presets
 * first and the controls become an option rather than a toll.
 *
 * Everything here changes only the caption style. A caption change re-renders
 * from cached analysis — no transcription, no AI call, no re-upload — which is
 * why it is safe to let people play.
 */

const FAMILIES = [
  { id: 'all', label: 'All' },
  { id: 'quiet', label: 'Quiet' },
  { id: 'punchy', label: 'Punchy' },
  { id: 'loud', label: 'Loud' },
  { id: 'editorial', label: 'Editorial' },
] as const;

const ANIMATION_LABELS: Record<string, string> = {
  karaoke: 'Highlight the spoken word',
  'word-pop': 'Words pop in one by one',
  'line-fade': 'The line fades in',
  typewriter: 'Words appear, no motion',
  bounce: 'Words bounce in',
  'word-box': 'A plate follows the spoken word',
  'slide-up': 'The line rises into place',
  'scale-in': 'The line scales up',
  shake: 'Emphasis words jitter',
};

const SAMPLE = 'This is what your captions will look like';

export function CaptionStudio({
  style,
  onChange,
  mode,
  posterUrl,
  sampleText = SAMPLE,
  compact = false,
}: {
  style: CaptionStyle;
  onChange: (next: CaptionStyle) => void;
  /** Drives the preview's shape — a 9:16 look is wrong on a 16:9 preview. */
  mode: 'short' | 'long';
  /** A real frame from the video, so the preview is over the actual footage. */
  posterUrl?: string | null;
  sampleText?: string;
  compact?: boolean;
}) {
  const [family, setFamily] = useState<(typeof FAMILIES)[number]['id']>('all');
  const [tuning, setTuning] = useState(false);

  const current = useMemo(() => captionPresetFor(style), [style]);
  const shown = useMemo(
    () => CAPTION_PRESETS.filter((p) => (family === 'all' ? true : p.family === family)),
    [family],
  );

  // The preset grid needs the faces it is about to draw; the font tab needs
  // all of them, but only once someone opens it.
  useEffect(() => {
    preloadCaptionFonts([style.fontFamily, ...shown.map((p) => p.style.fontFamily)]);
  }, [shown, style.fontFamily]);
  useEffect(() => {
    if (tuning) loadAllCaptionFonts();
  }, [tuning]);

  // The real output size, so the preview is the frame rather than a
  // reinterpretation of it. CaptionPreview scales it to whatever room it has.
  const wide = mode === 'long';
  const frameW = wide ? 1920 : 1080;
  const frameH = wide ? 1080 : 1920;

  const set = (patch: Partial<CaptionStyle>) => onChange({ ...style, ...patch });

  return (
    <div className={clsx('grid gap-6', compact ? '' : 'lg:grid-cols-[auto_minmax(0,1fr)]')}>
      {/* ------------------------------------------------------- the preview */}
      <div className={compact ? '' : 'lg:sticky lg:top-[calc(var(--topbar)+20px)] lg:self-start'}>
        {compact ? (
          // In a 340px inspector the full frame would be the whole panel and
          // the sixteen looks would be below the fold, which inverts what the
          // panel is for. The band shows the same pixels at the same scale in
          // a fifth of the height.
          <CaptionBand
            className="rounded-[14px] border border-line bg-ink"
            style={style}
            text={sampleText}
            frameWidth={frameW}
            frameHeight={frameH}
            aspect="16 / 7"
            backdrop={<Backdrop posterUrl={posterUrl} />}
          />
        ) : (
          <div
            className="overflow-hidden rounded-[18px] border border-line bg-ink"
            style={{ width: wide ? 520 : 300 }}
          >
            <CaptionPreview
              style={style}
              text={sampleText}
              frameWidth={frameW}
              frameHeight={frameH}
              activeWord={1}
              emphasisWord={style.animation === 'shake' ? 2 : -1}
            >
              <Backdrop posterUrl={posterUrl} />
            </CaptionPreview>
          </div>
        )}
        <p className="mt-2.5 text-center text-[11.5px] text-faint">
          {current ? current.name : 'Custom'} · {style.fontFamily} {style.fontWeight}
          {' · '}
          {wide ? '16:9' : '9:16'}
        </p>
      </div>

      {/* ------------------------------------------------------ the choosing */}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="mr-auto text-[15px] font-bold">Pick a look</h3>
          <div className="flex gap-1 rounded-xl bg-charcoal p-1">
            {FAMILIES.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFamily(f.id)}
                aria-pressed={family === f.id}
                className={clsx(
                  'rounded-lg px-2.5 py-1 text-[12px] font-semibold transition-colors',
                  family === f.id ? 'bg-violet text-ink' : 'text-muted hover:text-chalk',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <ul className={clsx('mt-3.5 grid gap-2.5', compact ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3')}>
          {shown.map((preset) => (
            <li key={preset.id}>
              <PresetTile
                preset={preset}
                selected={current?.id === preset.id}
                onSelect={() => onChange(preset.style)}
                frameWidth={frameW}
                frameHeight={frameH}
              />
            </li>
          ))}
        </ul>

        {/* ------------------------------------------------------- the knobs */}
        <button
          type="button"
          onClick={() => setTuning((t) => !t)}
          aria-expanded={tuning}
          className="btn-ghost mt-5 w-full"
        >
          {tuning ? 'Hide the controls' : 'Make it yours'}
        </button>

        {tuning ? (
          <div className="mt-4 space-y-5 rounded-[18px] border border-line bg-charcoal p-5">
            <Field label="Font">
              <div className={clsx('grid gap-1.5', compact ? '' : 'sm:grid-cols-2')}>
                {CAPTION_FONTS.map((font) => (
                  <button
                    key={font.id}
                    type="button"
                    onClick={() =>
                      set({
                        fontFamily: font.id,
                        // A caps-only face renders as caps whatever the flag
                        // says, so the flag follows the face rather than
                        // describing a setting that does nothing.
                        uppercase: font.capsOnly ? true : style.uppercase,
                        fontWeight: nearestWeight(font.weights, style.fontWeight),
                      })
                    }
                    aria-pressed={style.fontFamily === font.id}
                    title={font.vibe}
                    className={clsx(
                      'flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors',
                      style.fontFamily === font.id
                        ? 'border-violet bg-violet-dim'
                        : 'border-line hover:bg-charcoal2',
                    )}
                  >
                    <span
                      className="truncate text-[15px]"
                      style={{ fontFamily: `"${font.id}", sans-serif`, fontWeight: 700 }}
                    >
                      {font.capsOnly ? font.id.toUpperCase() : font.id}
                    </span>
                    {style.fontFamily === font.id ? (
                      <IconCheck className="h-3.5 w-3.5 flex-none text-violet" />
                    ) : null}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Weight">
              <div className="flex flex-wrap gap-1.5">
                {(findCaptionFont(style.fontFamily)?.weights ?? ['700']).map((w) => (
                  <Pill
                    key={w}
                    selected={String(style.fontWeight) === w}
                    onClick={() => set({ fontWeight: Number(w) })}
                  >
                    {w}
                  </Pill>
                ))}
              </div>
            </Field>

            <Slider
              label="Size"
              value={style.fontSizeRatio}
              min={0.028}
              max={0.09}
              step={0.002}
              format={(v) => `${Math.round((v / 0.058) * 100)}%`}
              onChange={(v) => set({ fontSizeRatio: v })}
            />

            <Slider
              label="Height on screen"
              value={style.positionY}
              min={0.12}
              max={0.9}
              step={0.01}
              format={(v) => (v < 0.4 ? 'Top' : v < 0.62 ? 'Middle' : v < 0.82 ? 'Lower' : 'Bottom')}
              onChange={(v) => set({ positionY: v })}
            />

            <Slider
              label="Words at a time"
              value={style.maxWordsPerCue}
              min={1}
              max={9}
              step={1}
              format={(v) => String(v)}
              onChange={(v) => set({ maxWordsPerCue: v })}
            />

            <Field label="Colour">
              <div className="flex flex-wrap items-center gap-4">
                <Swatch
                  label="Text"
                  value={style.color}
                  onChange={(color) => set({ color, gradient: null })}
                />
                <Swatch
                  label="Highlight"
                  value={style.activeColor ?? style.emphasisColor}
                  onChange={(c) => set({ emphasisColor: c, activeColor: c })}
                />
                {style.background ? (
                  <Swatch
                    label="Plate"
                    value={hexOf(style.background.color)}
                    onChange={(c) =>
                      set({ background: { ...style.background!, color: withAlpha(c, style.background!.color) } })
                    }
                  />
                ) : null}
              </div>
            </Field>

            <Field label="Alignment">
              <div className="flex gap-1.5">
                {(['left', 'center', 'right'] as const).map((a) => (
                  <Pill key={a} selected={style.align === a} onClick={() => set({ align: a })}>
                    {a[0].toUpperCase() + a.slice(1)}
                  </Pill>
                ))}
              </div>
            </Field>

            <Field label="Motion">
              <div className={clsx('grid gap-1.5', compact ? '' : 'sm:grid-cols-2')}>
                {CAPTION_ANIMATIONS.map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => set({ animation: a })}
                    aria-pressed={style.animation === a}
                    className={clsx(
                      'rounded-xl border px-3 py-2 text-left text-[12.5px] transition-colors',
                      style.animation === a
                        ? 'border-violet bg-violet-dim text-chalk'
                        : 'border-line text-muted hover:bg-charcoal2 hover:text-chalk',
                    )}
                  >
                    {ANIMATION_LABELS[a] ?? a}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Extras">
              <div className="flex flex-wrap gap-1.5">
                <Pill
                  selected={style.uppercase}
                  disabled={findCaptionFont(style.fontFamily)?.capsOnly}
                  onClick={() => set({ uppercase: !style.uppercase })}
                >
                  ALL CAPS
                </Pill>
                <Pill
                  selected={Boolean(style.background)}
                  onClick={() =>
                    set({
                      background: style.background
                        ? null
                        : { color: 'rgba(13,13,16,0.72)', padding: 18, radius: 14 },
                    })
                  }
                >
                  Plate behind
                </Pill>
                <Pill
                  selected={Boolean(style.stroke)}
                  onClick={() => set({ stroke: style.stroke ? null : { width: 7, color: '#000000' } })}
                >
                  Outline
                </Pill>
                <Pill
                  selected={Boolean(style.shadow)}
                  onClick={() =>
                    set({
                      shadow: style.shadow ? null : { offsetX: 0, offsetY: 4, blur: 24, color: 'rgba(0,0,0,0.55)' },
                    })
                  }
                >
                  Shadow
                </Pill>
                <Pill selected={style.italic} onClick={() => set({ italic: !style.italic })}>
                  Italic
                </Pill>
              </div>
            </Field>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- pieces */

function PresetTile({
  preset,
  selected,
  onSelect,
  frameWidth,
  frameHeight,
}: {
  preset: CaptionPreset;
  selected: boolean;
  onSelect: () => void;
  frameWidth: number;
  frameHeight: number;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      title={preset.blurb}
      className={clsx(
        'flex w-full flex-col overflow-hidden rounded-[14px] border text-left transition-colors',
        selected ? 'border-violet' : 'border-line hover:border-line/60',
      )}
    >
      {/* A full 9:16 frame would make every tile 400px tall and the grid
          unscannable, so the tile is a window onto the band where this style's
          captions actually sit. The percentage translate is relative to the
          frame's own height, so `-78%` puts positionY 0.78 on the tile's
          centre line — the crop follows the style rather than assuming the
          middle. */}
      {/* The backdrop belongs to the window rather than the cropped frame: a
          band cut out of one gradient is a flat grey, and the whole reason to
          show a backdrop is to judge whether the type survives a busy one. */}
      <CaptionBand
        className="block bg-[#101015]"
        style={preset.style}
        text="Captions that look good"
        frameWidth={frameWidth}
        frameHeight={frameHeight}
        backdrop={<Backdrop posterUrl={null} />}
      />
      <span
        className={clsx(
          'flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold',
          selected ? 'bg-violet-dim text-chalk' : 'bg-charcoal text-muted',
        )}
      >
        {preset.name}
        {selected ? <IconCheck className="ml-auto h-3.5 w-3.5 text-violet" /> : null}
      </span>
    </button>
  );
}

/**
 * What sits behind the captions when there is no frame yet.
 *
 * Not a flat colour: captions are designed to survive busy footage, and a look
 * chosen against an even grey will disappoint the first time it lands on a
 * bright window behind someone's head.
 */
function Backdrop({ posterUrl }: { posterUrl?: string | null }) {
  if (posterUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={posterUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
    );
  }
  return (
    <span
      className="absolute inset-0"
      style={{
        background:
          'radial-gradient(120% 90% at 22% 18%, #4a4a63 0%, #26263a 42%, #121218 100%), linear-gradient(200deg, rgba(155,123,255,0.18), transparent 60%)',
      }}
      aria-hidden
    />
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="eyebrow mb-2">{label}</p>
      {children}
    </div>
  );
}

function Pill({
  selected,
  onClick,
  disabled,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={clsx(
        'rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-40',
        selected ? 'border-violet bg-violet-dim text-chalk' : 'border-line text-muted hover:text-chalk',
      )}
    >
      {children}
    </button>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const id = `cap-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <label htmlFor={id} className="eyebrow">
          {label}
        </label>
        <span className="text-[12px] tabular-nums text-muted">{format(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-line accent-violet"
      />
    </div>
  );
}

function Swatch({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  const id = `cap-color-${label.toLowerCase()}`;
  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor={id}
        className="h-7 w-7 cursor-pointer rounded-lg border border-line"
        style={{ background: value }}
      />
      <label htmlFor={id} className="cursor-pointer text-[12.5px] text-muted">
        {label}
      </label>
      <input
        id={id}
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="sr-only"
      />
    </div>
  );
}

/* --------------------------------------------------------------- helpers */

/** The closest weight the chosen family actually ships. */
function nearestWeight(weights: string[], want: number): number {
  return Number(
    weights.reduce((best, w) => (Math.abs(Number(w) - want) < Math.abs(Number(best) - want) ? w : best), weights[0]),
  );
}

/** `<input type="color">` speaks hex only, so an rgba() plate has to be reduced. */
function hexOf(color: string): string {
  if (color.startsWith('#')) return color.slice(0, 7);
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m) return '#000000';
  const [r, g, b] = m[1].split(',').map((n) => Number(n.trim()));
  return `#${[r, g, b].map((n) => Math.max(0, Math.min(255, n | 0)).toString(16).padStart(2, '0')).join('')}`;
}

/** Put a new hex into an existing colour without losing its transparency. */
function withAlpha(hex: string, previous: string): string {
  const m = previous.match(/rgba\(([^)]+)\)/);
  const alpha = m ? Number(m[1].split(',')[3] ?? 1) : 1;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return alpha >= 1 ? hex : `rgba(${r},${g},${b},${alpha})`;
}
