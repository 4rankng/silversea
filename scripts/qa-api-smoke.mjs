#!/usr/bin/env node
/**
 * API smoke test — exercises a curated set of endpoints per role and reports
 * status codes. Catches backend regressions without spinning up a browser.
 *
 * The endpoint list is intentionally small (3-5 per role) and focused on
 * the most-touched resources. The full RBAC × route × viewport matrix is
 * the staging-visual-matrix.mjs run; this is the fast "is the API alive
 * and the roles wired correctly" check that should run on every PR.
 *
 * A 2xx for "list with limit=1" and 4xx for "a role that should NOT see this"
 * are both considered PASS — the smoke asserts the contract, not a single
 * status. See `expected` per row.
 *
 * Usage:
 *   node scripts/qa-api-smoke.mjs                     # every role in ROLES
 *   node scripts/qa-api-smoke.mjs --role cus,laixe    # subset
 *   node scripts/qa-api-smoke.mjs --json              # machine-readable
 *
 * Exit 0 on all PASS, 1 on any FAIL.
 */

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { api, DEFAULT_BACKEND, login, ROLES, role as getRole } from "./lib/http.mjs";

const BACKEND = process.env.BACKEND ?? DEFAULT_BACKEND;
const ARTIFACTS = process.env.ARTIFACTS ?? `qa/${new Date().toISOString().slice(0, 10)}_api-smoke`;

/** Each row: { method, path, expect: 'ok' | 'forbid' | 'any' }
 *  - 'ok'    → 2xx
 *  - 'forbid'→ 401/403 (the role should not be able to read this)
 *  - 'any'   → 2xx, 4xx (we only care it didn't 5xx)
 */
const ENDPOINTS = {
  admin: [
    { method: "GET", path: "/auth/users?limit=1",       expect: "ok" },
    { method: "GET", path: "/audit-logs?limit=1",       expect: "ok" },
    { method: "GET", path: "/admin/app-settings",       expect: "any" },
  ],
  giamdoc: [
    { method: "GET", path: "/trips?limit=1",            expect: "ok" },
    { method: "GET", path: "/shipments?limit=1",        expect: "ok" },
    { method: "GET", path: "/audit-logs?limit=1",       expect: "ok" },
  ],
  ketoan: [
    { method: "GET", path: "/trips?limit=1",            expect: "ok" },
    { method: "GET", path: "/recoverable-costs",        expect: "any" },
    { method: "GET", path: "/shipments?limit=1",        expect: "ok" },
  ],
  cus: [
    { method: "GET", path: "/customers?limit=1",        expect: "ok" },
    { method: "GET", path: "/shipments?limit=1",        expect: "ok" },
    { method: "GET", path: "/audit-logs?limit=1",       expect: "forbid" },
  ],
  dieuvan: [
    { method: "GET", path: "/shipments?limit=1",        expect: "ok" },
    { method: "GET", path: "/trips?limit=1",            expect: "ok" },
    { method: "GET", path: "/customers?limit=1",        expect: "ok" },
  ],
  giaonhan: [
    { method: "GET", path: "/forwarder/me/trips",       expect: "ok" },
    { method: "GET", path: "/shipments?limit=1",        expect: "forbid" },
    { method: "GET", path: "/auth/users?limit=1",       expect: "forbid" },
  ],
  laixe: [
    { method: "GET", path: "/driver/me/trips?limit=1",  expect: "ok" },
    { method: "GET", path: "/driver/me/penalties",      expect: "any" },
    { method: "GET", path: "/shipments?limit=1",        expect: "forbid" },
  ],
  customer: [
    { method: "GET", path: "/portal/shipments?limit=1", expect: "ok" },
    { method: "GET", path: "/portal/debit-notes?limit=1", expect: "any" },
    { method: "GET", path: "/auth/users?limit=1",       expect: "forbid" },
  ],
};

function classify(row, status) {
  switch (row.expect) {
    case "ok":     return status >= 200 && status < 300;
    case "forbid": return status === 401 || status === 403;
    case "any":    return status < 500;
    default:       return false;
  }
}

const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const roleArg = args.find((a) => a.startsWith("--role="));
const roleList = roleArg
  ? roleArg.slice("--role=".length).split(",").filter(Boolean)
  : Object.keys(ROLES);

const summary = {
  generatedAt: new Date().toISOString(),
  backend: BACKEND,
  total: 0,
  passed: 0,
  failed: 0,
  allPassed: true,
  roles: [],
};

for (const roleKey of roleList) {
  const def = getRole(roleKey);
  const rows = ENDPOINTS[roleKey];
  if (!rows) {
    summary.roles.push({ role: roleKey, skipped: true, reason: "no endpoints mapped" });
    continue;
  }
  const token = await login(roleKey);
  const roleResult = { role: roleKey, username: def.username, calls: [] };
  for (const row of rows) {
    const start = Date.now();
    const res = await api(token, row.method, row.path);
    const ok = classify(row, res.status);
    roleResult.calls.push({
      method: row.method,
      path: row.path,
      expect: row.expect,
      status: res.status,
      ok,
      ms: Date.now() - start,
    });
    summary.total += 1;
    if (ok) summary.passed += 1;
    else { summary.failed += 1; summary.allPassed = false; }
  }
  summary.roles.push(roleResult);
  const fails = roleResult.calls.filter((c) => !c.ok);
  if (!JSON_OUT) {
    const status = fails.length === 0 ? "PASS" : "FAIL";
    console.log(`  [${status}]  ${roleKey.padEnd(10)} ${roleResult.calls.length - fails.length}/${roleResult.calls.length} OK`);
    for (const f of fails) {
      console.log(`         ✗ ${f.method} ${f.path} → ${f.status} (expected ${f.expect})`);
    }
  }
}

mkdirSync(ARTIFACTS, { recursive: true });
const { writeFileSync } = await import("node:fs");
writeFileSync(resolve(ARTIFACTS, "report.json"), `${JSON.stringify(summary, null, 2)}\n`);

if (JSON_OUT) console.log(JSON.stringify(summary, null, 2));
else console.log(`\n${summary.allPassed ? "✅" : "❌"} ${summary.passed}/${summary.total} endpoint calls passed — report: ${ARTIFACTS}/report.json`);

process.exit(summary.allPassed ? 0 : 1);
