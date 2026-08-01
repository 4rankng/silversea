import Redis from 'ioredis';
import { config } from '../config';

let redis: Redis | null = null;

const inflightCacheRequests = new Map<string, Promise<unknown>>();
const cacheVersions = new Map<string, number>();

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
  cacheVersions.set(key, (cacheVersions.get(key) ?? 0) + 1);
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

/**
 * Bust every report cache that derives from the ledger. Fail-open: each helper
 * here already swallows Redis errors, and the outer catch is belt-and-suspenders
 * so a ledger write is never broken by cache trouble. Call POST-commit (route
 * layer, after the service's transaction resolves) — invalidating mid-tx would
 * let a concurrent read recompute against not-yet-committed rows and cache a
 * stale value.
 */
export async function invalidateReportCaches(): Promise<void> {
  try {
    await Promise.all([
      cacheInvalidate('reports:dashboard'),
      cacheInvalidate('reports:dashboard:executive'),
      cacheInvalidatePattern('reports:pnl:*'),
      cacheInvalidatePattern('reports:fuel-variance:*'),   // previously never invalidated — stale-data bug
      cacheInvalidatePattern('reports:entity-results:*'),  // aging primitive cache (Phase A2)
    ]);
  } catch {
    // Non-critical — never block a write
  }
}

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
