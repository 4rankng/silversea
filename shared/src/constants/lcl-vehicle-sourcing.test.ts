import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LclVehicleSourcing,
  LCL_VEHICLE_SOURCING_LABELS,
  lclVehicleSourcingRule,
} from './index';

describe('FB-090 LCL vehicle sourcing rule (DEV SPEC Hàng lẻ §I)', () => {
  test('truck tonnage classes are 100% external (EXTERNAL_ONLY)', () => {
    // "Hàng lẻ Xe tải = 100% Xe ngoài" — every tonnage class (1.25T…15T)
    // has isContainer=false in vehicle_size_classes.
    assert.equal(lclVehicleSourcingRule(false), LclVehicleSourcing.EXTERNAL_ONLY);
  });

  test('container classes allow internal or external fleet', () => {
    // "Hàng lẻ Cont 20'/40' = Xe nội bộ hoặc Xe ngoài".
    assert.equal(
      lclVehicleSourcingRule(true),
      LclVehicleSourcing.INTERNAL_OR_EXTERNAL,
    );
  });

  test('every rule has a Vietnamese display label', () => {
    for (const rule of Object.values(LclVehicleSourcing)) {
      assert.ok(
        LCL_VEHICLE_SOURCING_LABELS[rule]?.trim(),
        `missing label for ${rule}`,
      );
    }
    assert.equal(
      LCL_VEHICLE_SOURCING_LABELS[LclVehicleSourcing.EXTERNAL_ONLY],
      '100% xe ngoài',
    );
    assert.equal(
      LCL_VEHICLE_SOURCING_LABELS[LclVehicleSourcing.INTERNAL_OR_EXTERNAL],
      'Xe nội bộ hoặc xe ngoài',
    );
  });
});
