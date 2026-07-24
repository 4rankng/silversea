import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { identifyLegacyTripSalary } from '../services/legacy-trip-salary-repair';

const JULY_2026_OLD_VALUE = 370_370;

describe('identifyLegacyTripSalary', () => {
  it('recognizes the July 2026 calendar-divisor salary and returns the fixed-26 correction', () => {
    assert.deepEqual(identifyLegacyTripSalary({
      status: 'COMPLETED',
      carrierType: 'OWN',
      departureDate: '2026-07-10',
      baseSalary: 10_000_000,
      tripWageDays: 1,
      storedDriverSalary: JULY_2026_OLD_VALUE,
    }), {
      legacyDivisor: 27,
      legacyDriverSalary: JULY_2026_OLD_VALUE,
      correctedDriverSalary: 384_615,
      salaryDelta: 14_245,
    });
  });

  it('does not touch a manual override', () => {
    assert.equal(identifyLegacyTripSalary({
      status: 'COMPLETED',
      carrierType: 'OWN',
      departureDate: '2026-07-10',
      baseSalary: 10_000_000,
      tripWageDays: 1,
      storedDriverSalary: 400_000,
    }), null);
  });

  it('does not touch locked, canceled, or external trips', () => {
    for (const input of [
      { status: 'LOCKED', carrierType: 'OWN' },
      { status: 'CANCELED', carrierType: 'OWN' },
      { status: 'COMPLETED', carrierType: 'EXTERNAL' },
    ]) {
      assert.equal(identifyLegacyTripSalary({
        ...input,
        departureDate: '2026-07-10',
        baseSalary: 10_000_000,
        tripWageDays: 1,
        storedDriverSalary: JULY_2026_OLD_VALUE,
      }), null);
    }
  });

  it('does not report months where the retired divisor already equaled 26', () => {
    assert.equal(identifyLegacyTripSalary({
      status: 'COMPLETED',
      carrierType: 'OWN',
      departureDate: '2026-06-10',
      baseSalary: 10_000_000,
      tripWageDays: 1,
      storedDriverSalary: 384_615,
    }), null);
  });
});
