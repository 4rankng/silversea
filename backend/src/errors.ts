/**
 * Canonical API error class. All services and routes should throw this
 * instead of ad-hoc `Object.assign(new Error(), { status })` patterns.
 */
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: string | Array<{ code?: string; message: string; path?: Array<string | number> }> | Record<string, unknown>,
    public payload?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Extract the PostgreSQL SQLSTATE from a thrown error. Drizzle wraps the
 * underlying postgres-js error, so the code may live on `err.code` (direct
 * driver throw) or `err.cause.code` (Drizzle-wrapped throw).
 */
export function getPgErrorCode(err: unknown): string | null {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code || e?.cause?.code || null;
}

/**
 * True when the error is a PostgreSQL unique-violation (SQLSTATE 23505),
 * optionally narrowed to a single constraint by name. The constraint name may
 * ride `err.constraint` or the Drizzle-wrapped `err.cause.constraint`; when
 * absent it is matched against `detail` ("Key (col)=(val) already exists").
 */
export function isPgUniqueViolation(err: unknown, constraintName?: string): boolean {
  if (getPgErrorCode(err) !== '23505') return false;
  if (!constraintName) return true;
  const e = err as {
    constraint?: string;
    detail?: string;
    cause?: { constraint?: string; detail?: string };
  } | null;
  const constraint = e?.constraint || e?.cause?.constraint || '';
  const detail = e?.detail || e?.cause?.detail || '';
  return constraint.includes(constraintName) || detail.includes(constraintName);
}
