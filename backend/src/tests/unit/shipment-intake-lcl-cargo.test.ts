/**
 * LCL intake cargo gate — helpdesk 2026-10-13 (ops Tiếp Vu)
 *
 * "hàng lẻ: phần thể tích (cbm) k bắt buộc cần nhập": CBM is optional on the
 * LCL create path end to end. This pins the no-DB half of the intake gate
 * (assertLclIntakeCargoReady, extracted from assertIntakeReady so the unit
 * lane can reach it): a blank/omitted CBM must NOT block submit-for-dispatch,
 * while quy cách, số lượng and trọng lượng stay enforced with the exact 409
 * copy. CBM itself is deliberately unchecked here — the create-form gate
 * owns entered-value positivity, and the nullable numeric column plus the
 * non-negative shared schemas own storage ('0.000' may exist from API
 * clients and must not wedge dispatch).
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

describe('assertLclIntakeCargoReady (LCL CBM optional, helpdesk 2026-10-13)', () => {
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

  test('still enforces quy cách, số lượng and trọng lượng with the CBM-free message', () => {
    const CARGO_MESSAGE = 'Hàng lẻ cần đủ quy cách, số lượng và trọng lượng.';
    expectApiError(() => assertLclIntakeCargoReady({ ...COMPLETE_LCL, packageType: '' }), 409, CARGO_MESSAGE);
    expectApiError(() => assertLclIntakeCargoReady({ ...COMPLETE_LCL, packageType: '   ' }), 409, CARGO_MESSAGE);
    expectApiError(() => assertLclIntakeCargoReady({ ...COMPLETE_LCL, packageType: null }), 409, CARGO_MESSAGE);
    expectApiError(() => assertLclIntakeCargoReady({ ...COMPLETE_LCL, packageCount: null }), 409, CARGO_MESSAGE);
    expectApiError(() => assertLclIntakeCargoReady({ ...COMPLETE_LCL, packageCount: 0 }), 409, CARGO_MESSAGE);
    expectApiError(() => assertLclIntakeCargoReady({ ...COMPLETE_LCL, cargoWeightKg: null }), 409, CARGO_MESSAGE);
    expectApiError(() => assertLclIntakeCargoReady({ ...COMPLETE_LCL, cargoWeightKg: '0.00' }), 409, CARGO_MESSAGE);
  });
});
