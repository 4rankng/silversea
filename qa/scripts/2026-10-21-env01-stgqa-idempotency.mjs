#!/usr/bin/env node
/**
 * ENV-01 integration probe — stgqa seed/purge idempotency on the LOCAL dev
 * DB (qa/scripts per the 2026-10-19 owner ruling; NEVER run against staging
 * or prod — the PR only installs + documents the pipeline).
 *
 * Proves, in order:
 *   A. seed run #1 creates the exact fixture census (1 BU / 1 KH / 1 nhà xe /
 *      4 lots / 4 containers);
 *   B. seed run #2 converges to the SAME census and the SAME lot row ids
 *      (idempotent upserts, no duplicates);
 *   C. the seed never touches users (full-row snapshot identical);
 *   D. the password reset leaves user identity intact and collapses every
 *      password_hash to one value (the Abc123 rule);
 *   E. the QA-fixture purge clears the whole fixture class (visible census 0;
 *      the nhà xe row is FK-pinned master data, so the registry SCRUBS its
 *      identity instead of deleting the row) while non-QA user rows (the
 *      NV00x real-staff class) stay untouched;
 *   F. a re-seed after the purge restores the exact census again.
 *
 * Usage (repo root or backend/, local stack up — make dev):
 *   node qa/scripts/2026-10-21-env01-stgqa-idempotency.mjs
 * Artifacts: prints STGQA-PROBE-* lines; caller saves them under
 *   qa/<date>_env01-stgqa_<gate>.log
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DB_CONTAINER = 'ss-prod-db';
const DB_NAME = 'silversea';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5441/silversea';
const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../backend');

function psql(query) {
  const res = spawnSync('docker', ['exec', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', DB_NAME, '-tAc', query], { encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`psql failed (${res.status}): ${res.stderr}`);
  return res.stdout.trim();
}

function run(label, args, env) {
  const res = spawnSync('npx', ['tsx', ...args], { cwd: BACKEND, encoding: 'utf8', env: { ...process.env, ...env } });
  const tail = (res.stdout + res.stderr).split('\n').filter((l) => /^(STGQA|QA-PURGE|SURFACE|Error)/.test(l)).slice(-8).join('\n');
  console.log(`[${label}] exit=${res.status}\n${tail || '(no signal lines)'}`);
  return res.status;
}

// ── censuses ─────────────────────────────────────────────────────────────────
function fixtureCensus() {
  return {
    units: Number(psql(`SELECT count(*) FROM business_units WHERE code = 'QA-DEMO'`)),
    customers: Number(psql(`SELECT count(*) FROM customers WHERE code = 'QAKH-DEMO' AND deleted_at IS NULL`)),
    warehouses: Number(psql(`SELECT count(*) FROM operational_sites WHERE code = 'QAKHO-DEMO' AND deleted_at IS NULL`)),
    // Registry design: operational_sites is FK-pinned master data, so the
    // purge SCRUBS (renames) rather than deletes. "Purged" for the warehouse
    // therefore means its fixture identity is gone, not the row.
    warehouseIdentity: Number(psql(`SELECT count(*) FROM operational_sites WHERE code = 'QAKHO-DEMO' AND (name = 'QA Nhà xe Demo' OR short_name = 'QA Nhà xe')`)),
    lots: Number(psql(`SELECT count(*) FROM shipments WHERE shipment_code LIKE 'QAENV01-%' AND deleted_at IS NULL`)),
    containers: Number(psql(`SELECT count(*) FROM shipment_containers WHERE container_number LIKE 'QATU%'`)),
    lotIds: psql(`SELECT coalesce(string_agg(id::text, ',' ORDER BY id), '') FROM shipments WHERE shipment_code LIKE 'QAENV01-%'`),
  };
}

// Registry users-surface QA-class predicate (branch-for-branch mirror of
// qa-fixture-registry.ts; the demo-trio branch is staging-only so the LOCAL
// purge never fires it).
const QA_USER_PREDICATE = `username ILIKE 'qa%' OR full_name ILIKE 'QA%' OR username ~ '-[0-9]{13}-' OR username ILIKE '%-inv-%' OR username ILIKE 'e2e-%' OR username ILIKE 'HAHA-email-probe%'`;

function usersSnapshot() {
  return {
    total: Number(psql(`SELECT count(*) FROM users`)),
    active: Number(psql(`SELECT count(*) FROM users WHERE deleted_at IS NULL`)),
    idsMd5: psql(`SELECT coalesce(md5(string_agg(id::text, ',' ORDER BY id)), '') FROM users`),
    // Full-row digest of every NON-QA user (the real-staff NV00x class):
    // id, username, email, role, status, deletion, password_hash.
    nonQaRowMd5: psql(`SELECT coalesce(md5(string_agg(id || ':' || username || ':' || coalesce(email, '') || ':' || role || ':' || status || ':' || coalesce(deleted_at::text, '') || ':' || password_hash, '|' ORDER BY id)), '') FROM users WHERE NOT (${QA_USER_PREDICATE})`),
    nonQaActive: Number(psql(`SELECT count(*) FROM users WHERE deleted_at IS NULL AND NOT (${QA_USER_PREDICATE})`)),
    distinctHashes: Number(psql(`SELECT count(DISTINCT password_hash) FROM users`)),
  };
}

const failures = [];
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
}

// ── probe ────────────────────────────────────────────────────────────────────
const users0 = usersSnapshot();
const seedEnv = { STGQA_ENV: 'local', DATABASE_URL };

const exitSeed1 = run('seed#1', ['src/seed/seed-qa-fixtures.ts'], seedEnv);
const census1 = fixtureCensus();
check('A: seed#1 exit 0', exitSeed1 === 0);
check('A: exact fixture census', JSON.stringify({ u: census1.units, kh: census1.customers, kho: census1.warehouses, lot: census1.lots, cont: census1.containers }) === JSON.stringify({ u: 1, kh: 1, kho: 1, lot: 4, cont: 4 }), JSON.stringify(census1));

const exitSeed2 = run('seed#2', ['src/seed/seed-qa-fixtures.ts'], seedEnv);
const census2 = fixtureCensus();
check('B: seed#2 exit 0', exitSeed2 === 0);
check('B: census identical (idempotent)', JSON.stringify(census1) === JSON.stringify(census2), `lots ${census1.lotIds} vs ${census2.lotIds}`);

const users1 = usersSnapshot();
check('C: seed never touches users', JSON.stringify(users0) === JSON.stringify(users1), `total ${users0.total}→${users1.total}, idsMd5 same=${users0.idsMd5 === users1.idsMd5}`);

const exitReset = run('pwreset', ['src/seed/reset-staging-passwords.ts'], seedEnv);
const users2 = usersSnapshot();
check('D: reset exit 0', exitReset === 0);
check('D: user identity intact (ids + non-QA rows unchanged, only hashes collapse)', users2.total === users1.total && users2.idsMd5 === users1.idsMd5 && users2.nonQaActive === users1.nonQaActive && users2.distinctHashes === 1, `distinctHashes=${users2.distinctHashes} nonQaActive ${users1.nonQaActive}→${users2.nonQaActive}`);

// E: purge clears the whole fixture class. Exit 2 = guarded survivors
// elsewhere on the dev DB (sanctioned non-gating state for this probe — the
// claim under test is OUR fixture census reaching zero).
const exitPurge = run('purge', ['src/seed/purge-qa-fixtures.ts'], { QA_PURGE_ENV: 'local', DATABASE_URL });
const censusPurged = fixtureCensus();
const users3 = usersSnapshot();
check('E: purge accepted (exit 0 or guarded-2)', exitPurge === 0 || exitPurge === 2, `exit=${exitPurge}`);
check(
  'E: fixture class cleared (visible lots/units/containers 0; warehouse identity scrubbed)',
  censusPurged.units === 0 && censusPurged.customers === 0 && censusPurged.lots === 0 && censusPurged.containers === 0 && censusPurged.warehouseIdentity === 0,
  JSON.stringify(censusPurged),
);
check('E: non-QA users untouched by purge', users3.nonQaActive === users2.nonQaActive && users3.nonQaRowMd5 === users2.nonQaRowMd5, `nonQaActive ${users2.nonQaActive}→${users3.nonQaActive}, rowMd5 same=${users3.nonQaRowMd5 === users2.nonQaRowMd5}`);

const exitSeed3 = run('seed#3-after-purge', ['src/seed/seed-qa-fixtures.ts'], seedEnv);
const census3 = fixtureCensus();
check('F: seed#3 exit 0', exitSeed3 === 0);
check('F: census restored to the exact set', census3.units === 1 && census3.customers === 1 && census3.warehouses === 1 && census3.lots === 4 && census3.containers === 4, JSON.stringify(census3));
check('F: revived lots keep their row ids (soft-delete + revive, no dupes)', census3.lotIds === census1.lotIds, `${census1.lotIds} vs ${census3.lotIds}`);

const summary = {
  ok: failures.length === 0,
  failures,
  users0, users1, users2, users3,
  census1, census2, censusPurged, census3,
  exits: { seed1: exitSeed1, seed2: exitSeed2, reset: exitReset, purge: exitPurge, seed3: exitSeed3 },
};
const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../2026-10-21-env01-stgqa');
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'probe-result.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`STGQA-PROBE-SUMMARY ok=${summary.ok} failures=[${failures.join(', ')}]`);
console.log(`STGQA-PROBE-ARTIFACT ${path.join(outDir, 'probe-result.json')}`);
process.exit(failures.length === 0 ? 0 : 1);
