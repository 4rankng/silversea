/**
 * Build a deterministic, lowercase, colon-delimited idempotency key from the
 * supplied parts.  Used by every mutating API call so retries (manual or
 * automatic) deduplicate on the server instead of creating duplicates.
 */
export function buildIdempotencyKey(...parts: Array<string | number | null | undefined>): string {
  return parts
    .map((part) => String(part ?? ''))
    .join(':')
    .replace(/\s+/g, '-')
    .toLowerCase();
}
