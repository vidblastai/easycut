import Link from 'next/link';
import { Logo } from '@/components/Logo';

/**
 * The footer, and the only place the policies are guaranteed to be findable.
 *
 * Terms and a privacy policy are not decoration and they are not a page in a
 * sidebar: they are the two links a person looks for in the bottom-left of a
 * site before they hand over a card and an hour of their own face. Stripe asks
 * for them, app stores ask for them, and anybody cautious enough to check is
 * exactly the customer worth keeping. So they live here, on every marketing
 * page, in the place everybody already looks.
 *
 * Grouped rather than listed flat, because a single row of eight links reads as
 * a tag cloud. Three headings — what it is, what it costs, what you agreed to —
 * is the shape people scan.
 */

const COLUMNS: Array<{ title: string; links: Array<{ href: string; label: string; external?: boolean }> }> = [
  {
    title: 'Product',
    links: [
      { href: '/new', label: 'Make a video' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/captions', label: 'Caption styles' },
      { href: '/help', label: 'How it works' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { href: '/privacy', label: 'Privacy policy' },
      { href: '/terms', label: 'Terms of service' },
    ],
  },
  {
    title: 'More',
    links: [
      {
        href: 'https://github.com/vidblastai/easycut/tree/claude/easycut-ai-video-editor-cnpana',
        label: 'Source code',
        external: true,
      },
      { href: 'mailto:hello@easycut.ai', label: 'Contact', external: true },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="relative z-10 border-t border-line bg-[#0B0B0E]">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-9 sm:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]">
          <div>
            <Logo size={26} />
            <p className="mt-3 max-w-[34ch] text-[13px] leading-relaxed text-muted">
              Upload the footage, get a finished video. Built for people who would rather be making
              things than editing them.
            </p>
          </div>

          {COLUMNS.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <h2 className="text-[10.5px] font-bold uppercase tracking-[.09em] text-faint">
                {column.title}
              </h2>
              <ul className="mt-3 space-y-2">
                {column.links.map((link) => (
                  <li key={link.href}>
                    {link.external ? (
                      <a
                        href={link.href}
                        target={link.href.startsWith('http') ? '_blank' : undefined}
                        rel={link.href.startsWith('http') ? 'noopener' : undefined}
                        className="text-[13.5px] text-muted transition-colors hover:text-chalk"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-[13.5px] text-muted transition-colors hover:text-chalk"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-line-soft pt-6 text-[12.5px] text-faint sm:flex-row sm:items-center sm:justify-between">
          <p>&copy; {new Date().getFullYear()} EasyCut</p>
          {/* Repeated in the bottom bar on purpose. It is the one row people
              scan for these two, and a link nobody can find is a link that is
              not there. */}
          <p className="flex flex-wrap gap-x-5 gap-y-1">
            <Link href="/privacy" className="transition-colors hover:text-chalk">
              Privacy
            </Link>
            <Link href="/terms" className="transition-colors hover:text-chalk">
              Terms
            </Link>
            <Link href="/pricing" className="transition-colors hover:text-chalk">
              Pricing
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
