#!/usr/bin/env node
/**
 * Build and tests enforce the same reviewed structure contract.
 * Existing file ceilings live in structure.guard.test.ts; new source files
 * have a 400-line ceiling. No duplicated 600-line policy or bypass switches.
 * Updating a ceiling still requires the explicit review documented there.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const frontend = fileURLToPath(new URL('../', import.meta.url));
const result = spawnSync(process.execPath, [
  fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url)),
  'run', 'src/tests/structure.guard.test.ts', '--maxWorkers=1',
], { cwd: frontend, stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
