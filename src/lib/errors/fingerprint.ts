/**
 * Which errors count as "the same error".
 *
 * ── Why this matters more than it looks ──────────────────────────────────
 *
 * The failure this whole module exists for is a render breaking at 2am. That
 * failure does not arrive once. The queue retries it, the rescuer requeues it,
 * and if the cause is environmental — a storage bucket gone, a key revoked —
 * then EVERY job in the queue hits it within the minute. An alerter with no
 * notion of sameness turns one incident into four hundred messages, and the
 * predictable result is that the channel gets muted and the next incident is
 * missed entirely.
 *
 * So identity is computed from the SHAPE of the failure, not its text: the
 * error class, where it happened, and the message with every varying part
 * removed. Two jobs failing on two different project ids for one reason
 * fingerprint identically and alert once.
 */

/**
 * Strips the parts of a message that vary between occurrences of one bug.
 *
 * Each rule is here because it was the difference between two messages that
 * are plainly the same failure:
 *
 *   "project cm3x9… not found"            → ids
 *   "ENOSPC: /app/.storage/tmp/9f2c.mp4"  → paths
 *   "timed out after 30012ms"             → numbers
 *   "unexpected status 503"               → numbers
 */
export function normaliseMessage(message: string): string {
  return (
    message
      // UUIDs.
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
      /*
       * Generated ids of every other flavour — cuid, nanoid, hex digest.
       *
       * Matched by shape rather than by prefix: a long run of alphanumerics
       * containing BOTH a letter and a digit. A first attempt anchored on
       * cuid's leading `c` and a length of 21, and a test caught it failing on
       * a 20-character one — which meant two jobs failing for one reason
       * fingerprinted differently and alerted twice.
       *
       * The two lookaheads are what keep it off ordinary prose: no English
       * word 16 characters long also contains a digit.
       */
      .replace(/\b(?=[a-z0-9]*[0-9])(?=[a-z0-9]*[a-z])[a-z0-9]{16,}\b/gi, '<id>')
      // Paths and URLs keep their shape but lose their leaves.
      .replace(/\b[a-z]+:\/\/[^\s'"]+/gi, '<url>')
      .replace(/(?:\/[\w.-]+){2,}/g, '<path>')
      // Any remaining run of digits.
      .replace(/\d+/g, '<n>')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200)
  );
}

/**
 * A short, stable id for one kind of failure.
 *
 * Deliberately a cheap non-cryptographic hash rather than a crypto import:
 * this runs on every failure, it never leaves the process except as a label,
 * and a collision costs one merged alert.
 */
export function fingerprint(parts: {
  name: string;
  message: string;
  where: string;
}): string {
  const seed = `${parts.name}|${parts.where}|${normaliseMessage(parts.message)}`;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).padStart(7, '0');
}
