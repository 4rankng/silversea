/**
 * Round 19 (Đổi nhà xe + biển sau phát lệnh) — the reassignment route's
 * carrier-vehicle forwarding contract. The old blanket
 * `externalCarrierVehicleId: trip.externalCarrierVehicleId` made a carrier or
 * plate change impossible: the preserved vehicle belongs to the OLD carrier
 * (409 "Xe không thuộc nhà xe đã gán hoặc không còn hoạt động.") and its
 * stored plate silently beat the typed one. See
 * resolveReassignExternalVehicleId for the decision table under test.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveReassignExternalVehicleId } from '../../services/trip-lifecycle-ops.service';

const TRIP = {
  externalCarrierId: 9,
  externalPlateNumber: '60C-111.11',
  externalCarrierVehicleId: 101,
};

describe('resolveReassignExternalVehicleId (round 19 change-carrier)', () => {
  test('keeps the issued vehicle when the payload changes neither carrier nor plate', () => {
    assert.equal(resolveReassignExternalVehicleId({
      trip: TRIP,
      payload: { externalCarrierId: 9, externalPlateNumber: '60C-111.11' },
    }), 101);
    // Partner-less payload (no carrier, no plate) is the idempotent re-save.
    assert.equal(resolveReassignExternalVehicleId({ trip: TRIP, payload: {} }), 101);
  });

  test('drops the issued vehicle when the payload switches carrier (TC-R19-REASSIGN-01)', () => {
    assert.equal(resolveReassignExternalVehicleId({
      trip: TRIP,
      payload: { externalCarrierId: 11, externalPlateNumber: '60C-222.22' },
    }), null);
    // Even a plate-less carrier switch must not keep the old carrier's vehicle.
    assert.equal(resolveReassignExternalVehicleId({
      trip: TRIP,
      payload: { externalCarrierId: 11 },
    }), null);
  });

  test('drops the issued vehicle when a different plate is typed for the same carrier', () => {
    // Case-insensitive compare: formatting-only differences keep the vehicle.
    assert.equal(resolveReassignExternalVehicleId({
      trip: TRIP,
      payload: { externalCarrierId: 9, externalPlateNumber: ' 60c-111.11 ' },
    }), 101);
    // A genuinely different plate means a different vehicle — the typed text
    // must ride, not the preserved vehicle's stored plate.
    assert.equal(resolveReassignExternalVehicleId({
      trip: TRIP,
      payload: { externalCarrierId: 9, externalPlateNumber: '60C-999.99' },
    }), null);
    // An emptied plate only counts as a change when the trip carried one.
    assert.equal(resolveReassignExternalVehicleId({
      trip: TRIP,
      payload: { externalCarrierId: 9, externalPlateNumber: '  ' },
    }), 101);
  });

  test('an explicit picker-provided vehicle id always wins', () => {
    assert.equal(resolveReassignExternalVehicleId({
      trip: TRIP,
      payload: { externalCarrierId: 11, externalPlateNumber: '60C-222.22', externalCarrierVehicleId: 205 },
    }), 205);
    assert.equal(resolveReassignExternalVehicleId({
      trip: TRIP,
      payload: { externalCarrierVehicleId: 205 },
    }), 205);
  });

  test('a vehicle-less issued trip stays vehicle-less unless the picker names one', () => {
    assert.equal(resolveReassignExternalVehicleId({
      trip: { externalCarrierId: 9, externalPlateNumber: '60C-111.11', externalCarrierVehicleId: null },
      payload: { externalCarrierId: 9, externalPlateNumber: '60C-111.11' },
    }), null);
  });
});
