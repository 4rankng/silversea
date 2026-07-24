import type { Driver, PenaltyReason, Truck } from '@tingting/shared';
import type { PenaltyRow } from '../../../hooks/usePenalties';

export interface PenaltyTableProps {
  penalties: PenaltyRow[];
  drivers: Driver[];
  reasons: PenaltyReason[];
  trucks: Truck[];
  listLoading: boolean;
  canCancel: boolean;
  onOpenDrawer: (driverId?: number) => void;
  onCancelPenalty: (penalty: PenaltyRow) => void;
}
