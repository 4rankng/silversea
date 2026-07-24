/**
 * Build a URL query string from a record. Skips `null`, `undefined`, and
 * empty-string values so callers can spread optional filters without
 * guarding each one. Numbers and booleans are stringified.
 *
 * Examples:
 *   toQuery()                                          → ''
 *   toQuery({})                                        → ''
 *   toQuery({ page: 1, search: 'foo' })               → '?page=1&search=foo'
 *   toQuery({ page: 1, search: undefined, status: '' }) → '?page=1'
 */
export function toQuery(
  params?: Record<string, string | number | boolean | null | undefined>,
): string {
  if (!params) return '';
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '') continue;
    qs.append(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}
