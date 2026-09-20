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
  const baseUrl = process.env.STAGING_URL || process.env.BASE_URL || 'http://localhost:7174';
  const api = process.env.STAGING_API || process.env.API_URL || `${baseUrl.replace(/\/$/, '')}/api`;
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
  };
}
