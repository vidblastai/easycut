import Link from 'next/link';
import { ASPECTS } from '@/lib/edl/types';
import { PAID_PLANS, PLANS } from '@/lib/billing/plans';
import { STYLE_LIST } from '@/lib/styles/presets';

/**
 * The questions people actually ask before paying.
 *
 * Every answer here is checked against what the code does, and the numbers are
 * read from the plan definitions rather than typed in — a FAQ is the part of a
 * site people quote back at you, so it is the worst possible place for a
 * number that used to be true.
 *
 * `<details>` rather than JavaScript: it is open-able before hydration, it is
 * keyboard accessible for free, and search engines read the answers.
 */

const STARTER = PAID_PLANS[0];

const FAQS: Array<{ q: string; a: React.ReactNode }> = [
  {
    q: 'Do I need to know how to edit?',
    a: (
      <>
        No. You pick a style, drop the file in, and the edit is made — cuts, captions, B-roll,
        graphics, sound effects and music. There is a full timeline editor if you want to change
        something, but nothing needs you to open it.
      </>
    ),
  },
  {
    q: 'What does it actually do to my video?',
    a: (
      <>
        It removes the silences, the ums, the false starts and the takes you redid, then builds an
        edit on top: word-by-word captions timed to your speech, B-roll where you name something
        concrete, graphics for the numbers you say, punch-ins, transitions and a music bed that
        ducks under your voice.
      </>
    ),
  },
  {
    q: 'How long does it take?',
    a: (
      <>
        Analysis is a couple of minutes. The render depends on length — a short is quick, a
        ten-minute video takes longer. You can close the tab; it emails you when it is done.
      </>
    ),
  },
  {
    q: 'Can I change something afterwards?',
    a: (
      <>
        Yes, and it is the cheap path. Every layer is editable in the timeline, and re-rendering
        after a change only redraws the part that changed rather than the whole video — so fixing
        one caption takes seconds, not another full render.
      </>
    ),
  },
  {
    q: 'Which aspect ratios do I get?',
    a: (
      <>
        All {ASPECTS.length} — {ASPECTS.join(', ')} — out of the same edit, so you are not
        exporting once per platform. The framing follows the speaker rather than cropping the
        middle out.
      </>
    ),
  },
  {
    q: 'What happens to my footage?',
    a: (
      <>
        It is deleted on a schedule your plan sets — {STARTER.sourceRetentionDays} days on{' '}
        {STARTER.name} — and the finished videos are kept far longer. Deletion is automatic and
        permanent.{' '}
        <Link href="/privacy" className="font-semibold text-violet hover:underline">
          The full schedule is in the privacy policy.
        </Link>
      </>
    ),
  },
  {
    q: 'Is my video used to train anything?',
    a: (
      <>
        No. Your footage, transcripts and finished videos are never used to train any model of
        ours, and we do not sell your data. Making the video means sending parts of it to
        specialist services — the audio to a transcription provider, the transcript text to the AI
        director — and each one gets the least it needs.
      </>
    ),
  },
  {
    q: 'Can I try it before paying?',
    a: (
      <>
        Yes — {PLANS.free.footageMinutes} minutes free, on your own footage, watermarked. That is
        a whole video, not a preview of one.
      </>
    ),
  },
  {
    q: 'What if I pick the wrong style?',
    a: (
      <>
        Switch it and re-render. There are {STYLE_LIST.length} styles and changing between them
        costs nothing — it replays the edit against the same analysis rather than starting over.
      </>
    ),
  },
  {
    q: 'Can I cancel?',
    a: (
      <>
        Any time, from your account settings. You keep the plan until the end of the month you
        have paid for, and your finished videos stay for as long as the plan you made them on
        promised.
      </>
    ),
  },
];

export function Faq() {
  return (
    <section className="relative z-10 border-t border-line py-24">
      <div className="mx-auto max-w-3xl px-6">
        <h2 className="text-3xl font-extrabold tracking-[-0.03em] sm:text-[40px]">
          Questions.
        </h2>

        <div className="mt-10 divide-y divide-line-soft border-y border-line-soft">
          {FAQS.map((item) => (
            <details key={item.q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15.5px] font-bold tracking-[-0.01em] marker:hidden">
                {item.q}
                <span
                  aria-hidden
                  className="grid h-6 w-6 flex-none place-items-center rounded-full border border-line text-muted transition-transform group-open:rotate-45"
                >
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
                    <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </span>
              </summary>
              <p className="mt-3 max-w-[62ch] text-[14.5px] leading-relaxed text-muted">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
