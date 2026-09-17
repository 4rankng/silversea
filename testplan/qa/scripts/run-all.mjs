#!/usr/bin/env node
// scripts/run-all.mjs — run a topic set of cases from testplan/qa/cases/<topic>/index.mjs.
//
// Usage:
//   STAGING_URL=https://vantai.tingting.vip \
//   node testplan/qa/scripts/run-all.mjs chungtu-regression

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadEnv } from '../lib/env.mjs';
import { createSession, writeRunSummary } from '../lib/harness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

async function main() {
  const topic = process.argv[2];
  if (!topic) {
    console.error('usage: node scripts/run-all.mjs <topic>');
    console.error('  topics live in testplan/qa/cases/<topic>/index.mjs');
    process.exit(1);
  }
  const indexFile = path.resolve(__dirname, '..', 'cases', topic, 'index.mjs');
  try {
    await fs.access(indexFile);
  } catch {
    console.error(`topic index not found: ${indexFile}`);
    process.exit(1);
  }

  const env = await loadEnv();
  const today = new Date().toISOString().slice(0, 10);
  const runId = `${today}_${topic}`;
  const evidenceDir = path.join(REPO_ROOT, 'testplan', 'qa', 'evidence', runId);

  console.log(`[run-all] topic=${topic}`);
  console.log(`[run-all] env=${env.env} url=${env.baseUrl}`);
  console.log(`[run-all] evidenceDir=${evidenceDir}`);

  const set = await import(pathToFileURL(indexFile).href);
  if (!Array.isArray(set.cases)) {
    throw new Error(`topic index must export { cases: [{ id, role, file }] }`);
  }

  // Group by role so we reuse one browser session per role
  const byRole = new Map();
  for (const c of set.cases) {
    if (!byRole.has(c.role)) byRole.set(c.role, []);
    byRole.get(c.role).push(c);
  }

  const allResults = [];
  for (const [role, cases] of byRole.entries()) {
    console.log(`\n[run-all] — role ${role}: ${cases.length} case(s)`);
    const ctx = await createSession({ env, role, evidenceDir, runId });
    for (const c of cases) {
      const t0 = Date.now();
      let result;
      try {
        const mod = await import(pathToFileURL(path.resolve(path.dirname(indexFile), c.file)).href);
        result = await mod.default(ctx, { env, evidenceDir, runId });
      } catch (e) {
        result = { verdict: 'ERROR', errors: [e.stack || e.message] };
      }
      const durationMs = Date.now() - t0;
      const row = {
        caseId: c.id,
        role,
        file: c.file,
        verdict: result.verdict || 'INCONCLUSIVE',
        durationMs,
        ...result,
      };
      allResults.push(row);
      console.log(`  ${row.caseId}: ${row.verdict} (${row.durationMs}ms)`);
      if (row.errors?.length) console.log('    errors:', row.errors);
    }
    await ctx.close();
  }

  await writeRunSummary({ runId, evidenceDir, results: allResults });
  const summary = path.join(evidenceDir, 'results.json');
  console.log(`\n[run-all] summary → ${summary}`);
  const pass = allResults.filter((r) => r.verdict === 'PASS').length;
  const fail = allResults.filter((r) => r.verdict === 'FAIL').length;
  const other = allResults.length - pass - fail;
  console.log(`[run-all] ${pass} pass · ${fail} fail · ${other} inconclusive/error`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(2); });
