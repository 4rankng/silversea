import { ZodError } from 'zod';
import { ApiError } from '../errors';

/**
 * Throw a formatted validation error from a failed Zod parse. Produces
 * `{ error: "message" }` consistent with the global error handler.
 *
 * The `error` field is user-facing, so no internal field path may ride along in
 * it (a banner once read `containers.0.containerTypeId` verbatim). The
 * machine-readable locations stay where they belong: in `details`, the verbatim
 * `[{code, message, path}]` issue array the global ZodError handler returns.
 */
export function throwValidation(error: ZodError): never {
  const first = error.issues[0];
  // zod v4 types an issue path as PropertyKey[] (symbol-capable) while the
  // ApiError details contract is the JSON-safe (string | number)[] the global
  // handler has always emitted — narrow explicitly instead of casting.
  throw new ApiError(400, first.message, error.issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    path: issue.path.filter((segment): segment is string | number => typeof segment !== 'symbol'),
  })));
}
