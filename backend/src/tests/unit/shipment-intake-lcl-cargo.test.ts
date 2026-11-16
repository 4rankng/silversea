/**
 * LCL intake cargo gate — helpdesk 2026-10-13 + SIL-846 (KH 15/11)
 *
 * "hàng lẻ: phần thể tích (cbm) k bắt buộc cần nhập" (ops Tiếp Vu) and
 * SIL-846 "Vẫn để quy cách đóng gói, tuy nhiên không bắt buộc phải chọn mới
 * lưu được": CBM and quy cách đóng gói are both optional on the LCL create
 * path end to end. This pins the no-DB half of the intake gate
 * (assertLclIntakeCargoReady, extracted from assertIntakeReady so the unit
 * lane can reach it): a blank quy cách or CBM must NOT block submit-for-
 * dispatch, while số lượng and trọng lượng stay enforced with the exact 409
 * copy. Optional strings/numerics are deliberately unchecked beyond the
 * gate — the create-form gate owns entered-value positivity, and the
 * nullable columns plus the non-negative shared schemas own storage.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { assertLclIntakeCargoReady } from '../../services/shipment-intake.service';
import { ApiError } from '../../errors';

/** A complete LCL shipment row slice: every enforced field satisfied. */
const COMPLETE_LCL = {
  expectedDeliveryDate: '2026-10-20',
  packageType: 'Pallet',
  packageCount: 8,
  cargoWeightKg: '1200.00',
} as const;

function expectApiError(fn: () => void, statusCode: number, message: string) {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof ApiError, `expected ApiError, got ${String(error)}`);
    assert.equal(error.statusCode, statusCode);
    assert.equal(error.message, message);
    return;
  }
  assert.fail(`expected ApiError(${statusCode}, ${message}), got no throw`);
}

describe('assertLclIntakeCargoReady (LCL CBM optional, quy cách optional since SIL-846)', () => {
  test('accepts a complete LCL row regardless of CBM — blank, omitted, or zero-decimal', () => {
    // CBM is not part of the gate's input contract: null/blank never reaches
    // a check, and a stored '0.000' (API-created) must not wedge dispatch.
    assert.doesNotThrow(() => assertLclIntakeCargoReady({ ...COMPLETE_LCL }));
    assert.doesNotThrow(() => assertLclIntakeCargoReady({ ...COMPLETE_LCL, cargoVolumeCbm: null } as typeof COMPLETE_LCL));
    assert.doesNotThrow(() => assertLclIntakeCargoReady({ ...COMPLETE_LCL, cargoVolumeCbm: '0.000' } as typeof COMPLETE_LCL));
    assert.doesNotThrow(() => assertLclIntakeCargoReady({ ...COMPLETE_LCL, cargoVolumeCbm: '4.250' } as typeof COMPLETE_LCL));
  });

  test('still enforces the delivery date with the renamed-field message', () => {
    expectApiError(
      () => assertLclIntakeCargoReady({ ...COMPLETE_LCL, expectedDeliveryDate: null }),
      409,
      'Hàng lẻ cần ngày giao hàng.',
    );
  });

  test('SIL-846 — quy cách đóng gói is optional: blank/whitespace/null passes', () => {
    assert.doesNotThrow(() => assertLclIntakeCargoReady({ ...COMPLETE_LCL, packageType: '' }));
    assert.doesNotThrow(() => assertLclIntakeCargoReady({ ...COMPLETE_LCL, packageType: '   ' }));
    assert.doesNotThrow(() => assertLclIntakeCargoReady({ ...COMPLETE_LCL, packageType: null }));
  });

  test('still enforces số lượng and trọng lượng with the SIL-846 message', () => {
    const CARGO_MESSAGE = 'Hàng lẻ cần đủ số lượng và trọng lượng.';
    expectApiError(() => assertLclIntakeCargoReady({ ...COMPLETE_LCL, packageCount: null }), 409, CARGO_MESSAGE);
    expectApiError(() => assertLclIntakeCargoReady({ ...COMPLETE_LCL, packageCount: 0 }), 409, CARGO_MESSAGE);
    expectApiError(() => assertLclIntakeCargoReady({ ...COMPLETE_LCL, cargoWeightKg: null }), 409, CARGO_MESSAGE);
    expectApiError(() => assertLclIntakeCargoReady({ ...COMPLETE_LCL, cargoWeightKg: '0.00' }), 409, CARGO_MESSAGE);
  });
});
