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
    // the 5s default timeout is untouched.
    maxWorkers: Math.max(2, Math.floor(cpus().length / 2)),
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@tingting/shared': resolve(__dirname, '../shared/src'),
    },
  },
});
