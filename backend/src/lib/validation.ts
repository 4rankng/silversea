import { ZodError } from 'zod';
import { ApiError } from '../errors';

/**
 * Throw a formatted validation error from a failed Zod parse.
 * Produces `{ error: "message (field)" }` consistent with the global error handler.
 */
export function throwValidation(error: ZodError): never {
  const first = error.errors[0];
  const field = first.path.join('.');
  const message = field ? `${first.message} (${field})` : first.message;
  // Pass the zod issues through verbatim so `details` matches the structured
  // [{code, message, path}] array the global ZodError handler already returns.
  throw new ApiError(400, message, error.errors);
}
