import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const routesSource = readFileSync(
  join(here, '../../routes/shipments/cus-workspace.routes.ts'),
  'utf8',
);

test('SIL-748: OPS is admitted to /cus-workspace, /cus-workspace/containers, and /cus-workspace/:id', () => {
  // GET /cus-workspace
  assert.match(
    routesSource,
    /cusWorkspaceRoutes\.get\(\s*['"]\/cus-workspace['"],\s*requireRoles\([^)]*Role\.OPS[^)]*\)/,
    '/cus-workspace must admit Role.OPS',
  );

  // GET /cus-workspace/containers
  assert.match(
    routesSource,
    /cusWorkspaceRoutes\.get\(\s*['"]\/cus-workspace\/containers['"],\s*requireRoles\([^)]*Role\.OPS[^)]*\)/,
    '/cus-workspace/containers must admit Role.OPS',
  );

  // GET /cus-workspace/:id
  assert.match(
    routesSource,
    /cusWorkspaceRoutes\.get\(\s*['"]\/cus-workspace\/:id['"],\s*requireRoles\([^)]*Role\.OPS[^)]*\)/,
    '/cus-workspace/:id must admit Role.OPS',
  );
});
