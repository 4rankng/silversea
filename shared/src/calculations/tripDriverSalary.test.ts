import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeTripDriverSalary, resolveTripDriverSalary } from './tripDriverSalary';

describe('computeTripDriverSalary', () => {
  it('uses the fixed 26-day trip allocation divisor', () => {
    assert.equal(computeTripDriverSalary(10_000_000, 1), 384_615);
    assert.equal(computeTripDriverSalary(10_000_000, 2), 769_231);
  });

  it('uses the configured driver base salary', () => {
    assert.equal(computeTripDriverSalary(12_000_000, 1), 461_538);
  });

  it('returns zero for missing or invalid inputs', () => {
    assert.equal(computeTripDriverSalary(0, 1), 0);
    assert.equal(computeTripDriverSalary(10_000_000, 0), 0);
    assert.equal(computeTripDriverSalary(Number.NaN, 1), 0);
  });
});

describe('resolveTripDriverSalary', () => {
  it('prefers configured driver salary allocation over a legacy route fallback', () => {
    assert.equal(resolveTripDriverSalary(10_000_000, 1, 370_370), 384_615);
  });

  it('retains the legacy fallback when the driver has no configured base salary', () => {
    assert.equal(resolveTripDriverSalary(0, 1, 400_000), 400_000);
  });
});
