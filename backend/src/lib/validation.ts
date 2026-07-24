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
  throw new ApiError(400, message, error.errors.map(e => ({
    path: e.path.join('.'),
    message: e.message,
  })).join('; '));
}
