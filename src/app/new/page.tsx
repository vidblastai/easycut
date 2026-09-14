import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { UploadFlow } from '@/components/UploadFlow';
import { STYLE_LIST, FORMAT_PRESETS } from '@/lib/styles/presets';
import { capabilities } from '@/lib/config/env';

export const dynamic = 'force-dynamic';

export default function NewProjectPage() {
  const missing = capabilities().filter((c) => !c.configured && (c.key === 'asr' || c.key === 'llm'));

  return (
    <main className="min-h-screen">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <Link href="/">
          <Logo />
        </Link>
        <Link href="/dashboard" className="btn-ghost">
          My videos
        </Link>
      </header>

      <div className="mx-auto max-w-3xl px-6 pb-24">
        <h1 className="text-3xl font-extrabold tracking-[-0.03em] sm:text-[40px]">Upload your footage</h1>
        <p className="mt-3 text-muted">Three choices, then we take it from here.</p>

        {missing.length > 0 ? (
          <div className="mt-6 rounded-2xl border border-warn/30 bg-warn/[0.06] p-4 text-sm">
            <p className="font-semibold text-warn">Running with reduced features</p>
            <ul className="mt-2 space-y-1 text-muted">
              {missing.map((c) => (
                <li key={c.key}>
                  <span className="font-medium text-chalk">{c.label}</span> is not configured — {c.fallback}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-muted">
              Your video will still render. See <code className="text-chalk">docs/API_KEYS.md</code> to switch these on.
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
          }))}
          formats={[FORMAT_PRESETS.short, FORMAT_PRESETS.long]}
        />
      </div>
    </main>
  );
}
