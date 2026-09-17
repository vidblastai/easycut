'use client';

import { useMemo } from 'react';
import { clsx } from 'clsx';
import type { Edl } from '@/lib/edl/types';

/**
 * The last step's report.
 *
 * The finished video answers "is this right?". These answer "what did you do
 * to it?", which is the question somebody asks in the half-second before they
 * decide whether to open an editor. A row of counts does not answer it — three
 * sound effects happened *where*, and *why*? — so everything here is timed and
 * named rather than tallied.
 */

const clock = (sec: number) => {
  const n = Math.max(0, Math.round(sec));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
};

/** Frame-accurate, because a report that rounds is a report you cannot check. */
const tc = (sec: number) => {
  const s = Math.max(0, sec);
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;
};

/* ------------------------------------------------------------- the ribbon */

/**
 * The cut, drawn against the footage it came from.
 *
 * "33s removed" is a number. The same fact as a strip of your 47 seconds with
 * the dead air struck through, and the 14 that survived underneath, is the
 * edit — and it is the one picture that tells somebody whether to trust the
 * thing before they have watched a frame of it.
 */
export function CutRibbon({ edl }: { edl: Edl }) {
  const { sourceSec, kept, keptSec, hookAt } = useMemo(() => {
    const ordered = [...edl.segments].sort((a, b) => a.sourceStartSec - b.sourceStartSec);
    const hook = edl.segments.find((s) => s.reason === 'hook') ?? null;
    return {
      // A source duration of zero would divide the whole drawing by nothing;
      // fall back to what survived, which at least draws a full bar.
      sourceSec: edl.source.durationSec || edl.format.durationSec || 1,
      kept: ordered,
      keptSec: ordered.reduce((sum, s) => sum + (s.sourceEndSec - s.sourceStartSec), 0),
      hookAt: hook ? hook.sourceStartSec : null,
    };
  }, [edl]);

  const removed = Math.max(0, Math.round(sourceSec - keptSec));

  const Bar = ({
    items,
    total,
    thin,
  }: {
    items: Array<{ id: string; a: number; b: number; hook: boolean }>;
    total: number;
    thin?: boolean;
  }) => (
    <div
      className={clsx('relative mt-1.5 overflow-hidden rounded-[5px] bg-ink', thin ? 'h-2.5' : 'h-[15px]')}
      style={
        thin
          ? undefined
          : {
              // Hatching for what came out, so the gaps read as struck through
              // rather than as a bar that simply has not loaded.
              backgroundImage:
                'repeating-linear-gradient(135deg, rgba(255,255,255,.05) 0 4px, transparent 4px 9px)',
            }
      }
    >
      {items.map((seg) => (
        <span
          key={seg.id}
          className={clsx('absolute inset-y-0 rounded-[3px]', seg.hook ? 'bg-violet' : 'bg-violet/30')}
          style={{
            left: `${((seg.a / total) * 100).toFixed(3)}%`,
            width: `${(((seg.b - seg.a) / total) * 100).toFixed(3)}%`,
          }}
        />
      ))}
    </div>
  );

  return (
    <div className="mt-5 rounded-2xl border border-line bg-charcoal p-4">
      <Row k="You filmed" v={clock(sourceSec)} />
      <Bar
        total={sourceSec}
        items={kept.map((s) => ({ id: s.id, a: s.sourceStartSec, b: s.sourceEndSec, hook: s.reason === 'hook' }))}
      />

      <div className="mt-4">
        <Row k="We kept" v={clock(edl.format.durationSec)} />
        <Bar
          thin
          total={edl.format.durationSec || 1}
          items={edl.segments.map((s) => ({
            id: s.id,
            a: s.outStartSec,
            b: s.outEndSec,
            hook: s.reason === 'hook',
          }))}
        />
      </div>

      <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
        <b className="font-bold text-chalk">{removed}s</b> of pauses, ums and false starts struck out
        {hookAt !== null ? (
          <>
            , and the strongest line pulled from{' '}
            <b className="font-mono font-bold text-chalk">{tc(hookAt)}</b> to the front so nobody scrolls
            past it
          </>
        ) : null}
        .
      </p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[10px] font-bold uppercase tracking-[.09em] text-faint">{k}</span>
      <span className="font-mono text-[12px] tabular-nums text-muted">{v}</span>
    </div>
  );
}

/* -------------------------------------------------------------- at a glance */

