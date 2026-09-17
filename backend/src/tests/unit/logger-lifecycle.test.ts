import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('redirected logger emits JSON and exits without a pretty-transport worker', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
    'import logger from "./src/lib/logger.ts"; logger.warn({ test: "lifecycle" }, "finished");'],
  { cwd: process.cwd(), timeout: 5000, env: { ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'warn' } });
  const record = JSON.parse(stdout.trim());
  assert.equal(record.msg, 'finished');
  assert.equal(record.test, 'lifecycle');
});
