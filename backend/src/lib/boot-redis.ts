// Boot-time Redis reachability check. A wrong redis URL used to surface only
// as silent per-request 503s (the fail-closed auth middleware hid a dead
// config until someone probed); a wrong config must die loudly at boot
// instead, and the boot log must show which URL the process is using.
import Redis from 'ioredis';

export interface RedisBootCheck {
  ok: boolean;
  /** URL as configured, credentials stripped — safe for boot logs. */
  url: string;
  error?: string;
}

/** scheme://host:port form — never echoes passwords or usernames. */
export function redactRedisUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const auth = parsed.username || parsed.password ? '***@' : '';
    return `${parsed.protocol}//${auth}${parsed.host}${parsed.pathname}`;
  } catch {
    return '(unparseable redis url)';
  }
}

/** Ping Redis once with a hard timeout. Never throws — resolves a verdict. */
export async function checkRedisAtBoot(url: string, timeoutMs = 2500): Promise<RedisBootCheck> {
  const shown = redactRedisUrl(url);
  const client = new Redis(url, {
    lazyConnect: true,
    connectTimeout: timeoutMs,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  const verdict = await new Promise<RedisBootCheck>((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, url: shown, error: `no response within ${timeoutMs}ms` }), timeoutMs + 500);
    client.connect()
      .then(() => resolve({ ok: true, url: shown }))
      .catch((err: Error) => resolve({ ok: false, url: shown, error: err.message }));
    // Both resolve paths are settled exactly once; the timer only guards a
    // hung connect (ioredis connectTimeout should fire first).
  });
  client.disconnect();
  return verdict;
}