/**
 * Eight tiles: what came out, then what went on.
 *
 * Colour carries the split, because eight numbers at identical weight is a
 * wall rather than a summary — and a layer nobody asked for fades instead of
 * shouting its zero as loudly as a real count.
 */
export function Glance({ edl }: { edl: Edl }) {
  const items = useMemo(() => {
    const kept = edl.segments.reduce((sum, s) => sum + (s.outEndSec - s.outStartSec), 0);
    const removed = Math.max(0, (edl.source.durationSec || 0) - kept);
    const words = edl.captions.length
      ? Math.round(edl.captions.reduce((n, c) => n + c.words.length, 0) / edl.captions.length)
      : 0;

    return [
      { k: 'Removed', v: `${removed.toFixed(0)}s`, sub: 'pauses, ums, retakes', added: false },
      { k: 'Cuts', v: `${Math.max(0, edl.segments.length - 1)}`, sub: 'visible splices', added: false },
      { k: 'Captions', v: `${edl.captions.length}`, sub: `cards, ${words} words each`, added: true },
      { k: 'B-roll', v: `${edl.broll.length}`, sub: 'inserts', added: true },
      { k: 'Graphics', v: `${edl.graphics.length}`, sub: 'stat cards', added: true },
      { k: 'Sound effects', v: `${edl.sfx.length}`, sub: 'cues', added: true },
      { k: 'Punch-ins', v: `${edl.punchIns.length}`, sub: 'second camera', added: true },
      {
        k: 'Music',
        // A track can carry eight mood tags. Two describe it; eight wrap the
        // tile onto a third line and drag the whole row out of alignment.
        v: edl.music ? '1' : '—',
        sub: edl.music
          ? edl.music.mood.split(',').slice(0, 2).join(',').trim() || edl.music.title || 'bed'
          : 'turned off',
        added: true,
      },
    ];
  }, [edl]);

  return (
    <dl className="mt-3.5 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line-soft sm:grid-cols-4">
      {items.map((item) => {
        const empty = item.v === '0' || item.v === '—' || item.v === '0s';
        return (
          <div key={item.k} className="bg-charcoal px-3.5 py-3">
            <dt className={clsx('text-[10.5px] font-semibold uppercase tracking-[.07em]', empty ? 'text-faint/60' : 'text-faint')}>
              {item.k}
            </dt>
            <dd
              className={clsx(
                'mt-1 text-[19px] font-bold leading-tight tabular-nums',
                empty ? 'text-faint' : item.added ? 'text-violet' : 'text-chalk',
              )}
            >
              {item.v}
              <small className="mt-0.5 block text-[12px] font-medium leading-snug text-muted">{item.sub}</small>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/* ------------------------------------------------------------------ the cut */

const REASON_LABEL: Record<string, string> = {
  keep: 'keep',
  hook: 'hook',
  silence: 'silence',
  filler: 'filler',
  stammer: 'stammer',
  retake: 'retake',
  tangent: 'tangent',
};

/** Source timecode → output timecode, which is the thing only this app knows. */
export function TheCut({ edl }: { edl: Edl }) {
  if (!edl.segments.length) return null;

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-3 border-b border-line-soft px-4 py-3">
        <h3 className="text-sm font-bold">The cut</h3>
        <span className="font-mono text-[11px] text-faint">source&nbsp;→&nbsp;output</span>
      </div>
      <div className="p-4">
        <div className="grid gap-px">
          {edl.segments.map((seg) => (
            <div
              key={seg.id}
              className="grid items-baseline gap-3 border-t border-line-soft py-2 font-mono text-[11.5px] tabular-nums first:border-t-0 sm:grid-cols-[62px_124px_14px_118px_minmax(0,1fr)]"
            >
              <span
                className={clsx(
                  'rounded-[5px] px-1.5 py-0.5 text-center font-sans text-[10px] font-bold uppercase tracking-[.05em]',
                  seg.reason === 'hook' ? 'bg-violet/16 text-violet' : 'bg-charcoal2 text-muted',
                )}
              >
                {REASON_LABEL[seg.reason] ?? seg.reason}
              </span>
              <span className="text-faint">
                {tc(seg.sourceStartSec)}–{tc(seg.sourceEndSec)}
              </span>
              <span className="hidden text-center text-faint sm:block">→</span>
              <span className="text-chalk">
                {tc(seg.outStartSec)}–{tc(seg.outEndSec)}
              </span>
              <span className="truncate font-sans text-[12.5px] text-muted">{seg.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------- everything we added */

type AddedRow = { at: number; kind: keyof typeof KIND; what: React.ReactNode };

const KIND = {
  Music: 'bg-ok/15 text-ok',
  Captions: 'bg-charcoal2 text-muted',
  Cut: 'bg-bad/[0.13] text-bad',
  'B-roll': 'bg-ok/15 text-ok',
  Graphic: 'bg-violet/16 text-violet',
  Sound: 'bg-warn/[0.14] text-warn',
  'Punch-in': 'bg-violet/16 text-violet',
} as const;

/**
 * Everything the edit put on top, in time order.
 *
 * The tiles say three sound effects happened; this says where each one is and
 * what it is for. It is the half of the report that decides whether somebody
 * opens the editor or just posts the thing.
 */
export function AddedList({ edl }: { edl: Edl }) {
  const rows = useMemo<AddedRow[]>(() => {
    const out: AddedRow[] = [];

    if (edl.music) {
      out.push({
        at: 0,
        kind: 'Music',
        what: (
          <>
            <b className="font-semibold text-chalk">{edl.music.title || edl.music.mood}</b>
            <i className="not-italic text-muted"> — ducked under your voice, lifted between lines</i>
          </>
        ),
      });
    }
    if (edl.captions.length) {
      const words = Math.round(edl.captions.reduce((n, c) => n + c.words.length, 0) / edl.captions.length);
      out.push({
        at: 0,
        kind: 'Captions',
        what: `${edl.captions.length} cards, ${words} words each, timed to the syllable`,
      });
    }
    for (const t of edl.transitions) {
      out.push({ at: t.atSec, kind: 'Cut', what: t.type === 'cut' ? 'Splice between two takes' : `${t.type} on the splice` });
    }
    for (const b of edl.broll) {
      out.push({
        at: b.outStartSec,
        kind: 'B-roll',
        what: (
          <>
            <b className="font-semibold text-chalk">{b.query || b.kind}</b>
            {b.intent ? <i className="not-italic text-muted"> — {b.intent}</i> : null}
          </>
        ),
      });
    }
    for (const g of edl.graphics) {
      out.push({
        at: g.outStartSec,
        kind: 'Graphic',
        what: (
          <>
            <b className="font-semibold text-chalk">{g.text || g.type}</b>
            {g.subtext ? <i className="not-italic text-muted"> — {g.subtext}</i> : null}
          </>
        ),
      });
    }
    for (const f of edl.sfx) {
      out.push({ at: f.atSec, kind: 'Sound', what: <i className="not-italic text-muted">{f.sound}</i> });
    }
    for (const q of edl.punchIns) {
      out.push({
        at: q.outStartSec,
        kind: 'Punch-in',
        what: `Pushes in ${q.scale.toFixed(2)}× and holds for ${(q.outEndSec - q.outStartSec).toFixed(1)}s`,
      });
    }

    return out.sort((a, b) => a.at - b.at);
  }, [edl]);

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-3 border-b border-line-soft px-4 py-3">
        <h3 className="text-sm font-bold">Everything we added</h3>
        <span className="font-mono text-[11px] text-faint">
          {rows.length} {rows.length === 1 ? 'thing' : 'things'}
        </span>
      </div>
      <div className="p-4">
        {rows.length === 0 ? (
          <p className="text-[12.5px] text-faint">Nothing added — this is your footage, cut.</p>
        ) : (
          <div className="grid gap-px">
            {rows.map((row, i) => (
              <div
                key={`${row.kind}-${i}`}
                className="grid grid-cols-[52px_82px_minmax(0,1fr)] items-baseline gap-3 border-t border-line-soft py-2 first:border-t-0"
              >
                <span className="font-mono text-[11.5px] tabular-nums text-faint">{tc(row.at)}</span>
                <span
                  className={clsx(
                    'whitespace-nowrap rounded-[5px] px-1.5 py-0.5 text-center text-[10px] font-bold uppercase tracking-[.05em]',
                    KIND[row.kind],
                  )}
                >
                  {row.kind}
                </span>
                <span className="min-w-0 text-[13px] text-chalk">{row.what}</span>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-[12px] leading-relaxed text-faint">
          B-roll illustrates the noun, never the vibe. &ldquo;Growth has been incredible&rdquo; gets nothing
          — that&rsquo;s a feeling, not an object.
        </p>
      </div>
    </div>
  );
}
