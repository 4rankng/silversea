// SIL-769 (09/11, customer CR-006 2B; Frank: "khách hàng bảo thế nào thì làm
// thế") — the driver's biên lai photo is MANDATORY for exactly THREE lot fees
// (Phí Nâng / Phí Hạ / Lưu vỏ) and optional for every other lot row. The one
// shared set (`DRIVER_RECEIPT_REQUIRED_EXPENSE_TYPE_CODES`) is read by BOTH
// gates — the driver form's submit block and `insertDriverIncidentalCostTx` —
// so the pair cannot drift. These pins are filesystem-only: the shared table's
// membership, the BE gate reading it, and the absence of the superseded
// CP700-03 group law ("MỌI dòng nhóm DRIVER_SHIPMENT phải có ảnh biên lai").
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  DRIVER_LOT_COST_EXPENSE_TYPES,
  DRIVER_RECEIPT_REQUIRED_EXPENSE_TYPE_CODES,
  driverLotCostRequiresReceipt,
} from '@tingting/shared';

describe('SIL-769 — biên lai photo mandatory for exactly Phí Nâng / Phí Hạ / Lưu vỏ', () => {
  test('exactly three fees mandate the photo: LIFTING, LOWERING, YARD_STORAGE', () => {
    assert.deepEqual([...DRIVER_RECEIPT_REQUIRED_EXPENSE_TYPE_CODES].sort(), ['LIFTING', 'LOWERING', 'YARD_STORAGE']);
  });

  test('the three codes are real catalog lot-cost rows — the mapping is not invented', () => {
    for (const code of DRIVER_RECEIPT_REQUIRED_EXPENSE_TYPE_CODES) {
      assert.ok(
        DRIVER_LOT_COST_EXPENSE_TYPES.some((type) => type.code === code),
        `${code} must exist in the driver lot-cost catalog set`,
      );
    }
  });

  test('sibling lot fees and absent refs stay optional', () => {
    assert.equal(driverLotCostRequiresReceipt('FEE_CLEANING'), false);
    assert.equal(driverLotCostRequiresReceipt('FEE_WAREHOUSE'), false);
    assert.equal(driverLotCostRequiresReceipt('WAREHOUSE_LABOR'), false);
    assert.equal(driverLotCostRequiresReceipt('CONTAINER_SWAP'), false);
    // No catalog ref (the free "Chi phí lô hàng khác") — optional.
    assert.equal(driverLotCostRequiresReceipt(null), false);
    assert.equal(driverLotCostRequiresReceipt(undefined), false);
    assert.equal(driverLotCostRequiresReceipt(''), false);
  });

  test('the BE write path keys the photo rule on the shared set and names the fee', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../services/driver-fulfillment.service.ts'), 'utf8');
    assert.ok(
      source.includes('driverLotCostRequiresReceipt(input.expenseTypeCode) && !input.receiptStorageKey'),
      'the BE gate must read the shared SIL-769 set',
    );
    assert.ok(
      source.includes('phải kèm ảnh biên lai trước khi lưu.'),
      'the refusal must name the fee (SIL-769 requirement 3)',
    );
    assert.ok(
      !source.includes("effectiveGroup === 'DRIVER_SHIPMENT' && !input.receiptStorageKey"),
      'the superseded CP700-03 group law must not return',
    );
  });

  test('the FE gate mirrors the same shared helper — no local re-declaration', () => {
    const form = readFileSync(resolve(import.meta.dirname, '../../../frontend/src/components/trip/ShipmentCostEntryForm.tsx'), 'utf8');
    assert.ok(form.includes('driverLotCostRequiresReceipt'), 'the form gate must read the shared helper');
    assert.ok(
      !form.includes("return selected.group === 'DRIVER_SHIPMENT';"),
      'the old bucket-wide gate return must not return',
    );
  });
});
