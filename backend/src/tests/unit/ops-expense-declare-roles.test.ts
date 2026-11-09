// SIL-748 (owner product decision 09/11) — the drawer's [Khai chi phí] entry
// admits CUS: the four create-flow guards must name Role.CUS alongside
// Role.OPS, while edit/delete of saved rows stay OPS-only. Route-guard role
// wiring has no db-free runtime seam (app boot is banned in BE unit tests,
// owner ruling 2026-10-19), so this rides the established source-scan pattern
// (see ops-shipments-route-guard.test.ts).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const opsRoutesSource = readFileSync(join(here, '../../routes/ops.ts'), 'utf8');

test('SIL-748: the expense declaration create flow admits Role.CUS alongside Role.OPS', () => {
  assert.match(
    opsRoutesSource,
    /const EXPENSE_DECLARERS = requireRoles\(Role\.OPS, Role\.CUS\)/,
    'the EXPENSE_DECLARERS guard must be OPS + CUS',
  );
  // The four endpoints the drawer's declaration form drives:
  assert.match(
    opsRoutesSource,
    /router\.get\(\s*'\/expense-types',\s*EXPENSE_DECLARERS/,
    'GET /expense-types must admit CUS — the form cannot render without its catalog',
  );
  assert.match(
    opsRoutesSource,
    /router\.get\(\s*'\/expenses\/cont-claimants',\s*EXPENSE_DECLARERS/,
    'GET /expenses/cont-claimants must admit CUS — the duplicate-claimant warning',
  );
  assert.match(
    opsRoutesSource,
    /router\.post\(\s*'\/expenses',[^\n]*?EXPENSE_DECLARERS/,
    'POST /expenses must admit CUS — the save itself',
  );
  assert.match(
    opsRoutesSource,
    /router\.post\(\s*'\/expense-photos\/upload',[^\n]*?EXPENSE_DECLARERS/,
    'POST /expense-photos/upload must admit CUS — receipt photos ride the same form',
  );
});

test('SIL-748: edit/delete of saved expenses stay OPS-only', () => {
  assert.match(
    opsRoutesSource,
    /router\.patch\(\s*'\/expenses\/:id',[^\n]*?OPS_ONLY/,
    'PATCH /expenses/:id stays OPS_ONLY',
  );
  assert.match(
    opsRoutesSource,
    /router\.delete\(\s*'\/expenses\/:id',[^\n]*?OPS_ONLY/,
    'DELETE /expenses/:id stays OPS_ONLY',
  );
});
