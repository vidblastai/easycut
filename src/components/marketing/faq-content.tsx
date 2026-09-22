import Link from 'next/link';
import { ASPECTS } from '@/lib/edl/types';
import { PAID_PLANS, PLANS } from '@/lib/billing/plans';
import { STYLE_LIST } from '@/lib/styles/presets';
import type { FaqGroup } from './Faq';

/**
 * The answers, kept out of the interactive component.
 *
 * Separate file because the tabs need `use client` and these numbers come from
 * the plan definitions and the style list — which are server-side truths. Read
 * here and passed in as props, so the FAQ cannot quote a price the software
 * does not charge or a style count the picker does not offer.
 */

const STARTER = PAID_PLANS[0];

export const FAQ_GROUPS: FaqGroup[] = [
  {
    id: 'edit',
    label: 'The edit',
    items: [
      {
        q: 'Do I need to know how to edit?',
        a: (
          <>
            No. You pick a style, drop the file in, and the edit is made — cuts, captions, B-roll,
            graphics, sound effects and music. There is a full timeline editor if you want to
            change something, but nothing needs you to open it.
          </>
        ),
      },
      {
        q: 'What does it actually do to my video?',
        a: (
          <>
            It removes the silences, the ums, the false starts and the takes you redid, then builds
            an edit on top: word-by-word captions timed to your speech, B-roll where you name
            something concrete, graphics for the numbers you say, punch-ins, transitions and a
            music bed that ducks under your voice.
          </>
        ),
      },
      {
        q: 'Can I change something afterwards?',
        a: (
          <>
            Yes, and it is the cheap path. Every layer is editable in the timeline, and re-rendering
            after a change only redraws the part that changed rather than the whole video — so
            fixing one caption takes seconds, not another full render.
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
        q: 'Which aspect ratios do I get?',
        a: (
          <>
            All {ASPECTS.length} — {ASPECTS.join(', ')} — out of the same edit, so you are not
            exporting once per platform. The framing follows the speaker rather than cropping the
            middle out.
          </>
        ),
      },
    ],
  },
  {
    id: 'app',
    label: 'The app',
    items: [
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
        q: 'How long can my video be?',
        a: (
          <>
            Up to {STARTER.maxMinutesPerUpload} minutes in a single upload on {STARTER.name}, and
            up to {PAID_PLANS[PAID_PLANS.length - 1].maxMinutesPerUpload} minutes on the top plan.
            That is a separate limit from the monthly allowance, so one long file cannot eat your
            whole month in a single click.
          </>
        ),
      },
      {
        q: 'Is there a watermark?',
        a: (
          <>
            Only on the free tier. Every paid plan exports clean, at 1080p, in every aspect ratio.
          </>
        ),
      },
      {
        q: 'What happens to my footage?',
        a: (
          <>
            It is deleted on a schedule your plan sets — {STARTER.sourceRetentionDays} days on{' '}
            {STARTER.name} — and the finished videos are kept far longer. Deletion is automatic and
            permanent. Once the footage has gone you can still watch and download what you made;
            you just cannot re-render it.{' '}
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
            specialist services — the audio to a transcription provider, the transcript text to the
            AI director — and each one gets the least it needs. Your video itself never goes to the
            AI.
          </>
        ),
      },
    ],
  },
  {
    id: 'billing',
    label: 'Billing',
    items: [
      {
        q: 'Can I try it before paying?',
        a: (
          <>
            Yes — {PLANS.free.footageMinutes} minutes free, on your own footage, watermarked. That
            is a whole video, not a preview of one.
          </>
        ),
      },
      {
        q: 'Why is it measured in minutes rather than videos?',
        a: (
          <>
            Because almost everything a video costs scales with how much footage went in, not with
            how many clips came out. A plan sold as &ldquo;three videos&rdquo; would have to either
            refuse your hour-long podcast or lose money on it. The page shows both numbers, and the
            video counts are deliberately cautious — film tighter and you get more.
          </>
        ),
      },
      {
        q: 'What happens if I go over?',
        a: (
          <>
            You are told before the upload starts, not after. The meter is checked against the file
            you are about to send, so nothing gets halfway through and then fails.
          </>
        ),
      },
      {
        q: 'Can I cancel?',
        a: (
          <>
            Any time, from your account settings. You keep the plan until the end of the month you
            have paid for, and your finished videos stay for as long as the plan you made them on
            promised — changing plan does not retroactively shorten anything you already made.
          </>
        ),
      },
      {
        q: 'What if a video comes out badly?',
        a: (
          <>
            Open it in the editor and fix the bit that is wrong, or switch style and re-render —
            both are free and neither re-runs the analysis. If it failed outright, it says where it
            stopped and everything before that point is kept.
          </>
        ),
      },
    ],
  },
];
