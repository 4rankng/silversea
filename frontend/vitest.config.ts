import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { cpus } from 'node:os';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test-setup.ts'],
    // Full-suite order stability (QA 26, branch fix-sec-depends part B): the
    // batch run flaked with a DIFFERENT handful of 5s-timeout failures on
    // each run while every one of those files passed isolated and on
    // immediate retry (qa/2026-10-27_dependabot68-vitest-bump: 9 timeouts
    // across 7 files, then 733/733 green on the very next run). The variable
    // is scheduling contention, not shared test state — this host reports 10
    // logical CPUs but only 4 performance cores, so the default fork count
    // saturates the machine and pushes findBy* latency past the 5s test
    // timeout for whichever files happen to be mid-flight during the spike.
    // Cap workers at half the logical CPUs so per-test latency stays bounded
    // on every run instead of on most runs. No test is skipped or weakened;
    // (the 5s default timeout statement below is superseded by the R14 note.)
    // R14 gates (2026-11-10): the QA-26 worker cap no longer bounds per-test
    // latency on its own — the suite grew to 816 files / 6416 tests and a full
    // run scattered ~13 outer-timeout failures per run (a DIFFERENT handful
    // each time: AccountingDebitClosePage, Layout nav matrix, detailed-plan,
    // shipment-create), while every one of those files passed idle (14 files,
    // 278/278, qa/2026-11-10_r14-gates-fe-suspects). The failure class is
    // unchanged (scheduling contention pushing awaits past the ceiling), so
    // the ceiling rises with it: 5000ms → 15000ms. A passing test never waits
    // for the ceiling, so green-path wall time is unchanged; a genuinely
    // broken assertion still fails, only later. Nothing skipped, nothing
    // weakened.
    testTimeout: 15000,
    maxWorkers: Math.max(2, Math.min(4, Math.floor(cpus().length / 2))),
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@tingting/shared': resolve(__dirname, '../shared/src'),
    },
  },
});
