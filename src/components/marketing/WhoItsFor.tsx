import { ASPECTS } from '@/lib/edl/types';
import { STYLE_LIST } from '@/lib/styles/presets';

/**
 * Who this is for, said plainly.
 *
 * The section a landing page needs most and usually skips: somebody two
 * seconds in is not asking what the product does, they are asking whether it
 * is for them. Every line here is a real capability — the counts come from the
 * style list and the aspect list, so they cannot drift away from the product.
 */

const AUDIENCES = [
  {
    title: 'Founders and consultants',
    body:
      'One take, straight off a phone, into something that looks like you paid for it. ' +
      'The ums and the false starts come out; you do not have to do a second take.',
    proof: 'Clean · Punchy · Bulletin',
  },
  {
    title: 'Podcasters',
    body:
      'Drop in the full episode and take the shorts out of it. The long cut keeps its ' +
      'chapters; the clips get vertical framing that follows whoever is talking.',
    proof: 'Podcast · Essay · Commentary',
  },
  {
    title: 'Course creators and teachers',
    body:
      'Walkthroughs where the screen is the lesson and you narrate from the corner, ' +
      'with the steps numbered on screen so nobody has to scrub back.',
    proof: 'Screencast · Explainer',
  },
  {
    title: 'Agencies and social teams',
    body:
      'Several videos at once, a house caption look applied to all of them, and every ' +
      'aspect ratio out of one edit rather than one export per platform.',
    proof: 'Every style, 10 at a time',
  },
] as const;

export function WhoItsFor() {
  return (
    <section className="relative z-10 border-t border-line py-24">
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="max-w-2xl text-3xl font-extrabold tracking-[-0.03em] sm:text-[40px]">
          Made for people who talk to a camera.
        </h2>
        <p className="mt-4 max-w-xl text-muted">
          {STYLE_LIST.length} styles and {ASPECTS.length} aspect ratios, all out of the same edit.
          If your video is somebody explaining something, it is for you.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {AUDIENCES.map((a) => (
            <div key={a.title} className="card p-6">
              <h3 className="text-lg font-bold tracking-[-0.02em]">{a.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{a.body}</p>
              <p className="mt-4 text-[12px] font-semibold uppercase tracking-[0.12em] text-violet">
                {a.proof}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
