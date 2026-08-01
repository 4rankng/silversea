import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { submitShipmentForDispatchSchema } from '@tingting/shared';
import shipmentRoutes from '../routes/shipments';

test('the built shared package exposes the shipment dispatch runtime contract', () => {
  assert.equal(typeof submitShipmentForDispatchSchema.safeParse, 'function');
  assert.equal(typeof shipmentRoutes, 'function');
});

test('supported backend entry points refresh the shared runtime package', async () => {
  const [backendPackageText, makefile] = await Promise.all([
    readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    readFile(new URL('../../../Makefile', import.meta.url), 'utf8'),
  ]);
  const backendPackage = JSON.parse(backendPackageText) as {
    scripts: Record<string, string>;
  };

  for (const lifecycle of ['predev', 'prebuild', 'preseed', 'pretest']) {
    assert.equal(backendPackage.scripts[lifecycle], 'pnpm --dir ../shared build');
  }
  assert.match(makefile, /\(cd backend && pnpm dev\)/);
  assert.doesNotMatch(makefile, /\(cd backend && npx tsx watch src\/index\.ts\)/);
});
