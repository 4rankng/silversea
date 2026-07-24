import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { tripClient } from '../../../api/tripClient';
import { qk } from '../../../api/keys';
import type { NormalizedTrip } from '../../../hooks/useTripQueries';
import { useConfirm } from '../../../components/UI';
import { onboardingEvents } from '../../../lib/onboardingEvents';
import type { ReassignState, Toast } from '../utils';

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
      onboardingEvents.emit('trip.dispatched', { tripId });
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
