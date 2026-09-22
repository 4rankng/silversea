import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const configUrl = new URL('../../config/index.ts', import.meta.url).href;
const tsxLoader = import.meta.resolve('tsx');

// A fresh process and empty cwd prevent cached modules and a developer's .env
// from hiding the target-switching failure. No DB/Redis client is imported.
function loadConfig(overrides: Record<string, string> = {}) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'silversea-config-'));
  try {
    const result = spawnSync(process.execPath, ['--import', fileURLToPath(tsxLoader), '--input-type=module', '-e',
      `const { config } = await import(${JSON.stringify(configUrl)}); console.log(JSON.stringify(config));`,
    ], {
      cwd,
      env: { PATH: process.env.PATH, NODE_ENV: 'development', ...overrides },
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.ifError(result.error);
    return result;
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test('valid development defaults retain the local DB and Redis targets', () => {
  const result = loadConfig();
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout.trim());
  assert.equal(config.nodeEnv, 'development');
  assert.equal(config.databaseUrl, 'postgres://postgres:postgres@localhost:5441/silversea');
  assert.equal(config.redisUrl, 'redis://localhost:6391');
});

test('valid explicit test configuration retains its selected targets and mode', () => {
  const result = loadConfig({
    NODE_ENV: 'test', PORT: '3999', DATABASE_URL: 'postgres://localhost:5441/isolated_qa',
    REDIS_URL: 'redis://localhost:6391/14', DB_POOL_MAX: '3',
  });
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout.trim());
  assert.equal(config.nodeEnv, 'test');
  assert.equal(config.port, 3999);
  assert.equal(config.databaseUrl, 'postgres://localhost:5441/isolated_qa');
  assert.equal(config.redisUrl, 'redis://localhost:6391/14');
  assert.equal(config.dbPoolMax, 3);
});

const invalidConfigs: Record<string, Record<string, string>> = {
  pool: { DB_POOL_MAX: '-1' },
  port: { PORT: 'invalid' },
  database: { DATABASE_URL: 'not-a-url' },
  environment: { NODE_ENV: 'invalid' },
};
for (const [name, invalid] of Object.entries(invalidConfigs)) {
  test(`invalid ${name} configuration stops before exporting fallback targets`, () => {
    const result = loadConfig({
      NODE_ENV: 'test', DATABASE_URL: 'postgres://localhost:5441/isolated_qa',
      REDIS_URL: 'redis://localhost:6391/14', ...invalid,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Invalid configuration/);
    assert.equal(result.stdout.trim(), '', 'No replacement runtime config may be exported');
  });
}

test('production still rejects missing required configuration', () => {
  const result = loadConfig({ NODE_ENV: 'production' });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Invalid configuration/);
  assert.equal(result.stdout.trim(), '');
});
