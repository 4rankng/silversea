/**
 * Build a URL query string from a record. Skips `null`, `undefined`, and
 * empty-string values so callers can spread optional filters without
 * guarding each one. Numbers and booleans are stringified.
 *
 * SIL-1147 — non-finite numbers (NaN/±Infinity) are skipped too: a numeric
 * param computed from a missing value must never ride the wire as the literal
 * string 'NaN' (that was the preview's 400 NaN for every lot). Dropping the
 * param lets the backend name the missing input instead.
 *
 * Examples:
 *   toQuery()                                          → ''
 *   toQuery({})                                        → ''
 *   toQuery({ page: 1, search: 'foo' })               → '?page=1&search=foo'
 *   toQuery({ page: 1, search: undefined, status: '' }) → '?page=1'
 *   toQuery({ customerId: NaN, routeId: 2 })           → '?routeId=2'
 */
export function toQuery(
  params?: Record<string, string | number | boolean | null | undefined>,
): string {
  if (!params) return '';
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '') continue;
    // typeof 'number' first: a search term that literally reads 'NaN' is a
    // string and stays.
    if (typeof v === 'number' && !Number.isFinite(v)) continue;
    qs.append(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}
