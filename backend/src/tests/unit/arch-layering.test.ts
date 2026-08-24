import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Architecture layering guard for backend/src.
 *
 * Layering contract (docs/backend-architecture.md):
 *   routes (thin: zod parse, authz, service call, response envelope)
 *     -> services (queries, transactions, business rules)
 *       -> db (schema + client)
 *
 * Rules enforced by static scan (fs walk + import-specifier regex — no module
 * graph; the codebase uses static ESM imports only):
 *   1. Route files must not import the db client directly. `../db/schema`
 *      imports stay allowed (type-only surface).
 *   2. Service files must not import from routes (no reverse edges).
 *   3. Source files respect the LOC budget; current violators live in
 *      SIZE_BASELINE below, annotated with the phase that removes them.
 *
 * Baselines are shrink-only: never add entries. Remove an entry in the same
 * commit that fixes the file.
 */

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const SIZE_BUDGET = 1500;

/** repo-relative path (from backend/) -> owning phase or deferral reason */
const SIZE_BASELINE: Record<string, string> = {
  'src/services/cus-shipment-workspace-reads.service.ts': 'deferred (cold)',
};

/**
 * Route files still importing the db client. Legacy long tail (config/catalog/
 * settings routes); shrinks as queries migrate to services. Never add entries.
 */
const DB_CLIENT_IMPORT_BASELINE = new Set([
  'src/routes/trips.ts',
  'src/routes/upload.ts',
  'src/routes/llm-settings.ts',
  'src/routes/gps-settings.ts',
  'src/routes/salary.ts',
  'src/routes/admin-gps.ts',
  'src/routes/forwarder.ts',
  'src/routes/ocr.ts',
  'src/routes/auth.ts',
  'src/routes/expense.ts',
  'src/routes/ocr-settings.ts',
  'src/routes/financial/payments.routes.ts',
  'src/routes/config/salary-periods-config.routes.ts',
  'src/routes/config/config-helpers.ts',
  'src/routes/config/catalog-crud.routes.ts',
  'src/routes/config/debit-note-templates.routes.ts',
  'src/routes/config/audit-logs.routes.ts',
  'src/routes/config/tire-lifecycle.routes.ts',
  'src/routes/config/operational-config.routes.ts',
]);

async function walkTsFiles(dir: string, out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkTsFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(path.relative(srcRoot, full));
    }
  }
  return out;
}

/** Matches `from '../db'` / `from '../../db'` — specifier ends at `db`, so `../db/schema` does not match. */
const DB_CLIENT_IMPORT = /from\s+['"](?:\.\.\/)+(?:\.\.\/)*db['"]/;
/** Matches any import whose specifier crosses into a routes directory — `from '...'` and bare side-effect `import '...'` both count. */
const ROUTES_IMPORT = /(?:from|import)\s*['"][^'"]*\/routes\//;

test('routes do not import the db client outside the frozen baseline', async () => {
  const routesFiles = (await walkTsFiles(path.join(srcRoot, 'src/routes'))).filter(
    (file) => !file.startsWith('src/routes/utils/'),
  );
  assert.ok(routesFiles.length > 20, 'route file discovery found an implausibly small surface');

  const offenders: string[] = [];
  for (const file of routesFiles) {
    const source = await readFile(path.join(srcRoot, file), 'utf8');
    if (DB_CLIENT_IMPORT.test(source) && !DB_CLIENT_IMPORT_BASELINE.has(file)) {
      offenders.push(file);
    }
  }
  assert.deepEqual(offenders, [], [
    'Route files importing the db client must go through a service instead.',
    'Baseline is shrink-only — to fix a file, move its queries to a service and remove its baseline entry in the same commit.',
    'Offenders:',
    ...offenders,
  ].join('\n'));
});

test('baseline lists no longer-existing violations (dead entries must be removed)', async () => {
  const routesFiles = new Set(await walkTsFiles(path.join(srcRoot, 'src/routes')));
  for (const file of DB_CLIENT_IMPORT_BASELINE) {
    const onDisk = routesFiles.has(file);
    const importsDb = onDisk
      ? DB_CLIENT_IMPORT.test(await readFile(path.join(srcRoot, file), 'utf8'))
      : false;
    assert.ok(
      onDisk && importsDb,
      `${file} is baseline-listed but ${onDisk ? 'no longer imports the db client' : 'no longer exists'} — remove the dead entry`,
    );
  }
});

test('services do not import from routes', async () => {
  const serviceFiles = await walkTsFiles(path.join(srcRoot, 'src/services'));
  assert.ok(serviceFiles.length > 100, 'service file discovery found an implausibly small surface');

  const offenders: string[] = [];
  for (const file of serviceFiles) {
    const source = await readFile(path.join(srcRoot, file), 'utf8');
    if (ROUTES_IMPORT.test(source)) {
      offenders.push(file);
    }
  }
  assert.deepEqual(offenders, [], [
    'Services must not import from routes — reverse layering edge.',
    'Offenders:',
    ...offenders,
  ].join('\n'));
});

test('source files respect the LOC budget outside the baseline', async () => {
  const files = [
    ...(await walkTsFiles(path.join(srcRoot, 'src/services'))),
    ...(await walkTsFiles(path.join(srcRoot, 'src/routes'))),
  ];
  const offenders: string[] = [];
  for (const file of files) {
    const source = await readFile(path.join(srcRoot, file), 'utf8');
    const lines = source.split('\n').length;
    if (lines > SIZE_BUDGET && !(file in SIZE_BASELINE)) {
      offenders.push(`${file} (${lines} LOC)`);
    }
  }
  assert.deepEqual(offenders, [], [
    `Source files exceed the ${SIZE_BUDGET} LOC budget. Split the file along a seam and remove its baseline entry in the same commit.`,
    'Offenders:',
    ...offenders,
  ].join('\n'));
});
