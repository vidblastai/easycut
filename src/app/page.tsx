import Link from 'next/link';
import { Logo, LogoMark } from '@/components/Logo';
import { CaptionShowcase } from '@/components/captions/CaptionShowcase';
import { STYLE_LIST } from '@/lib/styles/presets';

/**
 * The marketing page.
 *
 * It has one job: make someone who has never opened an editor believe this will
 * work for them, and get them to the upload screen. So the copy leads with the
 * outcome ("a finished video"), the mechanics are shown as three steps, and the
 * only call to action anywhere on the page is "Upload your footage".
 */

const LAYERS = [
  { title: 'Captions', body: 'Word-perfect, animated, with the words that matter picked out in your accent colour.' },
  { title: 'B-roll', body: 'Real footage cut in wherever you name something concrete. Never generic, never over your punchline.' },
  { title: 'Motion graphics', body: 'Numbers become stat cards. Lists build in. Named ideas get an animated icon.' },
  { title: 'Sound design', body: 'Whooshes on cuts, pops on graphics, a music bed that ducks under your voice automatically.' },
  { title: 'Transitions', body: 'Whip pans, zoom punches and glitches — placed only on real cuts, never for decoration.' },
  { title: 'Reframing', body: 'Shot landscape, posting vertical? We track you through the frame so you never lose your head.' },
];

const STEPS = [
  {
    number: '01',
    title: 'Drop in your footage',
    body: 'Raw and rambling, or already trimmed — tell us which and we adjust how hard we cut.',
  },
  {
    number: '02',
    title: 'Pick short or long',
    body: 'Vertical and hook-first, or widescreen and chaptered. Then choose a look. That is every decision you make.',
  },
  {
    number: '03',
    title: 'Get a finished video',
    body: 'Under two minutes for a short. Download it, or nudge anything you want and re-render for free.',
  },
];

export default function HomePage() {
  return (
    <main className="relative overflow-hidden">
      {/* Ambient accent glow — the only decorative element on the page. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[560px] w-[900px] -translate-x-1/2 rounded-full opacity-[0.16] blur-[120px]"
        style={{ background: 'radial-gradient(circle, #9B7BFF 0%, transparent 70%)' }}
      />

      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Logo />
        <nav className="flex items-center gap-2">
          <Link href="/dashboard" className="btn-ghost">
            My videos
          </Link>
          <Link href="/new" className="btn-primary">
            Upload footage
          </Link>
        </nav>
      </header>

      {/* ------------------------------------------------------------ hero */}
      <section className="relative z-10 mx-auto max-w-4xl px-6 pb-20 pt-16 text-center sm:pt-24">
        <div className="animate-rise">
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-charcoal px-3.5 py-1.5 text-xs font-semibold text-muted">
            <span className="h-1.5 w-1.5 animate-pulseDot rounded-full bg-violet" />
            Short video in ~90 seconds. Long form in under six minutes.
          </span>
        </div>

        <h1 className="animate-rise mt-7 text-[40px] font-extrabold leading-[1.04] tracking-[-0.035em] sm:text-[62px]">
          Upload your footage.
          <br />
          <span className="text-violet">Get a finished video.</span>
        </h1>

        <p className="animate-rise mx-auto mt-6 max-w-2xl text-[17px] leading-[1.65] text-muted sm:text-lg">
          You talk to camera. We do the rest — cutting out the pauses and the
          &ldquo;umm&rdquo;s, adding captions, B-roll, graphics, sound design and music,
          and framing it for wherever you&rsquo;re posting it.
        </p>

        <p className="animate-rise mx-auto mt-3 max-w-xl text-sm text-muted/70">
          No timeline. No keyframes. No editing knowledge of any kind.
        </p>

        <div className="animate-rise mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/new" className="btn-primary w-full px-7 py-3.5 text-[15px] sm:w-auto">
            Upload your footage
          </Link>
          <Link href="/dashboard" className="btn-ghost w-full px-7 py-3.5 text-[15px] sm:w-auto">
            See an example
          </Link>
        </div>

        {/* The captions are the product — most short-form is watched muted —
            so the page shows them rather than describing them. These are the
            real presets, drawn by the renderer's own paint code. */}
        <div className="mt-14">
          <CaptionShowcase />
        </div>
      </section>

      {/* ----------------------------------------------------------- steps */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 pb-24">
        <div className="grid gap-4 sm:grid-cols-3">
          {STEPS.map((step) => (
            <div key={step.number} className="card p-6">
              <div className="text-xs font-bold tracking-[0.18em] text-violet">{step.number}</div>
              <h3 className="mt-3 text-lg font-bold tracking-[-0.02em]">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------- layers */}
      <section className="relative z-10 border-t border-line bg-[#0B0B0E] py-24">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="max-w-2xl text-3xl font-extrabold tracking-[-0.03em] sm:text-[40px]">
            Everything a good editor would add, added for you.
          </h2>
          <p className="mt-4 max-w-xl text-muted">
            Not filters on top of your video — an actual edit, built from what you said.
          </p>

          {/* One surface split by hairlines rather than six bordered cards.
              Border, radius and fill each say "separate object", and six of
              them in a grid said it six times about one list. */}
          <div className="mt-10 grid gap-px overflow-hidden rounded-2xl bg-line sm:grid-cols-2 lg:grid-cols-3">
            {LAYERS.map((layer) => (
              <div key={layer.title} className="bg-charcoal p-6">
                <h3 className="text-base font-bold tracking-[-0.02em]">{layer.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{layer.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- styles */}
      <section className="relative z-10 py-24">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-3xl font-extrabold tracking-[-0.03em] sm:text-[40px]">Pick a look.</h2>
          <p className="mt-4 max-w-xl text-muted">
            Each one changes the pacing, the captions, the sound design and how much
            happens on screen. You can switch after the edit and re-render for free.
          </p>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {STYLE_LIST.map((style) => (
              <div key={style.id} className="card p-6">
                <div className="flex items-center gap-2.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: style.accent }} />
                  <h3 className="text-base font-bold tracking-[-0.02em]">{style.name}</h3>
                </div>
                <p className="mt-2 text-sm font-medium text-chalk/80">{style.tagline}</p>
                <p className="mt-2 text-sm leading-relaxed text-muted">{style.bestFor}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- cta */}
      <section className="relative z-10 border-t border-line py-24">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <LogoMark size={44} className="mx-auto text-violet" />
          <h2 className="mt-6 text-3xl font-extrabold tracking-[-0.03em] sm:text-[40px]">
            Your next video is one upload away.
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-muted">
            Bring the footage. We&rsquo;ll bring the edit.
          </p>
          <Link href="/new" className="btn-primary mt-8 px-7 py-3.5 text-[15px]">
            Upload your footage
          </Link>
        </div>
      </section>

      <footer className="relative z-10 border-t border-line py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 text-sm text-muted sm:flex-row">
          <Logo size={24} />
          <p>Built for people who would rather be making things than editing them.</p>
        </div>
      </footer>
    </main>
  );
}
