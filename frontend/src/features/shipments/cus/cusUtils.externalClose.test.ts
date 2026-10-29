import { describe, expect, it } from 'vitest';
import { TripStatus } from '@tingting/shared';
import { canCompleteExternalTrip } from './cusUtils';

// SIL-592 (id 692) — the CUS staff-close gate for external-carrier trips.
// Backend law (trip-status-machine: "An external-carrier trip never enters
// IN_TRANSIT — staff close admits CREATED directly"; trip-external-close card
// 20261004_359: a trip that ran must carry its biển số): a plated live
// EXTERNAL trip is closable from CUS; own-fleet trips close through the driver
// app, terminal states must never re-close, and a deferred-plate trip shows no
// affordance until "Phân xe lại" fills the plate.
describe('canCompleteExternalTrip — CUS staff-close gate', () => {
  it('closes a running EXTERNAL trip', () => {
    expect(canCompleteExternalTrip({ tripId: 55, tripStatus: TripStatus.IN_TRANSIT, carrierType: 'EXTERNAL', plateNumber: '30A-123.45' })).toBe(true);
  });

  it('admits a CREATED EXTERNAL trip — staff close skips the driver-only start', () => {
    expect(canCompleteExternalTrip({ tripId: 55, tripStatus: TripStatus.CREATED, carrierType: 'EXTERNAL', plateNumber: '30A-123.45' })).toBe(true);
  });

  it('refuses an already COMPLETED trip (terminal — Q18)', () => {
    expect(canCompleteExternalTrip({ tripId: 55, tripStatus: TripStatus.COMPLETED, carrierType: 'EXTERNAL', plateNumber: '30A-123.45' })).toBe(false);
  });

  it('refuses a CANCELED trip', () => {
    expect(canCompleteExternalTrip({ tripId: 55, tripStatus: TripStatus.CANCELED, carrierType: 'EXTERNAL', plateNumber: '30A-123.45' })).toBe(false);
  });

  it('refuses a planned line with no live trip yet', () => {
    expect(canCompleteExternalTrip({ tripId: null, tripStatus: null, carrierType: 'EXTERNAL', plateNumber: '30A-123.45' })).toBe(false);
    expect(canCompleteExternalTrip({ tripId: undefined, tripStatus: undefined, carrierType: 'EXTERNAL', plateNumber: '30A-123.45' })).toBe(false);
  });

  it('refuses OWN-fleet trips — the driver app closes those', () => {
    expect(canCompleteExternalTrip({ tripId: 55, tripStatus: TripStatus.IN_TRANSIT, carrierType: 'OWN', plateNumber: '30A-123.45' })).toBe(false);
    expect(canCompleteExternalTrip({ tripId: 55, tripStatus: TripStatus.IN_TRANSIT, carrierType: null, plateNumber: '30A-123.45' })).toBe(false);
  });

  it('refuses when the trip status is unknown (legacy producer)', () => {
    expect(canCompleteExternalTrip({ tripId: 55, tripStatus: null, carrierType: 'EXTERNAL', plateNumber: '30A-123.45' })).toBe(false);
  });

  it('refuses a deferred-plate trip — the server 409s until Phân xe lại fills the biển số', () => {
    expect(canCompleteExternalTrip({ tripId: 55, tripStatus: TripStatus.IN_TRANSIT, carrierType: 'EXTERNAL', plateNumber: null })).toBe(false);
    expect(canCompleteExternalTrip({ tripId: 55, tripStatus: TripStatus.CREATED, carrierType: 'EXTERNAL', plateNumber: '  ' })).toBe(false);
  });
});
