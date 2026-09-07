import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { tripClient } from '../../../api/tripClient';
import { qk } from '../../../api/keys';
import type { NormalizedTrip } from '../../../hooks/useTripQueries';
import { useConfirm } from '../../../components/UI';
import { splitRoute } from '../../../lib/route';
import type { PairingState, PairTripDraftState, ReassignState, Toast } from '../utils';

function toInputDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function buildPairDraft(trip: NormalizedTrip): PairTripDraftState {
  const route = splitRoute(trip.routeName);
  return {
    plannedStartAt: trip.plannedStartAt ? toInputDateTime(trip.plannedStartAt) : `${trip.departureDate}T08:00`,
    plannedEndAt: trip.plannedEndAt ? toInputDateTime(trip.plannedEndAt) : `${trip.departureDate}T17:00`,
    canonicalOrigin: trip.canonicalOrigin ?? route?.from ?? '',
    canonicalDestination: trip.canonicalDestination ?? route?.to ?? trip.routeName ?? '',
    cargoWeightKg: trip.cargoWeightKg ?? '',
    vehicleCapacityKg: trip.vehicleCapacityKg ?? '',
    expectedVersion: trip.version,
  };
}

function emptyPairingState(): PairingState {
  return {
    secondTripId: '',
    pairKind: 'KET_HOP',
    firstTrip: {
      plannedStartAt: '',
      plannedEndAt: '',
      canonicalOrigin: '',
      canonicalDestination: '',
      cargoWeightKg: '',
      vehicleCapacityKg: '',
    },
    secondTrip: {
      plannedStartAt: '',
      plannedEndAt: '',
      canonicalOrigin: '',
      canonicalDestination: '',
      cargoWeightKg: '',
      vehicleCapacityKg: '',
    },
    loading: false,
    error: '',
  };
}

function sameVehicleCandidate(source: NormalizedTrip, candidate: NormalizedTrip): boolean {
  return source.id !== candidate.id
    && !source.pairing
    && !candidate.pairing
    && source.carrierType !== 'EXTERNAL'
    && candidate.carrierType !== 'EXTERNAL'
    && source.truckId === candidate.truckId
    && source.driverId === candidate.driverId;
}

export function useDispatchMutations(pendingTrips: NormalizedTrip[]) {
  const queryClient = useQueryClient();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((kind: 'success' | 'error', text: string) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, kind, text }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4500);
  }, []);

  const handleDispatch = useCallback(async (tripId: number) => {
    const trip = pendingTrips.find((t) => t.id === tripId);
    if (!(await confirm('Bạn có chắc chắn muốn xuất phát chuyến đi này? Trạng thái sẽ chuyển thành Đang chạy.'))) {
      return;
    }
    setDispatching(true);
    setActionLoading(tripId);
    try {
      await tripClient.dispatchTrip(tripId);
      const code = trip?.tripCode || '';
      addToast('success', code ? `Đã xuất phát chuyến ${code}` : 'Đã xuất phát chuyến đi');
      await queryClient.invalidateQueries({ queryKey: qk.trips.dispatch });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Lỗi khi khởi hành chuyến đi.';
      addToast('error', msg);
    } finally {
      setActionLoading(null);
      setDispatching(false);
    }
  }, [pendingTrips, confirm, addToast, queryClient]);

  return { actionLoading, dispatching, toasts, setToasts, handleDispatch, confirmDialog };
}

