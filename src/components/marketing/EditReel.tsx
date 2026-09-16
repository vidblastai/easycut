import { MediaSlot } from './MediaSlot';
import { BrollArt, Shot } from './Shot';

/**
 * The hero: the edit happening, on a loop.
 *
 * Every line of copy on this page is a claim about work the customer cannot
 * see — "we cut the dead air", "we add captions", "we drop in B-roll". Claims
 * are cheap. So the top of the page shows it instead: a take with the pauses
 * still in it, the pauses closing up, then each layer arriving one at a time
 * with its name ticked off beside it.
 *
 * Every element runs its own animation over the same twelve-second clock, so
 * the whole thing stays in step without a frame of JavaScript. `forwards` on
 * the fill means the reduced-motion rule in globals.css — which collapses every
 * animation to a single 0.01ms pass — lands on the finished edit rather than on
 * an empty frame. That is the one state worth seeing if you only get one.
 *
 * Drop a real screen recording at public/marketing/hero.{webm,mp4,gif} and it
 * takes the whole frame over. See MediaSlot.
 */

/* The stagger lives in the stylesheet's keyframe percentages, not in a delay —
   a delay shifts an element's whole loop out of step with the master clock. */
const WORDS = [
  { text: 'This' },
  { text: 'changes', accent: true },
  { text: 'everything' },
];

/** Ticked off as each layer lands, in the order the pipeline adds them. */
const LAYERS = [
  { name: 'Dead air cut', at: '2.30s' },
  { name: 'Captions', at: '3.70s' },
  { name: 'B-roll', at: '5.80s' },
  { name: 'Graphics', at: '7.60s' },
  { name: 'Sound design', at: '9.40s' },
];

/** The take, as the timeline sees it: speech, then a pause, then speech. */
const STRIP = [
  { kind: 'talk', span: 13 },
  { kind: 'gap', span: 7 },
  { kind: 'talk', span: 18 },
  { kind: 'gap', span: 5 },
  { kind: 'talk', span: 9 },
  { kind: 'gap', span: 9 },
  { kind: 'talk', span: 15 },
  { kind: 'gap', span: 6 },
  { kind: 'talk', span: 18 },
] as const;

export function EditReel() {
  return (
    <div className="ec-reel">
      <div className="ec-reel-stage">
        <div className="ec-reel-frame">
          <MediaSlot slot="hero" alt="EasyCut turning a raw take into a finished video">
            <>
              <Shot />

              <div className="ec-broll" aria-hidden>
                <BrollArt />
                <span className="ec-broll-tag">&ldquo;city at night&rdquo;</span>
              </div>

              <div className="ec-stat" aria-hidden>
                <b>3.2&times;</b>
                <span>more watch time</span>
              </div>

              <div className="ec-caption" aria-hidden>
                {WORDS.map((word) => (
                  <span key={word.text} className={word.accent ? 'ec-word ec-word-accent' : 'ec-word'}>
                    {word.text}
                  </span>
                ))}
              </div>

              <span className="ec-chip ec-chip-raw" aria-hidden>
                <i className="ec-dot-raw" />
                Raw take &middot; 3:42
              </span>
              <span className="ec-chip ec-chip-done" aria-hidden>
                <i className="ec-dot-done" />
                Ready to post &middot; 1:08
              </span>
            </>
          </MediaSlot>
        </div>

        <div className="ec-strip" aria-hidden>
          <div className="ec-strip-row">
            {STRIP.map((cell, i) => (
              <span
                key={i}
                className={cell.kind === 'gap' ? 'ec-cell ec-cell-gap' : 'ec-cell ec-cell-talk'}
                style={{ flexGrow: cell.span, animationDelay: `${i * 0.045}s` }}
              >
                {cell.kind === 'talk' ? <i /> : null}
              </span>
            ))}
          </div>
          <div className="ec-playhead" />
          <div className="ec-sfx-row">
            <span className="ec-sfx" style={{ left: '17%' }} />
            <span className="ec-sfx" style={{ left: '44%' }} />
            <span className="ec-sfx" style={{ left: '71%' }} />
          </div>
        </div>
      </div>

      {/* What just happened, named. Doubles as the feature list. */}
      <ul className="ec-layers">
        {LAYERS.map((layer) => (
          <li key={layer.name} className="ec-layer" style={{ animationDelay: layer.at }}>
            <span className="ec-tick" style={{ animationDelay: layer.at }}>
              <svg viewBox="0 0 12 12" fill="none" aria-hidden>
                <path d="M2.5 6.2l2.4 2.4 4.6-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            {layer.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
