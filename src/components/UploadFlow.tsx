'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import { StylePreview } from '@/components/styles/StylePreview';
import { detectFormat, probeInBrowser, type Detected } from '@/lib/styles/detect';
import type { BrollOverlay, ClipTransition, Layout } from '@/lib/edl/types';
import { layoutPlan } from '@/lib/styles/layouts';
import { IconArrowRight, IconCheck } from '@/components/shell/Icons';
import { Stepper, type StepKey } from '@/components/shell/Stepper';
import { readDefaultCaptionPreset } from '@/lib/captions/default-preset';
import { CaptionPicker } from '@/components/captions/CaptionPicker';
import { takePendingUpload } from '@/lib/ui/pending-upload';
import { ScenePicker } from '@/components/scenes/ScenePicker';
import { TransitionPicker } from '@/components/transitions/TransitionPicker';
import { BrollSourcePicker } from '@/components/broll/BrollSourcePicker';
import { brollShapeFor, priceBrollRate, waitForBrollRate, type BrollSourceRate } from '@/lib/assets/ai-broll';
import { OverlayPicker } from '@/components/broll/OverlayPicker';
import type { BrollSource } from '@/lib/assets/ai-broll';

/**
 * The upload wizard: one question per screen.
 *
 * The previous version stacked five sections on one page. Everything was
 * visible, which sounds like a virtue and is not — a person who has never
 * edited a video opened it and saw five decisions they did not know how to
 * make, all at once, with the submit button greyed out at the bottom for a
 * reason that was three screens up. One question at a time turns the same
 * five decisions into a conversation, and each screen can afford to explain
 * itself because it is the only thing on the page.
 *
 * Every question has a working default, so the only one that can actually
 * block the wizard is the file.
 */

interface StyleOption {
  id: string;
  name: string;
  tagline: string;
  bestFor: string;
  accent: string;
  layout: Layout;
  formats: ('short' | 'long')[];
  /** The treatment this style gives its inserts — see BROLL_OVERLAYS. */
  /** One treatment, or the short list a style cycles through its inserts. */
  brollOverlay: BrollOverlay | BrollOverlay[];
  /** Whether the preview should draw a title card — see `leadsWithCards`. */
  chapterCards?: { short: boolean; long: boolean };
  /** How often this style cuts away, per format. Prices the B-roll source. */
  brollPacing?: {
    short: { everySec: number; durationSec: [number, number] };
    long: { everySec: number; durationSec: [number, number] };
  };
}

interface FormatOption {
  mode: 'short' | 'long';
  label: string;
  description: string;
  aspect: string;
  maxDurationSec: number;
  platforms: string[];
}

/**
 * The layers a person can decline before anything is made.
 *
 * These existed already, as switches on a finished video — turn one off and it
 * re-renders from cached analysis for nothing. Which is fine, and is not the
 * same as being asked. Somebody who knows they never want music should not have
 * to watch a video get scored and then unscore it.
 */
const LAYERS = [
  { key: 'captions', label: 'Captions', body: 'Word by word, timed to the syllable.' },
  { key: 'broll', label: 'B-roll', body: 'Real footage cut in where you name something concrete.' },
  { key: 'graphics', label: 'Graphics', body: 'Stat cards, lists and icons for the numbers you say.' },
  { key: 'icons', label: 'Icon cards', body: 'When you name a thing — a deadline, a phone, a banana — a small illustrated icon of it slides up on the word and fades.' },
  { key: 'scenes', label: 'Animated scenes', body: 'Where you explain something with a shape — steps, a before and after, a figure — the picture becomes a full-screen animation of it.' },
  { key: 'sfx', label: 'Sound effects', body: 'Whooshes on the cuts, pops on the graphics.' },
  { key: 'punchIns', label: 'Punch-ins', body: 'A second camera that pushes in on your point.' },
  { key: 'annotations', label: 'Notes beside you', body: 'Lists you say out loud, ticked off next to your head while you keep talking.' },
  { key: 'music', label: 'Music', body: 'A bed that ducks under your voice and lifts between lines.' },
] as const;

type LayerKey = (typeof LAYERS)[number]['key'];

type Phase = 'choose' | 'uploading' | 'starting';

/**
 * Two decisions, and dropping the file in is not one of them.
 *
 * The file is how you start, not something you decide — numbering it pushed the
 * first real choice to position two and made the whole thing read as longer
 * than it is. So the drop lives at the top of the first question, and the
 * question is the style.
 *
 * "Where is it going?" is gone for a different reason: it asked about
 * distribution when what it needed was a fact about the file — nobody shoots
 * vertical for YouTube — and it asked it before the person had seen anything to
 * choose between. The footage answers it, and the answer decides which styles
 * are even worth showing.
 */
const QUESTIONS = ['style', 'edits'] as const;

