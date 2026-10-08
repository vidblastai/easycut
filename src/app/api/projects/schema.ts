import { z } from 'zod';
import { BROLL_SOURCES } from '@/lib/assets/ai-broll';
import { BROLL_OVERLAYS, CLIP_TRANSITIONS } from '@/lib/edl/types';

/**
 * What the upload wizard sends.
 *
 * Its own module because Next refuses any export from a route file that is
 * not a handler — and this is the one thing in the request path worth
 * testing directly, since every field here is a second copy of a list that
 * lives somewhere else.
 */
export const CreateProjectSchema = z.object({
  title: z.string().max(200).optional(),
  mode: z.enum(['short', 'long']),
  styleId: z.string().default('clean'),
  /** The caption look, when the picker set a default. Omitted takes the style's. */
  captionPreset: z.string().optional(),
  sceneLook: z.string().optional(),
  /** Transitions the person picked, in cycling order. Omitted takes the style's. */
  clipTransitions: z.array(z.string()).max(CLIP_TRANSITIONS.length).optional(),
  /**
   * Found, or made, or both. Omitted means found — see assets/ai-broll.ts.
   *
   * Read from `BROLL_SOURCES` rather than written out, and that is the whole
   * bug this line used to be: the list here said three and the product
   * offered four. Picking "Mixed" — the one that chooses per insert, which is
   * the interesting one — failed the upload with "Invalid request" and no
   * indication of which field was wrong. Two lists of the same thing always
   * drift; there is now one.
   */
  brollSource: z.enum(BROLL_SOURCES as unknown as [string, ...string[]]).optional(),
  /** The treatment every insert wears. Omitted takes the edit style's. */
  brollOverlay: z.enum(BROLL_OVERLAYS).optional(),
  inputMode: z.enum(['raw', 'roughcut']).default('raw'),
  /**
   * Layers the person declined, before anything is made.
   *
   * Sent as the switches that are OFF. These have always been changeable on a
   * finished video — turn one off and it re-renders from cached analysis for
   * nothing — which is fine and is not the same as being asked. Somebody who
   * knows they never want music should not have to watch a video get scored and
   * then unscore it.
   */
  layers: z.record(z.string(), z.boolean()).optional(),
  userNote: z.string().max(500).optional(),
  filename: z.string().min(1).max(300),
  contentType: z.string().default('video/mp4'),
  sizeBytes: z.number().int().nonnegative().default(0),
});
