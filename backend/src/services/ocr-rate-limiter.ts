/**
 * OCR rate limiter — 2 requests/second, Redis-backed sliding window.
 *
 * Uses a sorted-set sliding window: ZADD with score=now, ZREMRANGEBYSCORE
 * to evict stale entries, ZCARD to count. Atomic per Redis call; the three
 * calls are not wrapped in a transaction because a small race window is
 * acceptable (worst case: 3 requests slip through in the same millisecond).
 *
 * Applied globally (not per-user) to protect upstream OCR API quotas.
 */
import { getRedis } from '../lib/redis';

const WINDOW_MS = 1000; // 1 second
const MAX_REQUESTS = 2;
const KEY = 'ocr:rate:global';

/**
 * Check if an OCR request is allowed under the 2 req/s limit.
 * Returns true if allowed, false if rate-limited.
 * Fail-open when Redis is unavailable (don't block OCR over a Redis outage).
 */
export async function checkOcrRateLimit(): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return true; // no Redis → no limiting (fail-open)

  try {
    const now = Date.now();
    const windowStart = now - WINDOW_MS;

    // Atomic pipeline: evict stale entries, add current, count.
    const pipeline = redis.pipeline();
    pipeline.zremrangebyscore(KEY, 0, windowStart);
    pipeline.zadd(KEY, now, `${now}:${Math.random()}`);
    pipeline.zcard(KEY);
    pipeline.pexpire(KEY, WINDOW_MS);
    const results = await pipeline.exec();
    const count = (results?.[2]?.[1] as number) ?? 0;
    return count <= MAX_REQUESTS;
  } catch {
    // Redis down → fail-open.
    return true;
  }
}
