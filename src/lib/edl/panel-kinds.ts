import type { PanelScene } from './types';

/** The fields that decide what an exhibit is able to draw. */
export interface PanelMaterial {
  icons: readonly string[];
  items: readonly string[];
  values: readonly string[];
  figure: string;
  imagePrompt: string;
}

/**
 * Which exhibits this scene's own data could actually draw, best first.
 *
 * Not a preference list: a `counter` with no figure is a blank panel and a
 * `toggle-pair` with one item is half a switch. Everything that reaches the
 * renderer has something to render.
 */
export function renderableKinds(input: Partial<PanelMaterial>): Array<PanelScene['kind']> {
  /*
   * Tolerant of a missing field, because this now also reads documents off
   * disk. The schema defaults every one of these, but an EDL written by an
   * older build — or by hand, in a test — need not carry them, and a kind
   * list is not worth throwing over.
   */
  const data = {
    icons: input.icons ?? [],
    items: input.items ?? [],
    values: input.values ?? [],
    figure: input.figure ?? '',
    imagePrompt: input.imagePrompt ?? '',
  };
  const out: Array<PanelScene['kind']> = [];
  if (data.figure && data.items.length && data.values.length) out.push('stat-card');
  /*
   * A counter needs a QUANTITY, not a number.
   *
   * "Tribe v2" came back as a counter with the figure 2, which renders as a
   * giant "2" running up from zero under the label TRIBE V2 — the format's
   * loudest device spent on a version number. A counter earns its scene at
   * ten or more, or at any figure carrying a unit: the references count to
   * 1500, to 700, to 19.718.
   */
  if (countable(data.figure)) out.push('counter');
  if (data.icons.length >= 2) out.push('icon-hub');
  if (data.imagePrompt) out.push('hero-image');
  if (data.items.length >= 2 && data.values.length >= 2) out.push('rank-list');
  if (data.items.length === 2) out.push('toggle-pair');
  if (data.items.length >= 2) out.push('rank-list');
  if (data.items.length) out.push('chat-card', 'list-panel');
  return [...new Set(out)];
}

/** Whether a written figure is a quantity worth counting up to. */
function countable(figure: string): boolean {
  if (!figure) return false;
  if (/[%x]|\b(k|m|mio|mrd|bn)\b/i.test(figure)) return true;
  const value = Number(figure.replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  return Number.isFinite(value) && Math.abs(value) >= 10;
}
