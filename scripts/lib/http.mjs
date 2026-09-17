#!/usr/bin/env node
/**
 * HTTP client + role table for Silversea QA scripts.
 *
 * No top-level side effects: import and call. Every script that needs to talk
 * to the backend uses `login()` and `api()`; the role table is the canonical
 * source of truth for "which username + home route per persona" (used by
 * puppeteer-driven smoke tests, API smoke, and the staging visual matrix).
 *
 * Conventions (shared across scripts/):
 *   - dev:    FRONTEND = http://localhost:7174   BACKEND = http://localhost:3001/api
 *   - staging: pass { frontend, backend } explicitly
 *   - demo password: "Abc123" (matches the demo accounts table in AGENTS.md)
 *
 * The `roles` object is a superset of the test-spa-smoke ROLE_TABLE and the
 * staging-visual-matrix DEFAULT_ACCOUNTS, normalized to one key per persona.
 * If you need a role that's not here, add it — never fork the table.
 */

export const DEFAULT_FRONTEND = "http://localhost:7174";
export const DEFAULT_BACKEND = "http://localhost:3001/api";
export const DEFAULT_PASSWORD = "Abc123";

/**
 * Canonical persona table. `home` is the role's primary route (where the
 * auth guard lands them on first login). `api` is the preferred GET
 * endpoint for a "the role can read SOMETHING" smoke check — it doubles
 * as a Casbin/role check and a 200-vs-403 discriminator.
 *
 * `home` is also the route the puppeteer smoke should NOT see 403'd when
 * the user is redirected to /. Use `api` to disambiguate a "blank main
 * because the page is empty" from a "blank because the role can't see it".
 */
export const ROLES = Object.freeze({
  admin:    { username: "admin",    home: "/config",                 api: "/auth/users?limit=1" },
  giamdoc:  { username: "giamdoc",  home: "/dashboard",              api: "/trips?limit=1" },
  ketoan:   { username: "ketoan",   home: "/accounting",             api: "/recoverable-costs?limit=1" },
  cus:      { username: "cus",      home: "/shipments",              api: "/customers?limit=1" },
  dieuvan:  { username: "dieuvan",  home: "/dispatch",               api: "/shipments?limit=1" },
  giaonhan: { username: "giaonhan", home: "/my-orders",              api: "/forwarder/me/trips" },
  laixe:    { username: "laixe",    home: "/my-trips",               api: "/driver/me/trips?limit=1" },
  customer: { username: "customer", home: "/portal/shipments",       api: "/portal/shipments?limit=1" },
});

/**
 * Login as a user; returns the JWT.
 *
 * @param {string|{username: string, password?: string}} who
 *   Either a role key from ROLES, a `{username, password}` pair, or
 *   a username string (uses DEFAULT_PASSWORD).
 * @param {{backend?: string, password?: string, fetchImpl?: typeof fetch}} [opts]
 *   `backend` overrides the API origin (default: DEFAULT_BACKEND).
 *   `password` overrides the default password.
 *   `fetchImpl` injects a custom fetch (tests).
 * @returns {Promise<string>} the bearer token.
 */
export async function login(who, opts = {}) {
  const backend = opts.backend ?? DEFAULT_BACKEND;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const { username } = typeof who === "string" ? ROLES[who] ?? { username: who } : who;
  if (!username) throw new Error(`login: unknown role "${who}" (not in ROLES)`);
  // Precedence: opts.password > who.password > DEFAULT_PASSWORD
  const password = opts.password
    ?? (typeof who === "object" ? who.password : undefined)
    ?? DEFAULT_PASSWORD;

  const res = await fetchImpl(`${backend}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: username, password }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`login ${username} → ${res.status} ${body.slice(0, 200)}`);
  }
  const body = await res.json();
  if (!body?.token) throw new Error(`login ${username}: response has no token (${JSON.stringify(body).slice(0, 200)})`);
  return body.token;
}

/**
 * Authenticated API call. Returns `{ status, ok, data }`; never throws on
 * non-2xx so the caller can assert on status codes (the whole point of
 * regression tests).
 *
 * @param {string} token Bearer token (from `login`).
 * @param {string} method HTTP verb.
 * @param {string} path API path beginning with `/` (e.g. `/shipments/123`).
 * @param {unknown} [body] JSON-serializable request body.
 * @param {{backend?: string, fetchImpl?: typeof fetch, query?: Record<string, unknown>, headers?: Record<string, string>}} [opts]
 *   `query` is merged as URL search params (omit the leading `?`).
 *   `headers` is merged on top of the default Content-Type + Authorization.
 *   The Authorization and Content-Type defaults can be overridden by passing
 *   those keys in `headers` explicitly.
 */
export async function api(token, method, path, body, opts = {}) {
  const backend = opts.backend ?? DEFAULT_BACKEND;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = new URL(`${backend}${path}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(opts.headers ?? {}),
  };
  const res = await fetchImpl(url, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, ok: res.ok, data };
}

/**
 * Health check that exercises the full network path (TCP + HTTP + auth-bypass
 * for /api/health). Returns `{ ok, status, body, ms }` — the `ms` field is
 * useful for catching a healthy-but-slow backend (latency regression).
 */
export async function health(backend = DEFAULT_BACKEND, fetchImpl = fetch) {
  const start = Date.now();
  const url = `${backend}/health`;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(5_000) });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    return { ok: res.ok, status: res.status, body, ms: Date.now() - start };
  } catch (error) {
    return { ok: false, status: 0, body: null, ms: Date.now() - start, error: error?.message ?? String(error) };
  }
}

/**
 * Read a role definition. Throws if the role is unknown so the caller
 * doesn't have to null-check.
 */
export function role(key) {
  const r = ROLES[key];
  if (!r) throw new Error(`unknown role "${key}" (known: ${Object.keys(ROLES).join(", ")})`);
  return r;
}
