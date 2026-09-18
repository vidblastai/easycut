import Link from 'next/link';
import { PAID_PLANS, PLANS } from '@/lib/billing/plans';
import { SiteFooter } from '@/components/marketing/SiteFooter';

export const metadata = {
  title: 'Privacy — EasyCut',
  description: 'What we collect, who we send it to, and when it is deleted.',
};

/**
 * The privacy policy.
 *
 * Written against what the code actually does, not against a template: the
 * retention table below is generated from `src/lib/billing/plans.ts`, which is
 * the same file the sweeper reads, so the page cannot promise a schedule the
 * software is not keeping. If somebody changes Starter to fourteen days, this
 * page says fourteen days on the next deploy.
 *
 * The sub-processor list is the set of services the pipeline can actually call
 * — see src/lib/transcribe, src/lib/director and src/lib/assets. A service that
 * is not configured is never contacted, which is why the list says "when
 * enabled" rather than naming them all as certainties.
 *
 * This is a plain-English description of real behaviour, not legal advice. It
 * needs a lawyer's pass before launch, and the places where a decision is
 * genuinely yours rather than the code's are marked in docs/LAUNCH.md.
 */

const UPDATED = '17 September 2026';

export default function PrivacyPage() {
  return (
    <>
      <main className="min-h-screen bg-ink px-5 py-12 sm:px-8">
      <div className="mx-auto max-w-[68ch]">
        <Link href="/" className="text-[13px] font-semibold text-violet hover:underline">
          ← EasyCut
        </Link>

        <h1 className="mt-6 text-[32px] font-extrabold leading-[1.15] tracking-[-.035em]">
          Privacy
        </h1>
        <p className="mt-2 text-[13.5px] text-muted">Last updated {UPDATED}</p>

        <p className="mt-6 text-[15px] leading-relaxed text-chalk/90">
          You upload footage of yourself talking. That is about as personal as a file gets, so this
          page says plainly what happens to it — what we keep, who else sees it, and when it is
          deleted. Everything here describes what the software actually does.
        </p>

        <Section title="What we collect">
          <Row k="Your account">
            Email address, and your name if you gave one. Sign-in is handled by Clerk; we never see
            or store a password.
          </Row>
          <Row k="Your footage">
            The video file you upload, and the proxy and audio track we derive from it to do the
            work.
          </Row>
          <Row k="What you said">
            A transcript with word-level timings, produced from the audio. It is the thing the whole
            edit is built from — the cuts, the captions and the B-roll choices all come out of it.
          </Row>
          <Row k="The edit itself">
            The finished video, its thumbnail, and the edit decision list describing every cut and
            layer, so you can change it later without paying to analyse the footage again.
          </Row>
          <Row k="How much you have used">
            Minutes of footage processed this month, against your plan&rsquo;s allowance. Nothing
            else about your usage is tracked.
          </Row>
          <Row k="What we do not collect">
            No advertising identifiers, no cross-site tracking, no third-party analytics watching you
            use the app.
          </Row>
        </Section>

        <Section title="Who else sees it">
          <p className="text-[14.5px] leading-relaxed text-muted">
            Making a video means sending parts of it to specialist services. Each one gets the least
            it needs, and only the ones switched on for this deployment are ever contacted.
          </p>
          <Row k="Transcription">
            Your audio — not the video — goes to a speech-to-text provider (Deepgram, Groq or
            AssemblyAI, depending on configuration) to produce the transcript.
          </Row>
          <Row k="The AI director">
            The transcript <em>text</em> goes to Anthropic or Google Gemini to decide the hook, the
            cuts and where B-roll belongs. Your video is never sent — only the words.
          </Row>
          <Row k="B-roll and images">
            Short search terms derived from what you said (&ldquo;calculator desk notepad&rdquo;) go
            to Pexels or Pixabay, and to Replicate or fal when an illustration is generated. No part
            of your footage is sent.
          </Row>
          <Row k="Storage and hosting">
            Files are stored with Cloudflare R2 or Amazon S3; the app and workers run on our hosting
            provider.
          </Row>
          <Row k="Payments">
            Handled by Stripe. Card details go to Stripe directly and never reach our servers.
          </Row>
          <p className="mt-4 text-[14.5px] leading-relaxed text-muted">
            We do not sell your data, and we do not use your footage, transcripts or finished videos
            to train any model of our own.
          </p>
        </Section>

        <Section title="How long we keep it">
          <p className="text-[14.5px] leading-relaxed text-muted">
            Two clocks, because the two things are different sizes and have different uses. Your
            original footage is enormous and, once the edit exists, is only needed for re-cutting.
            The finished video is small and is the thing you come back for.
          </p>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[30rem] border-collapse text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-line">
                  <th className="py-2 pr-4 font-semibold text-faint">Plan</th>
                  <th className="py-2 pr-4 font-semibold text-faint">Your footage</th>
                  <th className="py-2 font-semibold text-faint">Your finished videos</th>
                </tr>
              </thead>
              <tbody>
                {[PLANS.free, ...PAID_PLANS].map((plan) => (
                  <tr key={plan.id} className="border-b border-line-soft">
                    <td className="py-2.5 pr-4 font-semibold text-chalk">{plan.name}</td>
                    <td className="py-2.5 pr-4 text-muted">{plan.sourceRetentionDays} days</td>
                    <td className="py-2.5 text-muted">
                      {plan.renderRetentionDays === null
                        ? 'While you are subscribed'
                        : `${plan.renderRetentionDays} days`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-5 text-[14.5px] leading-relaxed text-muted">
            Deletion is automatic and permanent — a background job removes the files from storage on
            the schedule above, and they are not recoverable afterwards. Once your footage has gone
            you can still watch and download your finished video, but it can no longer be re-edited
            or exported in another shape, because re-rendering needs the original.
          </p>
          <p className="mt-3 text-[14.5px] leading-relaxed text-muted">
            Delete a project yourself and everything belonging to it — footage, transcript, edit and
            renders — is removed immediately rather than on a schedule. Close your account and the
            same happens to everything in it.
          </p>
        </Section>

        <Section title="What you can ask for">
          <Row k="A copy">Every video you have made is downloadable from the app at any time.</Row>
          <Row k="Deletion">
            Delete any project from your dashboard, or ask us to close your account entirely.
          </Row>
          <Row k="Correction">Your name and email can be changed in your account settings.</Row>
          <Row k="A question">
            Anything else — including where your data sits and who has touched it — we will answer.
          </Row>
        </Section>

        <Section title="Security">
          <p className="text-[14.5px] leading-relaxed text-muted">
            Files are transferred over TLS and stored with access restricted to the application.
            Every project is tied to the account that made it, and a request for someone else&rsquo;s
            project is refused whether or not you happen to know its address. Sign-in, passwords and
            session security are handled by Clerk rather than by us, which is deliberate: it is the
            part most worth not writing ourselves.
          </p>
        </Section>

        <Section title="Children">
          <p className="text-[14.5px] leading-relaxed text-muted">
            EasyCut is not intended for anyone under 16, and we do not knowingly hold data from
            them. If a child&rsquo;s footage has been uploaded, tell us and it will be removed.
          </p>
        </Section>

        <Section title="Changes">
          <p className="text-[14.5px] leading-relaxed text-muted">
            If this policy changes in a way that affects what happens to footage you have already
            uploaded, we will email you before it takes effect. Retention periods in force when you
            uploaded something continue to apply to it — changing your plan does not retroactively
            shorten how long we keep what you made on the old one.
          </p>
        </Section>

        <Section title="Contact">
          <p className="text-[14.5px] leading-relaxed text-muted">
            Questions about any of this: <span className="text-chalk">privacy@easycut.ai</span>.
          </p>
        </Section>

        <p className="mt-12 border-t border-line pt-5 text-[12.5px] leading-relaxed text-faint">
          EasyCut is an independent product. This page describes how the software behaves today; it
          is not legal advice, and it is reviewed whenever the pipeline changes what it sends or how
          long it keeps it.
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
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * A labelled paragraph.
 *
 * A definition list rather than prose because this is reference material —
 * people arrive looking for one answer ("what happens to my footage?") and
 * should be able to find it without reading the paragraph above it.
 */
function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 grid gap-1 sm:grid-cols-[minmax(0,10.5rem)_minmax(0,1fr)] sm:gap-5">
      <p className="text-[13.5px] font-semibold text-chalk">{k}</p>
      <p className="text-[14.5px] leading-relaxed text-muted">{children}</p>
    </div>
  );
}
