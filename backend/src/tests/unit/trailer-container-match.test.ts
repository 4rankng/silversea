// CR-010.1 (SIL-898 c) — the trailer/container-type match law at the issue
// gate: the requirement is the container's LENGTH only. A 20'DC box must
// never 409 a 20FT moóc — not because of an ISO 2x code (QA 24/11, R3M-KQ1)
// and not because the row is classified kép (QA 24/11 round 2: R3M-KQ1 +
// R15-DRV-KEP, both DOUBLE 20'DC on the 20FT 15RM-107.28, both refused by
// the old DOUBLE-forces-40FT rule). Only a 40' container on a 20FT moóc is a
// provable mismatch. Pure module — mirrors the FE picker advisory
// (trailerFit.ts), so one law pins both sides.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  inferTrailerTypeFromContainerCode,
  requiredTrailerTypeForFulfillment,
} from '../../services/dispatch-planning-utils.service';

describe('inferTrailerTypeFromContainerCode — the length digit leads', () => {
  it('house labels keep their lengths', () => {
    assert.equal(inferTrailerTypeFromContainerCode('20DC'), '20FT');
    assert.equal(inferTrailerTypeFromContainerCode(' 20hc '), '20FT');
    assert.equal(inferTrailerTypeFromContainerCode('40DC'), '40FT');
    assert.equal(inferTrailerTypeFromContainerCode('40HC'), '40FT');
    assert.equal(inferTrailerTypeFromContainerCode('45HC'), '40FT');
  });

  it('ISO 2x codes are 20FT — the R3M-KQ1 false 409 shape', () => {
    assert.equal(inferTrailerTypeFromContainerCode('22G1'), '20FT');
    assert.equal(inferTrailerTypeFromContainerCode('22R1'), '20FT');
    assert.equal(inferTrailerTypeFromContainerCode('25G1'), '20FT');
  });

  it('a "20\'DC"-style type label reads 20FT when the code lacks the leading digit', () => {
    // Master data stores the human label in container_types.name ("20'DC");
    // the gate reads both columns (QA 24/11 round 2 — đọc đúng trường dữ liệu).
    assert.equal(inferTrailerTypeFromContainerCode('DC', "20'DC"), '20FT');
    assert.equal(inferTrailerTypeFromContainerCode('', " 20'DC "), '20FT');
    assert.equal(inferTrailerTypeFromContainerCode(null, "20'DC"), '20FT');
    assert.equal(inferTrailerTypeFromContainerCode('DC', "40'HC"), '40FT');
    assert.equal(inferTrailerTypeFromContainerCode('DC', null), '40FT');
  });

  it('ISO 4x and L5 codes stay 40FT; unknown text keeps the conservative 40FT', () => {
    assert.equal(inferTrailerTypeFromContainerCode('42G1'), '40FT');
    assert.equal(inferTrailerTypeFromContainerCode('L5G1'), '40FT');
    assert.equal(inferTrailerTypeFromContainerCode('RT'), '40FT');
    assert.equal(inferTrailerTypeFromContainerCode(''), '40FT');
    assert.equal(inferTrailerTypeFromContainerCode(null), '40FT');
  });
});

describe('requiredTrailerTypeForFulfillment — the length floor law', () => {
  it('a single 20-footer (house or ISO) needs only a 20FT moóc', () => {
    assert.equal(requiredTrailerTypeForFulfillment('20DC', 'SINGLE'), '20FT');
    assert.equal(requiredTrailerTypeForFulfillment('22G1', 'SINGLE'), '20FT');
  });

  it('a kép DOUBLE row keeps the 20FT floor — the R3M-KQ1 + R15-DRV-KEP rig', () => {
    // QA 24/11 round 2: both bulk-dispatched rows are DOUBLE-classified
    // 20'DC on the 20FT 15RM-107.28 and must issue, not 409.
    assert.equal(requiredTrailerTypeForFulfillment('20DC', 'DOUBLE'), '20FT');
    assert.equal(requiredTrailerTypeForFulfillment('22G1', 'DOUBLE'), '20FT');
    assert.equal(requiredTrailerTypeForFulfillment('DC', 'DOUBLE', "20'DC"), '20FT');
  });

  it('Lấy Lẻ keeps the 40FT floor; 40-foot containers stay blocked on 20FT', () => {
    assert.equal(requiredTrailerTypeForFulfillment('22G1', 'LCL_PICKUP'), '40FT');
    assert.equal(requiredTrailerTypeForFulfillment('40HC', 'SINGLE'), '40FT');
    assert.equal(requiredTrailerTypeForFulfillment('40HC', 'DOUBLE'), '40FT');
  });
});
