import type { Request, Response, NextFunction } from 'express';
import { ApiError } from '../errors';
import { config } from '../config';

export function globalErrorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  // Zod validation errors → 400
  if (err.name === 'ZodError') {
    const issues = (err as unknown as { errors?: Array<{ message: string; path?: Array<string | number> }> }).errors;
    const first = issues?.[0];
    // Surface a user-readable top-level message including field path so the UI doesn't
    // have to inspect `details`. Fall back to the generic message if no issues.
    let topMessage = 'Dữ liệu không hợp lệ';
    if (first?.message) {
      const pathLabel = first.path && first.path.length
        ? ` (${first.path.join('.')})`
        : '';
      topMessage = `${first.message}${pathLabel}`;
    }
    res.status(400).json({ error: topMessage, details: issues });
    return;
  }

  // Canonical API errors
  if (err instanceof ApiError) {
    const body: Record<string, unknown> = { error: err.message };
    if (err.details) body.details = err.details;
    if (err.payload) {
      // Allow services to attach a structured payload (e.g. the duplicate
      // shipment reference + creator info) that the frontend can use to
      // surface "đã nhập bởi tài khoản X" without re-fetching.
      Object.assign(body, err.payload);
    }
    res.status(err.statusCode).json(body);
    return;
  }

  // Custom errors with numeric status property (e.g., NoForwarderProfileError)
  if ('status' in err && typeof (err as { status?: unknown }).status === 'number' && (err as { status: number }).status >= 400 && (err as { status: number }).status < 600) {
    res.status((err as { status: number }).status).json({ error: err.message });
    return;
  }

  // PostgreSQL unique constraint violation (23505). Drizzle wraps the underlying
  // postgres-js error, so the SQLSTATE may live on either `err.code` (direct
  // driver throw) or `err.cause.code` (Drizzle-wrapped throw). Mirror the logic
  // in routes/utils/crud-factory.ts and services/trip-mutations.service.ts —
  // without the `.cause` fallback, duplicate usernames/emails here surface as a
  // generic 500 instead of a clean 409.
  const pgErr = err as { code?: string; cause?: { code?: string; detail?: string }; detail?: string };
  const pgCode = pgErr.code || pgErr.cause?.code;
  if (pgCode === '23505') {
    const detail = pgErr.cause?.detail || pgErr.detail || '';
    const fieldMatch = detail.match(/Key \(([^)]+)\)/);
    const field = fieldMatch ? fieldMatch[1] : 'dữ liệu';
    res.status(409).json({ error: `${field} đã tồn tại` });
    return;
  }
  if (pgCode === '40P01' || pgCode === '40001' || pgCode === '55P03') {
    res.status(409).json({
      error: 'Dữ liệu đã được xử lý đồng thời. Vui lòng tải lại và thử lại.',
    });
    return;
  }

  // Generic server error
  const isDev = config.nodeEnv === 'development';
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.stack || err.message);
  // Log the underlying cause (e.g. Drizzle-wrapped Postgres errors) so
  // constraint violations are visible in the console during development.
  if (err.cause) console.error(`[ERROR] cause:`, err.cause);
  res.status(500).json({
    error: 'Lỗi máy chủ',
    ...(isDev && { details: err.message, stack: err.stack }),
  });
}
