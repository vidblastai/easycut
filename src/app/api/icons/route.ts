import { NextResponse } from 'next/server';
import { resolveCardIcons } from '@/lib/assets/icon-cards';

export const runtime = 'nodejs';

/**
 * One illustrated icon, for the editor.
 *
 * The pipeline resolves a whole video's icons at once so a single set can win
 * all of them — see `resolveCardIcons`. The editor cannot do that: somebody is
 * changing one card and wants to see the result before they change the next.
 * So this is the one-at-a-time door, and the family rule simply does not apply
 * to a card a person picked by hand.
 *
 * Unauthenticated on purpose: it reads a public icon index and returns
 * drawing. There is nothing here that belongs to a project.
 */
export async function GET(request: Request) {
  const query = (new URL(request.url).searchParams.get('q') ?? '').trim().slice(0, 80);
  if (!query) return NextResponse.json({ error: 'Nothing to look up.' }, { status: 400 });

  const [icon] = await resolveCardIcons([query], '#9B7BFF').catch(() => [null]);
  if (!icon) {
    return NextResponse.json(
      { error: `No icon for “${query}”. Try the object itself — “money bag” rather than “revenue”.` },
      { status: 404 },
    );
  }

  return NextResponse.json({ id: icon.id, markup: icon.markup, monochrome: icon.monochrome });
}
