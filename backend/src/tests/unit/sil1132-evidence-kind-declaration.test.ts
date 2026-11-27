// SIL-1132 — the SAVED-row evidence-kind declaration (Hóa đơn / Phiếu thu)
// from the "Xem / bổ sung chứng từ" panel. The endpoint is a convergent
// single-field classification write; these pins hold its two pure laws —
// extracted beside the create write so BOTH paths read one rule set:
//   1. `receiptKindPhotoRefusal` — the ROAD "Phiếu thu" photo law, the exact
//      clause the create path enforces (SIL-769 scope, unchanged).
//   2. `evidenceKindDeclarationRefusal` — the declaration verdict: system-
//      recorded rows stay locked (card 20261005), legacy NULL cost_group rows
//      fall back like the write path, then the photo law above.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DriverIncidentalCostType } from '@tingting/shared';
import {
  driverCostFallbackGroup,
  evidenceKindDeclarationRefusal,
  receiptKindPhotoRefusal,
} from '../../services/driver-fulfillment.service';

describe('SIL-1132 — evidence-kind declaration laws (pure)', () => {
  test('Phiếu thu on a ROAD row without its biên lai is refused — the create law verbatim', () => {
    assert.equal(
      receiptKindPhotoRefusal({ evidenceKind: 'RECEIPT', receiptStorageKey: null, costGroup: 'DRIVER_ROAD' }),
      'Chọn Phiếu thu thì phải chụp biên lai trước khi lưu.',
    );
  });

  test('Phiếu thu with the paper, or any LOT row, stands (SIL-769 owns lot photos at create)', () => {
    assert.equal(receiptKindPhotoRefusal({ evidenceKind: 'RECEIPT', receiptStorageKey: 'receipt.png', costGroup: 'DRIVER_ROAD' }), null);
    assert.equal(receiptKindPhotoRefusal({ evidenceKind: 'RECEIPT', receiptStorageKey: null, costGroup: 'DRIVER_SHIPMENT' }), null);
  });

  test('Hóa đơn is declarable whatever the row carries', () => {
    assert.equal(receiptKindPhotoRefusal({ evidenceKind: 'INVOICE', receiptStorageKey: null, costGroup: 'DRIVER_ROAD' }), null);
  });

  test('system-recorded rows stay locked for the driver (card 20261005)', () => {
    assert.equal(
      evidenceKindDeclarationRefusal({ costType: DriverIncidentalCostType.ROAD_ALLOWANCE, costGroup: 'DRIVER_ROAD', feeNormCode: null, receiptStorageKey: null }, 'INVOICE'),
      'Khoản này do hệ thống tự ghi nhận.',
    );
    assert.equal(
      evidenceKindDeclarationRefusal({ costType: DriverIncidentalCostType.LIFT_DROP_ZONE, costGroup: 'DRIVER_ROAD', feeNormCode: null, receiptStorageKey: null }, 'RECEIPT'),
      'Khoản này do hệ thống tự ghi nhận.',
    );
    // …but the norm-backed LIFT_DROP_ZONE row keeps its legitimate path (the
    // create write's own feeNormCode exception).
    assert.equal(
      evidenceKindDeclarationRefusal({ costType: DriverIncidentalCostType.LIFT_DROP_ZONE, costGroup: 'DRIVER_ROAD', feeNormCode: 'LIFT_DROP_ALLOWANCE', receiptStorageKey: 'receipt.png' }, 'RECEIPT'),
      null,
    );
  });

  test('a legacy NULL cost_group falls back like the write path before the photo law reads it', () => {
    assert.equal(driverCostFallbackGroup(null, DriverIncidentalCostType.TOLL), 'DRIVER_ROAD');
    assert.equal(driverCostFallbackGroup(null, DriverIncidentalCostType.LIFT_FEE), 'DRIVER_SHIPMENT');
    // An explicit bucket always wins over the enum fallback.
    assert.equal(driverCostFallbackGroup('DRIVER_SHIPMENT', DriverIncidentalCostType.TOLL), 'DRIVER_SHIPMENT');
    // Legacy ROAD row + Phiếu thu + no paper refuses; the Hóa đơn flip stands.
    assert.equal(
      evidenceKindDeclarationRefusal({ costType: DriverIncidentalCostType.TOLL, costGroup: null, feeNormCode: null, receiptStorageKey: null }, 'RECEIPT'),
      'Chọn Phiếu thu thì phải chụp biên lai trước khi lưu.',
    );
    assert.equal(
      evidenceKindDeclarationRefusal({ costType: DriverIncidentalCostType.TOLL, costGroup: null, feeNormCode: null, receiptStorageKey: null }, 'INVOICE'),
      null,
    );
  });

  test('both write paths call the SHARED pure laws — one rule set cannot drift', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../../services/driver-fulfillment.service.ts'), 'utf8');
    assert.ok(
      source.includes('const receiptKindRefusal = receiptKindPhotoRefusal('),
      'insertDriverIncidentalCostTx must refuse through the shared pure photo law',
    );
    assert.ok(
      source.includes('const refusal = evidenceKindDeclarationRefusal(row, evidenceKind);'),
      'the declaration must run the shared declaration law on the stored row',
    );
  });
});
