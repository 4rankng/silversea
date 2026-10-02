// testplan/qa/lib/env.mjs — environment config
//
// Reads baseUrl/api from env vars (STAGING_URL, STAGING_API) and falls back to
// testplan/testaccounts.txt so the harness works without any setup.
//
// All scripts in scripts/ and cases/ import from here — never hardcode URLs.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TESTPLAN_ROOT = path.resolve(__dirname, '..', '..');
const TESTACCOUNTS = path.join(TESTPLAN_ROOT, 'testaccounts.txt');

// Split a testaccounts.txt body into role → username lists per section.
// Entries are comma-separated; each entry contributes its first
// whitespace-delimited token, but only if it starts with a letter — prose
// prefixes like "38 named drivers…" yield "38", which is not a username
// candidate and would make the DRIVER role unresolvable (card _46).
export function parseAccountsTxt(txt) {
  const accounts = { local: {}, staging: {} };
  let section = null;
  for (const line of txt.split('\n')) {
    if (/^(local|staging):\s*$/.test(line)) { section = line.replace(':', '').trim(); continue; }
    if (!section) continue;
    const m = line.match(/^ {4}(\w+):\s+(.+)$/);
    if (!m) continue;
    const role = m[1];
    const usernames = m[2].split(',').map((s) => s.trim().split(/\s+/)[0]).filter((t) => /^[a-z]/i.test(t));
    accounts[section][role] = usernames;
  }
  return accounts;
}

export async function loadEnv() {
  const baseUrl = process.env.STAGING_URL || process.env.BASE_URL || 'http://localhost:7175';
  // With no URL overrides, the local default follows the Makefile contract:
  // frontend :7175, backend :3002 (two ports, unlike staging's single origin).
  const api = process.env.STAGING_API || process.env.API_URL
    || (process.env.STAGING_URL || process.env.BASE_URL
      ? `${baseUrl.replace(/\/$/, '')}/api`
      : 'http://localhost:3002/api');
  const password = process.env.PASSWORD || 'Abc123';

  let accounts = { local: {}, staging: {} };
  try {
    const txt = await fs.readFile(TESTACCOUNTS, 'utf8');
    accounts = parseAccountsTxt(txt);
  } catch (e) {
    console.warn('env: could not parse testaccounts.txt:', e.message);
  }

  const env = baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1') ? 'local' : 'staging';

  return {
    env,
    baseUrl: baseUrl.replace(/\/$/, ''),
    api,
    password,
    accounts,
    // Convenience: pick first user for a role in the current env
    userFor(role) {
      const list = accounts[env]?.[role];
      return list?.[0] || null;
    },
    // Ordered candidates for a role. The local DB has two modes — dev-seed
    // (demo users) or `make stgdb` (prod-mirror) — so no single first entry
    // is always present. Callers that can probe a login (smoke.mjs,
    // harness createSession) walk this list; userFor stays the first one.
    candidatesFor(role) {
      return accounts[env]?.[role] ?? [];
    },
  };
}

/**
 * Card 20260928_157: a role the env simply does not have is not an exception,
 * it is a BLOCKED run.
 *
 * CUSTOMER is local-only by design — prod has no customer-portal users, so
 * `make stgdb` mirrors none to staging. Before this, pointing any runner at
 * staging made `createSession` throw `no username for role CUSTOMER`, and
 * run-all's per-role `createSession` sits OUTSIDE its per-case try/catch: the
 * topic died with `FATAL ... no username for role CUSTOMER` (exit 2) instead
 * of reporting the role as unavailable. A crash reads like a harness defect;
 * BLOCKED naming the env reads like what it is.
 *
 * The marker travels on the error so both runners can recognise it without
 * string-matching the message.
 */
export function missingRoleError(role, envName) {
  const err = new Error(`no username for role ${role} in env ${envName}; check testplan/testaccounts.txt`);
  err.code = 'NO_ROLE_CANDIDATES';
  err.role = role;
  return err;
}

/** The BLOCKED verdict for every case of a role this env cannot log in. */
export function blockedForMissingRole(role, envName) {
  return {
    verdict: 'BLOCKED',
    errors: [
      `[${envName}] role ${role} has no account in env ${envName} — no case for this role can log in here; add a ${role} user to testplan/testaccounts.txt or run this topic on an env that has one`,
    ],
  };
}

/**
 * Fail loudly when the stack is not the one the harness thinks it is.
 *
 * Card 20260928_192. The silent version of this bug is expensive: point the
 * harness at a port nothing serves and every API call 401s, which reads as an
 * auth problem and gets debugged as one — for a long time — when the actual
 * cause is that `pnpm dev` came up on a different port than the Makefile, or
 * proxying to a backend that is not running.
 *
 * So check the two things a run actually depends on, and say which one is
 * wrong rather than letting the suite discover it 200 assertions later:
 *   - the frontend answers on `baseUrl`;
 *   - the API answers on `api` (health probe, any 2xx/3xx/4xx counts as up —
 *     a 401 proves something IS listening, which is the whole question).
 */
export async function preflight(env, { fetchImpl = fetch } = {}) {
  const problems = [];

  for (const [label, url] of [['frontend', env.baseUrl], ['api', env.api]]) {
    try {
      const res = await fetchImpl(url, { redirect: 'manual' });
      // Any response at all means something is bound to that port. A 404 from
      // the API is a routing answer, not a dead server.
      void res.status;
    } catch (e) {
      problems.push(`${label} unreachable at ${url} (${e.cause?.code || e.message})`);
    }
  }

  if (problems.length > 0) {
    const lines = [
      '',
      'PREFLIGHT FAILED — this run would test the wrong thing:',
      ...problems.map((p) => `  - ${p}`),
      '',
      'The local stack is two ports (Makefile line 6):',
      '  frontend 7175  ·  backend 3002',
      'Bring it up from the repo root with `make dev`, or override the port:',
      '  QA_BASE_URL=http://localhost:<port> node <script>.mjs',
      '',
    ];
    const err = new Error(lines.join('\n'));
    err.preflight = true;
    throw err;
  }
  return true;
}
