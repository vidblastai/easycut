import { describe, expect, it, vi, afterEach } from 'vitest';

/**
 * Position is meaning on a panel tile.
 *
 * `toggle-pair` reads `iconSvgs[0]` and `iconSvgs[1]` as its left and right
 * sides, and `icon-hub` reads them against its own labels. Dressing used to
 * drop the failures with `.filter(Boolean)`, which compacts — so a pair whose
 * FIRST lookup failed drew its second icon on the left tile and nothing on
 * the right: one picture, labelled with the other side's name.
 */
describe('dressing a panel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  /** A distinct stroke colour per icon, since `sanitiseSvg` keeps colours. */
  const INK: Record<string, string> = {
    scissors: '#111111', robot: '#222222', film: '#333333',
    nonsense: '#444444', gibberish: '#555555',
  };

  async function dressWith(found: Record<string, boolean>, icons: string[]) {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      const name = String(url);
      const hit = Object.entries(found).find(([key]) => name.includes(key));
      return hit && hit[1]
        ? {
            ok: true,
            text: async () =>
              `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" stroke="${INK[hit[0]]}"/></svg>`,
          }
        : { ok: false, status: 404, text: async () => '' };
    }) as never);

    const { dressPanel } = await import('@/lib/assets/panel-assets');
    const [scene] = (
      await dressPanel([
        {
          id: 'a', outStartSec: 0, outEndSec: 2, kind: 'toggle-pair',
          eyebrow: ['A', 'B'] as [string, string], chip: '', items: ['Left', 'Right'],
          values: [], figure: '', label: '', icons, iconSvgs: [], imageUrl: '',
          imagePrompt: '', winner: -1, reason: '',
        } as never,
      ])
    ).scenes;
    return scene.iconSvgs;
  }

  it('leaves a hole where a lookup failed instead of closing it', async () => {
    const svgs = await dressWith({ scissors: false, robot: true }, ['scissors', 'robot']);
    expect(svgs).toHaveLength(2);
    expect(svgs[0]).toBe('');
    expect(svgs[1]).toContain(INK.robot);
  });

  it('keeps every icon in the order it was asked for', async () => {
    const svgs = await dressWith({ film: true, robot: true }, ['film', 'robot']);
    expect(svgs[0]).toContain(INK.film);
    expect(svgs[1]).toContain(INK.robot);
  });

  it('comes back all holes rather than empty when nothing resolves', async () => {
    const svgs = await dressWith({}, ['nonsense', 'gibberish']);
    expect(svgs).toEqual(['', '']);
  });
});
