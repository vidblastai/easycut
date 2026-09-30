/**
 * Cutting a string to length without cutting a word in half.
 *
 * `slice` is the reflex and it is wrong everywhere the result is read as
 * prose. A scene's supporting line came out as "…but the you picke" on screen,
 * and the social caption a creator is handed to paste under their video was
 * cut the same way — both from a plain character count that happened to land
 * mid-word.
 *
 * Whole words only, and an ellipsis so the cut reads as deliberate rather than
 * as something that failed to load. A single word longer than the budget is
 * the one case that still has to break mid-word, because there is no earlier
 * boundary to fall back to.
 */
export function trimToWords(text: string, maxChars: number): string {
  const clean = text.trim();
  if (clean.length <= maxChars) return clean;

  // One character of the budget belongs to the ellipsis.
  const budget = Math.max(1, maxChars - 1);
  const cut = clean.slice(0, budget + 1);
  const lastSpace = cut.lastIndexOf(' ');

  const kept = lastSpace > 0 ? cut.slice(0, lastSpace) : clean.slice(0, budget);
  // Trailing punctuation before an ellipsis reads as a typo.
  return `${kept.replace(/[\s,;:.!?-]+$/, '')}…`;
}
