// Shared integer-id parsing for route params and query values. Garbage ids
// are a client error — they must surface as a clean 400 with the field label,
// never as a NaN flowing into a DB query and a 500 (user-sanctioned
// direction, backend refactor plan §2.1).
import { ApiError } from '../../errors';

/**
 * Parse a positive integer id. Throws ApiError(400) on garbage — message is
 * `${label} không hợp lệ` so callers name the field they are parsing.
 */
export function parseId(raw: string | string[] | undefined, label = 'ID'): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = Number.parseInt(value ?? '', 10);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(400, `${label} không hợp lệ`);
  }
  return id;
}

/**
 * Optional variant for multipart/body fields: absent or empty → null; a
 * present value must parse as a positive integer or ApiError(400).
 */
export function parseOptionalId(raw: unknown, label: string): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  return parseId(String(raw), label);
}
