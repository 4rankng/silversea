// SIL-961 (K5.29 + memo 24/11 Mục 08) — CUS (Chứng từ) sees [Khai chi phí] on
// the lot drawer and the BE lot-scope create lane must admit the role. QA
// build 3e9a28fa: tiepvv opened /shipments/1191 and the action bar carried no
// Khai chi phí; the FE host gate (ShipmentDetailPage) mirrored the finance
// trio only, and the BE gate refused every non-trio actor before the lot lane
// could answer. Both seams carry the role now; the trip lane stays
// finance-only for CUS exactly like OPS.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));

describe('SIL-961 — CUS khai chi phí theo lô (K5.29)', () => {
  test('the create gate admits CUS on the lot-only lane beside OPS', () => {
    const source = readFileSync(join(here, '..', '..', 'services', 'expense-accounting-create.service.ts'), 'utf8');
    assert.match(source, /actor\.role === Role\.OPS \|\| actor\.role === Role\.CUS/);
    // Trip-scoped creation stays refused for the lot-only roles — the 403
    // sits INSIDE the lot-only branch, before any write.
    const gate = source.slice(
      source.indexOf('if (actor.role === Role.OPS || actor.role === Role.CUS)'),
      source.indexOf('if (input.tripId == null) return createShipmentLevelAccountingExpense'),
    );
    assert.match(gate, /input\.tripId != null/);
    assert.match(gate, /403/);
  });

  test('the finance trio law is untouched for every other command', () => {
    const source = readFileSync(join(here, '..', '..', 'services', 'expense-accounting-write.service.ts'), 'utf8');
    assert.match(
      source,
      /if \(!\[Role\.ADMIN, Role\.MANAGER, Role\.ACCOUNTANT\]\.includes\(actor\.role\)\) throw new ApiError\(403/,
    );
  });

  test('the FE host gate passes canDeclareCost for CUS on /shipments/:id', () => {
    const source = readFileSync(join(here, '..', '..', '..', '..', 'frontend', 'src', 'pages', 'ShipmentDetailPage.tsx'), 'utf8');
    assert.match(source, /Role\.ACCOUNTANT \|\| user\.role === Role\.CUS/);
  });
});
