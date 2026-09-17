#!/usr/bin/env node
// scripts/run-case.mjs — run a single test case by file path.
//
// Usage:
//   STAGING_URL=https://vantai.tingting.vip \
//   node testplan/qa/scripts/run-case.mjs testplan/qa/cases/TC-CUS-CREATE-021.mjs
//
// Each case file exports default `async function (ctx, helpers) → { verdict, ... }`
// where helpers is `{ env, runId, evidenceDir }`.

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadEnv } from '../lib/env.mjs';
import { createSession, writeRunSummary } from '../lib/harness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TESTPLAN_QA = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(TESTPLAN_QA, '..', '..');

async function main() {
  const casePath = process.argv[2];
  if (!casePath) {
    console.error('usage: node scripts/run-case.mjs <case-file.mjs>');
    process.exit(1);
  }
  const absCase = path.resolve(casePath);

  const env = await loadEnv();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runId = `${timestamp}_${process.pid}_${path.basename(absCase, '.mjs')}`;
  const evidenceDir = path.join(REPO_ROOT, 'testplan', 'qa', 'evidence', runId);

  console.log(`[run-case] case=${absCase}`);
  console.log(`[run-case] env=${env.env} url=${env.baseUrl}`);
  console.log(`[run-case] evidenceDir=${evidenceDir}`);

  const caseMod = await import(pathToFileURL(absCase).href);
  if (typeof caseMod.default !== 'function') {
    throw new Error(`case file must export default function; got ${typeof caseMod.default}`);
  }

  const ctx = await createSession({ env, role: caseMod.role, evidenceDir, runId });
  const helpers = { env, evidenceDir, runId };

  const t0 = Date.now();
  let result;
  try {
    result = await caseMod.default(ctx, helpers);
  } catch (e) {
    result = { verdict: 'ERROR', errors: [e.stack || e.message] };
  }
  const durationMs = Date.now() - t0;

  await writeRunSummary({
    runId,
    evidenceDir,
    results: [{ caseId: caseMod.caseId || path.basename(absCase, '.mjs'), verdict: result.verdict || 'INCONCLUSIVE', durationMs, ...result }],
  });
  console.log(`[run-case] ${result.verdict || 'INCONCLUSIVE'} in ${durationMs}ms`);
  console.log('[run-case] summary written to', path.join(evidenceDir, 'results.json'));

  await ctx.close();
  process.exit(result.verdict === 'PASS' ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(2); });
