import { AppShell, ShellMain } from '@/components/shell/AppShell';
import { CaptionGallery } from '@/components/captions/CaptionGallery';
import { db } from '@/lib/db';
import { recentsFor } from '@/lib/ui/recents';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Caption styles — EasyCut',
  description: 'Sixteen finished caption looks, previewed in the shape your video goes out in.',
};

export default async function CaptionsPage() {
  const projects = await db.project
    .findMany({ orderBy: { createdAt: 'desc' }, take: 8 })
    .catch(() => []);

  return (
    <AppShell recents={recentsFor(projects)}>
      <ShellMain>
        <div className="pt-7">
          <h1 className="text-[28px] font-extrabold">Caption styles</h1>
          <p className="mt-1.5 max-w-[62ch] text-[13.5px] text-muted">
            Most short-form is watched with the sound off, which makes the captions the video. Pick the
            one you want new uploads to start from — you can still change it on any individual video,
            and changing it never costs anything to re-render.
          </p>
        </div>

        <div className="mt-7">
          <CaptionGallery />
        </div>
      </ShellMain>
    </AppShell>
  );
}
