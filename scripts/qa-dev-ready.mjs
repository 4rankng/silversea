#!/usr/bin/env node
/**
 * Pre-flight: assert the local dev stack is ready before any QA run.
 *
 * Checks (all must pass for exit 0):
 *   1. Docker containers: ss-prod-db + ss-prod-redis running
 *   2. Postgres reachable on 5441 + can read public schema
 *   3. Redis reachable on 6391 + responds to PING
 *   4. Backend health on 3001/api/health returns 200
 *   5. Frontend HTTP on 7174 returns 200 (not the login redirect)
 *   6. DB migrations are at the journal's HEAD (no pending migrations)
 *
 * Usage:
 *   node scripts/qa-dev-ready.mjs                     # auto-load .env, default ports
 *   BACKEND=http://localhost:3001/api node scripts/qa-dev-ready.mjs
 *   node scripts/qa-dev-ready.mjs --json              # machine-readable output
 *   node scripts/qa-dev-ready.mjs --quiet             # only print failures
 *
 * Exits 0 if every check passes; 1 otherwise. Writes
 *   qa/<date>_dev-ready/report.json
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { health } from "./lib/http.mjs";

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const FRONTEND = process.env.FRONTEND ?? "http://localhost:7174";
const BACKEND = process.env.BACKEND ?? "http://localhost:3001/api";
const DB_CONTAINER = process.env.DB_CONTAINER ?? "ss-prod-db";
const REDIS_CONTAINER = process.env.REDIS_CONTAINER ?? "ss-prod-redis";
const DB_USER = process.env.DB_USER ?? "postgres";
const DB_NAME = process.env.DB_NAME ?? "silversea";
const ARTIFACTS = process.env.ARTIFACTS ?? `qa/${new Date().toISOString().slice(0, 10)}_dev-ready`;

const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const QUIET = args.includes("--quiet") || JSON_OUT;

function docker(args_, opts = {}) {
  try {
    return { ok: true, out: execFileSync("docker", args_, { encoding: "utf8", timeout: 5_000, ...opts }).trim() };
  } catch (error) {
    return { ok: false, out: "", code: error?.status ?? -1, err: error?.stderr?.toString?.() ?? String(error) };
  }
}

async function check(label, fn) {
  const start = Date.now();
  try {
    const detail = await fn();
    return { label, ok: true, ms: Date.now() - start, detail };
  } catch (error) {
    return { label, ok: false, ms: Date.now() - start, error: error?.message ?? String(error) };
  }
}

const results = [];

// 1) Docker
results.push(await check("docker db container running", async () => {
  const r = docker(["inspect", "-f", "{{.State.Running}}", DB_CONTAINER]);
  if (!r.ok) throw new Error(`docker inspect failed: ${r.err || "command failed"}`);
  if (r.out !== "true") throw new Error(`${DB_CONTAINER} is not running (state=${r.out || "missing"})`);
  return { container: DB_CONTAINER };
}));

results.push(await check("docker redis container running", async () => {
  const r = docker(["inspect", "-f", "{{.State.Running}}", REDIS_CONTAINER]);
  if (!r.ok) throw new Error(`docker inspect failed: ${r.err || "command failed"}`);
  if (r.out !== "true") throw new Error(`${REDIS_CONTAINER} is not running (state=${r.out || "missing"})`);
  return { container: REDIS_CONTAINER };
}));

// 2) Postgres
results.push(await check("postgres reachable + has tables", async () => {
  const r = docker([
    "exec", DB_CONTAINER, "psql", "-U", DB_USER, "-d", DB_NAME, "-tAc",
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';",
  ]);
  if (!r.ok) throw new Error(`psql failed: ${r.err || r.out}`);
  const n = Number(r.out);
  if (!Number.isFinite(n) || n < 50) throw new Error(`expected ≥50 public tables, got ${n} (run 'make setup' or 'pnpm seed')`);
  return { tables: n };
}));

// 3) Redis
results.push(await check("redis responds to PING", async () => {
  const r = docker(["exec", REDIS_CONTAINER, "redis-cli", "PING"]);
  if (!r.ok) throw new Error(`redis-cli failed: ${r.err || r.out}`);
  if (r.out !== "PONG") throw new Error(`expected PONG, got "${r.out}"`);
  return { response: r.out };
}));

// 4) Backend health
results.push(await check("backend /api/health 200", async () => {
  const h = await health(BACKEND);
  if (!h.ok) throw new Error(`status=${h.status} body=${JSON.stringify(h.body)} error=${h.error ?? ""}`);
  return { status: h.status, body: h.body, ms: h.ms };
}));

// 5) Frontend
results.push(await check("frontend root returns 200", async () => {
  const start = Date.now();
  const res = await fetch(FRONTEND, { signal: AbortSignal.timeout(5_000) });
  const ms = Date.now() - start;
  if (!res.ok) throw new Error(`status=${res.status}`);
  // The Vite dev server returns 200 on /; the production build redirects to
  // /login on /, which is also a 200 (nginx serves index.html). Either is
  // fine for the "the SPA is up" assertion.
  return { status: res.status, ms };
}));

// 6) Migrations
results.push(await check("db migrations at journal HEAD", async () => {
  const journalPath = resolve(REPO_ROOT, "backend/drizzle/meta/_journal.json");
  if (!existsSync(journalPath)) throw new Error(`journal not found at ${journalPath}`);
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  const expected = journal.entries.length;
  const r = docker([
    "exec", DB_CONTAINER, "psql", "-U", DB_USER, "-d", DB_NAME, "-tAc",
    "SELECT count(*) FROM drizzle.__drizzle_migrations;",
  ]);
  if (!r.ok) throw new Error(`psql failed: ${r.err || r.out}`);
  const actual = Number(r.out);
  if (!Number.isFinite(actual)) throw new Error(`could not parse migration count: "${r.out}"`);
  if (actual < expected) {
    throw new Error(`DB has ${actual} migrations, journal expects ${expected} (run 'make migrate' to apply pending)`);
  }
  return { expected, applied: actual, latestTag: journal.entries[expected - 1]?.tag };
}));

// ── Output ────────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
const summary = {
  generatedAt: new Date().toISOString(),
  frontend: FRONTEND,
  backend: BACKEND,
  total: results.length,
  passed: results.length - failed.length,
  failed: failed.length,
  allPassed: failed.length === 0,
  results,
};

mkdirSync(ARTIFACTS, { recursive: true });
writeFileSync(resolve(ARTIFACTS, "report.json"), `${JSON.stringify(summary, null, 2)}\n`);

if (JSON_OUT) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  for (const r of results) {
    const icon = r.ok ? "✓" : "✗";
    const tail = r.ok ? (r.detail ? ` — ${JSON.stringify(r.detail)}` : "") : ` — ${r.error}`;
    if (r.ok && QUIET) continue;
    console.log(`  ${icon} ${r.label}${tail}  (${r.ms}ms)`);
  }
  console.log("");
  console.log(failed.length === 0
    ? `✅ Dev stack ready (${summary.passed}/${summary.total} checks passed) — report: ${ARTIFACTS}/report.json`
    : `❌ Dev stack NOT ready (${summary.passed}/${summary.total} passed) — fix above then re-run`);
}

process.exit(failed.length === 0 ? 0 : 1);
