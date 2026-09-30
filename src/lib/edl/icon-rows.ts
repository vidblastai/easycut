import { hasSideRoom, ICON_ROW_BELOW_COUNT, iconRowPlacement, type IconCue } from './types';

/**
 * Re-laying out icon rows after some of their cards did not survive.
 *
 * The builder places rows before anything has been fetched, so it places them
 * for the cards the director ASKED for. By the time the icons come back some
 * of those words have no icon, and a row can arrive here a different size from
 * the one it was laid out as.
 *
 * That is not just a matter of nudging a coordinate. The builder guarantees
 * that a row rising from the floor has three cards — one on its own reads as
 * something that happened rather than something designed, and two read as a
 * third that failed to load, which here would be literally true. A failed
 * lookup must not be able to quietly break that promise after the fact.
 *
 * So a short row moves out to the side, where one or two cards belong and a
 * single big card in an empty margin is a deliberate-looking thing. Only where
 * the frame has no margin — a vertical picture, where the subject fills it —
 * is the row dropped instead.
 */
export function relayoutIconRows(
  rows: IconCue[],
  frame: { width: number; height: number },
): IconCue[] {
  const roomBeside = hasSideRoom(frame.width, frame.height);

  return rows.flatMap((cue) => {
    if (!cue.cards.length) return [];

    const short = cue.side === 'below' && cue.cards.length < ICON_ROW_BELOW_COUNT;
    if (short && !roomBeside) return [];
    const side = short ? 'right' : cue.side;

    /*
     * Re-placed for the cards that SURVIVED, in the shape it ended up.
     *
     * A card's size depends on how many share its row, and the row's position
     * is what keeps it clear of the captions or out in the margin. Passing
     * `side` matters as much as the count: without it every row was recomputed
     * with the BELOW geometry, which dragged a side column's y from the middle
     * of the frame down into the caption band while leaving its x at the edge.
     */
    const spot = iconRowPlacement(cue.cards.length, frame.width, frame.height, side);
    return [{ ...cue, side, x: spot.x, y: spot.y }];
  });
}
