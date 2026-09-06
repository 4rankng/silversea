import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  api,
  DEFAULT_BACKEND,
  DEFAULT_FRONTEND,
  DEFAULT_PASSWORD,
  health,
  login,
  ROLES,
  role,
} from "./http.mjs";

/** Build a fake `fetch` that records the call and returns a canned response.
 *  Each canned response can be either:
 *    - { status, body }                — body is sent verbatim as the text body
 *    - { status, json }                — body is JSON.stringified for the text body
 *    - { status, text }                — explicit raw text body
 *  The real `api()`/`health()` use `res.text()` then JSON.parse; the fake
 *  must match that round-trip. */
function fakeFetch(responses) {
  const calls = [];
  let index = 0;
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const r = responses[index++] ?? responses[responses.length - 1];
    const textBody = "body" in r
      ? r.body
      : "json" in r
        ? JSON.stringify(r.json)
        : r.text ?? "";
    return {
      ok: r.ok ?? (r.status >= 200 && r.status < 300),
      status: r.status,
      text: async () => textBody,
      json: async () => ("json" in r ? r.json : (() => { try { return JSON.parse(textBody); } catch { return null; } })()),
    };
  };
  return { fetchImpl, calls };
}

describe("login", () => {
  test("posts to /auth/login with identifier+password and returns the token", async () => {
    const { fetchImpl, calls } = fakeFetch([{ ok: true, status: 200, json: { token: "jwt-abc" } }]);
    const token = await login("admin", { fetchImpl });
    assert.equal(token, "jwt-abc");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${DEFAULT_BACKEND}/auth/login`);
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.identifier, "admin");
    assert.equal(body.password, DEFAULT_PASSWORD);
    assert.equal(calls[0].init.method, "POST");
  });

  test("accepts a {username, password} object", async () => {
    const { fetchImpl, calls } = fakeFetch([{ ok: true, status: 200, json: { token: "t" } }]);
    await login({ username: "free-user", password: "custom" }, { fetchImpl });
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.identifier, "free-user");
    assert.equal(body.password, "custom");
  });

  test("accepts a raw username string and uses default password", async () => {
    const { fetchImpl, calls } = fakeFetch([{ ok: true, status: 200, json: { token: "t" } }]);
    await login("phantom-role", { fetchImpl });
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.identifier, "phantom-role");
    assert.equal(body.password, DEFAULT_PASSWORD);
  });

  test("throws with status + body on non-2xx", async () => {
    const { fetchImpl } = fakeFetch([{ ok: false, status: 401, text: "bad creds" }]);
    await assert.rejects(login("admin", { fetchImpl }), /admin → 401 bad creds/);
  });

  test("throws when the response has no token (defends against upstream shape changes)", async () => {
    const { fetchImpl } = fakeFetch([{ ok: true, status: 200, json: { data: "no token here" } }]);
    await assert.rejects(login("admin", { fetchImpl }), /no token/);
  });

  test("respects a custom backend origin", async () => {
    const { fetchImpl, calls } = fakeFetch([{ ok: true, status: 200, json: { token: "t" } }]);
    await login("admin", { fetchImpl, backend: "https://staging.example.com/api" });
    assert.equal(calls[0].url, "https://staging.example.com/api/auth/login");
  });
});

describe("api", () => {
  test("sends Authorization + JSON body and returns {status,ok,data}", async () => {
    const { fetchImpl, calls } = fakeFetch([{ ok: true, status: 200, json: { items: [1, 2] } }]);
    const res = await api("tkn", "POST", "/shipments", { customerId: 7 }, { fetchImpl });
    assert.deepEqual(res, { status: 200, ok: true, data: { items: [1, 2] } });
    const c = calls[0];
    assert.equal(c.url, `${DEFAULT_BACKEND}/shipments`);
    assert.equal(c.init.method, "POST");
    assert.equal(c.init.headers.Authorization, "Bearer tkn");
    assert.equal(c.init.headers["Content-Type"], "application/json");
    assert.equal(c.init.body, JSON.stringify({ customerId: 7 }));
  });

  test("omits Authorization when token is null (for /auth/* calls)", async () => {
    const { fetchImpl, calls } = fakeFetch([{ ok: true, status: 200, json: {} }]);
    await api(null, "GET", "/auth/refresh", undefined, { fetchImpl });
    assert.equal(calls[0].init.headers.Authorization, undefined);
  });

  test("merges query params and omits null/undefined values", async () => {
    const { fetchImpl, calls } = fakeFetch([{ ok: true, status: 200, json: {} }]);
    await api("t", "GET", "/x", undefined, { fetchImpl, query: { a: 1, b: null, c: undefined, d: "z" } });
    const url = new URL(calls[0].url);
    assert.equal(url.searchParams.get("a"), "1");
    assert.equal(url.searchParams.has("b"), false);
    assert.equal(url.searchParams.has("c"), false);
    assert.equal(url.searchParams.get("d"), "z");
  });

  test("merges extra headers (e.g. Idempotency-Key) on top of the defaults", async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 200, json: { ok: true } }]);
    await api("tkn", "POST", "/shipments", { x: 1 }, { fetchImpl, headers: { "Idempotency-Key": "abc-123" } });
    const h = calls[0].init.headers;
    assert.equal(h.Authorization, "Bearer tkn");
    assert.equal(h["Content-Type"], "application/json");
    assert.equal(h["Idempotency-Key"], "abc-123");
  });

  test("caller can override Authorization by passing it in headers (for /auth/* edge cases)", async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 200, json: {} }]);
    await api("tkn", "GET", "/x", undefined, { fetchImpl, headers: { Authorization: "Bearer override" } });
    assert.equal(calls[0].init.headers.Authorization, "Bearer override");
  });

  test("does NOT throw on non-2xx — returns ok:false so the caller can assert on status", async () => {
    const { fetchImpl } = fakeFetch([{ ok: false, status: 404, text: "not here" }]);
    const res = await api("t", "GET", "/missing", undefined, { fetchImpl });
    assert.equal(res.status, 404);
    assert.equal(res.ok, false);
    assert.equal(res.data, "not here");
  });

  test("returns the raw text as `data` when the body is not JSON", async () => {
    const { fetchImpl } = fakeFetch([{ status: 200, body: "plain" }]);
    const res = await api("t", "GET", "/whatever", undefined, { fetchImpl });
    assert.equal(res.data, "plain");
  });
});

describe("health", () => {
  test("returns ok:true + body on a 200", async () => {
    const { fetchImpl } = fakeFetch([{ status: 200, json: { status: "ok" } }]);
    const h = await health("http://x/api", fetchImpl);
    assert.equal(h.ok, true);
    assert.equal(h.status, 200);
    assert.deepEqual(h.body, { status: "ok" });
    assert.ok(Number.isFinite(h.ms));
  });

  test("returns ok:false + error message on a network failure", async () => {
    const fetchImpl = async () => { throw new Error("ECONNREFUSED"); };
    const h = await health("http://x/api", fetchImpl);
    assert.equal(h.ok, false);
    assert.match(h.error, /ECONNREFUSED/);
  });
});

describe("ROLES + role()", () => {
  test("every known QA role has a username, home, and api endpoint", () => {
    for (const [key, def] of Object.entries(ROLES)) {
      assert.ok(def.username, `${key} missing username`);
      assert.ok(def.home?.startsWith("/"), `${key} home must be a route`);
      assert.ok(def.api?.startsWith("/"), `${key} api must be a route`);
    }
  });

  test("role() throws on an unknown key (caller does not need to null-check)", () => {
    assert.throws(() => role("not-a-role"), /unknown role "not-a-role"/);
  });
});
