import type { SceneLook } from '../../src/lib/edl/types';
import type { Look } from './contract';
import { studio } from './studio';
import { neon } from './neon';
import { gallery } from './gallery';
import { archive } from './archive';

export type { Look, LookContext, Arrange } from './contract';

export const LOOKS: Record<SceneLook, Look> = { studio, neon, gallery, archive };

/**
 * Looks are resolved by id with a fallback rather than indexed directly,
 * because an EDL is data that outlives the code that wrote it: a project saved
 * before a look was renamed must still render, and a scene whose look nobody
 * recognises should come out as `studio` rather than as a white frame.
 */
export function lookFor(id: string | undefined): Look {
  return LOOKS[(id ?? '') as SceneLook] ?? studio;
}
