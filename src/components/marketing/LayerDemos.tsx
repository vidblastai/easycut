import type { ReactNode } from 'react';
import { MediaSlot } from './MediaSlot';
import { BrollArt, Figure, Shot } from './Shot';

/**
 * Six layers, each shown doing its one thing.
 *
 * These used to be six paragraphs in a grid. A paragraph saying "whooshes on
 * cuts, pops on graphics" asks the reader to picture sound design; a waveform
 * that ducks under a voice and pings on a cue does not ask for anything. Same
 * word count, and now the words are the caption rather than the evidence.
 *
 * Each demo is a handful of divs on a CSS loop — nothing to download, nothing
 * to buffer, and legible at the 260px these tiles are on a phone. Every one is
 * a MediaSlot, so a real screen recording dropped into public/marketing takes
 * its place without touching this file.
 */

interface Layer {
  slot: string;
  title: string;
  body: string;
  demo: ReactNode;
}

const LAYERS: Layer[] = [
  {
    slot: 'layer-captions',
    title: 'Captions',
    body: 'Word-perfect and timed to the syllable, with the words that carry the sentence picked out.',
    demo: (
      <>
        <Shot />
        <div className="d-cap">
          <span style={{ animationDelay: '0.1s' }}>You&rsquo;re</span>
          <span style={{ animationDelay: '0.35s' }} className="d-cap-hit">losing</span>
          <span style={{ animationDelay: '0.6s' }}>them</span>
        </div>
      </>
    ),
  },
  {
    slot: 'layer-broll',
    title: 'B-roll',
    body: 'Real footage cut in where you name something concrete. Never generic, never over your punchline.',
    demo: (
      <>
        <Shot />
        <div className="d-broll-card">
          <BrollArt />
        </div>
        <span className="d-broll-tag">&ldquo;city at night&rdquo;</span>
      </>
    ),
  },
  {
    slot: 'layer-graphics',
    title: 'Motion graphics',
    body: 'Numbers become stat cards. Lists build in a line at a time. Named ideas get an animated icon.',
    demo: (
      <>
        <Shot />
        <div className="d-gfx">
          <i style={{ ['--h' as string]: '38%', animationDelay: '0.05s' }} />
          <i style={{ ['--h' as string]: '64%', animationDelay: '0.18s' }} />
          <i style={{ ['--h' as string]: '92%', animationDelay: '0.31s' }} />
          <i style={{ ['--h' as string]: '55%', animationDelay: '0.44s' }} />
        </div>
        <span className="d-gfx-num">+312%</span>
      </>
    ),
  },
  {
    slot: 'layer-sound',
    title: 'Sound design',
    body: 'Whooshes on the cuts, pops on the graphics, and a music bed that gets out of the way when you talk.',
    demo: (
      <>
        <Shot />
        <div className="d-snd">
          <span className="d-snd-scrim" />
          <div className="d-snd-music">
            {Array.from({ length: 22 }, (_, i) => (
              <i key={i} style={{ ['--i' as string]: i, animationDelay: `${i * 0.03}s` }} />
            ))}
          </div>
          <div className="d-snd-voice" />
          <span className="d-snd-tag">ducked</span>
        </div>
      </>
    ),
  },
  {
    slot: 'layer-transitions',
    title: 'Transitions',
    body: 'Whip pans, zoom punches and glitches — placed on real cuts only, never as decoration.',
    demo: (
      <div className="d-tr">
        <span className="d-tr-a"><Shot /></span>
        <span className="d-tr-b"><Shot graded wide /></span>
        <span className="d-tr-blur" />
      </div>
    ),
  },
  {
    slot: 'layer-reframe',
    title: 'Reframing',
    body: 'Shot wide, posting vertical? We follow you through the frame so you never lose your head.',
    demo: (
      <>
        <Shot bare />
        <div className="d-rf">
          <Figure className="d-rf-subject" />
          <span className="d-rf-crop" />
          <span className="d-rf-tag">9:16</span>
        </div>
      </>
    ),
  },
];

export function LayerDemos() {
  return (
    <div className="layer-grid">
      {LAYERS.map((layer) => (
        <article key={layer.title} className="layer-tile">
          <div className="layer-stage">
            <MediaSlot slot={layer.slot} alt={`${layer.title} in the finished video`}>
              {layer.demo}
            </MediaSlot>
          </div>
          <div className="layer-copy">
            <h3>{layer.title}</h3>
            <p>{layer.body}</p>
          </div>
        </article>
      ))}
    </div>
  );
}
