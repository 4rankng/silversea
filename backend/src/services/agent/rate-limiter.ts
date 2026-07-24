// P5 Governance — per-user chat rate limiter.
//
// Redis-backed token bucket: each user gets `agentRateLimitPerMin` tokens per
// 60-second window. Each chat message consumes 1 token. When the bucket is
// empty, the limiter returns false and the socket emits a clean RUN_ERROR.
//
// Uses atomic Redis INCR + EXPIRE (the simplest correct token bucket):
//   key = agent:rate:{userId}
//   INCR key → count; if count === 1, EXPIRE key 60
//   if count > limit → rate limited

import { getRedis } from '../../lib/redis';
import { config } from '../../config';

const RATE_WINDOW_SEC = 60;
const KEY_PREFIX = 'agent:rate:';

/** Check if the user is within their rate limit. Returns true if allowed,
 *  false if rate-limited. When `agentRateLimitPerMin` is 0, always allows. */
export async function checkRateLimit(userId: number): Promise<boolean> {
  const limit = config.agentRateLimitPerMin;
  if (limit <= 0) return true; // disabled

  const redis = getRedis();
  if (!redis) return true; // no Redis → no limiting (fail-open)

  const key = `${KEY_PREFIX}${userId}`;
  try {
    // Atomic: INCR then EXPIRE only on the first increment.
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, RATE_WINDOW_SEC);
    }
    return count <= limit;
  } catch {
    // Redis down → fail-open (don't block chat over a Redis outage).
    return true;
  }
}
