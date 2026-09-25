import Link from 'next/link';
import { PricingExplainer, PricingSection } from '@/components/marketing/PricingSection';
import { SiteFooter } from '@/components/marketing/SiteFooter';
import { Logo, LogoMark } from '@/components/Logo';
import { BeforeAfter } from '@/components/marketing/BeforeAfter';
import { FlowMap } from '@/components/marketing/FlowMap';
import { LayerDemos } from '@/components/marketing/LayerDemos';
import { MarketingStyles } from '@/components/marketing/styles';
import { SocialProof } from '@/components/marketing/SocialProof';
import { STYLE_LIST, leadsWithCards } from '@/lib/styles/presets';
import { StylePreview } from '@/components/styles/StylePreview';
import { WhoItsFor } from '@/components/marketing/WhoItsFor';
import { WhatItReplaces } from '@/components/marketing/WhatItReplaces';
import { Testimonials } from '@/components/marketing/Testimonials';
import { Showreel } from '@/components/marketing/Showreel';
import { CostCompare } from '@/components/marketing/CostCompare';
import { Faq } from '@/components/marketing/Faq';
import { FAQ_GROUPS } from '@/components/marketing/faq-content';

/**
 * The marketing page.
 *
 * It has one job: make someone who has never opened an editor believe this will
 * work for them, and get them to the upload screen.
 *
 * Which is why it is now mostly pictures. Everything this product does happens
 * to a video, and a paragraph about a video is the weakest possible way to
 * describe one — "we cut the dead air and add captions" is a claim the reader
 * has heard from four other tools this week. So the page shows: the edit
 * assembling itself at the top, the same take before and after in the middle,
 * and each layer doing its one thing further down. The words stayed; they are
 * captions now rather than evidence.
 *
 * Every visual is a MediaSlot, so a real screen recording dropped into
 * public/marketing replaces the drawn one without a code change.
 */

const STEPS = [
  {
    number: '01',
    title: 'Drop in your footage',
    body: 'We read the shape and the length off the file — vertical is a short, a long widescreen recording is long form. Nobody asks you what your own video is.',
  },
  {
    number: '02',
    title: 'Pick a style',
    body: 'The shape of the finished video: full frame, or your face on top with something to watch underneath. Captions, B-roll, pacing and sound all follow from it.',
  },
  {
    number: '03',
    title: 'Get a video ready to post',
    body: 'Post it as-is, or open the timeline and fine-tune every cut before you export.',
  },
];

