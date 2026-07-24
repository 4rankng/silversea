/**
 * Canonical API error class. All services and routes should throw this
 * instead of ad-hoc `Object.assign(new Error(), { status })` patterns.
 */
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
