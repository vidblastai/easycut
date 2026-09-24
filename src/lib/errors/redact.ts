/**
 * What must never leave this process inside an error report.
 *
 * An alert is the one message the product sends to a third party WITHOUT a
 * human reading it first, and the things most likely to be in a stack trace or
 * an error message are exactly the things most likely to be secret: a signed
 * upload URL with the key in the query string, an `Authorization` header echoed
 * back by a failing HTTP client, a customer's email address in a "could not
 * send to …" message.
 *
 * So redaction runs on every string that goes out — message, stack, and every
 * value of the context object — and it runs LAST, after the message has been
 * built, because that is the only place it cannot be forgotten.
 *
 * It errs towards over-redaction. A `[redacted]` in an alert costs a moment
 * working out which field it was; a live API key in somebody's Slack costs a
 * key rotation, and in a third-party error service it is there for ever.
 */

/**
 * Names whose VALUE is always secret, wherever they appear — as a context key,
 * as a query parameter, or as `name=value` in a message.
 */
const SECRET_NAME = /(?:api[-_]?key|secret|token|password|passwd|credential|authorization|auth|signature|sig|bearer|session|cookie|dsn|access[-_]?key|private)/i;

/**
 * Values that are secret whatever they are called, recognised by their shape.
 *
 * Every provider this talks to uses a distinctive prefix, which is the one
 * thing about a key that is safe to rely on. The last two are the generic
 * shapes: a JWT, and an AWS-style access key id.
 */
const SECRET_SHAPES: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}/g,              // OpenAI, Anthropic
  /\bsk_(?:live|test)_[A-Za-z0-9]{16,}/g,  // Stripe secret
  /\brk_(?:live|test)_[A-Za-z0-9]{16,}/g,  // Stripe restricted
  /\bwhsec_[A-Za-z0-9]{16,}/g,             // Stripe webhook signing
  /\bre_[A-Za-z0-9_-]{16,}/g,              // Resend
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,       // Slack
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g,         // GitHub
  /\bAIza[A-Za-z0-9_-]{20,}/g,             // Google
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,        // AWS access key id
];

/** An email address is a person, not a diagnostic. */
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

const REDACTED = '[redacted]';

/**
 * Scrubs one string.
 *
 * Order matters: query strings first (so a whole signed URL collapses to
 * something still readable), then `key=value` pairs, then bare shapes, then
 * emails last — an email inside an already-redacted blob is not there to find.
 */
export function redact(text: string): string {
  let out = text;

  // Signed URLs: keep the path, drop every parameter whose name looks secret.
  out = out.replace(/([?&])([A-Za-z0-9_-]+)=([^&\s"']+)/g, (whole, sep, name) =>
    SECRET_NAME.test(name) ? `${sep}${name}=${REDACTED}` : whole,
  );

  /*
   * Bearer tokens BEFORE the name=value rule below, not after.
   *
   * `Authorization: Bearer abc123` matches the name=value rule with a value of
   * "Bearer" — so that rule redacts the word Bearer, leaves the token in
   * place, and this rule then finds nothing to do because its anchor is gone.
   * A test caught it; the reading order is the fix.
   */
  out = out.replace(/\bBearer\s+[A-Za-z0-9._-]{8,}/gi, `Bearer ${REDACTED}`);

  // `ANTHROPIC_API_KEY=sk-...`, `token: "abc"`.
  //
  // `&` is excluded from the value: without it the match runs greedily past
  // the end of one query parameter and swallows the rest of the URL, which
  // deletes the very context that makes an alert useful.
  out = out.replace(
    /\b([A-Za-z0-9_.-]*(?:api[-_]?key|secret|token|password|passwd|credential|authorization|signature|dsn|access[-_]?key)[A-Za-z0-9_.-]*)(\s*[:=]\s*)(['"]?)([^\s'",;)&]+)\3/gi,
    (_whole, name, sep, quote) => `${name}${sep}${quote}${REDACTED}${quote}`,
  );

  for (const shape of SECRET_SHAPES) out = out.replace(shape, REDACTED);

  out = out.replace(EMAIL, REDACTED);

  return out;
}

/**
 * Scrubs a context object: secret-looking KEYS lose their value outright,
 * everything else has its value scrubbed as a string.
 *
 * Depth-limited and breadth-limited on purpose. An alert is a paragraph, not a
 * heap dump, and a deeply nested object in an error report is usually an ORM
 * row that has no business being sent anywhere.
 */
export function redactContext(
  value: unknown,
  depth = 0,
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return redact(value);
  if (depth >= 3) return '[deep]';

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((v) => redactContext(v, depth + 1));
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>).slice(0, 30)) {
      out[key] = SECRET_NAME.test(key) ? REDACTED : redactContext(v, depth + 1);
    }
    return out;
  }

  return String(value);
}