export function useTripPairMutations(pendingTrips: NormalizedTrip[]) {
  const queryClient = useQueryClient();
  const [pairingOpen, setPairingOpen] = useState<number | null>(null);
  const [pairingState, setPairingState] = useState<PairingState>(emptyPairingState);

  const closePairing = useCallback(() => {
    setPairingOpen(null);
    setPairingState(emptyPairingState());
  }, []);

  const openPairing = useCallback((trip: NormalizedTrip) => {
    const candidate = pendingTrips.find((item) => sameVehicleCandidate(trip, item));
    setPairingOpen(trip.id);
    setPairingState({
      secondTripId: candidate ? String(candidate.id) : '',
      pairKind: 'KET_HOP',
      firstTrip: buildPairDraft(trip),
      secondTrip: candidate ? buildPairDraft(candidate) : emptyPairingState().secondTrip,
      loading: false,
      error: '',
    });
  }, [pendingTrips]);

  const selectPairCandidate = useCallback((tripId: number) => {
    const candidate = pendingTrips.find((item) => item.id === tripId);
    setPairingState((current) => ({
      ...current,
      secondTripId: tripId > 0 ? String(tripId) : '',
      secondTrip: candidate ? buildPairDraft(candidate) : emptyPairingState().secondTrip,
      error: '',
    }));
  }, [pendingTrips]);

  const handlePair = useCallback(async (firstTripId: number) => {
    const firstTrip = pendingTrips.find((item) => item.id === firstTripId);
    const secondTripId = Number(pairingState.secondTripId);
    const secondTrip = pendingTrips.find((item) => item.id === secondTripId);
    if (!firstTrip || !secondTrip) {
      setPairingState((current) => ({ ...current, error: 'Vui lòng chọn chuyến ghép chiều về' }));
      return;
    }

    const validateNumeric = (value: string, label: string): number | null => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setPairingState((current) => ({ ...current, error: `${label} phải lớn hơn 0` }));
        return null;
      }
      return parsed;
    };

    const firstCargoWeightKg = validateNumeric(pairingState.firstTrip.cargoWeightKg, 'Trọng lượng hàng chuyến 1');
    if (firstCargoWeightKg == null) return;
    const firstVehicleCapacityKg = validateNumeric(pairingState.firstTrip.vehicleCapacityKg, 'Tải trọng xe chuyến 1');
    if (firstVehicleCapacityKg == null) return;
    const secondCargoWeightKg = validateNumeric(pairingState.secondTrip.cargoWeightKg, 'Trọng lượng hàng chuyến 2');
    if (secondCargoWeightKg == null) return;
    const secondVehicleCapacityKg = validateNumeric(pairingState.secondTrip.vehicleCapacityKg, 'Tải trọng xe chuyến 2');
    if (secondVehicleCapacityKg == null) return;

    setPairingState((current) => ({ ...current, loading: true, error: '' }));
    try {
      await tripClient.createPair({
        firstTripId,
        secondTripId,
        pairKind: pairingState.pairKind,
        firstTrip: {
          ...pairingState.firstTrip,
          cargoWeightKg: firstCargoWeightKg,
          vehicleCapacityKg: firstVehicleCapacityKg,
          expectedVersion: firstTrip.version,
        },
        secondTrip: {
          ...pairingState.secondTrip,
          cargoWeightKg: secondCargoWeightKg,
          vehicleCapacityKg: secondVehicleCapacityKg,
          expectedVersion: secondTrip.version,
        },
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.trips.dispatch }),
        queryClient.invalidateQueries({ queryKey: qk.trips.all }),
        queryClient.invalidateQueries({ queryKey: qk.driver.twoOrders }),
      ]);
      closePairing();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Không thể ghép 2 chiều';
      setPairingState((current) => ({ ...current, loading: false, error: msg }));
    }
  }, [closePairing, pairingState, pendingTrips, queryClient]);

  return {
    pairingOpen,
    pairingState,
    setPairingState,
    openPairing,
    closePairing,
    selectPairCandidate,
    handlePair,
  };
}

export function useReassignMutations() {
  const queryClient = useQueryClient();
  const [reassignOpen, setReassignOpen] = useState<number | null>(null);
  const [reassignState, setReassignState] = useState<ReassignState>({
    carrierType: 'OWN',
    truckId: '', driverId: '',
    externalCarrierId: '', externalPlateNumber: '', externalDriverName: '', externalDriverPhone: '',
    loading: false, error: '',
  });

  const openReassign = useCallback((trip: NormalizedTrip) => {
    setReassignOpen(trip.id);
    setReassignState({
      carrierType: trip.carrierType || 'OWN',
      truckId: String(trip.truckId ?? ''),
      driverId: String(trip.driverId ?? ''),
      externalCarrierId: String(trip.externalCarrierId ?? ''),
      externalPlateNumber: trip.externalPlateNumber || '',
      externalDriverName: trip.externalDriverName || '',
      externalDriverPhone: trip.externalDriverPhone || '',
      loading: false, error: '',
    });
  }, []);

  const closeReassign = useCallback(() => {
    setReassignOpen(null);
    setReassignState({ 
      carrierType: 'OWN', 
      truckId: '', driverId: '', 
      externalCarrierId: '', externalPlateNumber: '', externalDriverName: '', externalDriverPhone: '',
      loading: false, error: '' 
    });
  }, []);

  const handleReassign = useCallback(async (tripId: number) => {
    if (reassignState.carrierType === 'OWN') {
      if (!reassignState.truckId || !reassignState.driverId) {
        setReassignState((s) => ({ ...s, error: 'Vui lòng chọn xe và lái xe' }));
        return;
      }
    } else {
      if (!reassignState.externalCarrierId && !reassignState.externalPlateNumber) {
        setReassignState((s) => ({ ...s, error: 'Vui lòng chọn đối tác hoặc nhập biển số' }));
        return;
      }
    }
    setReassignState((s) => ({ ...s, loading: true, error: '' }));
    try {
      await tripClient.reassignTrip(tripId, {
        carrierType: reassignState.carrierType,
        truckId: reassignState.truckId ? Number(reassignState.truckId) : null,
        driverId: reassignState.driverId ? Number(reassignState.driverId) : null,
        externalCarrierId: reassignState.externalCarrierId ? Number(reassignState.externalCarrierId) : null,
        externalPlateNumber: reassignState.externalPlateNumber,
        externalDriverName: reassignState.externalDriverName,
        externalDriverPhone: reassignState.externalDriverPhone,
      });
      await queryClient.invalidateQueries({ queryKey: qk.trips.dispatch });
      closeReassign();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Lỗi khi cập nhật';
      setReassignState((s) => ({ ...s, loading: false, error: msg }));
    }
  }, [reassignState, queryClient, closeReassign]);

  return { reassignOpen, reassignState, setReassignState, openReassign, closeReassign, handleReassign };
}
