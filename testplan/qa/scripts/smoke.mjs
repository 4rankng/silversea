#!/usr/bin/env node
// scripts/smoke.mjs — quick health + auth probe for the target environment.
// Does not drive any UI; just confirms API + role logins work end-to-end.

import { loadEnv } from '../lib/env.mjs';

async function main() {
  const env = await loadEnv();
  console.log(`[smoke] env=${env.env} baseUrl=${env.baseUrl} api=${env.api}`);

  const healthResp = await fetch(`${env.api}/health`).catch((e) => null);
  const health = healthResp ? { status: healthResp.status, body: await healthResp.json().catch(() => null) } : { status: 0, body: 'no response' };
  console.log(`[smoke] health: ${health.status} ${JSON.stringify(health.body)}`);
  if (health.status !== 200) process.exit(1);

  const roles = ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'CUS', 'DISPATCHER', 'DRIVER', 'OPS'];
  const looksLikeUsername = (u) => /^[a-z][a-z0-9-]+$/i.test(u);
  for (const role of roles) {
    // Walk the role's candidates: the local DB may be in either mode
    // (dev-seed demo users or make stgdb prod-mirror), so the first entry
    // in testaccounts.txt is not always the one that exists.
    const candidates = env.candidatesFor(role).filter(looksLikeUsername);
    if (candidates.length === 0) {
      console.log(`  ${role}: -- no users in env ${env.env} (likely local-only role)`);
      continue;
    }
    let hit = null;
    for (const u of candidates) {
      const r = await fetch(`${env.api}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: u, password: env.password }),
      });
      if (r.ok) { hit = { u, user: (await r.json()).user }; break; }
      console.log(`  ${role} (${u}): miss ${r.status}, trying next candidate`);
    }
    if (!hit) {
      console.log(`  ${role}: FAIL — all ${candidates.length} candidates refused`);
      continue;
    }
    console.log(`  ${role.padEnd(11)} (${hit.u}): OK → ${hit.user.fullName || hit.user.username} [${hit.user.role}]`);
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(2); });