/** Which of the four steps each question belongs to. */
const STEP_OF: Record<Question, StepKey> = { style: 'style', edits: 'edits' };
type Question = (typeof QUESTIONS)[number];

export function UploadFlow({
  styles,
  formats,
  brollRates,
}: {
  styles: StyleOption[];
  formats: FormatOption[];
  /** What each source charges — see `brollSourceRates`. Multiplied below. */
  brollRates: BrollSourceRate[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [at, setAt] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [detected, setDetected] = useState<Detected | null>(null);
  /*
   * Read off the file, never chosen.
   *
   * Vertical footage is edited vertical for Reels, TikTok and Shorts;
   * widescreen footage is edited widescreen for YouTube. Two pipelines, and a
   * file belongs to exactly one of them — so there is no override here. The
   * value below is still only this browser's guess: the server re-measures
   * with ffprobe in `stageIngest` and that measurement is what gets built.
   */
  const mode = detected?.mode ?? 'short';
  const [styleId, setStyleId] = useState(styles[0]?.id ?? 'clean');
  const [inputMode, setInputMode] = useState<'raw' | 'roughcut'>('raw');
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>(
    () => Object.fromEntries(LAYERS.map((l) => [l.key, true])) as Record<LayerKey, boolean>,
  );
  /**
   * The caption look, chosen here rather than discovered afterwards.
   *
   * Null means "whatever the edit style picks", which is what it always did.
   * Seeded from this browser's saved default so somebody who set one in the
   * caption gallery does not have to choose it again on every upload.
   */
  const [captionPreset, setCaptionPreset] = useState<string | null>(null);
  /**
   * The world the animated scenes get drawn in.
   *
   * Same contract as the caption look, and here for the same reason: it used
   * to be a side effect of the edit style, so the only way to see the dark one
   * was to render a video you did not want and read the source to find out why
   * it came out white.
   */
  const [sceneLook, setSceneLook] = useState<string | null>(null);

  /**
   * How the full-frame inserts arrive and leave.
   *
   * A list rather than a value, because the builder cycles it — every insert
   * making the same move is what makes a run of them read as a slideshow. The
   * order is the user's: it is the order they cycle in.
   */
  const [transitions, setTransitions] = useState<ClipTransition[]>([]);

  /**
   * Found, or made.
   *
   * Stock by default and not out of caution: search finds a literal calculator
   * in 200ms for nothing, and for most cues that is the better answer as well
   * as the cheaper one. Generation is for what no library has filmed, which is
   * something somebody knows about their own video and the software does not.
   */
  const [brollSource, setBrollSource] = useState<BrollSource>('stock');

  /** What every insert wears. Null means whatever the edit style declares. */
  const [brollOverlay, setBrollOverlay] = useState<BrollOverlay | null>(null);
  useEffect(() => {
    // On mount, not during render: localStorage is not there on the server and
    // can throw in a private window, and a mismatch would flash the wrong tile.
    setCaptionPreset(readDefaultCaptionPreset() ?? null);
  }, []);

  const [note, setNote] = useState('');

  const [phase, setPhase] = useState<Phase>('choose');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const question: Question = QUESTIONS[at];
  const busy = phase !== 'choose';
  const format = useMemo(() => formats.find((f) => f.mode === mode), [formats, mode]);

  /* Only the styles that suit this footage. A split screen offered on a
     widescreen edit is an offer to make something that will look wrong — and
     when the detection flips, a style that is no longer on the list quietly
     falls back to one that is, rather than submitting something unbuildable. */
  const choices = useMemo(() => styles.filter((s) => s.formats.includes(mode)), [styles, mode]);
  const chosen = choices.some((s) => s.id === styleId) ? styleId : (choices[0]?.id ?? styleId);
  // What the chosen style would put on its inserts, so the overlay picker can
  // say what "let the style choose" means rather than leaving it abstract.
  // A style may name several and cycle them, in which case the picker shows
  // the first — what "let the style choose" opens on.
  const declared = choices.find((s) => s.id === chosen)?.brollOverlay ?? 'none';
  const styleOverlay: BrollOverlay = Array.isArray(declared) ? (declared[0] ?? 'none') : declared;

  /*
   * What the inserts will cost, for THIS file and THIS style.
   *
   * The price is per insert, and the insert count is the style's cut-away
   * cadence against the length of the video — which is why it is worked out
   * here rather than sent down finished. The old version quoted four inserts
   * of two and a half seconds to everybody, the shape of a typical short, so a
   * ten-minute edit that gets seventy-five of them was quoted a twentieth of
   * what it would actually bill.
   *
   * Falls back to that same short-shaped guess only while the browser has not
   * read the file's length yet, which is the one moment when nothing better is
   * known.
   */
  const brollOffers = useMemo(() => {
    const pacing = choices.find((s) => s.id === chosen)?.brollPacing?.[mode];
    const seconds = detected?.durationSec ?? 0;
    const shape = pacing && seconds > 0
      ? brollShapeFor({ brollEverySec: pacing.everySec, brollDurationSec: pacing.durationSec }, seconds)
      : { inserts: 4, secondsEach: 2.5 };

    return brollRates.map((rate) => ({
      source: rate.source,
      label: rate.label,
      body: rate.body,
      available: rate.available,
      missing: rate.missing,
      costUsd: priceBrollRate(rate, shape.inserts, shape.secondsEach),
      waitSec: waitForBrollRate(rate, shape.inserts),
      inserts: shape.inserts,
    }));
  }, [brollRates, choices, chosen, mode, detected?.durationSec]);

  /*
   * Some layouts ARE the B-roll: a split screen with the insert switched off
   * renders a black half, and a reaction cut with nothing to react to is just a
   * talking head. Rather than refuse the toggle — it is the customer's video —
   * say plainly what they will get, so the finished render is not the first
   * time they find out.
   */
  const brollWarning = useMemo(() => {
    if (layers.broll) return null;
    const style = choices.find((s) => s.id === chosen);
    if (!style) return null;
    const plan = layoutPlan(style.layout);
    if (plan.alwaysOn) {
      return `${style.name} keeps a picture on screen beside you the whole way through. With B-roll off, that half of the frame stays empty — pick Clean or Punchy instead if you want a full-frame video.`;
    }
    if (plan.speakerWithBroll) {
      return `${style.name} is you reacting to something. With B-roll off there is nothing to cut to, so it will come out as a plain full-frame edit.`;
    }
    return null;
  }, [layers.broll, choices, chosen]);
  const style = useMemo(() => styles.find((s) => s.id === chosen), [styles, chosen]);

  /** What they have declined, for the line that summarises the whole thing. */
  const off = LAYERS.filter((l) => !layers[l.key]).map((l) => l.label.toLowerCase());

  const pickFile = useCallback((next: File | null) => {
    setError(null);
    if (!next) return;
    if (!next.type.startsWith('video/') && !/\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(next.name)) {
      setError('That does not look like a video file. MP4, MOV and WebM all work.');
      return;
    }
    setFile(next);
    setDetected(null);

    // Shape and length come out of the file's own header, which is a few
    // kilobytes — so the verdict lands in the moment the file is chosen rather
    // than after a round trip on a two-gigabyte upload.
    void probeInBrowser(next).then((probe) => setDetected(detectFormat(probe)));

  }, []);

  // A file dropped on the dashboard banner is waiting here. Adopting it skips
  // the question it already answered, so dropping and clicking land in the same
  // place rather than being two different flows.
  useEffect(() => {
    const dropped = takePendingUpload();
    if (dropped) pickFile(dropped);
  }, [pickFile]);

  // Enter advances, which is what every form on the web has taught people to
  // expect — except in the note field, where it would submit mid-sentence.
  useEffect(() => {
    if (busy) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter') return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (at < QUESTIONS.length - 1) setAt((n) => n + 1);
      else if (file) void submit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, busy, file]);

  async function submit() {
    if (!file) return;
    setError(null);
    setPhase('uploading');
    setProgress(0);

    try {
      // 1. Create the project and find out where the bytes should go.
      const createResponse = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          styleId: chosen,
          // Whatever this browser last chose in the caption gallery. Absent is
          // fine — the edit style names its own caption look.
          // What was chosen on the Edits step. Absent means the edit style
          // names its own, which is the behaviour this used to have always.
          captionPreset: captionPreset ?? undefined,
          sceneLook: sceneLook ?? undefined,
          // Omitted when empty, which is how "the style's own set" is spelled
          // everywhere else on this request.
          clipTransitions: transitions.length ? transitions : undefined,
          // Omitted when it is the default, like everything else on this
          // request — an explicit "stock" says nothing the absence did not.
          brollSource: brollSource === 'stock' ? undefined : brollSource,
          brollOverlay: brollOverlay ?? undefined,
          inputMode,
          // Only the ones being declined: the default is everything on, and a
          // request that spells out six `true`s says nothing the absence did not.
          layers: Object.fromEntries(Object.entries(layers).filter(([, on]) => !on)),
          userNote: note.trim() || undefined,
          filename: file.name,
          contentType: file.type || 'video/mp4',
          sizeBytes: file.size,
        }),
      });

      if (!createResponse.ok) {
        throw new Error((await createResponse.json().catch(() => ({}))).error ?? 'Could not start the project.');
      }
      const created = await createResponse.json();

      // 2. Upload, reporting real progress via XHR (fetch cannot do upload progress).
      await uploadWithRetry(created.upload, file, setProgress);

      // 3. Kick off the pipeline and go watch it.
      setPhase('starting');
      const startResponse = await fetch(`/api/projects/${created.project.id}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storageKey: created.upload.key,
          contentType: file.type || 'video/mp4',
          sizeBytes: file.size,
          // What the browser measured when it worked out short vs long form.
          // The server re-measures before it meters anything; this only lets it
          // refuse an over-allowance job with a straight answer.
          sourceDurationSec: detected?.durationSec ?? 0,
        }),
      });

      if (!startResponse.ok) {
        throw new Error((await startResponse.json().catch(() => ({}))).error ?? 'Could not start the edit.');
      }

      router.push(`/projects/${created.project.id}`);
    } catch (e) {
      setError((e as Error).message);
      setPhase('choose');
    }
  }

  if (busy) {
    return (
      <Uploading
        phase={phase}
        progress={progress}
        filename={file?.name ?? ''}
      />
    );
  }

  return (
    <div className="pb-4">
      {/* One stepper, not two. The wizard's own hairline rail said the same
          thing as the four steps above it, in a second visual language. */}
      <Stepper current={STEP_OF[question]} onStepClick={(k) => setAt(QUESTIONS.indexOf(k as Question))} />

      <div key={question} className="mt-7 animate-rise">
        {question === 'style' ? (
          <Ask
            title="Pick a style"
            sub="The shape of the video, and everything that follows from it — captions, B-roll, pacing, sound."
          >
            {/* The file, as a strip rather than a screen of its own. Dropping
                it in is how you start, not a decision — it does not deserve a
                step, and it does not deserve a page. */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                pickFile(e.dataTransfer.files?.[0] ?? null);
              }}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); inputRef.current?.click(); }
              }}
              role="button"
              tabIndex={0}
              className={clsx(
                'mb-4 flex cursor-pointer items-center gap-3 rounded-xl border border-dashed px-4 transition-colors',
                file ? 'py-3' : 'py-8 justify-center text-center',
                dragging ? 'border-violet bg-violet-dim' : 'border-line bg-charcoal hover:border-violet/50',
              )}
            >
              <input
                ref={inputRef}
                id="upload-file"
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              />
              {file ? (
                <>
                  <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-violet-dim text-violet">
                    <IconArrowRight className="h-4 w-4 -rotate-90" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold">{file.name}</span>
                    <span className="block font-mono text-[11.5px] text-muted">{formatBytes(file.size)}</span>
                  </span>
                  <span className="flex-none text-[12.5px] text-muted underline decoration-line underline-offset-4">
                    Choose another
                  </span>
                </>
              ) : (
                <span>
                  <span className="block text-[15px] font-bold">Drop your video here</span>
                  <span className="mt-1 block text-[12.5px] text-muted">MP4, MOV, WebM — or click to browse</span>
                </span>
              )}
            </div>

            {/* Which pipeline this file is on. A statement, not a question and
                not a choice: the format follows the shape of the footage, and
                there is no path from one to the other. Offering to "make it
                long form" would be offering to crop somebody's vertical video
                into a shape they did not film — and the server settles this
                from ffprobe anyway, so the control would have been a lie.

                ONLY ONCE THERE IS A FILE. This used to render on an empty
                wizard, where it read "SHORT FORM · Reading your footage…" over
                an empty drop zone — announcing a file nobody had chosen and
                claiming to be reading it. Next to a button saying "Choose a
                file first" that is a screen contradicting itself, and the
                honest reading of it is that something is already loaded and
                the upload is refusing you. */}
            {file ? (
              <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-charcoal px-3 py-2.5 text-[12.5px]">
                {/* The badge waits for the verdict too. Guessing "short form"
                    while the header is still being read is a guess that will
                    silently flip a second later on a widescreen file. */}
                {detected && format ? (
                  <span
                    className="rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider"
                    style={{ background: 'rgba(155,123,255,.14)', color: '#B39AFF' }}
                  >
                    {format.label}
                  </span>
                ) : null}
                <span className="text-muted">
                  {detected ? detected.reason : 'Reading your footage…'}
                </span>
                <span className="ml-auto text-faint">
                  {detected && format ? format.platforms.join(' · ') : ''}
                </span>
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {choices.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  data-style={s.id}
                  aria-pressed={chosen === s.id}
                  onClick={() => setStyleId(s.id)}
                  className={clsx(
                    'rounded-2xl border p-3 text-left transition-colors',
                    chosen === s.id
                      ? 'border-violet bg-violet-dim'
                      : 'border-line bg-charcoal hover:bg-charcoal2',
                  )}
                >
                  <StylePreview
                    layout={s.layout}
                    aspect={mode === 'short' ? '9:16' : '16:9'}
                    accent={s.accent}
                    className={mode === 'short' ? 'mx-auto w-[58%]' : 'w-full'}
                    chapterCards={s.chapterCards?.[mode] ?? false}
                  />
                  <p className="mt-3 flex items-center gap-2 text-[14px] font-bold">
                    <span className="h-2 w-2 rounded-full" style={{ background: s.accent }} />
                    {s.name}
                  </p>
                  <p className="mt-1 text-[12.5px] leading-snug text-muted">{s.tagline}</p>
                </button>
              ))}
            </div>

            <p className="mt-4 text-[12.5px] text-faint">
              {choices.find((s) => s.id === chosen)?.bestFor}
            </p>
          </Ask>
        ) : null}

        {question === 'edits' ? (
          <Ask
            title="What goes in it"
            sub="Everything is on by default. Turn off anything you do not want and it is never made — you are not paying for a layer you then delete."
          >
            <div className="grid gap-2 sm:grid-cols-2">
              {LAYERS.map((layer) => (
                <button
                  key={layer.key}
                  type="button"
                  data-layer={layer.key}
                  aria-pressed={layers[layer.key]}
                  onClick={() => setLayers((now) => ({ ...now, [layer.key]: !now[layer.key] }))}
                  className={clsx(
                    'flex items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors',
                    layers[layer.key]
                      ? 'border-violet/50 bg-violet-dim'
                      : 'border-line bg-charcoal text-muted hover:bg-charcoal2',
                  )}
                >
                  <span
                    className={clsx(
                      'mt-0.5 grid h-4 w-4 flex-none place-items-center rounded-[5px] border transition-colors',
                      layers[layer.key] ? 'border-violet bg-violet text-ink' : 'border-line',
                    )}
                  >
                    {layers[layer.key] ? <IconCheck className="h-2.5 w-2.5" /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-bold">{layer.label}</span>
                    <span className="mt-0.5 block text-[12px] leading-snug text-muted">{layer.body}</span>
                  </span>
                </button>
              ))}
            </div>

            {/* Only when captions are actually going in. Offering a look for a
                layer somebody has just switched off is offering a decision
                that cannot matter. */}
            {layers.captions ? (
              <CaptionPicker
                value={captionPreset}
                onChange={setCaptionPreset}
                mode={mode}
                className="mt-7"
              />
            ) : null}

            {/* Same rule: only where the layer is actually going in. */}
            {layers.scenes ? (
              <ScenePicker value={sceneLook} onChange={setSceneLook} className="mt-7" />
            ) : null}

            {/* Only where inserts are actually going in. Offering a source
                for a layer somebody has just switched off is offering a
                decision that cannot matter. */}
            {layers.broll ? (
              <>
                <BrollSourcePicker
                  offers={brollOffers}
                  value={brollSource}
                  onChange={setBrollSource}
                  className="mt-7"
                />
                <OverlayPicker
                  value={brollOverlay}
                  onChange={setBrollOverlay}
                  styleDefault={styleOverlay}
                  className="mt-7"
                />
              </>
            ) : null}

            {/* Transitions belong to whatever takes the whole frame, and both
                layers that do are optional — so the question only makes sense
                while at least one of them is still switched on. */}
            {layers.broll || layers.scenes ? (
              <TransitionPicker value={transitions} onChange={setTransitions} className="mt-7" />
            ) : null}

            {brollWarning ? (
              <p className="mt-3 rounded-xl border border-warn/40 bg-warn/10 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-chalk/90">
                {brollWarning}
              </p>
            ) : null}

            <h3 className="mt-7 text-[13px] font-bold">How finished is the footage?</h3>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <Choice
                selected={inputMode === 'raw'}
                onClick={() => setInputMode('raw')}
                title="Completely raw"
                body="Straight off the camera. We'll cut the pauses, the ums, the false starts and the takes you redid."
              />
              <Choice
                selected={inputMode === 'roughcut'}
                onClick={() => setInputMode('roughcut')}
                title="Already trimmed"
                body="You cut your own mistakes. We'll respect your edit and only add the layers on top."
              />
            </div>

            <div className="mt-6">
              <label htmlFor="upload-note" className="label">
                Anything we should know? <span className="text-faint">Optional</span>
              </label>
              <input
                id="upload-note"
                type="text"
                value={note}
                maxLength={200}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. keep the bit about pricing, skip the intro small talk"
                className="mt-2 w-full rounded-xl border border-line bg-charcoal px-4 py-3 text-sm outline-none transition-colors placeholder:text-muted/60 focus:border-violet"
              />
            </div>
          </Ask>
        ) : null}

      </div>

      {error ? (
        <p className="mt-5 rounded-xl border border-bad/40 bg-bad/[0.08] px-4 py-3 text-[13px] text-bad">{error}</p>
      ) : null}

      <div className="mt-8 flex items-center gap-3">
        {at > 0 ? (
          <button type="button" onClick={() => setAt(at - 1)} className="btn-ghost">
            Back
          </button>
        ) : null}

        {at < QUESTIONS.length - 1 ? (
          <button
            type="button"
            onClick={() => setAt(at + 1)}
            disabled={at === 0 && !file}
            className="btn-primary ml-auto"
          >
            {at === 0 && !file ? 'Choose a file first' : 'Continue'}
            <IconArrowRight className="h-4 w-4" />
          </button>
        ) : (
          <button type="button" onClick={submit} disabled={!file} className="btn-primary ml-auto px-6 py-3">
            Apply and make my video
            <IconArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>

      {at === QUESTIONS.length - 1 && file ? (
        <p className="mt-4 text-[12.5px] text-faint">
          {file.name} · {format?.label} · {style?.name} ·{' '}
          {inputMode === 'raw' ? 'Completely raw' : 'Already trimmed'}
          {off.length ? ` · no ${off.join(', ')}` : ''}
        </p>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- pieces */

function Ask({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-[22px] font-extrabold">{title}</h2>
      <p className="mt-1.5 text-[13.5px] text-muted">{sub}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Choice({
  selected,
  onClick,
  title,
  body,
  foot,
  badge,
  dot,
  tags,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  body: string;
  foot?: string;
  badge?: string;
  dot?: string;
  tags?: string[];
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={clsx(
        // A <button> centres its content vertically, which floats the shorter
        // card's title off its neighbour's baseline in a stretched row. Column
        // flex from the top is what keeps paired titles aligned.
        'flex flex-col items-start justify-start rounded-[18px] border p-5 text-left transition-colors',
        selected
          ? 'border-violet bg-violet-dim'
          : 'border-line bg-charcoal hover:border-line/80 hover:bg-charcoal2',
      )}
    >
      <span className="flex w-full items-center gap-2">
        {dot ? <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: dot }} aria-hidden /> : null}
        <span className="font-bold">{title}</span>
        {badge ? (
          <span className="ml-auto rounded-md bg-ink/60 px-2 py-0.5 text-[11px] font-semibold text-muted">
            {badge}
          </span>
        ) : null}
        {selected && !badge ? <IconCheck className="ml-auto h-4 w-4 text-violet" /> : null}
      </span>
      <span className="mt-1.5 text-[13px] leading-relaxed text-chalk/80">{body}</span>
      {foot ? <span className="mt-1 text-[11.5px] leading-relaxed text-muted">{foot}</span> : null}
      {tags?.length ? (
        <span className="mt-3 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span key={t} className="rounded-md border border-line px-2 py-0.5 text-[11px] font-medium text-muted">
              {t}
            </span>
          ))}
        </span>
      ) : null}
    </button>
  );
}

function Uploading({ phase, progress, filename }: { phase: Phase; progress: number; filename: string }) {
  const pct = Math.round(progress * 100);
  return (
    <div className="card mt-7 p-6">
      <div className="flex items-center justify-between text-[14px]">
        <span className="font-semibold">
          {phase === 'uploading' ? 'Uploading your footage' : 'Starting the edit'}
        </span>
        <span className="tabular-nums text-muted">{phase === 'uploading' ? `${pct}%` : ''}</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink">
        <div
          className={clsx(
            'h-full rounded-full bg-violet',
            phase === 'uploading' ? 'transition-[width] duration-200' : 'animate-pulseDot',
          )}
          style={{ width: phase === 'uploading' ? `${Math.max(3, pct)}%` : '100%' }}
        />
      </div>
      <p className="mt-3 text-[12.5px] text-faint">
        {filename} — keep this tab open until the upload finishes.
      </p>
    </div>
  );
}

/**
 * XHR rather than fetch, purely because fetch still cannot report upload
 * progress. On a 2 GB file the difference between a progress bar and a spinner
 * is the difference between waiting and assuming it's broken.
 */
/** An upload that failed with an HTTP status, so a caller can judge it. */
class UploadError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Statuses that mean "the server was not there", not "your file is wrong". */
const TRANSIENT = new Set([0, 408, 425, 429, 502, 503, 504]);

/**
 * Sends the file again when the failure was the server's, not the file's.
 *
 * The bytes go through the app server, so anything that takes it away for a
 * moment — a deploy rolling over, an edge blip — lands as a 502 from the proxy
 * rather than as anything we wrote. Making the person pick their file and fill
 * the form in again for a ten-second restart is the wrong answer when the
 * browser still has the file right there.
 *
 * A 413 or a 400 is not retried: sending the same too-large file three times
 * only wastes their upload.
 */
async function uploadWithRetry(
  upload: { method: 'PUT' | 'POST'; url: string; headers: Record<string, string> },
  file: File,
  onProgress: (fraction: number) => void,
): Promise<void> {
  // Anything big enough that starting over would hurt goes up in pieces.
  if (upload.method === 'POST' && file.size > CHUNKED_ABOVE) {
    return uploadInChunks(upload.url, file, onProgress);
  }

  const delays = [2000, 6000];
  for (let attempt = 0; ; attempt++) {
    try {
      await uploadWithProgress(upload, file, onProgress);
      return;
    } catch (error) {
      const status = error instanceof UploadError ? error.status : 0;
      if (!TRANSIENT.has(status) || attempt >= delays.length) throw error;
      onProgress(0);
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
}

/* ------------------------------------------------------- chunked uploading */

/** Above this, a lost connection costs too much to accept. */
const CHUNKED_ABOVE = 32 * 1024 * 1024;

/**
 * How much goes in one request.
 *
 * Eight megabytes is the compromise: small enough that losing one is a few
 * seconds even on a slow line, large enough that a 3 GB file is a few hundred
 * requests rather than tens of thousands.
 */
const CHUNK_BYTES = 8 * 1024 * 1024;

/** Per-chunk, not per-file — the whole point is that one chunk can fail a lot. */
const CHUNK_DELAYS = [1000, 2000, 4000, 8000, 15000, 30000];

/**
 * The same file, in pieces, resuming where it left off.
 *
 * Why this exists rather than a bigger timeout: the bytes were never the
 * problem. Three uploads in a row failed and the server logged no error at all
 * — twelve client-aborted requests and nothing else, which is what a dropped
 * connection looks like from the other end. On a phone export that takes ten
 * minutes to send, one drop is close to certain, and whole-file POST answers a
 * drop at minute nine by asking for all nine minutes again.
 *
 * So: ask the server how much it already has, send the next piece, repeat. A
 * drop now costs one piece. A reload costs nothing at all, because the upload
 * id is derived from the file itself and the server's part file is still there.
 */
async function uploadInChunks(url: string, file: File, onProgress: (fraction: number) => void): Promise<void> {
  const uploadId = uploadIdFor(file);
  let offset = await askReceived(url, uploadId, file.size).catch(() => 0);
  let strikes = 0;
  let done = false;

  onProgress(offset / file.size);

  /*
   * Driven by the server saying "done", not by the client's own arithmetic.
   *
   * The difference matters in one case that is easy to miss: a part file that
   * is already complete because the FINAL chunk's response was the one that got
   * lost. Counting bytes, the client would decide there was nothing left to
   * send and report success on an upload that was never finalised and has no
   * asset row. Looping until the server says so sends a last empty chunk
   * instead, which is exactly the nudge that finalises it.
   */
  while (!done) {
    const end = Math.min(offset + CHUNK_BYTES, file.size);
    try {
      const before = offset;
      const answer = await sendChunk(url, uploadId, file, offset, end, onProgress);
      offset = answer.received;
      done = answer.done;
      // A reply that accepted bytes and moved nowhere would spin for ever.
      strikes = !done && offset <= before && end > before ? strikes + 1 : 0;
      if (strikes > CHUNK_DELAYS.length) throw new UploadError(droppedMessage(offset, file.size), 0);
    } catch (error) {
      const status = error instanceof UploadError ? error.status : 0;
      if (!TRANSIENT.has(status) || strikes >= CHUNK_DELAYS.length) throw error;
      await new Promise((r) => setTimeout(r, CHUNK_DELAYS[strikes]));
      strikes += 1;
      /*
       * Re-ask rather than assume. A chunk can fail on the way back, after the
       * server wrote every byte of it — retrying from the old offset would then
       * be refused for ever, and the transfer would deadlock at 40%.
       */
      offset = await askReceived(url, uploadId, file.size).catch(() => offset);
    }
    onProgress(offset / file.size);
  }
}

/**
 * An id for this transfer, derived from the file rather than invented.
 *
 * Deterministic on purpose: a reload, a second tab or a phone that locked mid
 * upload all lose whatever the page was holding, and a fresh random id would
 * mean starting the file again while the bytes we already sent sit on the
 * server waiting for an id nobody will ask for.
 */
function uploadIdFor(file: File): string {
  let name = 0;
  for (const char of file.name) name = (name * 31 + char.charCodeAt(0)) % 0xffffffff;
  return `u-${file.size.toString(36)}-${file.lastModified.toString(36)}-${name.toString(36)}`.toLowerCase();
}

/**
 * How many bytes the server already holds for this upload.
 *
 * A part longer than the file cannot be a prefix of it, so it is thrown away
 * rather than resumed. That only happens if a previous transfer under the same
 * id was of different content, and resuming it would produce a file that is the
 * right length and the wrong video.
 */
async function askReceived(url: string, uploadId: string, size: number): Promise<number> {
  const response = await fetch(`${url}?uploadId=${encodeURIComponent(uploadId)}`, { cache: 'no-store' });
  if (!response.ok) return 0;
  const body = (await response.json()) as { received?: number };
  const received = Number.isFinite(body.received) ? Number(body.received) : 0;
  if (received <= size) return received;
  await fetch(`${url}?uploadId=${encodeURIComponent(uploadId)}`, { method: 'DELETE' }).catch(() => {});
  return 0;
}

/** Sends one slice and answers with the server's position, and whether that is the end. */
function sendChunk(
  url: string,
  uploadId: string,
  file: File,
  offset: number,
  end: number,
  onProgress: (fraction: number) => void,
): Promise<{ received: number; done: boolean }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', file.type || 'video/mp4');
    xhr.setRequestHeader('x-filename', file.name);
    xhr.setRequestHeader('x-upload-id', uploadId);
    xhr.setRequestHeader('x-chunk-offset', String(offset));
    xhr.setRequestHeader('x-upload-total', String(file.size));

    let sent = 0;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        sent = event.loaded;
        onProgress((offset + sent) / file.size);
      }
    };

    const answer = (): { received?: number; done?: boolean } => {
      try {
        return JSON.parse(xhr.responseText) as { received?: number; done?: boolean };
      } catch {
        return {};
      }
    };

    xhr.onload = () => {
      // 409 is not a failure: it is the server telling us where it really is,
      // which is the only answer that lets a resumed upload converge.
      if (xhr.status === 409) {
        const at = answer().received;
        return Number.isFinite(at)
          ? resolve({ received: Number(at), done: false })
          : reject(new UploadError(messageFor(xhr), 409));
      }
      if (xhr.status < 200 || xhr.status >= 300) return reject(new UploadError(messageFor(xhr), xhr.status));
      const body = answer();
      resolve({
        received: Number.isFinite(body.received) ? Number(body.received) : end,
        done: body.done === true,
      });
    };
    const dropped = () => reject(new UploadError(droppedMessage(offset + sent, file.size), 0));
    xhr.onerror = dropped;
    xhr.ontimeout = dropped;
    xhr.onabort = dropped;

    xhr.send(file.slice(offset, end));
  });
}

function uploadWithProgress(
  upload: { method: 'PUT' | 'POST'; url: string; headers: Record<string, string> },
  file: File,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(upload.method, upload.url);

    for (const [header, value] of Object.entries(upload.headers)) {
      xhr.setRequestHeader(header, value);
    }
    if (upload.method === 'POST') {
      xhr.setRequestHeader('Content-Type', file.type || 'video/mp4');
      xhr.setRequestHeader('x-filename', file.name);
    }

    /*
     * How far it got, kept so a failure can say so.
     *
     * "Upload failed — check your connection" is what this used to say for
     * every network-level failure, and it is useless: it reads as our problem
     * when it is usually a 3 GB file over a home connection, and it reads as
     * their connection when it is sometimes us. The number is the whole
     * diagnosis.
     */
    let sent = 0;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        sent = event.loaded;
        onProgress(event.loaded / event.total);
      }
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new UploadError(messageFor(xhr), xhr.status));
    xhr.onerror = () => reject(new UploadError(droppedMessage(sent, file.size), 0));
    xhr.ontimeout = () => reject(new UploadError(droppedMessage(sent, file.size), 0));
    xhr.onabort = () => reject(new UploadError(droppedMessage(sent, file.size), 0));

    xhr.send(file);
  });
}

/**
 * What to say when the connection drops mid-upload.
 *
 * There is no status code here — the request never completed — so the only
 * evidence is how far it got. Nothing sent at all is a different problem from
 * two thirds of a three-gigabyte file, and telling someone to "check your
 * connection" when the real answer is "this file is enormous" wastes their
 * afternoon.
 */
function droppedMessage(sent: number, total: number): string {
  if (!total) return 'The upload did not start. Check your connection and try again.';

  const fraction = sent / total;
  const size = formatBytes(total);

  if (sent === 0) {
    return `The upload never started (${size}). Check your connection, then try again.`;
  }
  if (fraction > 0.9) {
    return `The upload was cut off right at the end (${formatBytes(sent)} of ${size}). Try again — it usually goes through on a second attempt.`;
  }
  return (
    `The connection dropped after ${formatBytes(sent)} of ${size}. ` +
    (total > 500 * 1024 * 1024
      ? 'Large files are the usual cause — trimming the clip or exporting at 1080p instead of 4K will upload much more reliably.'
      : 'Try again, and if it keeps happening on the same file, send it to us.')
  );
}

/**
 * What to tell the person about a failed upload.
 *
 * Our own routes answer `{ error }` and that text is written for them. Anything
 * else came from the platform's proxy — raw JSON about an application that
 * failed to respond, which is true and useless — so it gets a plain sentence.
 */
function messageFor(xhr: XMLHttpRequest): string {
  try {
    const body = JSON.parse(xhr.responseText);
    if (typeof body?.error === 'string') return body.error;
  } catch {
    // Not ours, or not JSON at all.
  }
  if (xhr.status >= 500 || xhr.status === 0) {
    return 'The server dropped the upload. Please try again in a moment.';
  }
  return `Upload failed (${xhr.status}).`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
