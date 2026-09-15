/**
 * Canonical API error class. All services and routes should throw this
 * instead of ad-hoc `Object.assign(new Error(), { status })` patterns.
 */
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: string | Array<{ code?: string; message: string; path?: Array<string | number> }>,
    public payload?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
