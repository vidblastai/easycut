import { notFound } from 'next/navigation';
import { ProjectWorkspace } from '@/components/ProjectWorkspace';
import { db } from '@/lib/db';
import { STYLE_LIST } from '@/lib/styles/presets';
import { canAccessProject } from '@/lib/auth';
import { recentsFor } from '@/lib/ui/recents';
import { entitlementsOf } from '@/lib/billing/entitlements';
import { allowsQuality } from '@/lib/render/quality';

export const dynamic = 'force-dynamic';

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await canAccessProject(id))) notFound();

  const project = await db.project.findUnique({ where: { id } }).catch(() => null);
  if (!project) notFound();

  const recent = await db.project
    .findMany({ orderBy: { createdAt: 'desc' }, take: 8 })
    .catch(() => []);

  /*
   * Whether this project may be exported in 4K, decided on the server.
   *
   * From `planAtUpload`, like the watermark, so a downgrade does not change
   * what an existing project can do. The route checks it again — this only
   * decides whether the control is worth showing, and a control nobody can use
   * is worse than no control.
   */
  const canExport4k = allowsQuality(entitlementsOf(project.planAtUpload).maxHeight, '4k');

  return (
    <ProjectWorkspace
      projectId={id}
      recents={recentsFor(recent)}
      canExport4k={canExport4k}
      styles={STYLE_LIST.map((s) => ({ id: s.id, name: s.name, accent: s.accent, tagline: s.tagline }))}
    />
  );
}
