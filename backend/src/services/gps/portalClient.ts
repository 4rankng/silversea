import { config } from '../../config';
import { getGpsSettings } from './settings';

/**
 * Shared Bách Khoa web-portal client: one authenticated session reused by both
 * the live provider (get_AllTIBase) and the reports service. Logs in once, keeps
 * the session warm, and re-logs in transparently on expiry (302/401).
 *
 * The portal is ASP.NET MVC on IIS. It wants a browser UA + X-Requested-With,
 * and returns cookies (ASP.NET_SessionId + TrackingBKGPS) that must be sent back.
 */

const PORTAL_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

export interface PortalSession {
  cookieHeader: string;
  userId: string;
}

let session: PortalSession | null = null;
let sessionVersion = 0;
let sessionAttempt: { version: number; promise: Promise<PortalSession> } | null = null;

export function portalOrigin(): string {
  return new URL(config.bachKhoaApiUrl).origin;
}

export async function isPortalConfigured(): Promise<boolean> {
  const settings = await getGpsSettings();
  return !!(settings.username && settings.password);
}

function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fn(controller.signal).finally(() => clearTimeout(timer));
}

/** Turn Set-Cookie response headers into a Cookie request header + the userID. */
function parseSession(setCookies: string[]): { cookieHeader: string; userId: string | null } {
  const parts: string[] = [];
  let userId: string | null = null;
  for (const sc of setCookies) {
    const nv = sc.split(';')[0]; // "name=value" (drop attributes)
    const eq = nv.indexOf('=');
    if (eq <= 0) continue;
    const name = nv.slice(0, eq).trim();
    const value = nv.slice(eq + 1);
    parts.push(`${name}=${value}`);
    if (name === 'TrackingBKGPS') {
      const m = value.match(/BKuserID=(\d+)/);
      if (m) userId = m[1];
    }
  }
  return { cookieHeader: parts.join('; '), userId };
}

async function login(): Promise<PortalSession> {
  const settings = await getGpsSettings();
  const body = new URLSearchParams({
    txtLoginName: settings.username,
    txtPass: settings.password,
    txtPassLayer2: '',
    SaveLogin: '1',
  });
  const res = await withTimeout(config.bachKhoaTimeoutMs, (signal) =>
    fetch(`${portalOrigin()}/Login/LoginProcess`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': PORTAL_UA,
        Referer: `${portalOrigin()}/Login/Login`,
        'X-Requested-With': 'XMLHttpRequest',
      },
      body,
      redirect: 'manual',
      signal,
    }),
  );
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  const { cookieHeader, userId } = parseSession(headers.getSetCookie?.() ?? []);
  if (!userId || !cookieHeader) {
    throw new Error(`login returned no session (status ${res.status})`);
  }
  return { cookieHeader, userId };
}

export async function ensurePortalSession(): Promise<PortalSession> {
  while (!session) {
    const version = sessionVersion;
    if (!sessionAttempt || sessionAttempt.version !== version) {
      sessionAttempt = { version, promise: login() };
    }
    const attempt = sessionAttempt;
    try {
      const result = await attempt.promise;
      if (attempt.version === sessionVersion) session = result;
    } finally {
      if (sessionAttempt === attempt) sessionAttempt = null;
    }
  }
  return session;
}

export function invalidatePortalSession(): void {
  sessionVersion += 1;
  session = null;
  sessionAttempt = null;
}

export interface PortalPostOptions {
  contentType?: string;
  referer?: string; // path part, e.g. "Home/CameraSystem"
}

/**
 * POST `body` (pre-serialized string) to a portal path with the session cookie.
 * Re-logs in once on 302/401. Returns { status, text } — never throws on HTTP
 * status; network errors propagate to the caller.
 */
export async function portalPost(
  path: string,
  body: string,
  opts: PortalPostOptions = {},
): Promise<{ status: number; text: string }> {
  const contentType = opts.contentType ?? 'application/x-www-form-urlencoded';
  const referer = `${portalOrigin()}/${(opts.referer ?? 'Home/Index').replace(/^\//, '')}`;
  const url = `${portalOrigin()}${path.startsWith('/') ? path : `/${path}`}`;

  const doFetch = (s: PortalSession) =>
    withTimeout(config.bachKhoaTimeoutMs, (signal) =>
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': contentType,
          Cookie: s.cookieHeader,
          'User-Agent': PORTAL_UA,
          Referer: referer,
          'X-Requested-With': 'XMLHttpRequest',
        },
        body,
        redirect: 'manual',
        signal,
      }),
    );

  let s = await ensurePortalSession();
  let res = await doFetch(s);
  if (res.status === 302 || res.status === 401) {
    invalidatePortalSession();
    s = await ensurePortalSession();
    res = await doFetch(s);
  }
  return { status: res.status, text: await res.text() };
}
