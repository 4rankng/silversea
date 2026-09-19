#!/usr/bin/env node
// Per-suite throwaway databases via template clone (card _29).
//
// Every suite runs as its own tsx --test child process against its own
// throwaway database cloned from a clean template, so suites can neither see
// nor poison each other's data. Template build: empty DB → drizzle-kit
// migrate → the one-pass seed bootstrap. LOCAL dev container only (:5441) —
// never staging.
//
// The clone phase serializes globally (PostgreSQL takes a template lock per
// CREATE DATABASE; concurrent clones from one template are the documented
// risk). Suite EXECUTION still runs in parallel via --concurrency.
//
// Usage: node scripts/test-isolated.mjs [--concurrency N] [--filter substr]...
//        [--list] [--pin-isolation] [--keep-template]

import { spawn } from 'node:child_process';
import { openSync, closeSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argValue = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
const hasFlag = (flag) => args.includes(flag);

const concurrency = Math.max(1, Number(argValue('--concurrency') ?? '1'));
const filters = args.flatMap((a, i) => (a === '--filter' ? [args[i + 1]] : [])).filter(Boolean);
const listOnly = hasFlag('--list');
const pin = hasFlag('--pin-isolation');
const keepTemplate = hasFlag('--keep-template');

const baseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5441/silversea';
const adminUrl = (() => { const u = new URL(baseUrl); u.pathname = '/postgres'; return u.href; })();
const templateUrlFor = (name) => { const u = new URL(baseUrl); u.pathname = `/${name}`; return u.href; };

const stamp = `${process.pid}${Date.now().toString(36)}`;
const templateName = `sst_iso_tmpl_${stamp}`;
const admin = postgres(adminUrl, { max: 1 });
const createdDatabases = [];

// Serialize CREATE DATABASE ... TEMPLATE clones — concurrent clones are the
// documented PG caveat; execution parallelism is unaffected.
let cloneTail = Promise.resolve();
const serializedClone = (dbName) => {
  const run = cloneTail.then(() => admin.unsafe(`CREATE DATABASE ${dbName} TEMPLATE ${templateName}`));
  cloneTail = run.catch(() => {});
  return run;
};

function collectSuites(dir, out = []) {
  for (const entry of readdirSync(dir).sort()) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) collectSuites(full, out);
    else if (entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

let allSuites = collectSuites(path.join(backendRoot, 'src', 'tests')).sort();
if (filters.length > 0) {
  allSuites = allSuites.filter((file) => filters.some((f) => file.includes(f)));
}

const PIN_SUITES = [
  'src/tests/ports-code-partial-unique.test.ts',
  'src/tests/locked-lot-port-labels.test.ts',
].map((p) => path.join(backendRoot, p));

const suites = pin ? PIN_SUITES : allSuites;
// The pin proves PARALLEL isolation: it is meaningless at concurrency 1.
const effectiveConcurrency = pin ? Math.max(2, concurrency) : concurrency;
if (listOnly) {
  console.log(suites.map((file) => path.relative(backendRoot, file)).join('\n'));
  console.error(`total: ${suites.length}`);
  process.exit(0);
}

// Child env for suites: UTC clock + the lane's Redis (redis isn't per-suite
// isolated; suites flush only their own keys via prefixes — unchanged from
// the shared-DB runs).
const childEnv = {
  ...process.env,
  TZ: 'UTC',
  REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6391',
};

async function buildTemplate() {
  console.error(`[isolated] building clean template ${templateName} …`);
  await admin.unsafe(`CREATE DATABASE ${templateName}`);
  createdDatabases.push(templateName);
  const templateDbUrl = templateUrlFor(templateName);

  const migrateCode = await spawnLogged('npx', ['drizzle-kit', 'migrate'], templateDbUrl, 'migrate');
  if (migrateCode !== 0) throw new Error(`template migrate failed — see /tmp/${templateName}.migrate.log`);
  const seedCode = await spawnLogged('npx', ['tsx', 'src/reset-seed.ts'], templateDbUrl, 'seed');
  if (seedCode !== 0) throw new Error(`template seed failed — see /tmp/${templateName}.seed.log`);
  console.error('[isolated] template ready');
}

function spawnLogged(cmd, cmdArgs, dbUrl, label) {
  const out = openSync(`/tmp/${templateName}.${label}.log`, 'a');
  const child = spawn(cmd, cmdArgs, {
    cwd: backendRoot,
    env: { ...childEnv, DATABASE_URL: dbUrl },
    stdio: ['ignore', out, out],
  });
  closeSync(out);
  return new Promise((resolve) => child.on('close', (code) => resolve(code)));
}

async function runSuite(file, index) {
  const dbName = `sst_iso_suite_${stamp}_${index}`;
  await serializedClone(dbName);
  createdDatabases.push(dbName);
  const outPath = `/tmp/sst_iso_${stamp}_${index}.log`;
  const out = openSync(outPath, 'w');
  const child = spawn('npx', ['tsx', '--test', '--test-concurrency=1', file], {
    cwd: backendRoot,
    env: { ...childEnv, DATABASE_URL: templateUrlFor(dbName) },
    stdio: ['ignore', out, out],
  });
  closeSync(out);
  const code = await new Promise((resolve) => child.on('close', resolve));
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName}`);
  createdDatabases.splice(createdDatabases.indexOf(dbName), 1);
  const relative = path.relative(backendRoot, file);
  const tailLines = code === 0 ? 3 : 30;
  const tail = readFileSync(outPath, 'utf8').split('\n').filter(Boolean).slice(-tailLines).join(' | ');
  const verdict = code === 0 ? 'PASS' : `FAIL(exit ${code})`;
  console.log(`${verdict} ${relative} :: ${tail}`);
  return { file: relative, ok: code === 0, log: outPath };
}

async function main() {
  // Self-heal: drop leftovers from a previously killed runner (one runner at
  // a time — the sst_iso_ prefix is owned by whoever runs last).
  const stale = await admin.unsafe(`SELECT datname FROM pg_database WHERE datname LIKE 'sst\\_iso%' ESCAPE '\\'`);
  for (const row of stale) {
    if (!row.datname.includes(stamp)) {
      await admin.unsafe(`DROP DATABASE IF EXISTS ${row.datname}`).catch(() => {});
      console.error(`[isolated] swept stale ${row.datname}`);
    }
  }
  await buildTemplate();

  const results = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < suites.length) {
      const index = cursor;
      cursor += 1;
      results.push(await runSuite(suites[index], index));
    }
  };
  await Promise.all(Array.from({ length: Math.min(effectiveConcurrency, suites.length) }, worker));

  const failed = results.filter((r) => !r.ok);
  console.error(`\n[isolated] ${results.length - failed.length}/${results.length} suites green` +
    (failed.length ? ` — FAILURES: ${failed.map((r) => r.file).join(', ')}` : ''));
  if (!keepTemplate) {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${templateName}`);
    createdDatabases.splice(createdDatabases.indexOf(templateName), 1);
  } else {
    console.error(`[isolated] template kept: ${templateName}`);
  }
  await admin.end();
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch(async (err) => {
  console.error(`[isolated] fatal: ${err.message}`);
  for (const name of createdDatabases) {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${name}`).catch(() => {});
  }
  await admin.end();
  process.exitCode = 1;
});
