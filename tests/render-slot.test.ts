import { describe, expect, it } from 'vitest';
import { withRenderSlot } from '@/lib/render/slot';

describe('render slot', () => {
  it('runs browser renders one at a time, in arrival order, and frees the slot when one fails', async () => {
    const events: string[] = [];
    const job = (name: string, ms: number, fail = false) =>
      withRenderSlot(async () => {
        events.push(`start ${name}`);
        await new Promise((resolve) => setTimeout(resolve, ms));
        events.push(`end ${name}`);
        if (fail) throw new Error(name);
      });
    await Promise.allSettled([job('a', 20, true), job('b', 5), job('c', 5)]);
    expect(events).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  });
});
