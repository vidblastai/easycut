import { notFound } from 'next/navigation';
import { ProjectWorkspace } from '@/components/ProjectWorkspace';
import { db } from '@/lib/db';
import { STYLE_LIST } from '@/lib/styles/presets';
import { canAccessProject } from '@/lib/auth';
import { recentsFor } from '@/lib/ui/recents';

export const dynamic = 'force-dynamic';

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await canAccessProject(id))) notFound();

  const project = await db.project.findUnique({ where: { id } }).catch(() => null);
  if (!project) notFound();

  const recent = await db.project
    .findMany({ orderBy: { createdAt: 'desc' }, take: 8 })
    .catch(() => []);

  return (
    <ProjectWorkspace
      projectId={id}
      recents={recentsFor(recent)}
      styles={STYLE_LIST.map((s) => ({ id: s.id, name: s.name, accent: s.accent, tagline: s.tagline }))}
    />
  );
}
