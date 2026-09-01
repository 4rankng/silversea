import Redis from 'ioredis';
import { config } from '../config';

let redis: Redis | null = null;

const inflightCacheRequests = new Map<string, Promise<unknown>>();
const cacheVersions = new Map<string, number>();
// Globally monotonic version source. cacheGet snapshots a key's version to
// suppress stale writes after an invalidate; that guard is only sound while
// values never repeat, so the counter (not a per-key increment) owns the
// number — a cap-clear that resets the MAP must not reset the VALUES.
let cacheVersionSeq = 0;

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      connectTimeout: 3000,
      retryStrategy: (times) => (times > 1 ? null : 100),
    });
    redis.on('error', (err) => {
      console.error('[Redis] connection error:', err.message);
    });
  }
  return redis;
}

export async function disconnectRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}

export async function cacheGet<T>(
  key: string,
  ttl: number | ((result: T) => number),
  fetchFn: () => Promise<T>
): Promise<T> {
  const client = getRedis();
  try {
    const cached = await client.get(key);
    if (cached !== null) {
      return JSON.parse(cached) as T;
    }
  } catch {
    // Redis miss or parse error — fall through to fetchFn
  }

  const inflight = inflightCacheRequests.get(key);
  if (inflight) return inflight as Promise<T>;

  const version = cacheVersions.get(key) ?? 0;
  const fetchPromise = fetchFn()
    .then(async (result) => {
      if ((cacheVersions.get(key) ?? 0) === version) {
        try {
          const resolvedTtl = typeof ttl === 'function' ? ttl(result) : ttl;
          await client.set(key, JSON.stringify(result), 'EX', resolvedTtl);
        } catch {
          // Redis write failure — non-critical, serve from DB
        }
      }
      return result;
    })
    .finally(() => {
      if (inflightCacheRequests.get(key) === fetchPromise) {
        inflightCacheRequests.delete(key);
      }
    });

  inflightCacheRequests.set(key, fetchPromise);
  return fetchPromise;
}

export async function cacheInvalidate(key: string): Promise<void> {
  // The version map has no natural eviction; cap it so a pathological key
  // cardinality (e.g. per-entity keys over a huge table) cannot grow it
  // without bound. Clearing only loses version continuity — with a globally
  // monotonic sequence the re-created key gets a value no in-flight snapshot
  // can hold, so the stale-overwrite guard stays sound across a clear.
  if (cacheVersions.size > 10_000) cacheVersions.clear();
  cacheVersions.set(key, ++cacheVersionSeq);
  inflightCacheRequests.delete(key);
  const client = getRedis();
  try {
    await client.del(key);
  } catch {
    // Non-critical
  }
}

export async function cacheInvalidatePattern(pattern: string): Promise<void> {
  const client = getRedis();
  try {
    const stream = client.scanStream({ match: pattern, count: 100 });
    const keys: string[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (batch: string[]) => keys.push(...batch));
      stream.on('end', () => resolve());
      stream.on('error', (err: Error) => reject(err));
    });
    if (keys.length > 0) {
      await client.del(...keys);
    }
  } catch {
    // Non-critical
  }
}

// Report-cache invalidation moved to lib/report-cache.ts (single key registry).
// This module keeps only the raw cache mechanics (cacheGet / cacheInvalidate /
// cacheInvalidatePattern) and the non-report cache surfaces below.

export async function isTokenBlacklisted(jti: string): Promise<boolean> {
  const client = getRedis();
  try {
    const exists = await client.exists(`blacklist:${jti}`);
    return exists === 1;
  } catch (error) {
    // Fail-closed: if Redis is down, treat the token as blacklisted.
    // Rejecting potentially-revoked tokens is safer than allowing them.
    console.error('[Redis] blacklist check failed:', error);
    return true;
  }
}

export async function blacklistToken(jti: string, ttlSeconds: number): Promise<void> {
  const client = getRedis();
  await client.set(`blacklist:${jti}`, '1', 'EX', ttlSeconds);
}

// Graceful shutdown is handled centrally in index.ts to ensure
// HTTP server drain and DB pool close happen before Redis disconnect.
// Redis handlers were removed to prevent racing process.exit(0).
