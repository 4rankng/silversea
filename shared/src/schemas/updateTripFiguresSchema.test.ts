import { test } from 'node:test';
import assert from 'node:assert';
import { bulkUpdateTripFiguresSchema, updateTripFiguresSchema } from './index';
import { FuelMode, LoadingType } from '../constants';

const validLegs = [
  { sequence: 1, origin: 'A', destination: 'B', km: 100, loadingType: LoadingType.HANG },
];

const validBase = {
  legs: validLegs,
  fuelMode: FuelMode.AUTO,
};

test('rejects fuelSupplementLiters > 0 with empty reason', () => {
  const data = {
    ...validBase,
    fuelSupplementLiters: 5,
    fuelSupplementReason: '',
  };

  const result = updateTripFiguresSchema.safeParse(data);
  assert.strictEqual(result.success, false);
  if (!result.success) {
    const reasonIssue = result.error.issues.find(i => i.path.includes('fuelSupplementReason'));
    assert.ok(reasonIssue, 'should have an issue on fuelSupplementReason');
    assert.ok(reasonIssue!.message.includes('bổ sung'), `message should mention supplement: ${reasonIssue!.message}`);
  }
});

test('rejects fuelSupplementLiters > 0 with missing reason', () => {
  const data = {
    ...validBase,
    fuelSupplementLiters: 3,
  };

  const result = updateTripFiguresSchema.safeParse(data);
  assert.strictEqual(result.success, false);
  if (!result.success) {
    const reasonIssue = result.error.issues.find(i => i.path.includes('fuelSupplementReason'));
    assert.ok(reasonIssue, 'should have an issue on fuelSupplementReason');
  }
});

test('accepts fuelSupplementLiters > 0 with provided reason', () => {
  const data = {
    ...validBase,
    fuelSupplementLiters: 5,
    fuelSupplementReason: 'Chạy máy lạnh kéo dài',
  };

  const result = updateTripFiguresSchema.safeParse(data);
  assert.strictEqual(result.success, true);
});

test('accepts fuelSupplementLiters = 0 without reason', () => {
  const data = {
    ...validBase,
    fuelSupplementLiters: 0,
  };

  const result = updateTripFiguresSchema.safeParse(data);
  assert.strictEqual(result.success, true);
});

test('accepts fuelSupplementLiters undefined without reason', () => {
  const data = {
    ...validBase,
  };

  const result = updateTripFiguresSchema.safeParse(data);
  assert.strictEqual(result.success, true);
});

test('accepts null values for external carrier fields', () => {
  const data = {
    ...validBase,
    externalCarrierId: null,
    externalFreightCost: null,
    externalPlateNumber: null,
    externalDriverName: null,
    externalDriverPhone: null,
  };

  const result = updateTripFiguresSchema.safeParse(data);
  assert.strictEqual(result.success, true);
});

test('bulkUpdateTripFiguresSchema accepts per-row malformed figures for row-level handling', () => {
  const result = bulkUpdateTripFiguresSchema.safeParse({
    updates: [
      { tripId: 1, mode: 'actuals', figures: { legs: [], fuelMode: 'AUTO' } },
      { tripId: 2, mode: 'pre-departure', figures: validBase },
    ],
  });

  assert.strictEqual(result.success, true);
});

test('bulkUpdateTripFiguresSchema rejects empty batches', () => {
  const result = bulkUpdateTripFiguresSchema.safeParse({ updates: [] });
  assert.strictEqual(result.success, false);
});
