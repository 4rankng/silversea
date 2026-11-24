// CR-010.1 (SIL-898 c) — the trailer/container-type match law at the issue
// gate: a 20'DC box must never 409 a 20FT moóc because its container TYPE is
// coded in the ISO 2x family (QA 24/11, R3M-KQ1 — a 22xx-coded 20'DC row read
// as a 40' requirement and refused a rig that had issued 20'DC legs all
// month). Pure module — mirrors the FE picker advisory (trailerFit.ts), so
// one law pins both sides.
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

  it('ISO 4x and L5 codes stay 40FT; unknown text keeps the conservative 40FT', () => {
    assert.equal(inferTrailerTypeFromContainerCode('42G1'), '40FT');
    assert.equal(inferTrailerTypeFromContainerCode('L5G1'), '40FT');
    assert.equal(inferTrailerTypeFromContainerCode('RT'), '40FT');
    assert.equal(inferTrailerTypeFromContainerCode(''), '40FT');
    assert.equal(inferTrailerTypeFromContainerCode(null), '40FT');
  });
});

describe('requiredTrailerTypeForFulfillment — classification overrides', () => {
  it('a single 20-footer (house or ISO) needs only a 20FT moóc', () => {
    assert.equal(requiredTrailerTypeForFulfillment('20DC', 'SINGLE'), '20FT');
    assert.equal(requiredTrailerTypeForFulfillment('22G1', 'SINGLE'), '20FT');
  });

  it('DOUBLE pairing and Lấy Lẻ keep the 40FT floor', () => {
    assert.equal(requiredTrailerTypeForFulfillment('20DC', 'DOUBLE'), '40FT');
    assert.equal(requiredTrailerTypeForFulfillment('22G1', 'DOUBLE'), '40FT');
    assert.equal(requiredTrailerTypeForFulfillment('22G1', 'LCL_PICKUP'), '40FT');
  });
});
