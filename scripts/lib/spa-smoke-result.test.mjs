import assert from "node:assert/strict";
import { test } from "node:test";
import { assessSpaSmoke } from "./spa-smoke-result.mjs";
import { ROLES } from "./http.mjs";

const healthy = () => ({
  expectedHome: "/accounting",
  urlAfterRoot: "http://localhost:7174/accounting",
  urlAfterHome: "http://localhost:7174/accounting?view=work",
  forbiddenAdminBlocked: true,
  dispatchBlocked: true,
  homeSurface: { ready: true },
  apiSmoke: { ok: true, status: 200 },
  browserErrors: [],
  failedApiResponses: [],
});

test("complete healthy smoke evidence passes", () => {
  assert.deepEqual(assessSpaSmoke(healthy()), { ok: true, failures: [] });
});

for (const [name, change] of Object.entries({
  "API rejection at a correct URL": { apiSmoke: { ok: false, status: 403 } },
  "inconsistent API success flag": { apiSmoke: { ok: true, status: 500 } },
  "page exception": { browserErrors: ["PAGE-EXC: render failed"] },
  "failed page data request": { failedApiResponses: [{ status: 503, path: "/api/trips" }] },
  "blank or loading page": { homeSurface: { ready: false } },
  "root landing on the wrong page": { urlAfterRoot: "http://localhost:7174/dashboard" },
  "expected path only in query": { urlAfterHome: "http://localhost:7174/login?next=/accounting" },
  "expected path only as prefix": { urlAfterHome: "http://localhost:7174/accounting-old" },
  "admin route leak": { forbiddenAdminBlocked: false },
  "dispatch route leak": { dispatchBlocked: false },
  "missing browser evidence": { browserErrors: undefined },
  "missing request evidence": { failedApiResponses: undefined },
})) {
  test(`smoke fails closed for ${name}`, () => {
    const result = assessSpaSmoke({ ...healthy(), ...change });
    assert.equal(result.ok, false);
    assert.ok(result.failures.length > 0);
  });
}

test("admin smoke expects the application's configuration landing page", () => {
  assert.equal(ROLES.admin.home, "/config");
});
