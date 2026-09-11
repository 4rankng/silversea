/**
 * Settle a query even when its underlying request never will: a stalled
 * connection (mid-restart backend, dead proxy) keeps a react-query pending
 * forever, which renders as an eternal spinner. Opt-in per query — the
 * transport is intentionally untouched (blanket write-side timeouts would
 * interact with command-retry idempotency; per-query until 3+ sites, then
 * AbortSignal per-call).
 *
 * The losing promise is NOT aborted; its eventual response is dropped.
 */

/** instanceof-able rejection marker so UIs can specialize ("hết thời gian chờ"). */
export class TimeoutError extends Error {
  constructor(message = 'hết thời gian chờ') {
    super(message);
    this.name = 'TimeoutError';
  }
}

/** Reject with TimeoutError if `promise` hasn't settled within `timeoutMs`. */
export function raceWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError()), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
