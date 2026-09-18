import Link from 'next/link';
import { PAID_PLANS, PLANS } from '@/lib/billing/plans';
import { SiteFooter } from '@/components/marketing/SiteFooter';

export const metadata = {
  title: 'Terms — EasyCut',
  description: 'What you are agreeing to, in plain English.',
};

/**
 * Terms of service.
 *
 * Written the same way as the privacy policy: against what the software
 * actually does, in sentences a person can read once. The allowances and
 * retention windows are pulled from `src/lib/billing/plans.ts` rather than
 * typed out, so the terms cannot end up describing a plan that no longer
 * exists.
 *
 * Like the privacy policy, this is a plain description of real behaviour and
 * not legal advice. It needs a lawyer's pass before launch — docs/LAUNCH.md
 * says so, and the two places where the decision is genuinely commercial
 * rather than technical (refunds, what happens on cancellation) are written as
 * the policy the code currently implements, which is the honest starting point
 * for that conversation.
 */

const UPDATED = '18 September 2026';

export default function TermsPage() {
  return (
    <>
      <main className="min-h-screen bg-ink px-5 py-12 sm:px-8">
        <div className="mx-auto max-w-[68ch]">
          <Link href="/" className="text-[13px] font-semibold text-violet hover:underline">
            ← EasyCut
          </Link>

          <h1 className="mt-6 text-[32px] font-extrabold leading-[1.15] tracking-[-.035em]">Terms</h1>
          <p className="mt-2 text-[13.5px] text-muted">Last updated {UPDATED}</p>

          <p className="mt-6 text-[15px] leading-relaxed text-chalk/90">
            The short version: you keep your footage and everything we make from it, you pay monthly
            for a set amount of footage, and either of us can walk away at the end of a month. The
            rest of this page is that, with the details filled in.
          </p>

          <Section title="What EasyCut does">
            <p>
              You upload video of yourself talking. We transcribe it, decide where the cuts and the
              captions and the B-roll go, and render a finished video. You can change any of it in
              the editor, and re-render as often as you like while we still hold your footage.
            </p>
            <p>
              The edit is made by software making judgement calls. It is usually good and it is
              sometimes wrong — that is what the editor is for. We do not promise any particular
              creative result, and you should watch a video before you post it.
            </p>
          </Section>

          <Section title="Your account">
            <p>
              One person per account. Keep your sign-in to yourself; anything done from your account
              is treated as done by you. You must be 16 or older.
            </p>
          </Section>

          <Section title="Your content stays yours">
            <p>
              You own your footage and you own the finished videos. Nothing here transfers that.
            </p>
            <p>
              You give us permission to do the one thing you are paying for: store your file,
              process it, and send the necessary parts to the services that do transcription and
              editing decisions — set out precisely in the{' '}
              <Link href="/privacy" className="font-semibold text-violet hover:underline">
                privacy policy
              </Link>
              . That permission ends when the content is deleted. We do not use your footage,
              transcripts or finished videos to train models, and we do not show your work to anyone
              else.
            </p>
            <p>
              You are responsible for having the right to upload what you upload — including anyone
              else who appears or is audible in it.
            </p>
          </Section>

          <Section title="What you may not do">
            <p>
              Do not upload anything illegal, anything you do not have the rights to, sexual content
              involving minors, or material made to harass or impersonate someone. Do not resell
              access to the service itself, and do not try to get around the allowance on your plan
              with multiple accounts. We can suspend an account that does any of this, and we will
              tell you why.
            </p>
          </Section>

          <Section title="Plans, payment and cancellation">
            <p>
              Plans are monthly and charged in advance. Each one includes an amount of footage —
              from {PAID_PLANS[0].footageMinutes} minutes on {PAID_PLANS[0].name} up to{' '}
              {PAID_PLANS[PAID_PLANS.length - 1].footageMinutes / 60} hours on{' '}
              {PAID_PLANS[PAID_PLANS.length - 1].name} — measured by the length of the files you
              upload, not by the number of videos that come out. When the allowance runs out, new
              videos wait until it resets on your billing date; nothing you have already made is
              affected. Unused footage does not roll over.
            </p>
            <p>
              Cancel whenever you like and the plan runs to the end of the month you have paid for.
              Since a plan is consumed as you use it, we do not refund part-months as a rule — but if
              the software genuinely failed you, write to us and we will sort it out. We are not
              interested in keeping money from somebody we let down.
            </p>
            <p>
              If we change a price, existing subscribers get a month&rsquo;s notice by email before
              it applies.
            </p>
          </Section>

          <Section title="How long we keep things">
            <p>
              Two clocks, set by your plan: how long we keep the footage you uploaded, and how long
              we keep the finished videos. On {PLANS.starter.name} that is{' '}
              {PLANS.starter.sourceRetentionDays} days and {PLANS.starter.renderRetentionDays} days;
              on {PLANS.studio.name} it is {PLANS.studio.sourceRetentionDays} days and for as long as
              you subscribe. Deletion is automatic and permanent.
            </p>
            <p>
              Once footage is deleted a video can still be watched and downloaded but can no longer
              be re-cut, because re-rendering needs the original. Download anything you want to keep.
              If you cancel, export your videos before the subscription ends.
            </p>
          </Section>

          <Section title="What we do not promise">
            <p>
              We work hard to keep this running and we do not promise it never breaks. Jobs can fail,
              providers we depend on can have bad days, and we may take the service down for
              maintenance. Where something goes wrong on our side, what we owe you is limited to what
              you paid us in the previous month — which is the honest limit for a subscription at
              this price.
            </p>
            <p>
              Keep your own copy of anything that matters. We are a tool in your workflow, not your
              archive.
            </p>
          </Section>

          <Section title="Changes and endings">
            <p>
              We may update these terms; if a change materially affects you, we will email you before
              it takes effect. You can close your account at any time from settings, and everything
              in it is deleted. We can close an account that breaks the rules above, and will refund
              any unused paid time when we do.
            </p>
          </Section>

          <Section title="Contact">
            <p>
              Anything at all: <span className="text-chalk">hello@easycut.ai</span>.
            </p>
          </Section>

          <p className="mt-12 border-t border-line pt-5 text-[12.5px] leading-relaxed text-faint">
            This page describes how EasyCut actually operates today, in plain English. It is not
            legal advice and has not yet been reviewed by a lawyer.
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10 border-t border-line pt-7">
      <h2 className="text-[19px] font-bold tracking-[-.025em]">{title}</h2>
      <div className="mt-3 space-y-3 text-[14.5px] leading-relaxed text-muted [&>p]:leading-relaxed">
        {children}
      </div>
    </section>
  );
}
