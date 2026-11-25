// SIL-1042 (K5.49) — the driver's expense input requires a POSITIVE amount.
// The negative "bút toán điều chỉnh" belongs to the reconciliation layer
// only: the BE write shared by the single create and the batch refuses
// amount < 0 (one rule set governing every driver cost path — the same law
// as the SIL-769 receipt guard), and the driver form refuses the row with a
// row-numbered error before calling the API. The accounting side keeps its
// signed entries (`signedExpenseVndSchema`, OpsExpenseFormModal) untouched.
// Pins are source-level, per the sil769 precedent for this service: the
// guard lives inside `insertDriverIncidentalCostTx` — the function needs a
// live transaction, and the pin's job is to keep the guard on the SHARED
// write (not a route-only patch that the batch could bypass).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const service = readFileSync(resolve(import.meta.dirname, '../services/driver-fulfillment.service.ts'), 'utf8');
const hook = readFileSync(resolve(import.meta.dirname, '../../../frontend/src/features/driver/useDriverExpenseEntry.ts'), 'utf8');
const form = readFileSync(resolve(import.meta.dirname, '../../../frontend/src/components/trip/ShipmentCostEntryForm.tsx'), 'utf8');
const shared = readFileSync(resolve(import.meta.dirname, '../../../shared/src/expense-accounting.ts'), 'utf8');

describe('SIL-1042 — driver cost write requires a positive amount', () => {
  test('the BE guard refuses negatives on the shared driver write path and names the reconciliation layer', () => {
    assert.ok(service.includes('if (input.amount < 0)'), 'insertDriverIncidentalCostTx must carry the SIL-1042 negative guard');
    assert.ok(
      service.includes('Số tiền phải là số dương — khoản hoàn lại (số âm) do kế toán ghi ở tầng đối soát'),
      'the refusal must point the refund case at the reconciliation layer',
    );
  });

  test('the driver form refuses a negative row (row-numbered) before the API call', () => {
    assert.ok(hook.includes('row.amount < 0'), 'the save hook must refuse negative rows');
    assert.ok(
      hook.includes('Số tiền phải là số dương — màn nhập không nhận số âm'),
      'the hook refusal mirrors the K5.49 wording',
    );
    assert.ok(
      form.includes('data-testid="shipment-cost-negative-error"'),
      'the live field error replaces the old informational note',
    );
    assert.ok(!form.includes('shipment-cost-negative-note'), 'the superseded note must not return');
  });

  test('the accounting side keeps its signed entries — no guard lands on the shared schema', () => {
    assert.ok(shared.includes('signedExpenseVndSchema'), 'the signed schema is the accounting-side contract');
    assert.ok(!shared.includes('input.amount < 0'), 'the shared schema must stay signed; the guard is driver-path only');
  });
});
