import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TripStatus } from '@tingting/shared';

import type { NormalizedTrip } from '../../../hooks/useTripQueries';
import type { PairingState, ReassignState } from '../utils';
import { DispatchTripCard } from './DispatchTripCard';

const trip = (overrides: Partial<NormalizedTrip> = {}): NormalizedTrip => ({
  id: 1,
  version: 3,
  customerId: 10,
  customerName: 'Công ty ABC',
  truckId: 20,
  truckPlate: '51D-12345',
  driverId: 30,
  driverName: 'Nguyễn Văn A',
  routeId: 40,
  routeName: 'Cát Lái → Bình Dương',
  trailerType: '40FT',
  cargoTypeId: 50,
  status: 'CREATED',
  departureDate: '2026-07-27',
  plannedStartAt: '2026-07-27T08:00:00.000Z',
  plannedEndAt: '2026-07-27T12:00:00.000Z',
  canonicalOrigin: 'Cát Lái',
  canonicalDestination: 'Bình Dương',
  cargoWeightKg: '12000',
  vehicleCapacityKg: '18000',
  tripCode: 'TRIP-001',
  notes: undefined,
  pairing: null,
  carrierType: 'OWN',
  externalCarrierId: null,
  externalPlateNumber: null,
  externalDriverName: null,
  externalDriverPhone: null,
  ...overrides,
});

const reassignState: ReassignState = {
  carrierType: 'OWN',
  truckId: '',
  driverId: '',
  externalCarrierId: '',
  externalPlateNumber: '',
  externalDriverName: '',
  externalDriverPhone: '',
  loading: false,
  error: '',
};

const pairingState: PairingState = {
  secondTripId: '',
  firstTrip: {
    plannedStartAt: '2026-07-27T08:00',
    plannedEndAt: '2026-07-27T12:00',
    canonicalOrigin: 'Cát Lái',
    canonicalDestination: 'Bình Dương',
    cargoWeightKg: '12000',
    vehicleCapacityKg: '18000',
  },
  secondTrip: {
    plannedStartAt: '2026-07-28T09:00',
    plannedEndAt: '2026-07-28T13:00',
    canonicalOrigin: 'Bình Dương',
    canonicalDestination: 'Cát Lái',
    cargoWeightKg: '11000',
    vehicleCapacityKg: '18000',
  },
  loading: false,
  error: '',
};

describe('DispatchTripCard pairing UI', () => {
  it('renders persisted pair metrics for an already paired trip', () => {
    render(
      <DispatchTripCard
        trip={trip({
          pairing: {
            pairId: 42,
            order: 1,
            status: 'ACTIVE',
            partnerTripId: 2,
            partnerTripCode: 'TRIP-002',
            partnerStatus: TripStatus.CREATED,
            partnerDepartureDate: '2026-07-28',
            partnerRouteName: 'Bình Dương → Cát Lái',
            emptyDistanceKm: '22.5',
            combinedEfficiencyPercent: '88.2',
            requiredGapMinutes: 70,
            actualGapMinutes: 95,
            breakReason: null,
            survivingTripId: null,
            lateByMinutes: null,
          },
        })}
        pendingTrips={[trip()]}
        isEditing={false}
        isPairing={false}
        pairingState={pairingState}
        setPairingState={vi.fn()}
        reassignState={reassignState}
        setReassignState={vi.fn()}
        trucks={[]}
        drivers={[]}
        carrierCustomers={[]}
        onDispatch={vi.fn()}
        onOpenPairing={vi.fn()}
        onClosePairing={vi.fn()}
        onSelectPairCandidate={vi.fn()}
        onPair={vi.fn()}
        onOpenReassign={vi.fn()}
        onCloseReassign={vi.fn()}
        onReassign={vi.fn()}
        dispatching={false}
        actionLoadingId={null}
      />,
    );

    expect(screen.getByText('Cặp chuyến 2 chiều')).toBeTruthy();
    expect(screen.getByText(/22.5 km/)).toBeTruthy();
    expect(screen.queryByText('Ghép 2 chiều')).toBeNull();
  });

  it('shows the pairing editor with the available return-trip candidates', async () => {
    const onSelectPairCandidate = vi.fn();
    render(
      <DispatchTripCard
        trip={trip()}
        pendingTrips={[
          trip(),
          trip({
            id: 2,
            version: 4,
            tripCode: 'TRIP-002',
            routeName: 'Bình Dương → Cát Lái',
            departureDate: '2026-07-28',
          }),
        ]}
        isEditing={false}
        isPairing
        pairingState={pairingState}
        setPairingState={vi.fn()}
        reassignState={reassignState}
        setReassignState={vi.fn()}
        trucks={[]}
        drivers={[]}
        carrierCustomers={[]}
        onDispatch={vi.fn()}
        onOpenPairing={vi.fn()}
        onClosePairing={vi.fn()}
        onSelectPairCandidate={onSelectPairCandidate}
        onPair={vi.fn()}
        onOpenReassign={vi.fn()}
        onCloseReassign={vi.fn()}
        onReassign={vi.fn()}
        dispatching={false}
        actionLoadingId={null}
      />,
    );

    expect(screen.getByText(/Ghép điều vận 2 chiều/)).toBeTruthy();
    const trigger = screen.getByRole('button', { name: /Chuyến chiều về/ });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('option', { name: /TRIP-002/ }));
    expect(onSelectPairCandidate).toHaveBeenCalledWith(2);
  });
});
