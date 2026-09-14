import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { ProjectWorkspace } from '@/components/ProjectWorkspace';
import { db } from '@/lib/db';
import { STYLE_LIST } from '@/lib/styles/presets';

export const dynamic = 'force-dynamic';

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await db.project.findUnique({ where: { id } }).catch(() => null);
  if (!project) notFound();

  return (
    <main className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Link href="/">
          <Logo />
        </Link>
        <div className="flex items-center gap-2">
          <Link href="/dashboard" className="btn-ghost">
            My videos
          </Link>
          <Link href="/new" className="btn-primary">
            New video
          </Link>
        </div>
      </header>

      <ProjectWorkspace
        projectId={id}
        styles={STYLE_LIST.map((s) => ({ id: s.id, name: s.name, accent: s.accent, tagline: s.tagline }))}
      />
    </main>
  );
}
