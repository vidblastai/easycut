import Link from 'next/link';
import { AppShell, ShellMain } from '@/components/shell/AppShell';
import { db } from '@/lib/db';
import { recentsFor } from '@/lib/ui/recents';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'How it works — EasyCut',
  description: 'What happens to your footage between dropping it in and getting a finished video back.',
};

/**
 * What actually happens to someone's footage.
 *
 * Written for the person uploading, not the person deploying: no stage names,
 * no provider names, and every claim is something they can check against the
 * video they get back. The things that cannot be promised — that the AI will
 * always pick the right B-roll — are stated as "usually", because a help page
 * that oversells is how a good result still feels like a failure.
 */
export default async function HelpPage() {
  const projects = await db.project.findMany({ orderBy: { createdAt: 'desc' }, take: 8 }).catch(() => []);

  return (
    <AppShell recents={recentsFor(projects)}>
      <ShellMain>
        <div className="mx-auto max-w-[68ch] pt-7">
          <h1 className="text-[28px] font-extrabold">How it works</h1>
          <p className="mt-1.5 text-[13.5px] text-muted">
            You bring footage of yourself talking. Everything after that is ours.
          </p>

          <ol className="mt-8 space-y-6">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-4">
                <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-violet-dim text-[12px] font-bold tabular-nums text-violet">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <h2 className="text-[15px] font-bold">{step.title}</h2>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>

          <h2 className="mt-10 text-[17px] font-bold">Questions people actually ask</h2>
          <dl className="mt-4 space-y-5">
            {FAQ.map((item) => (
              <div key={item.q}>
                <dt className="text-[14px] font-bold">{item.q}</dt>
                <dd className="mt-1 text-[13.5px] leading-relaxed text-muted">{item.a}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-10 rounded-[18px] border border-line bg-charcoal p-6 text-center">
            <p className="text-[15px] font-bold">Ready when you are.</p>
            <Link href="/new" className="btn-primary mt-4">
              Upload your footage
            </Link>
          </div>
        </div>
      </ShellMain>
    </AppShell>
  );
}

const STEPS = [
  {
    title: 'You drop in one file',
    body:
      'Straight off your phone or camera is fine. We ask three things: where it is going, whether you already trimmed it, and which look you want. Everything else — resolution, frame rate, where the cuts go — we work out.',
  },
  {
    title: 'We listen to it',
    body:
      'The whole thing gets transcribed word by word, with the exact moment each word starts and ends. That transcript is what makes the rest possible: the captions come from it, and so does knowing where you paused, restarted, or said "um".',
  },
  {
    title: 'We cut it',
    body:
      'If you said your footage was raw, the dead air comes out, along with filler words and the takes you abandoned halfway through. If you said it was already trimmed, we leave your cut alone and only add layers on top.',
  },
  {
    title: 'We build the edit',
    body:
      'Captions timed to your voice, B-roll over the parts that are describing something, icons and text where you make a point, punch-ins on the lines that matter, transitions, sound effects and a music bed under it all.',
  },
  {
    title: 'You fine-tune it',
    body:
      'Step three of the pipeline is yours. Change the caption look, drop a B-roll clip you do not like, trim a moment, move a cut. Every one of those replays the cheap half of the process — none of them costs anything or takes minutes.',
  },
  {
    title: 'You post it',
    body:
      'Download the file, or export the same edit in another shape — a 1:1 for the feed, a 16:9 for YouTube — without re-uploading or re-analysing anything.',
  },
];

const FAQ = [
  {
    q: 'Do you generate a voice?',
    a: 'No. It is your voice, your face, your footage. We never synthesise speech — the whole product is built around the assumption that you already recorded something real.',
  },
  {
    q: 'What does "already trimmed" actually change?',
    a: 'It turns off cutting. On raw footage we remove silences and mistakes, which can take several minutes out of a ten-minute recording. On a rough cut we treat your timing as deliberate and only add captions, B-roll and sound on top.',
  },
  {
    q: 'Will it cut something I wanted to keep?',
    a: 'Sometimes. A long deliberate pause looks a lot like dead air. That is what fine-tuning is for — every cut is visible on the timeline and any of them can be put back, for free.',
  },
  {
    q: 'How long does it take?',
    a: 'A 30–60 second short is usually a few minutes end to end, most of it rendering. Ten minutes of long-form takes considerably longer, because every frame of the output has to be drawn.',
  },
  {
    q: 'Can I change the captions after it is done?',
    a: 'Yes, and it is free. Font, colour, size, position, motion, how many words at a time — all of it. Caption changes replay cached work, so nothing is transcribed or analysed twice.',
  },
];
