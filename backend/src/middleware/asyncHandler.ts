import type { Request, Response, NextFunction } from 'express';

/**
 * Wraps an async Express route handler so that rejected promises are
 * forwarded to the global error handler via `next(err)`. Without this,
 * Express v5 will hang on unhandled promise rejections in route handlers.
 *
 * After wrapping, remove all manual try/catch from route handlers —
 * the global error handler (errorHandler.ts) handles ZodError, ApiError,
 * Postgres unique violations, and generic 500s centrally.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
