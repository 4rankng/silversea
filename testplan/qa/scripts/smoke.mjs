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
  for (const role of roles) {
    const u = env.userFor(role);
    // Defensive: env's parser filters prose-prefix tokens, but a hand-edited
    // testaccounts line could still land a non-username here — skip it.
    const looksLikeUsername = u && /^[a-z][a-z0-9-]+$/i.test(u);
    if (!u || !looksLikeUsername) {
      console.log(`  ${role}: -- no users in env ${env.env} (likely local-only role)`);
      continue;
    }
    const r = await fetch(`${env.api}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: u, password: env.password }),
    });
    if (!r.ok) {
      console.log(`  ${role} (${u}): FAIL ${r.status}`);
      continue;
    }
    const { user } = await r.json();
    console.log(`  ${role.padEnd(11)} (${u}): OK → ${user.fullName || user.username} [${user.role}]`);
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(2); });
