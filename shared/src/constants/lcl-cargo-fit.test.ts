import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { assessLclCargoFit, parseTonnageKg } from './lcl-cargo-fit';

describe('REQ-19 LCL cargo fit — parseTonnageKg (class code → kg)', () => {
  test('parses the canonical tonnage ladder', () => {
    assert.equal(parseTonnageKg('1.25T'), 1250);
    assert.equal(parseTonnageKg('2.5T'), 2500);
    assert.equal(parseTonnageKg('5T'), 5000);
    assert.equal(parseTonnageKg('15T'), 15000);
  });

  test('tolerates spacing and comma decimals, rejects everything else', () => {
    assert.equal(parseTonnageKg(' 5T '), 5000);
    assert.equal(parseTonnageKg('2,5T'), 2500);
    // Container codes and legacy/QA noise classes carry no tonnage — never guess.
    assert.equal(parseTonnageKg('CONT20'), null);
    assert.equal(parseTonnageKg('CONT40.LIGHT'), null);
    assert.equal(parseTonnageKg('E5T75677358'), null);
    assert.equal(parseTonnageKg(''), null);
  });
});

describe('REQ-19 LCL cargo fit — assessLclCargoFit (group Σkg vs class)', () => {
  // The brief's audit case: 1 xe 5T gom 3 lô (1.5T + 1.5T + 2T).
  const briefCase = [1500, 1500, 2000];

  test('5T class with exactly 5.000 kg of consolidated lots FITS', () => {
    const fit = assessLclCargoFit({
      isContainer: false,
      vehicleClassCode: '5T',
      cargoWeightKg: briefCase,
    });
    assert.equal(fit.status, 'FITS');
    assert.equal(fit.totalWeightKg, 5000);
    assert.equal(fit.tonnageKg, 5000);
  });

  test('5T class with 6.000 kg of consolidated lots is OVER (advisory)', () => {
    const fit = assessLclCargoFit({
      isContainer: false,
      vehicleClassCode: '5T',
      cargoWeightKg: [1500, 1500, 3000],
    });
    assert.equal(fit.status, 'OVER');
    assert.equal(fit.totalWeightKg, 6000);
    assert.equal(fit.tonnageKg, 5000);
  });

  test('null weights are skipped, not counted as zero-fact total', () => {
    const partial = assessLclCargoFit({
      isContainer: false,
      vehicleClassCode: '5T',
      cargoWeightKg: [1500, null, 2000],
    });
    assert.equal(partial.status, 'FITS');
    assert.equal(partial.totalWeightKg, 3500);

    const none = assessLclCargoFit({
      isContainer: false,
      vehicleClassCode: '5T',
      cargoWeightKg: [null, null],
    });
    assert.equal(none.status, 'NO_WEIGHT');
    assert.equal(none.totalWeightKg, null);
    assert.equal(none.tonnageKg, 5000);
  });

  test('container classes are priced per shell — no kg fit, no invented CBM capacity', () => {
    const fit = assessLclCargoFit({
      isContainer: true,
      vehicleClassCode: 'CONT20',
      cargoWeightKg: briefCase,
    });
    assert.equal(fit.status, 'CONTAINER_CLASS');
    assert.equal(fit.tonnageKg, null);
    // The totals still ride along so the surface can show Σkg / ΣCBM.
    assert.equal(fit.totalWeightKg, 5000);
  });

  test('truck-kind class with an unparseable code is UNKNOWN_CLASS, never a guess', () => {
    const fit = assessLclCargoFit({
      isContainer: false,
      vehicleClassCode: 'E5T75677358',
      cargoWeightKg: briefCase,
    });
    assert.equal(fit.status, 'UNKNOWN_CLASS');
    assert.equal(fit.tonnageKg, null);
    assert.equal(fit.totalWeightKg, 5000);
  });
});
