import Link from 'next/link';

/**
 * "Use it inside Claude" — the MCP server, said for people rather than for
 * developers. The pitch is the plan they already pay for: their Claude does
 * the creative part, EasyCut does the editing.
 */
const STEPS = [
  {
    n: '01',
    title: 'Add EasyCut to Claude',
    body: 'In Claude, open Settings → Connectors → Add custom connector and paste the EasyCut address. Sign in once. That is the whole setup.',
  },
  {
    n: '02',
    title: 'Ask for the edit',
    body: '“Edit this into a 40-second short and animate the three key points.” Share a link to the footage, or upload it to EasyCut.',
  },
  {
    n: '03',
    title: 'Watch it come together',
    body: 'Claude reads your transcript, picks the moments, writes the animations and checks every frame. EasyCut cuts, captions, scores and renders it.',
  },
];

export function ClaudeSection() {
  return (
    <section id="claude" className="relative z-10 scroll-mt-16 border-t border-line py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.15fr] lg:items-center">
          <div>
            <span className="eyebrow inline-flex items-center gap-2 text-violet">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-violet" />
              New
            </span>
            <h2 className="mt-3 text-3xl font-extrabold leading-[1.1] tracking-[-0.03em] sm:text-[40px]">
              Already use Claude?
              <br />
              <span className="text-violet">Edit your videos from inside it.</span>
            </h2>
            <p className="mt-4 max-w-[52ch] text-muted">
              Connect EasyCut to your Claude account and talk to your edit. Your Claude does the
              creative work on the plan you already have, and EasyCut does everything a video
              editor does: the cuts, captions, B-roll, sound and the final render.
            </p>
            <ul className="mt-6 space-y-2.5 text-[14.5px]">
              {[
                'Change anything by asking: “make the captions bigger”, “cut the intro”',
                'Animated scenes written for exactly what you say',
                'Works in claude.ai, the Claude desktop app and Claude Code',
              ].map((line) => (
                <li key={line} className="flex gap-2.5">
                  <svg width="18" height="18" viewBox="0 0 20 20" className="mt-0.5 flex-none text-violet" aria-hidden>
                    <path d="m5 10.5 3.2 3.2L15 6.8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="text-chalk/90">{line}</span>
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/settings#claude" className="btn-primary px-6 py-3 text-[15px]">
                Connect Claude
              </Link>
              <Link href="/new" className="btn-ghost px-6 py-3 text-[15px]">
                Or upload on the web
              </Link>
            </div>
          </div>

          <ol className="grid gap-3.5">
            {STEPS.map((step) => (
              <li key={step.n} className="card p-6">
                <div className="text-[12px] font-bold tracking-[0.14em] text-violet">{step.n}</div>
                <h3 className="mt-1.5 text-[17px] font-bold tracking-[-0.02em]">{step.title}</h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