export default function HomePage() {
  return (
    <main className="relative overflow-hidden">
      <MarketingStyles />
      {/* Ambient accent glow — the only decorative element on the page. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[560px] w-[900px] -translate-x-1/2 rounded-full opacity-[0.16] blur-[120px]"
        style={{ background: 'radial-gradient(circle, #9B7BFF 0%, transparent 70%)' }}
      />

      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Logo />
        <nav className="flex items-center gap-2">
          {/* Pricing and the questions in the header as well as further down.
              They are the second and third things everybody wants, and making
              somebody scroll for either reads as evasion. Hidden on a phone,
              where the whole page is a scroll away anyway. */}
          <Link href="#styles" className="btn-quiet hidden md:inline-flex">
            Styles
          </Link>
          <Link href="/pricing" className="btn-quiet hidden sm:inline-flex">
            Pricing
          </Link>
          <Link href="#faq" className="btn-quiet hidden md:inline-flex">
            FAQ
          </Link>
          <Link href="/dashboard" className="btn-ghost">
            My videos
          </Link>
          <Link href="/new" className="btn-primary">
            Upload footage
          </Link>
        </nav>
      </header>

      {/* ------------------------------------------------------------ hero */}
      <section className="relative z-10 mx-auto max-w-5xl px-6 pb-3 pt-6 text-center sm:pt-8">
        <div className="animate-rise">
          <SocialProof />
        </div>

        {/* One fluid size rather than a jump at `sm`. The promise — "get an
            edited video, ready to post" — is a long line, and at a fixed 48px
            it broke in two on a tablet, which delivers the payoff in pieces. */}
        <h1 className="animate-rise mt-4 text-[clamp(30px,4vw,48px)] font-extrabold leading-[1.04] tracking-[-0.038em]">
          Upload your footage.
          <br />
          <span className="text-violet">Get an edited video, ready to post.</span>
        </h1>

        <p className="animate-rise mx-auto mt-3 max-w-3xl text-[16px] leading-[1.55] text-muted">
          You talk to camera. We do the rest — the pauses and &ldquo;umm&rdquo;s cut, captions,
          B-roll, graphics, sound design and music, in the shape you filmed it.
        </p>

        <div className="animate-rise mt-5 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/new" className="btn-primary w-full px-7 py-3.5 text-[15px] sm:w-auto">
            Upload your footage
          </Link>
          <Link href="/dashboard" className="btn-ghost w-full px-7 py-3.5 text-[15px] sm:w-auto">
            See the dashboard
          </Link>
        </div>

        <p className="mt-3 text-[13px] text-muted/70">
          Short video in ~90 seconds. Long form in under six minutes. No editing knowledge of any kind.
        </p>
      </section>

      {/* The product in one picture: footage goes in one side, finished videos
          come out the other. This is the page's whole argument, and it sits
          above the fold on a laptop for exactly that reason. */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 pb-20">
        <FlowMap />
      </section>

      {/* ----------------------------------------------------------- steps */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 py-24">
        {/* The heading the prototype has always had. Without it the three
            cards floated, and the layers section that now follows them read as
            a reply to nothing. */}
        <h2 className="max-w-2xl text-3xl font-extrabold tracking-[-0.03em] sm:text-[40px]">
          Two decisions, then it&rsquo;s done.
        </h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-3">
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
            Everything a good editor would add.
          </h2>
          <p className="mt-4 max-w-xl text-muted">
            Not filters on top of your video — an actual edit, built from what you said.
          </p>

          <div className="mt-10">
            <LayerDemos />
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------- before / after */}
      <section className="relative z-10 border-t border-line bg-[#0B0B0E] py-24">
        <div className="mx-auto max-w-5xl px-6">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-extrabold tracking-[-0.03em] sm:text-[40px]">
              The same thirty seconds.
            </h2>
            <p className="mt-4 text-muted">
              Drag it. On the left is what came off the camera — the pauses are the
              red ones. On the right is what you&rsquo;d post.
            </p>
          </div>

          <div className="mt-10">
            <BeforeAfter />
          </div>

          <dl className="mt-8 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
            {[
              ['Cuts made', '94', 'Every pause, um and false start.'],
              ['Time removed', '2:34', 'Out of a 3:42 take.'],
              ['Your input', '1 upload', 'And two dropdowns.'],
            ].map(([label, value, note]) => (
              <div key={label} className="bg-charcoal px-5 py-5">
                <dt className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-faint">{label}</dt>
                <dd className="mt-1.5 text-2xl font-extrabold tracking-[-0.03em] text-violet">{value}</dd>
                <dd className="mt-1 text-[13px] text-muted">{note}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* -------------------------------------------------------- showreel */}
      {/* Drawn from the renderer's own layout plans until
          src/content/showcase.ts has real exports in it — see the note at
          the top of Showreel.tsx. */}
      <Showreel />

      {/* ---------------------------------------------------- who it's for */}
      <WhoItsFor />

      {/* ---------------------------------------------------------- styles */}
      <section id="styles" className="relative z-10 scroll-mt-16 border-t border-line py-24">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-3xl font-extrabold tracking-[-0.03em] sm:text-[40px]">Pick a look.</h2>
          <p className="mt-4 max-w-xl text-muted">
            Each one changes the pacing, the captions, the sound design and how much
            happens on screen. You can switch after the edit and re-render for free.
          </p>

          {/*
            * Drawn, not described.
            *
            * This section used to be twelve paragraphs, which is the one thing
            * a style picker must never be: "Punchy" and "Split screen" carry
            * exactly the same amount of information until you have seen one.
            * The preview is the same component the app's own picker uses and
            * reads from the same layout plan the renderer executes, so the
            * homepage cannot advertise a shape the product does not make.
            */}
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {STYLE_LIST.map((style) => (
              <div key={style.id} className="card flex gap-4 p-5">
                <StylePreview
                  layout={style.layout}
                  aspect="9:16"
                  accent={style.accent}
                  chapterCards={leadsWithCards(style, 'short')}
                  className="w-[74px] flex-none self-start"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5">
                    <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: style.accent }} />
                    <h3 className="text-base font-bold tracking-[-0.02em]">{style.name}</h3>
                  </div>
                  <p className="mt-1.5 text-[13.5px] font-medium leading-snug text-chalk/80">{style.tagline}</p>
                  <p className="mt-2 text-[13px] leading-relaxed text-muted">{style.bestFor}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- what it costs */}
      <CostCompare />

      {/* ------------------------------------------------- what it replaces */}
      <WhatItReplaces />

      {/* ---------------------------------------------------- testimonials */}
      {/* Renders nothing until src/content/testimonials.ts has real quotes in
          it — see the note at the top of that file. */}
      <Testimonials />

      {/* --------------------------------------------------------- pricing */}
      {/* On the homepage, not only on /pricing. Somebody deciding whether this
          is for them asks what it costs before they ask anything else, and a
          price they have to go hunting for reads as a price being hidden. */}
      <section id="pricing" className="relative z-10 scroll-mt-16 border-t border-line bg-[#0B0B0E] py-24">
        <div className="mx-auto max-w-6xl px-6">
          <PricingSection />
          <div className="mt-14 border-t border-line pt-10">
            <PricingExplainer />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- faq */}
      <div id="faq" className="scroll-mt-16">
        <Faq groups={FAQ_GROUPS} />
      </div>

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
          <Link href="/dashboard" className="btn-primary mt-8 px-7 py-3.5 text-[15px]">
            Open the dashboard
          </Link>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
