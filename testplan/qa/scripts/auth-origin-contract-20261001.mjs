// Real browser regression: opaque-document reload must not receive SPA auth.
// Run: node testplan/qa/scripts/auth-origin-contract-20261001.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadEnv, preflight } from '../lib/env.mjs';
import { createSession } from '../lib/harness.mjs';
const env = await loadEnv();
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(env.baseUrl).hostname));
await preflight(env);
const output = path.resolve('qa/2026-10-01_comprehensive-audit_auth-origin');
await fs.mkdir(output, { recursive: true });
const ctx = await createSession({ env, role: 'ADMIN', evidenceDir: output, runId: 'auth-origin' });
const events = [];
ctx.page.on('pageerror', error => events.push({ message: error.message, url: ctx.page.url() }));
try {
  assert.equal(ctx.page.url(), 'about:blank');
  await ctx.page.setViewport({ width: 390, height: 900, hasTouch: true });
  await ctx.settle(150);
  const blankEvents = [...events];
  await ctx.goto('/accounting/phoi-phieu');
  const application = { url: ctx.page.url(), authenticatedTokenMatches: await ctx.page.evaluate(token => localStorage.getItem('token') === token, ctx.token), role: ctx.user.role };
  const screenshot = await ctx.screenshot('admin-390-application-auth');
  await fs.writeFile(path.join(output, 'origin-proof.json'), JSON.stringify({ blankEvents, events, application, screenshot }, null, 2));
  assert.equal(blankEvents.length, 0, 'opaque about:blank reload must never execute token storage');
  assert.equal(events.length, 0);
  assert.equal(application.authenticatedTokenMatches, true);
  assert.equal(new URL(application.url).pathname, '/accounting/phoi-phieu');
  console.log(JSON.stringify({ opaqueReloadErrors: blankEvents.length, applicationAuth: true, role: application.role }));
} finally { await ctx.close(); }
