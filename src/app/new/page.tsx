import { AppShell, ShellMain } from '@/components/shell/AppShell';
import { UploadFlow } from '@/components/UploadFlow';
import { STYLE_LIST, FORMAT_PRESETS, leadsWithCards } from '@/lib/styles/presets';
import { capabilities } from '@/lib/config/env';
import { db } from '@/lib/db';
import { recentsFor } from '@/lib/ui/recents';

export const dynamic = 'force-dynamic';

export default async function NewProjectPage() {
  const missing = capabilities().filter((c) => !c.configured && (c.key === 'asr' || c.key === 'llm'));
  const projects = await db.project
    .findMany({ orderBy: { createdAt: 'desc' }, take: 8 })
    .catch(() => []);

  return (
    <AppShell recents={recentsFor(projects)}>
      {/* The stepper lives inside the wizard, not above it. A static copy here
          plus the live one in the flow meant two rails saying different things
          the moment you answered the first question. */}
      <ShellMain>
        <div className="mx-auto max-w-[760px] pt-5">
          {missing.length > 0 ? (
            <div className="mb-6 rounded-2xl border border-warn/30 bg-warn/[0.06] p-4 text-[13px]">
              <p className="font-semibold text-warn">Running with reduced features</p>
              <ul className="mt-2 space-y-1 text-muted">
                {missing.map((c) => (
                  <li key={c.key}>
                    <span className="font-medium text-chalk">{c.label}</span> is not configured — {c.fallback}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-muted">
                Your video will still render. <code className="text-chalk">docs/API_KEYS.md</code> says how to
                switch these on.
              </p>
            </div>
          ) : null}

          <UploadFlow
            styles={STYLE_LIST.map((s) => ({
              id: s.id,
              name: s.name,
              tagline: s.tagline,
              bestFor: s.bestFor,
              accent: s.accent,
              layout: s.layout,
              formats: s.formats,
              // Computed here, where the whole preset is in hand: the card is
              // a client component and should not have to carry the pacing
              // tables across the wire to work out what to draw.
              chapterCards: { short: leadsWithCards(s, 'short'), long: leadsWithCards(s, 'long') },
            }))}
            formats={[FORMAT_PRESETS.short, FORMAT_PRESETS.long]}
          />
        </div>
      </ShellMain>
    </AppShell>
  );
}
