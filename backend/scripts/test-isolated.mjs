#!/usr/bin/env node
// Per-suite throwaway databases via template clone (card _29).
//
// Every suite runs as its own tsx --test child process against its own
// throwaway database cloned from a clean template, so suites can neither see
// nor poison each other's data. Template build: empty DB → drizzle-kit
// migrate → the one-pass seed bootstrap. LOCAL dev container only (:5441) —
// never staging.
//
// The clone phase serializes per runner (PostgreSQL takes a template lock per
// CREATE DATABASE; concurrent clones from one template are the documented
// risk). Suite EXECUTION still runs in parallel via --concurrency.
//
// CONCURRENT-SAFETY CONTRACT (card 20261001_254):
//   * STAMPED runners (--stamp <lane> or ISOLATION_STAMP=<lane>) clone into a
//     disjoint `sst_iso_<stamp>_*` namespace. The startup self-heal sweeps
//     ONLY that stamp's own leftovers, and the cross-process gate is
//     per-stamp — so any number of DISTINCT stamps run concurrently without
//     touching each other's databases.
//   * A DEFAULT (unstamped) runner keeps the legacy single-tenant contract:
//     it owns the whole sst_iso_ prefix (its self-heal drops every database
//     not from its own run) and holds the GLOBAL gate. Never run a default
//     runner alongside a stamped one — the default's sweep destroys stamped
//     namespaces too. During migration, stamped runners WAIT for a live
//     global-gate holder before starting, so only default-vs-default and
//     default-vs-stamped orderings need care: run stamped, or run solo.
//   * Both gates are O_EXCL lock dirs; a holder that died without releasing
//     (PID no longer alive) is stale and reclaimable. Wait, never fail.
//
// Usage: node scripts/test-isolated.mjs [--concurrency N] [--filter substr]...
//        [--stamp <lane>] [--list] [--pin-isolation] [--keep-template]
//        (ISOLATION_STAMP=<lane> env is equivalent to --stamp.)

import { spawn } from 'node:child_process';
import fs, { openSync, closeSync, readFileSync, readdirSync, statSync } from 'node:fs';
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

// Per-lane stamp (card 20261001_254): sanitized to lower-case letters and
// digits ONLY — the stamp is interpolated unquoted into CREATE/DROP DATABASE,
// where a dash parses as minus ("syntax error at or near \"-\""), so dashes
// and every other character are stripped (lane names like "arch-filterbar"
// become "archfilterbar"). Empty = legacy single-tenant default.
const laneStampRaw = argValue('--stamp') ?? process.env.ISOLATION_STAMP ?? '';
const laneStamp = laneStampRaw.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 24);
if (laneStampRaw && !laneStamp) {
  console.error('[isolated] fatal: --stamp/ISOLATION_STAMP must contain letters or digits');
  process.exit(2);
}

const stamp = `${process.pid}${Date.now().toString(36)}`;
// Stamped runs clone into sst_iso_<stamp>_*; the default keeps the legacy
// sst_iso_* names exactly (single-tenant compatibility, card 20261001_254 AC2).
const namespace = laneStamp ? `sst_iso_${laneStamp}` : 'sst_iso';
const templateName = `${namespace}_tmpl_${stamp}`;
const admin = postgres(adminUrl, { max: 1 });
const createdDatabases = [];

// Cross-process gates (card 20260930_242 tail-gate lesson + 20261001_254):
// the DEFAULT runner's self-heal DROPS every sst_iso_* database not from its
// own run, so two default runners destroy each other mid-suite — hence the
// GLOBAL gate. A STAMPED runner's sweep touches only its own namespace, so its
// gate is per-stamp (one live runner per lane stamp, distinct stamps free to
// run concurrently). Stamped runners additionally WAIT for any live GLOBAL
// gate holder: a default runner's sweep is namespace-blind, so a stamped run
// must not start under one (see the contract in the header).
const globalLockDir = '/tmp/sst_iso_runner.lock';
const lockDir = laneStamp ? `/tmp/sst_iso_runner_${laneStamp}.lock` : globalLockDir;
const lockPidFile = `${lockDir}/pid`;
const holderAlive = (dir) => {
  try {
    const holder = Number(fs.readFileSync(`${dir}/pid`, 'utf8').trim());
    process.kill(holder, 0); // throws ESRCH when the holder is gone
    return true;
  } catch {
    return false;
  }
};
async function acquireRunnerLock() {
  for (;;) {
    // A live default runner owns the whole prefix — stamped runs queue behind
    // it too; default runs already hold this gate, so the check is a no-op
    // for them (their lockDir IS the global one).
    if (laneStamp && lockDir !== globalLockDir && holderAlive(globalLockDir)) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      continue;
    }
    try {
      fs.mkdirSync(lockDir, { recursive: false });
      fs.writeFileSync(lockPidFile, String(process.pid));
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (!holderAlive(lockDir)) {
        // Stale holder (crashed runner): reclaim. rmdir fails only if another
        // lane recreated it first — loop again in that case.
        try { fs.rmSync(lockDir, { recursive: true }); } catch { /* raced */ }
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}
// --list is read-only and takes no gate; every other mode claims the gate
// before the namespace sweep below (the sweep is the destructive step).
if (!listOnly) {
  await acquireRunnerLock();
  process.on('exit', () => { try { fs.rmSync(lockDir, { recursive: true }); } catch { /* already gone */ } });
}

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
  const dbName = `${namespace}_suite_${stamp}_${index}`;
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
  // Self-heal (card 20261001_254): drop leftovers from a previously killed
  // runner of THIS namespace only. A DEFAULT (unstamped) run keeps the legacy
  // single-tenant sweep — the whole sst_iso_ prefix is owned by whoever runs
  // last — while a STAMPED run touches nothing outside sst_iso_<stamp>_*, so
  // concurrent lanes' clones survive each other's startup (AC3).
  const stale = await admin.unsafe(`SELECT datname FROM pg_database WHERE datname LIKE 'sst\\_iso%' ESCAPE '\\'`);
  const dropped = [];
  const spared = [];
  for (const row of stale) {
    const shouldDrop = laneStamp
      ? row.datname.startsWith(`${namespace}_`)          // stamped: own namespace's leftovers only
      : !row.datname.includes(stamp);                    // default: everything not from this run (legacy)
    if (shouldDrop) {
      await admin.unsafe(`DROP DATABASE IF EXISTS ${row.datname}`).catch(() => {});
      dropped.push(row.datname);
    } else {
      spared.push(row.datname);
    }
  }
  for (const name of dropped) console.error(`[isolated] swept stale ${name}`);
  if (laneStamp && spared.length > 0) {
    console.error(`[isolated] ${spared.length} foreign-namespace database(s) left untouched (stamped run: ${spared.slice(0, 3).join(', ')}${spared.length > 3 ? ', …' : ''})`);
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
